import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  formatAdditionalEntryProductChoiceQuestion,
  formatAdditionalEntryHelp,
  formatBossEntryNotification,
  formatEntryConfirmation,
  formatEntryLocationQuestion,
  formatRegisteredEntry,
  handleEntryCommand,
  handleEntryConversation,
  orderEntryProductsByStock,
  scheduleAdditionalEntryHelp,
} from '../src/commands/entryCommand.js';
import {
  clearEntrySession,
  getEntrySession,
  saveEntrySession,
} from '../src/utils/entrySessionStore.js';
import { clearLastQuery, saveLastQuery } from '../src/utils/lastQueryStore.js';
import env from '../src/config/env.js';

function createMessage(userId: string, chatId: string, replies: string[]): Message {
  return {
    author: userId,
    from: chatId,
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;
}

test('orders available tires before zero-stock tires without changing each group order', () => {
  const products = [
    { id: 'zero-a', reference: '185/65 R15', description: 'ZERO A', stock: 0, cashPrice: 1, creditPrice: 1 },
    { id: 'available-a', reference: '185/65 R15', description: 'DISPONÍVEL A', stock: 2, cashPrice: 1, creditPrice: 1 },
    { id: 'zero-b', reference: '185/65 R15', description: 'ZERO B', stock: 0, cashPrice: 1, creditPrice: 1 },
    { id: 'available-b', reference: '185/65 R15', description: 'DISPONÍVEL B', stock: 5, cashPrice: 1, creditPrice: 1 },
  ];

  assert.deepEqual(
    orderEntryProductsByStock(products).map((product) => product.id),
    ['available-a', 'available-b', 'zero-a', 'zero-b']
  );
  assert.deepEqual(products.map((product) => product.id), [
    'zero-a',
    'available-a',
    'zero-b',
    'available-b',
  ]);
});

test('keeps the additional-entry choice clean and formats separate help', () => {
  assert.equal(
    formatAdditionalEntryProductChoiceQuestion(),
    '*ESCOLHA UM PNEU 🛞*\n*Digite o número do pneu:*'
  );
  assert.equal(
    formatAdditionalEntryHelp(),
    'Não achou o Pneu?\n' +
      'Digite: *novo* para adicionar um pneu ou *voltar* para pesquisar uma medida diferente'
  );
});

test('formats entry confirmation with supplier, invoice number and prices in compact rows', () => {
  const confirmation = formatEntryConfirmation({
    userId: 'entry-format-user',
    chatId: 'entry-format-chat',
    step: 'awaiting_confirmation',
    productId: 'entry-format-product',
    reference: '265/70 R16',
    description: '265/70R16 112S G-PROTAIL AT GRP TL',
    oldCashPrice: 829,
    oldCreditPrice: 877.08,
    quantity: 4,
    supplier: 'GP',
    invoiceName: 'GP',
    invoiceNumber: '201345',
    stockLocation: 'W3',
    updatedAt: Date.now(),
  });

  assert.equal(
    confirmation,
    [
      '📦 *ENTRADA — CONFIRMAR*',
      '',
      '🛞 *265/70 R16 — 265/70R16 112S G-PROTAIL AT GRP TL*',
      '📥 Quantidade: *+4*',
      '',
      '🚚 Fornecedor: *GP* | 📃 Número da nota: *201345*',
      '🧾 Nome da nota: *GP*',
      '',
      '💰 À vista: *R$829,00* | 💳 A prazo: *R$877,08*',
      '',
      '📍 Local: *W3*',
      '',
      '1️⃣ ✅ Confirmar',
      '2️⃣ ↩️ Voltar',
      '0️⃣ ❌ Cancelar',
    ].join('\n')
  );
});

test('sends the additional-entry help separately only while waiting for a choice', async () => {
  const userId = 'entry-help-user';
  const chatId = 'entry-help-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
    saveEntrySession({
      userId,
      chatId,
      step: 'awaiting_additional_item',
      productId: 'entry-help-original',
      reference: '175/70 R14',
      description: 'PNEU ORIGINAL',
      oldCashPrice: 250,
      oldCreditPrice: 264.5,
      additionalMeasure: '185/65 R15',
      additionalProducts: [],
      updatedAt: Date.now(),
    });

    scheduleAdditionalEntryHelp(message, userId, chatId, '185/65 R15', 5);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(replies, [formatAdditionalEntryHelp()]);

    replies.length = 0;
    scheduleAdditionalEntryHelp(message, userId, chatId, '185/65 R15', 10);
    await handleEntryConversation(message, 'x');
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(replies.length, 1);
    assert.match(replies[0] ?? '', /Opção inválida/);
  } finally {
    clearEntrySession(userId, chatId);
  }
});

