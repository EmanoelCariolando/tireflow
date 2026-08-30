import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import env from '../src/config/env.js';
import {
  handleProductRegistrationConversation,
  handleProductRegistrationStart,
  handleEntryProductRegistrationStart,
  isProductRegistrationCommand,
  normalizeProductDescription,
  parseNonNegativeInteger,
  parseProductRegistrationPrice,
} from '../src/commands/productRegistrationCommand.js';
import { handleMenuCommand, handleMenuSelection } from '../src/commands/menuCommand.js';
import {
  clearProductRegistrationSession,
  getProductRegistrationSession,
  saveProductRegistrationSession,
} from '../src/utils/productRegistrationSessionStore.js';
import {
  clearEntrySession,
  getEntrySession,
  saveEntrySession,
} from '../src/utils/entrySessionStore.js';

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

test('recognizes the direct product registration commands', () => {
  assert.equal(isProductRegistrationCommand('cadastrar pneu'), true);
  assert.equal(isProductRegistrationCommand('ADICIONAR PNEU'), true);
  assert.equal(isProductRegistrationCommand('cadastrar'), false);
  assert.equal(isProductRegistrationCommand('cadastrar pneu 175/70 R14'), false);
});

test('parses stock, descriptions and Brazilian price formats without ambiguity', () => {
  assert.equal(normalizeProductDescription('  Pirelli   mt60  '), 'PIRELLI MT60');
  assert.equal(normalizeProductDescription('x'), null);
  assert.equal(parseNonNegativeInteger('0'), 0);
  assert.equal(parseNonNegativeInteger('20'), 20);
  assert.equal(parseNonNegativeInteger('-1'), null);
  assert.equal(parseNonNegativeInteger('1.5'), null);
  assert.equal(parseProductRegistrationPrice('899'), 899);
  assert.equal(parseProductRegistrationPrice('899,90'), 899.9);
  assert.equal(parseProductRegistrationPrice('899.90'), 899.9);
  assert.equal(parseProductRegistrationPrice('R$ 1.299,90'), 1299.9);
  assert.equal(parseProductRegistrationPrice('1,299.90'), 1299.9);
  assert.equal(parseProductRegistrationPrice('1.000'), 1000);
  assert.equal(parseProductRegistrationPrice('12,345'), 12345);
  assert.equal(parseProductRegistrationPrice('10,999'), 10999);
  assert.equal(parseProductRegistrationPrice('1,2,3'), null);
  assert.equal(parseProductRegistrationPrice('-10'), null);
});

test('guides a zero-stock registration through validation and confirmation', async () => {
  const userId = 'new-product-zero-user';
  const chatId = 'new-product-zero-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);
  const previousLocationsFlag = env.inventoryLocationsEnabled;

  try {
    env.inventoryLocationsEnabled = false;
    await handleProductRegistrationStart(message);
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_measure');
    assert.equal(
      replies.at(-1),
      '🆕 *MEDIDA*\n' +
        '*Digite a medida:*'
    );

    await handleProductRegistrationConversation(message, 'medida errada');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_measure');
    assert.match(replies.at(-1) ?? '', /MEDIDA INVÁLIDA/);

    await handleProductRegistrationConversation(message, '110 90 17');
    assert.equal(getProductRegistrationSession(userId, chatId)?.reference, '110/90 R17');
    assert.equal(
      replies.at(-1),
      '🏷️*MARCA DO PNEU*\n' +
        '*Informe marca/modelo:*\n\n' +
        'Ex.: PIRELLI MT60 TRASEIRO 60P'
    );

    await handleProductRegistrationConversation(message, 'Pirelli MT60 traseiro 60P');
    assert.equal(
      getProductRegistrationSession(userId, chatId)?.description,
      'PIRELLI MT60 TRASEIRO 60P'
    );
    assert.equal(
      replies.at(-1),
      '📦 *QUANTIDADE*\nQuantos pneus?'
    );

    await handleProductRegistrationConversation(message, '1.5');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_initial_stock');
    assert.match(replies.at(-1) ?? '', /Estoque inválido/);

    await handleProductRegistrationConversation(message, '0');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_cash_price');
    assert.equal(replies.at(-1), '💰 *PREÇO À VISTA*\nDigite o preço à vista:');

    await handleProductRegistrationConversation(message, 'oitocentos');
    assert.match(replies.at(-1) ?? '', /Preço à vista inválido/);

    await handleProductRegistrationConversation(message, 'R$ 899,90');
    assert.equal(getProductRegistrationSession(userId, chatId)?.cashPrice, 899.9);
    assert.equal(getProductRegistrationSession(userId, chatId)?.creditPrice, 952.09);

    const confirmationSession = getProductRegistrationSession(userId, chatId);
    assert.equal(confirmationSession?.step, 'awaiting_confirmation');
    assert.equal(confirmationSession?.stockLocation, null);
    assert.match(replies.at(-1) ?? '', /CADASTRO — CONFIRMAR/);
    assert.match(replies.at(-1) ?? '', /Estoque inicial: \*0\*/);
    assert.doesNotMatch(replies.at(-1) ?? '', /Fornecedor:/);
    assert.doesNotMatch(replies.at(-1) ?? '', /Local:/);

    await handleProductRegistrationConversation(message, 'sim');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_confirmation');
    assert.match(replies.at(-1) ?? '', /1️⃣ ✅ Confirmar\n2️⃣ ↩️ Voltar\n0️⃣ ❌ Cancelar/);

    await handleProductRegistrationConversation(message, 'cancela');
    assert.equal(getProductRegistrationSession(userId, chatId), null);
    assert.match(replies.at(-1) ?? '', /Nenhuma informação foi salva/);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearProductRegistrationSession(userId, chatId);
  }
});

