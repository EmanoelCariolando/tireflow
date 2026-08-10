import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearPriceSession,
  getPriceSession,
  hasExpiredPriceSession,
  PriceSession,
  savePriceSession,
} from '../utils/priceSessionStore.js';
import { clearAllOperationSessions, hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { PriceProductNotFoundError, registerPriceChange } from '../services/priceService.js';
import { sendBossNotification } from '../services/notificationService.js';
import { isCancellationResponse, isConfirmationResponse } from '../utils/operationResponse.js';
import { calculateCreditPrice } from '../utils/productPricing.js';

const PRICE_COMMAND_REGEX = /^pre[cç]o\s+(\d+)$/i;

export function isPriceCommand(body: string): boolean {
  return PRICE_COMMAND_REGEX.test(body.trim());
}

export async function handlePriceCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredPriceSession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return;
  }

  const match = body.trim().match(PRICE_COMMAND_REGEX);
  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('❌ Comando inválido. Use: *preco 1*');
    return;
  }

  const lastQuery = getLastQuery(userId, chatId);
  if (!lastQuery) {
    await message.reply('⌛ *CONSULTA EXPIRADA*\nPesquise novamente: *pneu 175/70 R14* ou *baixo estoque*.');
    return;
  }

  const product = lastQuery.products[optionNumber - 1];
  if (!product) {
    await message.reply('❌ Item inválido. Use um número da última consulta.');
    return;
  }

  savePriceSession({
    userId,
    chatId,
    step: 'awaiting_cash_price',
    productId: product.id,
    reference: product.reference || lastQuery.normalizedMeasure,
    description: product.description,
    stock: product.stock,
    oldCashPrice: product.cashPrice,
    oldCreditPrice: product.creditPrice,
    updatedAt: Date.now(),
  });

  await message.reply(
    '💰 *PREÇO — NOVO VALOR À VISTA*\n\nDigite o novo valor.\nEx.: *335,50*\n\n_O preço a prazo (+5,8%) será calculado automaticamente._'
  );
}

export async function handlePriceConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredPriceSession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return true;
  }

  const session = getPriceSession(userId, chatId);
  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (isCancellationResponse(normalizedBody)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return true;
  }

  if (session.step === 'awaiting_cash_price') {
    await handleCashPriceStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ *ATUALIZANDO PREÇO...*');
    return true;
  }

  return false;
}

async function handleCashPriceStep(
  message: Message,
  session: PriceSession,
  body: string
): Promise<void> {
  const cashPrice = parsePriceValue(body);

  if (cashPrice === null) {
    await message.reply('❌ Preço inválido. Digite um valor maior ou igual a zero. Ex.: *335,50*');
    return;
  }

  const nextSession: PriceSession = {
    ...session,
    step: 'awaiting_confirmation',
    newCashPrice: cashPrice,
    newCreditPrice: calculateCreditPrice(cashPrice),
    updatedAt: Date.now(),
  };

  savePriceSession(nextSession);
  await message.reply(formatPriceConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: PriceSession,
  normalizedBody: string
): Promise<void> {
  if (!isConfirmationResponse(normalizedBody)) {
    await message.reply('Responda: *confirmar* ou *cancelar*.');
    return;
  }

  if (session.newCashPrice === undefined || session.newCreditPrice === undefined) {
    clearPriceSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão de preço. Faça a consulta novamente.');
    return;
  }

  savePriceSession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  const responsibleName = await getResponsibleName(message, session.userId);

  let registeredPriceChange: Awaited<ReturnType<typeof registerPriceChange>>;

  try {
    registeredPriceChange = await registerPriceChange({
      productId: session.productId,
      responsiblePhone: session.userId,
      responsibleName,
      oldCashPrice: session.oldCashPrice,
      oldCreditPrice: session.oldCreditPrice,
      newCashPrice: session.newCashPrice,
    });
  } catch (error) {
    clearPriceSession(session.userId, session.chatId);

    if (error instanceof PriceProductNotFoundError) {
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }

    console.error('[PRICE] Error registering price change:', error);
    await message.reply('Ocorreu um erro ao alterar o preço. Tente novamente.');
    return;
  }

  await runPostCommitTask('price group confirmation', () =>
    message.reply(
      formatRegisteredPriceChange(
        session,
        registeredPriceChange.movementCode,
        responsibleName,
        registeredPriceChange.currentStock
      )
    )
  );

  await runPostCommitTask('price private owner notification', () =>
    sendBossNotification(
      formatBossPriceNotification(session, registeredPriceChange.movementCode, responsibleName)
    )
  );

  clearPriceSession(session.userId, session.chatId);
}

function parsePriceValue(value: string): number | null {
  const trimmed = value.trim();
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;
  const price = Number(normalized);

  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  return Math.round(price * 100) / 100;
}

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(venda|entrada|ajuste|pre[cç]o|local)\b/i.test(normalizedBody);
}

function formatPriceConfirmation(session: PriceSession): string {
  return [
    '💰 *PREÇO — CONFIRMAR*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `💰 À vista: ${formatCurrency(session.oldCashPrice)} → *${formatCurrency(session.newCashPrice ?? 0)}*`,
    `💳 A prazo (+5,8%): ${formatCurrency(session.oldCreditPrice)} → *${formatCurrency(session.newCreditPrice ?? 0)}*`,
    '',
    'Responda: *confirmar* ou *cancelar*.',
  ].join('\n');
}

function formatRegisteredPriceChange(
  session: PriceSession,
  movementCode: string,
  responsibleName: string,
  currentStock: number
): string {
  return [
    '✅ *PREÇO ATUALIZADO*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `💰 À vista: ${formatCurrency(session.oldCashPrice)} → *${formatCurrency(session.newCashPrice ?? 0)}*`,
    `💳 A prazo: ${formatCurrency(session.oldCreditPrice)} → *${formatCurrency(session.newCreditPrice ?? 0)}*`,
    '',
    `📦 Estoque: *${currentStock}*`,
    `🧾 Movimentação: *${movementCode}*`,
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatBossPriceNotification(
  session: PriceSession,
  movementCode: string,
  responsibleName: string
): string {
  return [
    '💰 *PREÇO ATUALIZADO*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `💰 À vista: ${formatCurrency(session.oldCashPrice)} → *${formatCurrency(session.newCashPrice ?? 0)}*`,
    `💳 A prazo: ${formatCurrency(session.oldCreditPrice)} → *${formatCurrency(session.newCreditPrice ?? 0)}*`,
    '',
    `🧾 Movimentação: *${movementCode}*`,
    `👤 Responsável: *${responsibleName}*`,
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
