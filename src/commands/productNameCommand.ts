import type { Message } from 'whatsapp-web.js';
import {
  DuplicateProductNameError, ProductNameChangedError, ProductNameNotFoundError, renameProduct,
} from '../services/productNameService.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { getLastQuery, updateLastQueryProductDescription } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';
import {
  formatConfirmationOptions, formatOperationConfirmation,
  isCancellationResponse, parseConfirmationAction,
} from '../utils/operationResponse.js';
import { clearProductActionSession } from '../utils/productActionSessionStore.js';
import {
  clearProductNameSession, getProductNameSession, hasExpiredProductNameSession,
  saveProductNameSession, type ProductNameSession,
} from '../utils/productNameSessionStore.js';
import { MAX_PRODUCT_TEXT_LENGTH, normalizeProductDescription } from '../utils/productText.js';

const NAME_COMMAND_REGEX = /^nome\s+(\d+)$/i;
const NAME_QUESTION = '✏️ *MUDAR NOME*\n\nDigite o novo nome do produto:';

export function isProductNameCommand(body: string): boolean {
  return NAME_COMMAND_REGEX.test(body.trim());
}

export async function handleProductNameCommand(message: Message, body: string): Promise<boolean> {
  const match = body.trim().match(NAME_COMMAND_REGEX);
  if (!match) return false;
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return false;
  }
  const query = getLastQuery(userId, chatId);
  if (!query) {
    await message.reply('⌛ *CONSULTA EXPIRADA*\nFaça uma nova consulta.');
    return false;
  }
  const product = query.products[Number(match[1]) - 1];
  if (!product) {
    await message.reply('❌ Opção inválida. Escolha um item da última consulta.');
    return false;
  }
  clearProductActionSession(userId, chatId);
  saveProductNameSession({
    userId, chatId, productId: product.id, reference: product.reference,
    previousDescription: product.description, step: 'awaiting_name', updatedAt: Date.now(),
  });
  await message.reply(`${NAME_QUESTION}\n\nNome atual: *${product.description}*`);
  return true;
}

export async function handleProductNameConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  if (hasExpiredProductNameSession(userId, chatId)) {
    await message.reply('⌛ *ALTERAÇÃO DE NOME EXPIRADA*\nFaça uma nova consulta.');
    return true;
  }
  const session = getProductNameSession(userId, chatId);
  if (!session) return false;
  if (isCancellationResponse(body)) {
    clearProductNameSession(userId, chatId);
    await message.reply('❌ Alteração de nome cancelada.');
    return true;
  }
  if (session.step === 'processing') {
    await message.reply('⏳ *ATUALIZANDO NOME...*');
    return true;
  }
  if (session.step === 'awaiting_name') {
    const description = normalizeProductDescription(body);
    if (!description) {
      await message.reply(`❌ Digite um nome entre 2 e ${MAX_PRODUCT_TEXT_LENGTH} caracteres.`);
      return true;
    }
    if (description === session.previousDescription) {
      await message.reply('Este já é o nome atual. Digite um nome diferente ou *cancelar*.');
      return true;
    }
    saveProductNameSession({ ...session, newDescription: description, step: 'awaiting_confirmation' });
    await message.reply(formatOperationConfirmation('✏️ *MUDAR NOME — CONFIRMAR*', [
      [`Produto: *${session.reference}*`],
      [`Nome atual: *${session.previousDescription}*`, `Novo nome: *${description}*`],
    ]));
    return true;
  }
  const action = parseConfirmationAction(body);
  if (action === 'back') {
    saveProductNameSession({ ...session, step: 'awaiting_name', newDescription: undefined });
    await message.reply(NAME_QUESTION);
  } else if (action === 'cancel') {
    clearProductNameSession(userId, chatId);
    await message.reply('❌ Alteração de nome cancelada.');
  } else if (action === 'confirm' && session.newDescription) {
    await confirmProductName(message, session, session.newDescription);
  } else {
    await message.reply(`❌ Opção inválida.\n\n${formatConfirmationOptions()}`);
  }
  return true;
}

async function confirmProductName(
  message: Message, session: ProductNameSession, newDescription: string
): Promise<void> {
  saveProductNameSession({ ...session, step: 'processing' });
  let description: string;
  try {
    description = await renameProduct({
      productId: session.productId, expectedDescription: session.previousDescription,
      newDescription,
    });
  } catch (error) {
    if (error instanceof DuplicateProductNameError) {
      saveProductNameSession({ ...session, step: 'awaiting_name', newDescription: undefined });
      await message.reply('⚠️ Já existe um produto com essa referência e nome.\nDigite outro nome.');
      return;
    }
    if (error instanceof ProductNameChangedError || error instanceof ProductNameNotFoundError) {
      clearProductNameSession(session.userId, session.chatId);
      await message.reply('⚠️ O produto foi alterado ou não está mais disponível. Faça uma nova consulta.');
      return;
    }
    console.error('[PRODUCT_NAME] Error updating product name:', error);
    saveProductNameSession({ ...session, step: 'awaiting_confirmation' });
    await message.reply(`❌ Não foi possível mudar o nome. Tente novamente.\n\n${formatConfirmationOptions()}`);
    return;
  }
  updateLastQueryProductDescription(session.productId, description);
  clearProductNameSession(session.userId, session.chatId);
  await runPostCommitTask('product name confirmation', () =>
    message.reply(`✅ *NOME ATUALIZADO*\n\n*${session.reference} — ${description}*`)
  );
}