test('guides wheel registration with RODA as the reference', async () => {
  const userId = 'new-wheel-user';
  const chatId = 'new-wheel-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
    await handleProductRegistrationStart(message);

    await handleProductRegistrationConversation(message, '22.5X7.50');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_measure');
    assert.match(replies.at(-1) ?? '', /digite apenas: \*RODA\*/);

    await handleProductRegistrationConversation(message, 'roda');
    assert.equal(getProductRegistrationSession(userId, chatId)?.reference, 'RODA');
    assert.equal(
      replies.at(-1),
      '🏷️ *CADASTRO — DESCRIÇÃO DA RODA*\n' +
        'Informe modelo, quantidade de furos e medida.\n' +
        'Ex.: *275 8 FUROS (22.5X7.50)*'
    );

    await handleProductRegistrationConversation(message, '275 8 furos (22.5x7.50)');
    assert.equal(
      getProductRegistrationSession(userId, chatId)?.description,
      '275 8 FUROS (22.5X7.50)'
    );
    assert.equal(replies.at(-1), '📦 *QUANTIDADE*\nQuantas rodas?');
  } finally {
    clearProductRegistrationSession(userId, chatId);
  }
});

test('asks for the measure separately and keeps the note context when registering during an entry', async () => {
  const userId = 'entry-registration-user';
  const chatId = 'entry-registration-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);
  const previousLocationsFlag = env.inventoryLocationsEnabled;

  try {
    env.inventoryLocationsEnabled = false;
    saveEntrySession({
      userId,
      chatId,
      step: 'awaiting_additional_item',
      productId: 'existing-product',
      reference: '175/70 R14',
      description: 'PNEU EXISTENTE',
      oldCashPrice: 250,
      oldCreditPrice: 264.5,
      invoiceNumber: 'NF-100',
      items: [{
        productId: 'existing-product',
        reference: '175/70 R14',
        description: 'PNEU EXISTENTE',
        oldCashPrice: 250,
        oldCreditPrice: 264.5,
        quantity: 4,
        supplier: 'Fornecedor da Nota',
      }],
      additionalMeasure: '205/55 R16',
      additionalProducts: [],
      updatedAt: Date.now(),
    });

    await handleEntryProductRegistrationStart(message);
    assert.equal(getProductRegistrationSession(userId, chatId)?.origin, 'entry');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_measure');
    assert.equal(getProductRegistrationSession(userId, chatId)?.reference, undefined);
    assert.equal(replies.at(-1), '🆕 *MEDIDA*\n*Digite a medida:*');

    await handleProductRegistrationConversation(message, '205/55 R16');
    assert.equal(getProductRegistrationSession(userId, chatId)?.reference, '205/55 R16');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_description');
    assert.match(replies.at(-1) ?? '', /MARCA DO PNEU/);

    await handleProductRegistrationConversation(message, 'Michelin Primacy 4');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_initial_stock');
    assert.equal(
      replies.at(-1),
      '📦 *QUANTIDADE NA NOTA*\nQuantos pneus serão adicionados?'
    );

    await handleProductRegistrationConversation(message, '0');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_initial_stock');
    assert.match(replies.at(-1) ?? '', /Quantidade inválida/);

    await handleProductRegistrationConversation(message, '3');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_cash_price');
    assert.doesNotMatch(replies.at(-1) ?? '', /FORNECEDOR/);

    await handleProductRegistrationConversation(message, '499,90');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_confirmation');
    assert.match(replies.at(-1) ?? '', /CADASTRO NA NOTA — CONFIRMAR/);
    assert.match(replies.at(-1) ?? '', /Quantidade na nota: \*\+3\*/);
    assert.doesNotMatch(replies.at(-1) ?? '', /Fornecedor:/);
    assert.equal(getEntrySession(userId, chatId)?.items?.length, 1);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearProductRegistrationSession(userId, chatId);
    clearEntrySession(userId, chatId);
  }
});

