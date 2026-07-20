import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearEntrySession,
  EntrySession,
  getEntrySession,
  hasExpiredEntrySession,
  saveEntrySession,
} from '../utils/entrySessionStore.js';
import { clearAllOperationSessions, hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { EntryProductNotFoundError, registerEntry } from '../services/entryService.js';
import { sendBossNotification } from '../services/notificationService.js';

const ENTRY_COMMAND_REGEX = /^entrada\s+(\d+)$/i;

export function isEntryCommand(body: string): boolean {
  return ENTRY_COMMAND_REGEX.test(body.trim());
}

export async function handleEntryCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredEntrySession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return;
  }

  const match = body.trim().match(ENTRY_COMMAND_REGEX);
  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('Comando inválido. Exemplo: entrada 1');
    return;
  }

  const lastQuery = getLastQuery(userId, chatId);
  if (!lastQuery) {
    await message.reply('⚠️ Consulta expirada.\n\nPesquise novamente:\npneu 175/70/14\nou\nbaixo estoque');
    return;
  }

  const product = lastQuery.products[optionNumber - 1];
  if (!product) {
    await message.reply('Opção inválida. Escolha um número da última consulta.');
    return;
  }

  saveEntrySession({
    userId,
    chatId,
    step: 'awaiting_quantity',
    productId: product.id,
    reference: product.reference || lastQuery.normalizedMeasure,
    description: product.description,
    updatedAt: Date.now(),
  });

  await message.reply('Quantidade da entrada?\n\nDigite apenas o número. Exemplo: 20');
}

export async function handleEntryConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredEntrySession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return true;
  }

  const session = getEntrySession(userId, chatId);
  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (normalizedBody === 'cancelar') {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ Operação cancelada.');
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return true;
  }

  if (session.step === 'awaiting_quantity') {
    await handleQuantityStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_supplier') {
    await handleSupplierStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ Entrada em processamento. Aguarde um instante.');
    return true;
  }

  return false;
}

async function handleQuantityStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  const quantity = Number(normalizedBody);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    await message.reply('Quantidade inválida.\n\nDigite apenas o número. Exemplo: 20');
    return;
  }

  saveEntrySession({
    ...session,
    step: 'awaiting_supplier',
    quantity,
    updatedAt: Date.now(),
  });

  await message.reply('Fornecedor?\n\nExemplo:\nABC Pneus');
}

async function handleSupplierStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const supplier = body.trim();

  if (!supplier) {
    await message.reply('Fornecedor?\n\nExemplo:\nABC Pneus');
    return;
  }

  const nextSession: EntrySession = {
    ...session,
    step: 'awaiting_confirmation',
    supplier,
    updatedAt: Date.now(),
  };

  saveEntrySession(nextSession);
  await message.reply(formatEntryConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  if (normalizedBody !== 'confirmar') {
    await message.reply('Digite: confirmar ou cancelar');
    return;
  }

  if (!session.quantity || !session.supplier) {
    clearEntrySession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da entrada. Faça a consulta novamente.');
    return;
  }

  saveEntrySession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  const responsibleName = await getResponsibleName(message, session.userId);

  let registeredEntry: Awaited<ReturnType<typeof registerEntry>>;

  try {
    registeredEntry = await registerEntry({
      productId: session.productId,
      responsiblePhone: session.userId,
      responsibleName,
      quantity: session.quantity,
      supplier: session.supplier,
    });
  } catch (error) {
    clearEntrySession(session.userId, session.chatId);

    if (error instanceof EntryProductNotFoundError) {
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }

    console.error('[ENTRY] Error registering entry:', error);
    await message.reply('Ocorreu um erro ao registrar a entrada. Tente novamente.');
    return;
  }

  await runPostCommitTask('entry group confirmation', () =>
    message.reply(
      formatRegisteredEntry(
        session,
        registeredEntry.movementCode,
        responsibleName,
        registeredEntry.currentStock
      )
    )
  );

  await runPostCommitTask('entry private owner notification', () =>
    sendBossNotification(
      formatBossEntryNotification(
        session,
        registeredEntry.movementCode,
        responsibleName,
        registeredEntry.currentStock
      )
    )
  );

  clearEntrySession(session.userId, session.chatId);
}

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(venda|entrada|ajuste|preco)\b/i.test(normalizedBody);
}

function formatEntryConfirmation(session: EntrySession): string {
  return [
    '⚠️ Confirmar entrada?',
    '',
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    `Quantidade: +${session.quantity}`,
    `Fornecedor: ${session.supplier}`,
    '',
    'Digite: confirmar ou cancelar',
  ].join('\n');
}

function formatRegisteredEntry(
  session: EntrySession,
  movementCode: string,
  responsibleName: string,
  currentStock: number
): string {
  return [
    '📦 Entrada registrada',
    '',
    `Movimentação: ${movementCode}`,
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    `Quantidade: +${session.quantity}`,
    `Fornecedor: ${session.supplier}`,
    `Responsável: ${responsibleName}`,
    '',
    `Estoque atual: ${currentStock}`,
  ].join('\n');
}

function formatBossEntryNotification(
  session: EntrySession,
  movementCode: string,
  responsibleName: string,
  currentStock: number
): string {
  return [
    '📦 Nova entrada',
    '',
    `Movimentação: ${movementCode}`,
    `${responsibleName} registrou entrada de ${session.quantity} pneus`,
    `${session.reference} ${session.description}`,
    '',
    `Fornecedor: ${session.supplier}`,
    `Estoque atual: ${currentStock}`,
  ].join('\n');
}

async function getResponsibleName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}
