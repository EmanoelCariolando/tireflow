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
import { getAdjustmentSession } from '../utils/adjustmentSessionStore.js';
import { getEntrySession } from '../utils/entrySessionStore.js';
import { getSaleSession } from '../utils/saleSessionStore.js';
import { PriceProductNotFoundError, registerPriceChange } from '../services/priceService.js';
import { sendBossNotification } from '../services/notificationService.js';

const PRICE_COMMAND_REGEX = /^preco\s+(\d+)$/i;

export function isPriceCommand(body: string): boolean {
  return PRICE_COMMAND_REGEX.test(body.trim());
}

export async function handlePriceCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredPriceSession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return;
  }

  if (
    getPriceSession(userId, chatId) ||
    getAdjustmentSession(userId, chatId) ||
    getEntrySession(userId, chatId) ||
    getSaleSession(userId, chatId)
  ) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return;
  }

  const match = body.trim().match(PRICE_COMMAND_REGEX);
  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('Comando inválido. Exemplo: preco 1');
    return;
  }

  const lastQuery = getLastQuery(userId);
  if (!lastQuery) {
    await message.reply('⚠️ Consulta expirada.\n\nPesquise novamente:\npneu 175/70/14');
    return;
  }

  const product = lastQuery.products[optionNumber - 1];
  if (!product) {
    await message.reply('Opção inválida. Escolha um número da última consulta.');
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

  await message.reply('Novo preço à vista?\n\nDigite o valor. Exemplo: 335.50');
}

export async function handlePriceConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredPriceSession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return true;
  }

  const session = getPriceSession(userId, chatId);
  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (normalizedBody === 'cancelar') {
    clearPriceSession(userId, chatId);
    await message.reply('❌ Operação cancelada.');
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return true;
  }

  if (session.step === 'awaiting_cash_price') {
    await handleCashPriceStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_credit_price') {
    await handleCreditPriceStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ Alteração de preço em processamento. Aguarde um instante.');
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
    await message.reply('Preço inválido.\n\nDigite um valor maior ou igual a zero. Exemplo: 335.50');
    return;
  }

  savePriceSession({
    ...session,
    step: 'awaiting_credit_price',
    newCashPrice: cashPrice,
    updatedAt: Date.now(),
  });

  await message.reply('Novo preço a prazo?\n\nDigite o valor. Exemplo: 365.00');
}

async function handleCreditPriceStep(
  message: Message,
  session: PriceSession,
  body: string
): Promise<void> {
  const creditPrice = parsePriceValue(body);

  if (creditPrice === null) {
    await message.reply('Preço inválido.\n\nDigite um valor maior ou igual a zero. Exemplo: 365.00');
    return;
  }

  const nextSession: PriceSession = {
    ...session,
    step: 'awaiting_confirmation',
    newCreditPrice: creditPrice,
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
  if (normalizedBody !== 'confirmar') {
    await message.reply('Digite: confirmar ou cancelar');
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
      newCreditPrice: session.newCreditPrice,
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

  try {
    await message.reply(
      formatRegisteredPriceChange(
        session,
        registeredPriceChange.movementCode,
        responsibleName,
        registeredPriceChange.currentStock
      )
    );
  } catch (error) {
    console.error('[PRICE] Error sending price message to group:', error);
  }

  try {
    await sendBossNotification(
      formatBossPriceNotification(session, registeredPriceChange.movementCode, responsibleName)
    );
  } catch (error) {
    console.error('[PRICE] Error sending boss notification:', error);
  }

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
  return /^(venda|entrada|ajuste|preco)\b/i.test(normalizedBody);
}

function formatPriceConfirmation(session: PriceSession): string {
  return [
    '⚠️ Confirmar alteração de preço?',
    '',
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    '',
    `Preço à vista anterior: ${formatCurrency(session.oldCashPrice)}`,
    `Novo preço à vista: ${formatCurrency(session.newCashPrice ?? 0)}`,
    '',
    `Preço a prazo anterior: ${formatCurrency(session.oldCreditPrice)}`,
    `Novo preço a prazo: ${formatCurrency(session.newCreditPrice ?? 0)}`,
    '',
    'Digite: confirmar ou cancelar',
  ].join('\n');
}

function formatRegisteredPriceChange(
  session: PriceSession,
  movementCode: string,
  responsibleName: string,
  currentStock: number
): string {
  return [
    '✅ Preço alterado',
    '',
    `Movimentação: ${movementCode}`,
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    '',
    `À vista: ${formatCurrency(session.oldCashPrice)} -> ${formatCurrency(session.newCashPrice ?? 0)}`,
    `A prazo: ${formatCurrency(session.oldCreditPrice)} -> ${formatCurrency(session.newCreditPrice ?? 0)}`,
    `Responsável: ${responsibleName}`,
    '',
    `Estoque atual: ${currentStock}`,
  ].join('\n');
}

function formatBossPriceNotification(
  session: PriceSession,
  movementCode: string,
  responsibleName: string
): string {
  return [
    '🔔 Alteração de preço',
    '',
    `Movimentação: ${movementCode}`,
    `${responsibleName} alterou preços de ${session.reference} ${session.description}`,
    '',
    `À vista: ${formatCurrency(session.oldCashPrice)} -> ${formatCurrency(session.newCashPrice ?? 0)}`,
    `A prazo: ${formatCurrency(session.oldCreditPrice)} -> ${formatCurrency(session.newCreditPrice ?? 0)}`,
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