test('requires a supplier for initial stock and allows an optional valid location', async () => {
  const userId = 'new-product-stock-user';
  const chatId = 'new-product-stock-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);
  const previousLocationsFlag = env.inventoryLocationsEnabled;

  try {
    env.inventoryLocationsEnabled = true;
    await handleProductRegistrationStart(message);
    await handleProductRegistrationConversation(message, '18,4-30');
    await handleProductRegistrationConversation(message, 'Alliance Agri Nova 14 lonas');
    await handleProductRegistrationConversation(message, '2');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_supplier');
    assert.equal(replies.at(-1), '🚚 *FORNECEDOR*\nInforme o fornecedor:');

    await handleProductRegistrationConversation(message, 'x');
    assert.match(replies.at(-1) ?? '', /Fornecedor inválido/);
    await handleProductRegistrationConversation(message, 'JTR Pneus');
    await handleProductRegistrationConversation(message, '4.600,00');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_location');
    assert.match(replies.at(-1) ?? '', /1️⃣ \*W3\*\n2️⃣ \*PMAIS\*\n3️⃣ \*CG\*/);

    await handleProductRegistrationConversation(message, 'corredor 1');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_location');
    assert.match(replies.at(-1) ?? '', /LOCAL INVÁLIDO/);

    await handleProductRegistrationConversation(message, '1');
    assert.equal(getProductRegistrationSession(userId, chatId)?.stockLocation, 'W3');
    assert.match(replies.at(-1) ?? '', /Fornecedor: \*JTR Pneus\*/);
    assert.match(replies.at(-1) ?? '', /Local: \*W3\*/);
  } finally {
    env.inventoryLocationsEnabled = previousLocationsFlag;
    clearProductRegistrationSession(userId, chatId);
  }
});

test('shows product registration as menu option 3 and starts its isolated flow', async () => {
  const userId = 'new-product-menu-user';
  const chatId = 'new-product-menu-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
    await handleMenuCommand(message);
    assert.match(replies.at(-1) ?? '', /3️⃣ Cadastrar pneu/);
    assert.doesNotMatch(replies.at(-1) ?? '', /Baixo estoque/);
    assert.match(replies.at(-1) ?? '', /\*1\*, \*2\* ou \*3\*/);

    assert.equal(await handleMenuSelection(message, '3'), true);
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_measure');
    assert.equal(replies.at(-1), '🆕 *MEDIDA*\n*Digite a medida:*');
  } finally {
    clearProductRegistrationSession(userId, chatId);
  }
});

test('asks whether to register another product after a menu registration', async () => {
  const userId = 'additional-registration-user';
  const chatId = 'additional-registration-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
    saveProductRegistrationSession({
      userId,
      chatId,
      step: 'awaiting_additional_decision',
      registeredProductCount: 1,
      updatedAt: Date.now(),
    });

    await handleProductRegistrationConversation(message, 'talvez');
    assert.match(
      replies.at(-1) ?? '',
      /QUER ADICIONAR MAIS ALGUM PNEU\?\*\n\nItens preparados: \*1\*\n\n1️⃣ \*Sim\* \| 2️⃣ \*Não\*$/
    );

    await handleProductRegistrationConversation(message, '1');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_measure');
    assert.equal(getProductRegistrationSession(userId, chatId)?.registeredProductCount, 1);
    assert.equal(replies.at(-1), '🆕 *MEDIDA*\n*Digite a medida:*');

    saveProductRegistrationSession({
      userId,
      chatId,
      step: 'awaiting_additional_decision',
      registeredProductCount: 2,
      updatedAt: Date.now(),
    });
    await handleProductRegistrationConversation(message, '2');
    assert.equal(getProductRegistrationSession(userId, chatId), null);
    assert.equal(replies.at(-1), '✅ *CADASTRO FINALIZADO*\nPneus cadastrados: *2*');
  } finally {
    clearProductRegistrationSession(userId, chatId);
  }
});
