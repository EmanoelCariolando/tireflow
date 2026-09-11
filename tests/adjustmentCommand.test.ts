import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  formatAdjustmentTypeQuestion,
  handleAdjustmentConversation,
} from '../src/commands/adjustmentCommand.js';
import {
  clearAdjustmentSession,
  getAdjustmentSession,
  saveAdjustmentSession,
  type AdjustmentSession,
} from '../src/utils/adjustmentSessionStore.js';

const userId = 'adjustment-options-user';
const chatId = 'adjustment-options-group@g.us';

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

function baseSession(overrides: Partial<AdjustmentSession> = {}): AdjustmentSession {
  return {
    userId,
    chatId,
    step: 'awaiting_adjustment_type',
    productId: 'source-product',
    reference: '175/70 R14',
    description: 'PNEU ORIGEM',
    previousStock: 4,
    updatedAt: Date.now(),
    ...overrides,
  };
}

test('shows every stock correction possibility with an unambiguous final-balance option', () => {
  const text = formatAdjustmentTypeQuestion(baseSession());

  assert.match(text, /estoque contado \(saldo final\)/i);
  assert.match(text, /Adicionar unidades/);
  assert.match(text, /Retirar unidades/);
  assert.match(text, /Transferir para outro pneu/);
  assert.match(text, /Estoque atual: \*4\*/);
});

test('adds a quantity and calculates the resulting stock before confirmation', async () => {
  const replies: string[] = [];

  try {
    saveAdjustmentSession(baseSession());
    await handleAdjustmentConversation(createMessage(replies), '2');
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_quantity');
    assert.equal(getAdjustmentSession(userId, chatId)?.kind, 'add');

    await handleAdjustmentConversation(createMessage(replies), '3');
    assert.equal(getAdjustmentSession(userId, chatId)?.newStock, 7);
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_reason');

    await handleAdjustmentConversation(createMessage(replies), 'Unidade encontrada');
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_confirmation');
    assert.match(replies.at(-1) ?? '', /Estoque: \*4 → 7\*/);
    assert.match(replies.at(-1) ?? '', /Quantidade: \*3\*/);
  } finally {
    clearAdjustmentSession(userId, chatId);
  }
});

test('removes up to the available quantity and never permits negative stock', async () => {
  const replies: string[] = [];

  try {
    saveAdjustmentSession(baseSession());
    await handleAdjustmentConversation(createMessage(replies), '3');
    await handleAdjustmentConversation(createMessage(replies), '5');
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_quantity');
    assert.match(replies.at(-1) ?? '', /Não é possível retirar \*5\*/);

    await handleAdjustmentConversation(createMessage(replies), '4');
    assert.equal(getAdjustmentSession(userId, chatId)?.newStock, 0);
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_reason');
  } finally {
    clearAdjustmentSession(userId, chatId);
  }
});

test('prepares both sides of a transfer and shows both resulting balances', async () => {
  const replies: string[] = [];

  try {
    saveAdjustmentSession(baseSession({
      kind: 'transfer',
      step: 'awaiting_transfer_product',
      transferCandidates: [{
        id: 'target-product',
        reference: '185/65 R15',
        description: 'PNEU DESTINO',
        stock: 2,
      }],
    }));

    await handleAdjustmentConversation(createMessage(replies), '1');
    assert.equal(getAdjustmentSession(userId, chatId)?.targetProductId, 'target-product');
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_quantity');

    await handleAdjustmentConversation(createMessage(replies), '2');
    assert.equal(getAdjustmentSession(userId, chatId)?.newStock, 2);
    assert.equal(getAdjustmentSession(userId, chatId)?.targetNewStock, 4);

    await handleAdjustmentConversation(createMessage(replies), 'Venda baixada no pneu semelhante');
    const confirmation = replies.at(-1) ?? '';
    assert.match(confirmation, /Origem:[\s\S]*Estoque: \*4 → 2\*/);
    assert.match(confirmation, /Destino:[\s\S]*Estoque: \*2 → 4\*/);
    assert.match(confirmation, /Quantidade: \*2\*/);
  } finally {
    clearAdjustmentSession(userId, chatId);
  }
});

test('does not offer removal or transfer when the selected tire has zero stock', async () => {
  const replies: string[] = [];

  try {
    saveAdjustmentSession(baseSession({ previousStock: 0 }));
    await handleAdjustmentConversation(createMessage(replies), '3');
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_adjustment_type');
    assert.match(replies.at(-1) ?? '', /não possui unidades para retirar/i);

    await handleAdjustmentConversation(createMessage(replies), '4');
    assert.equal(getAdjustmentSession(userId, chatId)?.step, 'awaiting_adjustment_type');
    assert.match(replies.at(-1) ?? '', /não possui unidades para transferir/i);
  } finally {
    clearAdjustmentSession(userId, chatId);
  }
});