test('asks whether to change prices before confirming an entry', async () => {
  const userId = 'entry-price-user';
  const chatId = 'entry-price-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);
  const previousLocationsFlag = env.inventoryLocationsEnabled;

  try {
    env.inventoryLocationsEnabled = false;
    saveLastQuery(userId, chatId, '175/70 R14', [{
      id: 'entry-price-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      stock: 4,
      cashPrice: 250,
      creditPrice: 264.5,
    }]);

    await handleEntryCommand(message, 'entrada 1');
    assert.equal(replies.at(-1), '📦 *QUANTIDADE*\nQuantos pneus?');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_quantity');
    await handleEntryConversation(message, '10');
    assert.equal(replies.at(-1), '🧾 *NOME DA NOTA*\nInforme o nome da nota fiscal:');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_invoice_name');
    await handleEntryConversation(message, 'Distribuidora Teste');
    assert.equal(replies.at(-1), '🧾 *NÚMERO DA NOTA*\nInforme o número da nota fiscal:');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_invoice_number');
    await handleEntryConversation(message, 'nota #1');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_invoice_number');
    assert.match(replies.at(-1) ?? '', /Número da nota inválido/);
    await handleEntryConversation(message, 'NF-2026/001');
    assert.equal(getEntrySession(userId, chatId)?.invoiceNumber, 'NF-2026/001');
    assert.equal(replies.at(-1), '🚚 *FORNECEDOR*\nInforme o fornecedor:');
    await handleEntryConversation(message, 'ABC Pneus');

    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_price_decision');
    assert.match(replies.at(-1) ?? '', /VOCÊ QUER ALTERAR O PREÇO/);
    assert.match(replies.at(-1) ?? '', /1️⃣\*Sim\* \| 2️⃣\*Não\*/);

    await handleEntryConversation(message, 'talvez');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_price_decision');
    assert.match(replies.at(-1) ?? '', /1️⃣\*Sim\* \| 2️⃣\*Não\*/);

    await handleEntryConversation(message, '1');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_cash_price');
    assert.equal(replies.at(-1), '💰 *PREÇO À VISTA*\nDigite o preço à vista:');

    await handleEntryConversation(message, '275,00');
    const additionalDecision = getEntrySession(userId, chatId);
    assert.equal(additionalDecision?.step, 'awaiting_additional_decision');
    assert.equal(additionalDecision?.items?.[0]?.newCashPrice, 275);
    assert.equal(additionalDecision?.items?.[0]?.newCreditPrice, 290.95);
    assert.match(replies.at(-1) ?? '', /QUER ADICIONAR MAIS ALGUM PNEU/);

    await handleEntryConversation(message, '2');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_confirmation');
    assert.match(replies.at(-1) ?? '', /Fornecedor: \*ABC Pneus\* \| 📃 Número da nota: \*NF-2026\/001\*/);
    assert.match(replies.at(-1) ?? '', /🧾 Nome da nota: \*Distribuidora Teste\*/);
    assert.match(replies.at(-1) ?? '', /À vista: R\$250,00 → \*R\$275,00\* \| 💳 A prazo: R\$264,50 → \*R\$290,95\*/);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearEntrySession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('asks and validates the stock location after supplier only in Monteiro', async () => {
  const userId = 'entry-location-user';
  const chatId = 'entry-location-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);
  const previousLocationsFlag = env.inventoryLocationsEnabled;

  try {
    env.inventoryLocationsEnabled = true;
    saveLastQuery(userId, chatId, '175/70 R14', [{
      id: 'entry-location-product',
      reference: '175/70 R14',
      description: 'PNEU MONTEIRO',
      stock: 0,
      stockLocation: null,
      cashPrice: 250,
      creditPrice: 264.5,
    }]);

    await handleEntryCommand(message, 'entrada 1');
    await handleEntryConversation(message, '10');
    await handleEntryConversation(message, 'Distribuidora Monteiro');
    await handleEntryConversation(message, '987654');
    await handleEntryConversation(message, 'ABC Pneus');

    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_location');
    assert.equal(replies.at(-1), formatEntryLocationQuestion());
    assert.equal(
      replies.at(-1),
      '📍 *LOCALIZAÇÃO*\nInforme o local:\n1️⃣ *W3*\n2️⃣ *PMAIS*\n3️⃣ *CG*'
    );

    await handleEntryConversation(message, 'corredor 1');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_location');
    assert.match(replies.at(-1) ?? '', /LOCAL INVÁLIDO/);

    await handleEntryConversation(message, '1');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_price_decision');
    assert.equal(getEntrySession(userId, chatId)?.stockLocation, 'W3');
    assert.match(replies.at(-1) ?? '', /VOCÊ QUER ALTERAR O PREÇO/);

    await handleEntryConversation(message, '2');
    await handleEntryConversation(message, '2');
    assert.match(replies.at(-1) ?? '', /📍 Local: \*W3\*/);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearEntrySession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('adds the location transition only to the private entry notification', () => {
  const baseSession = {
    userId: 'entry-notification-user',
    chatId: 'entry-notification-chat@g.us',
    step: 'awaiting_confirmation' as const,
    productId: 'entry-notification-product',
    reference: '205/60 R15',
    description: 'SPEEDMAX HH301 91V',
    oldCashPrice: 479,
    oldCreditPrice: 502.95,
    quantity: 4,
    supplier: 'SPEEDMAX',
    stockLocation: 'W3',
    newCashPrice: 389,
    newCreditPrice: 411.56,
    invoiceName: 'Distribuidora Speedmax',
    invoiceNumber: 'NF-4455',
    updatedAt: Date.now(),
  };
  const registered = [{
    productId: baseSession.productId,
    movementCode: '#E-000004',
    previousStock: 0,
    currentStock: 4,
    previousLocation: 'CG',
    currentLocation: 'W3',
  }];

  const groupMessage = formatRegisteredEntry(baseSession, 'Responsável', registered);
  const bossMessage = formatBossEntryNotification(baseSession, 'Responsável', registered);

  assert.doesNotMatch(groupMessage, /📍 Local:/);
  assert.match(groupMessage, /Nota: \*Distribuidora Speedmax\* \| Nº: \*NF-4455\*/);
  assert.match(bossMessage, /📍 Local: \*CG → W3\*/);
  assert.match(bossMessage, /Nota: \*Distribuidora Speedmax\* \| Nº: \*NF-4455\*/);

  const firstLocationMessage = formatBossEntryNotification(
    baseSession,
    'Responsável',
    [{ ...registered[0]!, previousLocation: null }]
  );
  assert.match(firstLocationMessage, /📍 Local: \*W3\*/);
  assert.doesNotMatch(firstLocationMessage, /não cadastrado →/);
});

test('keeps current prices when the entry price answer is 2', async () => {
  const userId = 'entry-no-price-user';
  const chatId = 'entry-no-price-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);
  const previousLocationsFlag = env.inventoryLocationsEnabled;

  try {
    env.inventoryLocationsEnabled = false;
    saveLastQuery(userId, chatId, '185/65 R15', [{
      id: 'entry-no-price-product',
      reference: '185/65 R15',
      description: 'PNEU SEM ALTERAÇÃO',
      stock: 2,
      cashPrice: 300,
      creditPrice: 317.4,
    }]);

    await handleEntryCommand(message, 'entrada 1');
    await handleEntryConversation(message, '4');
    await handleEntryConversation(message, 'Fornecedor da Nota');
    await handleEntryConversation(message, '123456');
    await handleEntryConversation(message, 'Fornecedor Teste');
    await handleEntryConversation(message, '2');

    const additionalDecision = getEntrySession(userId, chatId);
    assert.equal(additionalDecision?.step, 'awaiting_additional_decision');
    assert.equal(additionalDecision?.items?.[0]?.newCashPrice, undefined);
    assert.match(replies.at(-1) ?? '', /QUER ADICIONAR MAIS ALGUM PNEU/);

    await handleEntryConversation(message, '2');

    const confirmation = getEntrySession(userId, chatId);
    assert.equal(confirmation?.step, 'awaiting_confirmation');
    assert.equal(confirmation?.newCashPrice, undefined);
    assert.equal(confirmation?.newCreditPrice, undefined);
    assert.match(replies.at(-1) ?? '', /À vista: \*R\$300,00\* \| 💳 A prazo: \*R\$317,40\*/);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearEntrySession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('adds another tire and keeps the final confirmation compact', async () => {
  const userId = 'entry-multi-user';
  const chatId = 'entry-multi-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);
  const previousLocationsFlag = env.inventoryLocationsEnabled;

  try {
    env.inventoryLocationsEnabled = false;
    saveLastQuery(userId, chatId, '175/70 R14', [{
      id: 'entry-multi-one',
      reference: '175/70 R14',
      description: 'PNEU PASSEIO',
      stock: 4,
      cashPrice: 250,
      creditPrice: 264.5,
    }]);

    await handleEntryCommand(message, 'entrada 1');
    await handleEntryConversation(message, '10');
    await handleEntryConversation(message, 'Distribuidora Multi');
    await handleEntryConversation(message, 'NF-7788');
    await handleEntryConversation(message, 'Fornecedor A');
    await handleEntryConversation(message, '2');
    await handleEntryConversation(message, '1');

    const awaitingMeasure = getEntrySession(userId, chatId);
    assert.equal(awaitingMeasure?.step, 'awaiting_additional_measure');
    assert.equal(
      replies.at(-1),
      '➕ *ADICIONAR PNEU*\n*Digite a medida do outro pneu:*\nEx.: *275 80 22.5*'
    );

    await handleEntryConversation(message, 'voltar');
    const returnedEntry = getEntrySession(userId, chatId);
    assert.equal(returnedEntry?.step, 'awaiting_additional_decision');
    assert.equal(returnedEntry?.items?.length, 1);
    assert.match(replies.at(-1) ?? '', /itens anteriores continuam na entrada/);

    await handleEntryConversation(message, '1');

    saveEntrySession({
      ...getEntrySession(userId, chatId)!,
      step: 'awaiting_additional_item',
      additionalMeasure: '275/80 R22.5',
      additionalProducts: [{
        id: 'entry-multi-two',
        reference: '275/80 R22.5',
        description: 'PNEU PESADO',
        stock: 0,
        cashPrice: 2000,
        creditPrice: 2116,
      }],
      updatedAt: Date.now(),
    });

    await handleEntryConversation(message, 'x');
    assert.equal(
      replies.at(-1),
      '❌ Opção inválida.\n\n*ESCOLHA UM PNEU 🛞*\n*Digite o número do pneu:*'
    );

    await handleEntryConversation(message, 'novo');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_additional_measure');
    assert.equal(
      replies.at(-1),
      '➕ *ADICIONAR PNEU*\n*Digite a medida do outro pneu:*\nEx.: *275 80 22.5*'
    );

    saveEntrySession({
      ...getEntrySession(userId, chatId)!,
      step: 'awaiting_additional_item',
      additionalMeasure: '275/80 R22.5',
      additionalProducts: [{
        id: 'entry-multi-two',
        reference: '275/80 R22.5',
        description: 'PNEU PESADO',
        stock: 0,
        cashPrice: 2000,
        creditPrice: 2116,
      }],
      updatedAt: Date.now(),
    });

    await handleEntryConversation(message, 'voltar');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_additional_measure');
    assert.equal(
      replies.at(-1),
      '➕ *ADICIONAR PNEU*\n*Digite a medida do outro pneu:*\nEx.: *275 80 22.5*'
    );

    saveEntrySession({
      ...getEntrySession(userId, chatId)!,
      step: 'awaiting_additional_item',
      additionalMeasure: '275/80 R22.5',
      additionalProducts: [{
        id: 'entry-multi-two',
        reference: '275/80 R22.5',
        description: 'PNEU PESADO',
        stock: 0,
        cashPrice: 2000,
        creditPrice: 2116,
      }],
      updatedAt: Date.now(),
    });

    await handleEntryConversation(message, '1');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_quantity');
    assert.equal(replies.at(-1), '📦 *QUANTIDADE*\nQuantos pneus?');

    await handleEntryConversation(message, '3');
    const additionalPriceDecision = getEntrySession(userId, chatId);
    assert.equal(additionalPriceDecision?.step, 'awaiting_price_decision');
    assert.equal(additionalPriceDecision?.supplier, 'Fornecedor A');
    assert.match(replies.at(-1) ?? '', /VOCÊ QUER ALTERAR O PREÇO/);

    await handleEntryConversation(message, '1');
    await handleEntryConversation(message, '2100');
    assert.equal(getEntrySession(userId, chatId)?.items?.length, 2);
    assert.equal(getEntrySession(userId, chatId)?.items?.[1]?.supplier, 'Fornecedor A');

    await handleEntryConversation(message, '2');
    const confirmation = replies.at(-1) ?? '';
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_confirmation');
    assert.match(confirmation, /175\/70 R14/);
    assert.match(confirmation, /275\/80 R22\.5/);
    assert.match(confirmation, /📥 Adicionou: \*\+10\* \| 🏷️ sem alteração/);
    assert.match(confirmation, /📥 Adicionou: \*\+3\* \| 💰 À vista: R\$2100,00/);
    assert.match(confirmation, /📃 A prazo: R\$2221,80/);
    assert.match(confirmation, /Nota: \*Distribuidora Multi\* \| Nº: \*NF-7788\*\n📦 Total de itens: \*2\*/);
    assert.match(confirmation, /1️⃣ ✅ Confirmar\n2️⃣ ↩️ Voltar\n0️⃣ ❌ Cancelar/);
    assert.ok(confirmation.split('\n').length <= 15);

    const registered = formatRegisteredEntry(
      getEntrySession(userId, chatId)!,
      'Responsável Teste',
      [
        {
          productId: 'entry-multi-one',
          movementCode: '#E-000001',
          previousStock: 4,
          currentStock: 14,
        },
        {
          productId: 'entry-multi-two',
          movementCode: '#E-000002',
          previousStock: 0,
          currentStock: 3,
        },
      ]
    );
    assert.match(registered, /✅ \*ENTRADAS REGISTRADAS\*/);
    assert.match(registered, /📥 Adicionou: \*\+3\* \| 💰 À vista: R\$2100,00/);
    assert.match(registered, /📃 A prazo: R\$2221,80/);
    assert.match(registered, /📦 Estoque atual: \*3\*/);
    assert.match(registered, /Nota: \*Distribuidora Multi\* \| Nº: \*NF-7788\*/);
    assert.doesNotMatch(registered, /#E-00000[12]/);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearEntrySession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});
