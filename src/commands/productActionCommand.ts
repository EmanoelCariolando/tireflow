import type { Message } from 'whatsapp-web.js';
import env from '../config/env.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { isCancellationResponse } from '../utils/operationResponse.js';
import { getSaleSession } from '../utils/saleSessionStore.js';
import { getEntrySession } from '../utils/entrySessionStore.js';
import { getPriceSession } from '../utils/priceSessionStore.js';
import { getAdjustmentSession } from '../utils/adjustmentSessionStore.js';
import { getAddPhotoSession } from '../utils/addPhotoSessionStore.js';
import { getLocationSession } from '../utils/locationSessionStore.js';
import { hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';
import { formatQuantityQuestion } from '../utils/operationPrompts.js';
import {
  clearProductActionSession,
  getProductActionSession,
  hasExpiredProductActionSession,
  saveProductActionSession,
} from '../utils/productActionSessionStore.js';
import { handleAdjustmentCommand } from './adjustmentCommand.js';
import { handleEntryCommand } from './entryCommand.js';
import { handleLocationCommand } from './locationCommand.js';
import { formatProductChoiceQuestion } from './pneuCommand.js';
import { handlePriceCommand } from './priceCommand.js';
import { handleAddPhotoCommand, handlePhotoCommand } from './productPhotoCommand.js';
import { handleSaleCommand } from './saleCommand.js';

type IndexedCommandHandler = (message: Message, body: string) => Promise<boolean>;
type SaleCommandStarter = (message: Message, body: string) => Promise<boolean>;

export interface ProductActionDependencies {
  sale: SaleCommandStarter;
  entry: IndexedCommandHandler;
  price: IndexedCommandHandler;
  photo: IndexedCommandHandler;
  adjustment: IndexedCommandHandler;
  addPhoto: IndexedCommandHandler;
  location: IndexedCommandHandler;
  inventoryLocationsEnabled: boolean;
}

const defaultDependencies: ProductActionDependencies = {
  sale: async (message, body) => {
    await handleSaleCommand(message, body);
    return Boolean(
      getSaleSession(getMessageUserId(message), getMessageChatId(message))
    );
  },
  entry: async (message, body) => {
    await handleEntryCommand(message, body);
    return Boolean(getEntrySession(getMessageUserId(message), getMessageChatId(message)));
  },
  price: async (message, body) => {
    await handlePriceCommand(message, body);
    return Boolean(getPriceSession(getMessageUserId(message), getMessageChatId(message)));
  },
  photo: async (message, body) => {
    await handlePhotoCommand(message, body);
    return false;
  },
  adjustment: async (message, body) => {
    await handleAdjustmentCommand(message, body);
    return Boolean(
      getAdjustmentSession(getMessageUserId(message), getMessageChatId(message))
    );
  },
  addPhoto: async (message, body) => {
    await handleAddPhotoCommand(message, body);
    return Boolean(getAddPhotoSession(getMessageUserId(message), getMessageChatId(message)));
  },
  location: async (message, body) => {
    await handleLocationCommand(message, body);
    return Boolean(getLocationSession(getMessageUserId(message), getMessageChatId(message)));
  },
  inventoryLocationsEnabled: env.inventoryLocationsEnabled,
};

export function formatProductActionMenu(
  inventoryLocationsEnabled = env.inventoryLocationsEnabled
): string {
  return [
    '⚙️ ESCOLHA O QUE DESEJA FAZER',
    '',
    '1️⃣ Venda | 2️⃣ Entrada',
    '3️⃣ Preço | 4️⃣ Foto',
    '5️⃣ Ajuste | 6️⃣ Adicionar foto',
    ...(inventoryLocationsEnabled ? ['7️⃣ Localização'] : []),
  ].join('\n');
}

export function formatZeroStockActionMenu(
  inventoryLocationsEnabled = env.inventoryLocationsEnabled
): string {
  return [
    '⚙️ *ESCOLHA O QUE DESEJA FAZER*',
    '',
    '1️⃣ Entrada',
    '2️⃣ Preço',
    ...(inventoryLocationsEnabled ? ['3️⃣ Localização'] : []),
  ].join('\n');
}

export function formatSaleQuantityQuestion(): string {
  return formatQuantityQuestion();
}

export async function handleProductActionConversation(
  message: Message,
  body: string,
  dependencies: ProductActionDependencies = defaultDependencies
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const normalizedBody = body.trim();

  if (hasExpiredProductActionSession(userId, chatId)) {
    if (!/^\d+$/.test(normalizedBody)) {
      return false;
    }

    await message.reply('⌛ CONSULTA EXPIRADA\nDigite novamente a medida do pneu.');
    return true;
  }

  const session = getProductActionSession(userId, chatId);

  if (!session) {
    return false;
  }

  if (isCancellationResponse(normalizedBody.toLowerCase())) {
    clearProductActionSession(userId, chatId);
    await message.reply('❌ Operação cancelada.');
    return true;
  }

  if (!/^\d+$/.test(normalizedBody)) {
    return false;
  }

  const selection = Number(normalizedBody);
  const lastQuery = getLastQuery(userId, chatId);

  if (!lastQuery) {
    clearProductActionSession(userId, chatId);
    await message.reply('⌛ CONSULTA EXPIRADA\nDigite novamente a medida do pneu.');
    return true;
  }

  if (session.step === 'awaiting_product') {
    if (!Number.isSafeInteger(selection) || selection <= 0 || !lastQuery.products[selection - 1]) {
      await message.reply(`❌ Pneu inválido.\n\n${formatProductChoiceQuestion()}`);
      return true;
    }

    saveProductActionSession(
      userId,
      chatId,
      'awaiting_action',
      selection,
      session.mode
    );
    await message.reply(
      session.mode === 'zero_stock'
        ? formatZeroStockActionMenu(dependencies.inventoryLocationsEnabled)
        : formatProductActionMenu(dependencies.inventoryLocationsEnabled)
    );
    return true;
  }

  const optionNumber = session.optionNumber;
  if (!optionNumber || !lastQuery.products[optionNumber - 1]) {
    clearProductActionSession(userId, chatId);
    await message.reply('⌛ CONSULTA EXPIRADA\nDigite novamente a medida do pneu.');
    return true;
  }

  if (session.mode === 'zero_stock') {
    const zeroStockActionHandlers: Record<
      number,
      { handler: IndexedCommandHandler; command: string }
    > = {
      1: { handler: dependencies.entry, command: 'entrada' },
      2: { handler: dependencies.price, command: 'preco' },
    };

    if (dependencies.inventoryLocationsEnabled) {
      zeroStockActionHandlers[3] = {
        handler: dependencies.location,
        command: 'local',
      };
    }

    const zeroStockAction = zeroStockActionHandlers[selection];
    if (!zeroStockAction) {
      await message.reply(
        `❌ Opção inválida.\n\n${formatZeroStockActionMenu(
          dependencies.inventoryLocationsEnabled
        )}`
      );
      return true;
    }

    await runIndexedAction(
      message,
      zeroStockAction,
      optionNumber,
      userId,
      chatId,
      session.mode
    );
    return true;
  }

  if (session.step === 'awaiting_sale_quantity') {
    if (!Number.isSafeInteger(selection) || selection <= 0) {
      await message.reply(`❌ Quantidade inválida.\n\n${formatSaleQuantityQuestion()}`);
      return true;
    }

    const saleStarted = await dependencies.sale(
      message,
      `venda ${optionNumber} ${selection}`
    );
    if (saleStarted) {
      clearProductActionSession(userId, chatId);
    }
    return true;
  }

  const actionHandlers: Record<number, { handler: IndexedCommandHandler; command: string }> = {
    2: { handler: dependencies.entry, command: 'entrada' },
    3: { handler: dependencies.price, command: 'preco' },
    4: { handler: dependencies.photo, command: 'foto' },
    5: { handler: dependencies.adjustment, command: 'ajuste' },
    6: { handler: dependencies.addPhoto, command: 'addfoto' },
  };
  if (dependencies.inventoryLocationsEnabled) {
    actionHandlers[7] = { handler: dependencies.location, command: 'local' };
  }

  if (selection === 1) {
    saveProductActionSession(
      userId,
      chatId,
      'awaiting_sale_quantity',
      optionNumber,
      session.mode
    );
    await message.reply(formatSaleQuantityQuestion());
    return true;
  }

  const action = actionHandlers[selection];
  if (!action) {
    await message.reply(`❌ Opção inválida.\n\n${formatProductActionMenu(
      dependencies.inventoryLocationsEnabled
    )}`);
    return true;
  }

  await runIndexedAction(
    message,
    action,
    optionNumber,
    userId,
    chatId,
    session.mode
  );
  return true;
}

async function runIndexedAction(
  message: Message,
  action: { handler: IndexedCommandHandler; command: string },
  optionNumber: number,
  userId: string,
  chatId: string,
  mode: 'standard' | 'zero_stock'
): Promise<void> {
  clearProductActionSession(userId, chatId);
  let actionStarted = false;
  try {
    actionStarted = await action.handler(message, `${action.command} ${optionNumber}`);
  } finally {
    // Read-only actions (such as viewing a photo) and actions that could not
    // initialize must leave the menu usable for the next numeric choice.
    if (!actionStarted && !hasActiveOperationSession(userId, chatId)) {
      saveProductActionSession(
        userId,
        chatId,
        'awaiting_action',
        optionNumber,
        mode
      );
    }
  }
}
