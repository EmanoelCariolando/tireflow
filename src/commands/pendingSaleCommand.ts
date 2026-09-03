import type { Message } from 'whatsapp-web.js';
import {
  decimalToNumber,
  findOpenPendingSaleById,
  findOpenPendingSales,
  PendingSaleNotOpenError,
  returnPendingSaleToStock,
  type PendingSaleWithDetails,
} from '../services/pendingSaleService.js';
import { sendBossTextNotification } from '../services/notificationService.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearPendingSaleResolutionSession,
  getPendingSaleResolutionSession,
  savePendingSaleResolutionSession,
} from '../utils/pendingSaleSessionStore.js';
import { saveSaleSession, type SaleItem, type SaleSession } from '../utils/saleSessionStore.js';
import { formatPaymentMenu } from './saleFormatting.js';
import {
  formatPendingKeptOpen,
  formatPendingReturned,
  formatPendingSaleList,
  formatPendingStatusQuestion,
} from './pendingSaleFormatting.js';

const PENDING_COMMAND_REGEX = /^pend[eê]ntes?$/i;

export function isPendingSaleCommand(body: string): boolean {
  return PENDING_COMMAND_REGEX.test(body.trim());
}

export async function handlePendingSaleCommand(message: Message): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const pendingSales = await findOpenPendingSales();

  if (pendingSales.length > 0) {
    savePendingSaleResolutionSession({
      userId,
      chatId,
      step: 'awaiting_selection',
      pendingSaleIds: pendingSales.map((pendingSale) => pendingSale.id),
      updatedAt: Date.now(),
    });
  }

  await message.reply(formatPendingSaleList(pendingSales));
}

export async function handlePendingSaleConversation(
  message: Message,
  body: string
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  const session = getPendingSaleResolutionSession(userId, chatId);
  if (!session) return false;

  const normalized = body.trim().toLowerCase();
  if (normalized === '0' || normalized === 'cancelar' || normalized === 'cancela') {
    clearPendingSaleResolutionSession(userId, chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return true;
  }

  if (session.step === 'awaiting_selection') {
    const selection = parsePositiveInteger(normalized);
    const pendingSaleId = selection ? session.pendingSaleIds[selection - 1] : undefined;
    const pendingSale = pendingSaleId
      ? await findOpenPendingSaleById(pendingSaleId)
      : null;

    if (!pendingSale) {
      await message.reply(
        selection
          ? '⚠️ Essa pendência não está mais disponível. Digite *pendente* para atualizar a lista.'
          : '❌ Opção inválida. Digite o número de uma pendência ou *0* para cancelar.'
      );
      if (selection) clearPendingSaleResolutionSession(userId, chatId);
      return true;
    }

    savePendingSaleResolutionSession({
      ...session,
      step: 'awaiting_status',
      selectedPendingSaleId: pendingSale.id,
      updatedAt: Date.now(),
    });
    await message.reply(formatPendingStatusQuestion(pendingSale));
    return true;
  }

  const pendingSale = session.selectedPendingSaleId
    ? await findOpenPendingSaleById(session.selectedPendingSaleId)
    : null;
  if (!pendingSale) {
    clearPendingSaleResolutionSession(userId, chatId);
    await message.reply('⚠️ Essa pendência já foi resolvida. Digite *pendente* para atualizar a lista.');
    return true;
  }

  if (normalized === '1' || normalized === 'sim' || normalized === 'vendeu') {
    clearPendingSaleResolutionSession(userId, chatId);
    const saleSession = mapPendingSaleToSaleSession(pendingSale, userId, chatId);
    saveSaleSession(saleSession);
    await message.reply([
      '✅ *VENDA CONFIRMADA*',
      'Agora informe como o cliente pagou.',
      '',
      formatPaymentMenu(saleSession),
    ].join('\n'));
    return true;
  }

  if (normalized === '2' || normalized === 'nao' || normalized === 'não') {
    clearPendingSaleResolutionSession(userId, chatId);
    await message.reply(formatPendingKeptOpen(pendingSale));
    return true;
  }

  if (normalized === '3' || normalized === 'voltou' || normalized === 'devolveu') {
    const responsibleName = await getContactName(message, userId);
    try {
      const result = await returnPendingSaleToStock(pendingSale.id, userId, responsibleName);
      clearPendingSaleResolutionSession(userId, chatId);
      const confirmation = formatPendingReturned(result);
      await Promise.all([
        runPostCommitTask('pending return group confirmation', () => message.reply(confirmation)),
        runPostCommitTask('pending return boss notification', () =>
          sendBossTextNotification(`🔔 *PENDÊNCIA DEVOLVIDA AO ESTOQUE*\n\n${confirmation}`)
        ),
      ]);
    } catch (error) {
      clearPendingSaleResolutionSession(userId, chatId);
      if (error instanceof PendingSaleNotOpenError) {
        await message.reply('⚠️ Essa pendência já foi resolvida por outra pessoa.');
        return true;
      }
      console.error('[PENDING_SALE] Error returning reserved stock:', error);
      await message.reply('Ocorreu um erro ao devolver os pneus ao estoque. Tente novamente.');
    }
    return true;
  }

  await message.reply(`❌ Opção inválida.\n\n${formatPendingStatusQuestion(pendingSale)}`);
  return true;
}

function mapPendingSaleToSaleSession(
  pendingSale: PendingSaleWithDetails,
  userId: string,
  chatId: string
): SaleSession {
  const items: SaleItem[] = pendingSale.items.map((item) => ({
    productId: item.productId,
    reference: item.reference,
    description: item.description,
    quantity: item.quantity,
    cashPrice: Number(item.cashPrice),
    creditPrice: Number(item.creditPrice),
    priceType: item.priceType === 'A prazo' ? 'A prazo' : 'À vista',
    unitPrice: item.priceType === 'A prazo' ? Number(item.creditPrice) : Number(item.cashPrice),
    totalValue: item.quantity * (
      item.priceType === 'A prazo' ? Number(item.creditPrice) : Number(item.cashPrice)
    ),
  }));
  const lastItem = items.at(-1)!;
  const sharedPriceType = items.every((item) => item.priceType === items[0]?.priceType)
    ? items[0]?.priceType
    : undefined;

  return {
    userId,
    chatId,
    step: 'awaiting_payment',
    productId: lastItem.productId,
    reference: lastItem.reference,
    description: lastItem.description,
    quantity: lastItem.quantity,
    cashPrice: lastItem.cashPrice,
    creditPrice: lastItem.creditPrice,
    unitPrice: lastItem.unitPrice,
    totalValue: Number(pendingSale.totalValue),
    priceType: sharedPriceType,
    originalTotalValue: decimalToNumber(pendingSale.originalTotalValue),
    discountPercent: decimalToNumber(pendingSale.discountPercent),
    discountAmount: decimalToNumber(pendingSale.discountAmount),
    items,
    pendingSaleId: pendingSale.id,
    pendingAssigneeId: pendingSale.assignedTo.phone,
    pendingAssigneeName: pendingSale.assignedTo.name,
    wasPending: true,
    updatedAt: Date.now(),
  };
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getContactName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}
