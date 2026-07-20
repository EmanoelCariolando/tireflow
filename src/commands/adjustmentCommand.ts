import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  AdjustmentSession,
  clearAdjustmentSession,
  getAdjustmentSession,
  hasExpiredAdjustmentSession,
  saveAdjustmentSession,
} from '../utils/adjustmentSessionStore.js';
import { clearAllOperationSessions, hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import {
  AdjustmentProductNotFoundError,
  registerAdjustment,
} from '../services/adjustmentService.js';
import { getCurrentProductStock } from '../services/saleService.js';
import { sendBossNotification } from '../services/notificationService.js';

const ADJUSTMENT_COMMAND_REGEX = /^ajuste\s+(\d+)$/i;

export function isAdjustmentCommand(body: string): boolean {
  return ADJUSTMENT_COMMAND_REGEX.test(body.trim());
}

export async function handleAdjustmentCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredAdjustmentSession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return;
  }

  const match = body.trim().match(ADJUSTMENT_COMMAND_REGEX);
  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('Comando inválido. Exemplo: ajuste 1');
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

  const currentStock = await getCurrentProductStock(product.id);
  if (currentStock === null) {
    await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
    return;
  }

  saveAdjustmentSession({
    userId,
    chatId,
    step: 'awaiting_new_stock',
    productId: product.id,
    reference: product.reference || lastQuery.normalizedMeasure,
    description: product.description,
    previousStock: currentStock,
    updatedAt: Date.now(),
  });

  await message.reply('Novo estoque?\n\nDigite apenas o número. Exemplo: 10');
}

export async function handleAdjustmentConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredAdjustmentSession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return true;
  }

  const session = getAdjustmentSession(userId, chatId);
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

  if (session.step === 'awaiting_new_stock') {
    await handleNewStockStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_reason') {
    await handleReasonStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ Ajuste em processamento. Aguarde um instante.');
    return true;
  }

  return false;
}

async function handleNewStockStep(
  message: Message,
  session: AdjustmentSession,
  normalizedBody: string
): Promise<void> {
  const newStock = Number(normalizedBody);

  if (!Number.isInteger(newStock) || newStock < 0) {
    await message.reply('Estoque inválido.\n\nDigite um número inteiro igual ou maior que zero. Exemplo: 10');
    return;
  }

  saveAdjustmentSession({
    ...session,
    step: 'awaiting_reason',
    newStock,
    updatedAt: Date.now(),
  });

  await message.reply('Motivo do ajuste?\n\nExemplo:\nConferência semanal');
}

async function handleReasonStep(
  message: Message,
  session: AdjustmentSession,
  body: string
): Promise<void> {
  const reason = body.trim();

  if (!reason) {
    await message.reply('Motivo do ajuste?\n\nExemplo:\nConferência semanal');
    return;
  }

  const nextSession: AdjustmentSession = {
    ...session,
    step: 'awaiting_confirmation',
    reason,
    updatedAt: Date.now(),
  };

  saveAdjustmentSession(nextSession);
  await message.reply(formatAdjustmentConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: AdjustmentSession,
  normalizedBody: string
): Promise<void> {
  if (normalizedBody !== 'confirmar') {
    await message.reply('Digite: confirmar ou cancelar');
    return;
  }

  if (session.newStock === undefined || !session.reason) {
    clearAdjustmentSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão do ajuste. Faça a consulta novamente.');
    return;
  }

  saveAdjustmentSession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  const responsibleName = await getResponsibleName(message, session.userId);

  let registeredAdjustment: Awaited<ReturnType<typeof registerAdjustment>>;

  try {
    registeredAdjustment = await registerAdjustment({
      productId: session.productId,
      responsiblePhone: session.userId,
      responsibleName,
      newStock: session.newStock,
      reason: session.reason,
    });
  } catch (error) {
    clearAdjustmentSession(session.userId, session.chatId);

    if (error instanceof AdjustmentProductNotFoundError) {
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }

    console.error('[ADJUSTMENT] Error registering adjustment:', error);
    await message.reply('Ocorreu um erro ao registrar o ajuste. Tente novamente.');
    return;
  }

  await runPostCommitTask('adjustment group confirmation', () =>
    message.reply(
      formatRegisteredAdjustment(
        session,
        registeredAdjustment.movementCode,
        responsibleName,
        registeredAdjustment.previousStock,
        registeredAdjustment.currentStock
      )
    )
  );

  await runPostCommitTask('adjustment private owner notification', () =>
    sendBossNotification(
      formatBossAdjustmentNotification(
        session,
        registeredAdjustment.movementCode,
        responsibleName,
        registeredAdjustment.previousStock,
        registeredAdjustment.currentStock
      )
    )
  );

  clearAdjustmentSession(session.userId, session.chatId);
}

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(venda|entrada|ajuste|preco)\b/i.test(normalizedBody);
}

function formatAdjustmentConfirmation(session: AdjustmentSession): string {
  return [
    '⚠️ Confirmar ajuste?',
    '',
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    `Estoque anterior: ${session.previousStock}`,
    `Novo estoque: ${session.newStock}`,
    `Motivo: ${session.reason}`,
    '',
    'Digite: confirmar ou cancelar',
  ].join('\n');
}

function formatRegisteredAdjustment(
  session: AdjustmentSession,
  movementCode: string,
  responsibleName: string,
  previousStock: number,
  currentStock: number
): string {
  return [
    '⚠️ Ajuste registrado',
    '',
    `Movimentação: ${movementCode}`,
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    `Anterior: ${previousStock}`,
    `Atual: ${currentStock}`,
    `Responsável: ${responsibleName}`,
    `Motivo: ${session.reason}`,
  ].join('\n');
}

function formatBossAdjustmentNotification(
  session: AdjustmentSession,
  movementCode: string,
  responsibleName: string,
  previousStock: number,
  currentStock: number
): string {
  return [
    '⚠️ Ajuste de estoque',
    '',
    `Movimentação: ${movementCode}`,
    `${responsibleName} ajustou estoque`,
    `${session.reference} ${session.description}`,
    '',
    `Anterior: ${previousStock}`,
    `Atual: ${currentStock}`,
    `Motivo: ${session.reason}`,
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
