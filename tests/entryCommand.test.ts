import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  formatRegisteredEntry,
  handleEntryCommand,
  handleEntryConversation,
} from '../src/commands/entryCommand.js';
import {
  clearEntrySession,
  getEntrySession,
  saveEntrySession,
} from '../src/utils/entrySessionStore.js';
import { clearLastQuery, saveLastQuery } from '../src/utils/lastQueryStore.js';

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

test('asks whether to change prices before confirming an entry', async () => {
  const userId = 'entry-price-user';
  const chatId = 'entry-price-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
    saveLastQuery(userId, chatId, '175/70 R14', [{
      id: 'entry-price-product',
      reference: '175/70 R14',
      description: 'PNEU TESTE',
      stock: 4,
      cashPrice: 250,
      creditPrice: 264.5,
    }]);

    await handleEntryCommand(message, 'entrada 1');
    await handleEntryConversation(message, '10');
    await handleEntryConversation(message, 'ABC Pneus');

    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_price_decision');
    assert.match(replies.at(-1) ?? '', /VOCÊ QUER ALTERAR O PREÇO/);
    assert.match(replies.at(-1) ?? '', /Digite \*s\* ou \*n\*/);

    await handleEntryConversation(message, 'talvez');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_price_decision');
    assert.match(replies.at(-1) ?? '', /Digite apenas \*s\* ou \*n\*/);

    await handleEntryConversation(message, 's');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_cash_price');
    assert.match(replies.at(-1) ?? '', /DIGITE O PREÇO À VISTA/);
    assert.match(replies.at(-1) ?? '', /275,00/);

    await handleEntryConversation(message, '275,00');
    const additionalDecision = getEntrySession(userId, chatId);
    assert.equal(additionalDecision?.step, 'awaiting_additional_decision');
    assert.equal(additionalDecision?.items?.[0]?.newCashPrice, 275);
    assert.equal(additionalDecision?.items?.[0]?.newCreditPrice, 290.95);
    assert.match(replies.at(-1) ?? '', /QUER ADICIONAR MAIS ALGUM PNEU/);

    await handleEntryConversation(message, 'n');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_confirmation');
    assert.match(replies.at(-1) ?? '', /À vista: R\$250,00 → \*R\$275,00\*/);
    assert.match(replies.at(-1) ?? '', /A prazo \(\+5,8%\): R\$264,50 → \*R\$290,95\*/);
  } finally {
    clearEntrySession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('keeps current prices when the entry price answer is n', async () => {
  const userId = 'entry-no-price-user';
  const chatId = 'entry-no-price-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
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
    await handleEntryConversation(message, 'Fornecedor Teste');
    await handleEntryConversation(message, 'n');

    const additionalDecision = getEntrySession(userId, chatId);
    assert.equal(additionalDecision?.step, 'awaiting_additional_decision');
    assert.equal(additionalDecision?.items?.[0]?.newCashPrice, undefined);
    assert.match(replies.at(-1) ?? '', /QUER ADICIONAR MAIS ALGUM PNEU/);

    await handleEntryConversation(message, 'n');

    const confirmation = getEntrySession(userId, chatId);
    assert.equal(confirmation?.step, 'awaiting_confirmation');
    assert.equal(confirmation?.newCashPrice, undefined);
    assert.equal(confirmation?.newCreditPrice, undefined);
    assert.match(replies.at(-1) ?? '', /Preços: \*sem alteração\*/);
  } finally {
    clearEntrySession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('adds another tire and keeps the final confirmation compact', async () => {
  const userId = 'entry-multi-user';
  const chatId = 'entry-multi-group@g.us';
  const replies: string[] = [];
  const message = createMessage(userId, chatId, replies);

  try {
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
    await handleEntryConversation(message, 'Fornecedor A');
    await handleEntryConversation(message, 'n');
    await handleEntryConversation(message, 's');

    const awaitingMeasure = getEntrySession(userId, chatId);
    assert.equal(awaitingMeasure?.step, 'awaiting_additional_measure');
    assert.match(replies.at(-1) ?? '', /Digite a medida/);

    saveEntrySession({
      ...awaitingMeasure!,
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

    await handleEntryConversation(message, 'entrada 1');
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_quantity');
    assert.match(replies.at(-1) ?? '', /Quantos pneus chegaram\?/);

    await handleEntryConversation(message, '3');
    await handleEntryConversation(message, 'Fornecedor B');
    await handleEntryConversation(message, 's');
    await handleEntryConversation(message, '2100');
    assert.equal(getEntrySession(userId, chatId)?.items?.length, 2);

    await handleEntryConversation(message, 'n');
    const confirmation = replies.at(-1) ?? '';
    assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_confirmation');
    assert.match(confirmation, /175\/70 R14/);
    assert.match(confirmation, /275\/80 R22\.5/);
    assert.match(confirmation, /📥 Adicionou: \*\+10\* \| 🏷️ sem alteração/);
    assert.match(confirmation, /📥 Adicionou: \*\+3\* \| 💰 À vista: R\$2100,00/);
    assert.match(confirmation, /📃 A prazo: R\$2221,80/);
    assert.match(confirmation, /Total de itens: \*2\*/);
    assert.ok(confirmation.split('\n').length <= 10);

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
    assert.match(registered, /📦 Estoque atual: \*3\* \| 🧾 \*#E-000002\*/);
  } finally {
    clearEntrySession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});
