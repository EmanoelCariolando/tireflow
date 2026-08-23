import assert from 'node:assert/strict';
import test from 'node:test';
import { Message } from 'whatsapp-web.js';
import {
  formatProductList,
  handlePneuCommand,
  handlePneuHelpCommand,
  isPneuHelpCommand,
  isStandaloneTireSizeCommand,
  isTireSizeLikeCommand,
  formatResolvedReferenceNotice,
  formatProductChoiceQuestion,
  handleLegacyPneuCommandNotice,
} from '../src/commands/pneuCommand.js';
import {
  handleZeroStockCommand,
  isZeroStockCommand,
} from '../src/commands/menuCommand.js';
import { productRepository } from '../src/repositories/productRepository.js';
import { clearLastQuery, getLastQuery } from '../src/utils/lastQueryStore.js';
import {
  buildReferenceCandidates,
  rankReferenceSuggestions,
} from '../src/services/productService.js';
import { normalizeTireSize } from '../src/utils/normalizeTireSize.js';
import {
  clearProductActionSession,
  getProductActionSession,
} from '../src/utils/productActionSessionStore.js';

test('accepts both pneu and pneus as the tire command help', () => {
  assert.equal(isPneuHelpCommand('pneu'), true);
  assert.equal(isPneuHelpCommand('PNEUS'), true);
  assert.equal(isPneuHelpCommand('pneu 175/70 R14'), false);
});

test('redirects the legacy pneu measure format to the standalone size', async () => {
  let replyText = '';
  const message = {
    reply: async (text: string) => {
      replyText = text;
    },
  } as unknown as Message;

  await handleLegacyPneuCommandNotice(message);

  assert.equal(
    replyText,
    'ℹ️ A consulta mudou. Agora, digite apenas a medida.\nEx.: *175 70 14*'
  );
});

test('accepts a standalone tire size without treating ordinary messages as queries', () => {
  assert.equal(isStandaloneTireSizeCommand('175 75 13'), true);
  assert.equal(isStandaloneTireSizeCommand('175/75 R13'), true);
  assert.equal(isStandaloneTireSizeCommand('pneu 175 75 13'), false);
  assert.equal(isStandaloneTireSizeCommand('bom dia'), false);
  assert.equal(isTireSizeLikeCommand('205 7 15'), true);
  assert.equal(isTireSizeLikeCommand('175.70.14'), true);
  assert.equal(isTireSizeLikeCommand('bom dia 205 70 15'), false);
});

test('recognizes the explicit zero-stock query', () => {
  assert.equal(isZeroStockCommand('0 175 75 13'), true);
  assert.equal(isZeroStockCommand('0 175/75 R13'), true);
  assert.equal(isZeroStockCommand('0'), false);
  assert.equal(isZeroStockCommand('zero 175 75 13'), false);
  assert.equal(isZeroStockCommand('zerado 175 75 13'), false);
});

test('a base metric size includes its C variant without broadening an explicit C query', () => {
  const baseCandidates = buildReferenceCandidates('205/70 R15');
  assert.ok(baseCandidates.includes('205/70 R15'));
  assert.ok(baseCandidates.includes('205/70 R15C'));
  assert.ok(baseCandidates.includes('205/70/15'));
  assert.ok(baseCandidates.includes('205/70/15C'));

  const commercialCandidates = buildReferenceCandidates('205/70 R15C');
  assert.ok(commercialCandidates.includes('205/70 R15C'));
  assert.equal(commercialCandidates.includes('205/70 R15'), false);
});

test('compact commercial sizes match their equivalent decimal notation', () => {
  const compact = normalizeTireSize('1400 16');
  assert.equal(compact, '1400/16');
  assert.ok(buildReferenceCandidates(compact).includes('14.00/16'));
  assert.ok(buildReferenceCandidates(compact).includes('14.00-16'));

  const decimal = normalizeTireSize('14.00 16');
  assert.equal(decimal, '14.00/16');
  assert.ok(buildReferenceCandidates(decimal).includes('1400/16'));
  assert.ok(buildReferenceCandidates(decimal).includes('1400-16'));

  // A metric width must never be reinterpreted as a decimal commercial size.
  assert.equal(buildReferenceCandidates('205/16').includes('2.05/16'), false);
});

test('ranks only close active-reference candidates and limits the result', () => {
  const references = [
    '205/70 R15',
    '205/70 R15C',
    '205/75 R15',
    '205/70 R16',
    '275/80 R22.5',
  ];

  assert.deepEqual(rankReferenceSuggestions('205 7 15', references), [
    '205/70 R15',
    '205/75 R15',
    '205/70 R16',
  ]);
  assert.deepEqual(rankReferenceSuggestions('medida errada', references), []);
});

test('reports the registered reference when an equivalent spelling was used', () => {
  const notice = formatResolvedReferenceNotice('1400/16', [
    {
      id: 'commercial-size',
      reference: '14.00/16',
      description: 'PNEU COMERCIAL',
      stock: 1,
      cashPrice: 1,
      creditPrice: 1,
    },
  ]);

  assert.equal(notice, '🔎 Medida encontrada como: *14.00/16*');
});

test('pneu without a measure shows only the short migration notice', async () => {
  let replyText = '';
  const message = {
    reply: async (text: string) => {
      replyText = text;
    },
  } as unknown as Message;

  await handlePneuHelpCommand(message);

  assert.equal(
    replyText,
    'ℹ️ A consulta mudou. Agora, digite apenas a medida.\nEx.: *175 70 14*'
  );
  assert.doesNotMatch(replyText, /COMANDOS|ATALHOS|foto|entrada|venda/);
});

