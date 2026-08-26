import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  formatProductActionMenu,
  formatZeroStockActionMenu,
  formatSaleQuantityQuestion,
  handleProductActionConversation,
  type ProductActionDependencies,
} from '../src/commands/productActionCommand.js';
import { formatProductChoiceQuestion } from '../src/commands/pneuCommand.js';
import {
  clearLastQuery,
  LAST_QUERY_TTL_MS,
  saveLastQuery,
} from '../src/utils/lastQueryStore.js';
import {
  clearProductActionSession,
  getProductActionSession,
  PRODUCT_ACTION_SESSION_TTL_MS,
  saveProductActionSession,
} from '../src/utils/productActionSessionStore.js';

const userId = 'product-action-user';
const chatId = 'product-action-group@g.us';

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

function saveQuery(): void {
  saveLastQuery(userId, chatId, '175/75 R13', [
    {
      id: 'product-1',
      reference: '175/75 R13',
      description: 'PNEU UM',
      stock: 4,
      cashPrice: 300,
      creditPrice: 315,
    },
    {
      id: 'product-2',
      reference: '175/75 R13',
      description: 'PNEU DOIS',
      stock: 8,
      cashPrice: 350,
      creditPrice: 367.5,
    },
  ]);
}

function createDependencies(calls: string[]): ProductActionDependencies {
  const handler = (name: string) => async (_message: Message, body: string): Promise<boolean> => {
    calls.push(`${name}:${body}`);
    return true;
  };

  return {
    sale: async (_message: Message, body: string) => {
      calls.push(`sale:${body}`);
      return true;
    },
    entry: handler('entry'),
    price: handler('price'),
    photo: handler('photo'),
    adjustment: handler('adjustment'),
    addPhoto: handler('addPhoto'),
    location: handler('location'),
    inventoryLocationsEnabled: true,
  };
}

test('formats the three new instructional messages exactly', () => {
  assert.equal(
    formatProductChoiceQuestion(),
    [
      '*ESCOLHA UM PNEU 🛞*',
      '*Digite o número do pneu:*',
    ].join('\n')
  );

  assert.equal(
    formatProductActionMenu(true),
    [
      '⚙️ ESCOLHA O QUE DESEJA FAZER',
      '',
      '1️⃣ Venda | 2️⃣ Entrada',
      '3️⃣ Preço | 4️⃣ Foto',
      '5️⃣ Ajuste | 6️⃣ Adicionar foto',
      '7️⃣ Localização',
    ].join('\n')
  );

  assert.equal(
    formatZeroStockActionMenu(true),
    [
      '⚙️ *ESCOLHA O QUE DESEJA FAZER*',
      '',
      '1️⃣ Entrada',
      '2️⃣ Preço',
      '3️⃣ Localização',
    ].join('\n')
  );

  assert.equal(
    formatSaleQuantityQuestion(),
    [
      '📦 *QUANTIDADE*',
      'Quantos pneus?',
    ].join('\n')
  );
});

test('keeps the consultation and its selection flow active for nine minutes', () => {
  assert.equal(LAST_QUERY_TTL_MS, 9 * 60 * 1000);
  assert.equal(PRODUCT_ACTION_SESSION_TTL_MS, 9 * 60 * 1000);
});

