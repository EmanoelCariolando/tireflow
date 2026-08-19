import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import env from '../src/config/env.js';
import {
  handleProductRegistrationConversation,
  handleProductRegistrationStart,
  isProductRegistrationCommand,
  normalizeProductDescription,
  parseNonNegativeInteger,
  parseProductRegistrationPrice,
} from '../src/commands/productRegistrationCommand.js';
import { handleMenuCommand, handleMenuSelection } from '../src/commands/menuCommand.js';
import {
  clearProductRegistrationSession,
  getProductRegistrationSession,
} from '../src/utils/productRegistrationSessionStore.js';

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
      '🆕 *CADASTRO — MEDIDA*\n' +
        'Digite apenas a medida, sem marca/modelo ou especificações.\n\n' +
        'Ex.: *175/70 R14*, *110/90-17*, *18.4/30* ou *31x10.50R15*'
    );

    await handleProductRegistrationConversation(message, 'medida errada');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_measure');
    assert.match(replies.at(-1) ?? '', /MEDIDA INVÁLIDA/);

    await handleProductRegistrationConversation(message, '110 90 17');
    assert.equal(getProductRegistrationSession(userId, chatId)?.reference, '110/90 R17');
    assert.equal(
      replies.at(-1),
      '🏷️ *CADASTRO — DESCRIÇÃO*\n' +
        'Informe marca/modelo e detalhes úteis, sem repetir a medida.\n' +
        'Ex.: *PIRELLI MT60 TRASEIRO 60P*'
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

    await handleProductRegistrationConversation(message, 'corredor 1');
    assert.equal(getProductRegistrationSession(userId, chatId)?.step, 'awaiting_location');
    assert.match(replies.at(-1) ?? '', /LOCAL INVÁLIDO/);

    await handleProductRegistrationConversation(message, 'w3');
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
    assert.match(replies.at(-1) ?? '', /CADASTRO — MEDIDA/);
  } finally {
    clearProductRegistrationSession(userId, chatId);
  }
});