test('zero query lists and caches only products without stock', async () => {
  const userId = 'zero-query-user';
  const chatId = 'zero-query-chat@g.us';
  const replies: string[] = [];
  const mutableRepository = productRepository as unknown as {
    findActiveByReferences: (references: string[]) => Promise<Array<Record<string, unknown>>>;
  };
  const originalFindActiveByReferences = mutableRepository.findActiveByReferences;

  mutableRepository.findActiveByReferences = async () => [
    {
      id: 'available-product',
      reference: '175/75 R13',
      description: 'PNEU COM ESTOQUE',
      stock: 4,
      stockLocation: null,
      cashPrice: 300,
      creditPrice: 320,
      imagePath: null,
    },
    {
      id: 'zero-product',
      reference: '175/75 R13',
      description: 'PNEU ZERADO',
      stock: 0,
      stockLocation: null,
      cashPrice: 310,
      creditPrice: 330,
      imagePath: null,
    },
  ];

  try {
    const message = {
      author: userId,
      from: chatId,
      reply: async (text: string) => {
        replies.push(text);
      },
    } as unknown as Message;

    await handleZeroStockCommand(message, '0 175 75 13');

    assert.equal(replies.length, 2);
    assert.match(replies[0] ?? '', /PNEU ZERADO/);
    assert.doesNotMatch(replies[0] ?? '', /PNEU COM ESTOQUE/);
    assert.match(replies[0] ?? '', /ESTOQUE ZERO — 1 modelo/);
    assert.doesNotMatch(replies[0] ?? '', /Para repor|cadastrar local/);
    assert.equal(replies[1], formatProductChoiceQuestion());
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_product');
    assert.deepEqual(
      getLastQuery(userId, chatId)?.products.map((product) => product.id),
      ['zero-product']
    );
  } finally {
    mutableRepository.findActiveByReferences = originalFindActiveByReferences;
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('sends the product choice instruction separately after an available-stock query', async () => {
  const userId = 'available-query-user';
  const chatId = 'available-query-chat@g.us';
  const replies: string[] = [];
  const mutableRepository = productRepository as unknown as {
    findAvailableByReferences: (references: string[]) => Promise<Array<Record<string, unknown>>>;
  };
  const originalFindAvailableByReferences = mutableRepository.findAvailableByReferences;

  mutableRepository.findAvailableByReferences = async () => [{
    id: 'available-product',
    reference: '175/75 R13',
    description: 'PNEU DISPONÍVEL',
    stock: 4,
    stockLocation: null,
    cashPrice: 300,
    creditPrice: 320,
    imagePath: null,
  }];

  try {
    const message = {
      author: userId,
      from: chatId,
      reply: async (text: string) => {
        replies.push(text);
      },
    } as unknown as Message;

    await handlePneuCommand(message, '175 75 13');

    assert.equal(replies.length, 2);
    assert.match(replies[0] ?? '', /PNEU DISPONÍVEL/);
    assert.equal(replies[1], formatProductChoiceQuestion());
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_product');
  } finally {
    mutableRepository.findAvailableByReferences = originalFindAvailableByReferences;
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('shows only the suggested reference when the tire size is invalid', async () => {
  let replyText = '';
  const message = {
    from: 'invalid-size-chat',
    author: 'invalid-size-user',
    reply: async (text: string) => {
      replyText = text;
    },
  } as unknown as Message;

  const mutableRepository = productRepository as unknown as {
    findDistinctActiveReferences: () => Promise<Array<{ reference: string }>>;
  };
  const originalFindDistinctActiveReferences = mutableRepository.findDistinctActiveReferences;
  mutableRepository.findDistinctActiveReferences = async () => [
    { reference: '175/70 R14' },
  ];

  try {
    await handlePneuCommand(message, '175.70.14');

    assert.equal(
      replyText,
      '❌ *MEDIDA INVÁLIDA*\n\nVocê quis dizer:\n\n- 175/70 R14\n\n*Digite novamente a medida correta:*'
    );
  } finally {
    mutableRepository.findDistinctActiveReferences = originalFindDistinctActiveReferences;
  }
});

test('shows the camera only beside products whose photo file exists', () => {
  const text = formatProductList(
    [
      {
        id: 'with-photo',
        reference: '175/70 R14',
        description: 'APOLO AMAZER 84T',
        stock: 1,
        stockLocation: 'CG',
        cashPrice: 349.5,
        creditPrice: 366,
        hasPhoto: true,
      },
      {
        id: 'without-photo',
        reference: '175/70 R14',
        description: 'DYNAMO STREET-H MH01 84T',
        stock: 23,
        cashPrice: 319,
        creditPrice: 334.95,
        hasPhoto: false,
      },
    ],
    '175/70 R14',
    true
  );

  assert.match(text, /Estoque: \*1\*\n📍 Local: \*CG\*/);
  assert.match(text, /APOLO AMAZER 84T[\s\S]*A prazo: \*R\$366,00\*\n📷/);
  assert.doesNotMatch(text, /DYNAMO STREET-H MH01 84T[\s\S]*A prazo: \*R\$334,95\*\n📷/);
  assert.equal((text.match(/📷/g) ?? []).length, 1);
  assert.doesNotMatch(
    formatProductList(
      [{
        id: 'congo',
        reference: '175/70 R14',
        description: 'PNEU CONGO',
        stock: 2,
        stockLocation: 'CG',
        cashPrice: 300,
        creditPrice: 320,
      }],
      '175/70 R14',
      false
    ),
    /Local:/
  );
});