test('selects a tire, opens the action menu and asks the sale quantity', async () => {
  const replies: string[] = [];
  const calls: string[] = [];
  const message = createMessage(replies);

  try {
    saveQuery();
    saveProductActionSession(userId, chatId, 'awaiting_product');

    assert.equal(await handleProductActionConversation(message, '2', createDependencies(calls)), true);
    assert.equal(replies.at(-1), formatProductActionMenu(true));
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_action');
    assert.equal(getProductActionSession(userId, chatId)?.optionNumber, 2);

    assert.equal(await handleProductActionConversation(message, '1', createDependencies(calls)), true);
    assert.equal(replies.at(-1), formatSaleQuantityQuestion());
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_sale_quantity');

    assert.equal(await handleProductActionConversation(message, '3', createDependencies(calls)), true);
    assert.deepEqual(calls, ['sale:venda 2 3']);
    assert.equal(getProductActionSession(userId, chatId), null);
  } finally {
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('routes every additional product action to the selected tire', async () => {
  const expected = new Map([
    ['2', 'entry:entrada 2'],
    ['3', 'price:preco 2'],
    ['4', 'photo:foto 2'],
    ['5', 'adjustment:ajuste 2'],
    ['6', 'addPhoto:addfoto 2'],
    ['7', 'location:local 2'],
  ]);

  try {
    saveQuery();

    for (const [selection, expectedCall] of expected) {
      const calls: string[] = [];
      saveProductActionSession(userId, chatId, 'awaiting_action', 2);

      assert.equal(
        await handleProductActionConversation(
          createMessage([]),
          selection,
          createDependencies(calls)
        ),
        true
      );
      assert.deepEqual(calls, [expectedCall]);
      assert.equal(getProductActionSession(userId, chatId), null);
    }
  } finally {
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('keeps the action menu active after viewing a photo so a sale can follow', async () => {
  const replies: string[] = [];
  const calls: string[] = [];
  const dependencies = createDependencies(calls);
  dependencies.photo = async (_message, body) => {
    calls.push(`photo:${body}`);
    replies.push('📷 Este produto ainda não possui foto cadastrada.');
    return false;
  };

  try {
    saveQuery();
    saveProductActionSession(userId, chatId, 'awaiting_action', 2);

    assert.equal(
      await handleProductActionConversation(createMessage(replies), '4', dependencies),
      true
    );
    assert.equal(replies.at(-1), '📷 Este produto ainda não possui foto cadastrada.');
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_action');
    assert.equal(getProductActionSession(userId, chatId)?.optionNumber, 2);

    assert.equal(
      await handleProductActionConversation(createMessage(replies), '1', dependencies),
      true
    );
    assert.equal(replies.at(-1), formatSaleQuantityQuestion());

    assert.equal(
      await handleProductActionConversation(createMessage(replies), '3', dependencies),
      true
    );
    assert.deepEqual(calls, ['photo:foto 2', 'sale:venda 2 3']);
  } finally {
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('keeps the action menu active when another action cannot initialize', async () => {
  const calls: string[] = [];
  const dependencies = createDependencies(calls);
  dependencies.adjustment = async (_message, body) => {
    calls.push(`adjustment:${body}`);
    return false;
  };

  try {
    saveQuery();
    saveProductActionSession(userId, chatId, 'awaiting_action', 2);

    assert.equal(
      await handleProductActionConversation(createMessage([]), '5', dependencies),
      true
    );
    assert.deepEqual(calls, ['adjustment:ajuste 2']);
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_action');
    assert.equal(getProductActionSession(userId, chatId)?.optionNumber, 2);
  } finally {
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('zero-stock selection offers and routes only entry, price and location', async () => {
  const expected = new Map([
    ['1', 'entry:entrada 2'],
    ['2', 'price:preco 2'],
    ['3', 'location:local 2'],
  ]);

  try {
    saveQuery();
    const replies: string[] = [];
    const calls: string[] = [];
    saveProductActionSession(
      userId,
      chatId,
      'awaiting_product',
      undefined,
      'zero_stock'
    );

    assert.equal(
      await handleProductActionConversation(
        createMessage(replies),
        '2',
        createDependencies(calls)
      ),
      true
    );
    assert.equal(replies.at(-1), formatZeroStockActionMenu(true));
    assert.equal(getProductActionSession(userId, chatId)?.mode, 'zero_stock');

    for (const [selection, expectedCall] of expected) {
      calls.length = 0;
      saveProductActionSession(
        userId,
        chatId,
        'awaiting_action',
        2,
        'zero_stock'
      );

      assert.equal(
        await handleProductActionConversation(
          createMessage(replies),
          selection,
          createDependencies(calls)
        ),
        true
      );
      assert.deepEqual(calls, [expectedCall]);
    }
  } finally {
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('keeps the zero-stock action menu active when an action cannot initialize', async () => {
  const calls: string[] = [];
  const dependencies = createDependencies(calls);
  dependencies.location = async (_message, body) => {
    calls.push(`location:${body}`);
    return false;
  };

  try {
    saveQuery();
    saveProductActionSession(userId, chatId, 'awaiting_action', 2, 'zero_stock');

    assert.equal(
      await handleProductActionConversation(createMessage([]), '3', dependencies),
      true
    );
    assert.deepEqual(calls, ['location:local 2']);
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_action');
    assert.equal(getProductActionSession(userId, chatId)?.optionNumber, 2);
    assert.equal(getProductActionSession(userId, chatId)?.mode, 'zero_stock');
  } finally {
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});

test('keeps asking for sale quantity when stock validation prevents the sale', async () => {
  const replies: string[] = [];
  const calls: string[] = [];
  const dependencies = createDependencies(calls);
  dependencies.sale = async (_message, body) => {
    calls.push(`sale:${body}`);
    replies.push('⚠️ ESTOQUE INSUFICIENTE');
    return false;
  };

  try {
    saveQuery();
    saveProductActionSession(userId, chatId, 'awaiting_sale_quantity', 2);

    assert.equal(
      await handleProductActionConversation(createMessage(replies), '9', dependencies),
      true
    );
    assert.deepEqual(calls, ['sale:venda 2 9']);
    assert.equal(getProductActionSession(userId, chatId)?.step, 'awaiting_sale_quantity');

    await handleProductActionConversation(createMessage(replies), '1', dependencies);
    assert.deepEqual(calls, ['sale:venda 2 9', 'sale:venda 2 1']);
  } finally {
    clearProductActionSession(userId, chatId);
    clearLastQuery(userId, chatId);
  }
});
