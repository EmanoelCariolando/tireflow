import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import env from '../src/config/env.js';
import {
  formatLocationConfirmation,
  handleLocationCommand,
  handleLocationConversation,
  isLocationCommand,
} from '../src/commands/locationCommand.js';
import { formatZeroStockProductList } from '../src/commands/menuCommand.js';
import { formatPneuHelp, formatProductList } from '../src/commands/pneuCommand.js';
import {
  clearLastQuery,
  getLastQuery,
  saveLastQuery,
  updateLastQueryProductLocation,
} from '../src/utils/lastQueryStore.js';
import {
  clearLocationSession,
  getLocationSession,
} from '../src/utils/locationSessionStore.js';

const userId = 'location-user';
const chatId = 'location-group@g.us';
const product = {
  id: 'location-product',
  reference: '175/70 R14',
  description: 'PNEU SEM LOCAL',
  stock: 4,
  stockLocation: null,
  cashPrice: 300,
  creditPrice: 320,
};

function createMessage(replies: string[]): Message {
  return {
    author: userId,
    from: chatId,
    reply: async (text: string) => {
      replies.push(text);
      return undefined;
    },
  } as unknown as Message;
}

test('recognizes only a numbered local command', () => {
  assert.equal(isLocationCommand('local 1'), true);
  assert.equal(isLocationCommand('LOCAL 12'), true);
  assert.equal(isLocationCommand('local'), false);
  assert.equal(isLocationCommand('local W3'), false);
});

test('renders missing locations and instructions only for Monteiro', () => {
  const monteiroList = formatProductList([product], '175/70 R14', true);
  assert.match(monteiroList, /📍 Local: não cadastrado/);
  assert.match(monteiroList, /Para cadastrar o local:\nlocal <número>\nExemplo: local 1/);

  const congoList = formatProductList([product], '175/70 R14', false);
  assert.doesNotMatch(congoList, /Local:/);
  assert.doesNotMatch(congoList, /local <número>/);
});

test('offers local registration in the zero-stock list without changing entry guidance', () => {
  const text = formatZeroStockProductList(
    [{ ...product, stock: 0 }],
    '175/70 R14',
    true
  );

  assert.match(text, /📦 Estoque: 0\n📍 Local: não cadastrado/);
  assert.match(text, /Para repor estoque:\nentrada 1/);
  assert.match(text, /Para cadastrar o local:\nlocal <número>\nExemplo: local 1/);
});

test('shows the local command in help only when inventory locations are enabled', () => {
  assert.match(
    formatPneuHelp(true),
    /local <número>\n↳ Adiciona ou altera o local físico do produto/
  );
  assert.doesNotMatch(formatPneuHelp(false), /local <número>/);
});

test('starts a clean location flow and validates the new location before confirmation', async () => {
  const previousFlag = env.inventoryLocationsEnabled;
  const replies: string[] = [];

  try {
    env.inventoryLocationsEnabled = true;
    saveLastQuery(userId, chatId, '175/70 R14', [product]);

    await handleLocationCommand(createMessage(replies), 'local 1');
    assert.equal(getLocationSession(userId, chatId)?.step, 'awaiting_location');
    assert.match(replies.at(-1) ?? '', /Local atual: \*não cadastrado\*/);

    await handleLocationConversation(createMessage(replies), 'corredor 1');
    assert.equal(getLocationSession(userId, chatId)?.step, 'awaiting_location');
    assert.match(replies.at(-1) ?? '', /Local inválido/);

    await handleLocationConversation(createMessage(replies), 'w3');
    const session = getLocationSession(userId, chatId);
    assert.equal(session?.step, 'awaiting_confirmation');
    assert.equal(session?.newLocation, 'W3');
    assert.equal(
      formatLocationConfirmation(session!),
      [
        '⚠️ *CONFIRMAR LOCAL?*',
        '',
        '*175/70 R14* — *PNEU SEM LOCAL*',
        'De: *não cadastrado*',
        'Para: *W3*',
        '',
        'Digite: confirmar ou cancelar',
      ].join('\n')
    );

    await handleLocationConversation(createMessage(replies), 'cancelar');
    assert.equal(getLocationSession(userId, chatId), null);
  } finally {
    env.inventoryLocationsEnabled = previousFlag;
    clearLocationSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('keeps the command disabled in units without inventory locations', async () => {
  const previousFlag = env.inventoryLocationsEnabled;
  const replies: string[] = [];

  try {
    env.inventoryLocationsEnabled = false;
    saveLastQuery(userId, chatId, '175/70 R14', [product]);
    await handleLocationCommand(createMessage(replies), 'local 1');

    assert.equal(getLocationSession(userId, chatId), null);
    assert.equal(replies.at(-1), 'O cadastro de locais não está habilitado nesta unidade.');
  } finally {
    env.inventoryLocationsEnabled = previousFlag;
    clearLocationSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('updates the cached query after a location is registered', () => {
  saveLastQuery(userId, chatId, '175/70 R14', [product]);
  updateLastQueryProductLocation(userId, chatId, product.id, 'PMAIS');
  assert.equal(getLastQuery(userId, chatId)?.products[0]?.stockLocation, 'PMAIS');
  clearLastQuery(userId, chatId);
});
