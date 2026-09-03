import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  getCurrentProductStock,
  InsufficientStockError,
  registerSaleItems,
  SaleProductNotFoundError,
} from '../services/saleService.js';
import {
  forwardMessageToBoss,
  sendBossTextNotification,
} from '../services/notificationService.js';
import {
  clearSaleSession,
  getSaleSession,
  hasExpiredSaleSession,
  MixedPaymentMethod,
  PaymentMethod,
  SaleSession,
  saveSaleSession,
} from '../utils/saleSessionStore.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
  isNewOperationConversationCommand as isNewOperationCommand,
} from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import {
  buildPaymentBreakdown,
  chooseMixedAmountMethod,
  parseCurrencyToCents,
  parseMixedPaymentMethods,
} from '../utils/salePayment.js';
import {
  formatConfirmationOptions,
  isBackResponse,
  isCancellationResponse,
  parseConfirmationAction,
} from '../utils/operationResponse.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  findActiveProductsByReference,
  findAvailableProductsByReference,
} from '../services/productService.js';
import { formatProductChoiceQuestion, formatProductList } from './pneuCommand.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';
import { formatAdditionalTireQuestion, formatQuantityQuestion } from '../utils/operationPrompts.js';
import { registerPendingSale } from '../services/pendingSaleService.js';
import {
  formatPendingAssigneeQuestion,
  formatPendingSaleConfirmation,
  formatPendingSaleRegistered,
} from './pendingSaleFormatting.js';
import {
  isAddItemSelection,
  isDiscountSelection,
  parseAdditionalItemSelection,
  parseCityHallResponse,
  parseDiscountPercent,
  parseDiscountType,
  parsePaymentMethod,
  parsePriceType,
} from './saleParsers.js';
import {
  adjustAvailableProductsForSaleCart as adjustAvailableProductsForCart,
  appendPricedSaleItem as appendPricedItemToSession,
  buildPersistedSaleItems as buildPersistenceItems,
  getExplicitSaleItems,
  getReservedSaleQuantity as getReservedQuantity,
  getSaleItems,
  hasSaleDiscount as hasDiscount,
} from '../utils/saleSessionHelpers.js';
import {
  formatBossSaleNotification,
  formatCityHallQuestion,
  formatDiscountMenu,
  formatDiscountPreview,
  formatDiscountValueQuestion,
  formatMethodForSentence,
  formatMissingReceiptMessage,
  formatMixedAmountQuestion,
  formatPaymentMenu,
  formatPriceTypeQuestion,
  formatReceiptRequest,
  formatRegisteredSale,
  formatSaleConfirmation,
  formatTransferCityQuestion,
  isPaymentReceiptRequired,
  MIXED_PAYMENT_MENU,
} from './saleFormatting.js';

export { parseCityHallResponse } from './saleParsers.js';
export {
  formatBossSaleNotification,
  formatCityHallQuestion,
  formatRegisteredSale,
  formatSaleConfirmation,
  formatTransferCityQuestion,
  isCashReceiptRequired,
} from './saleFormatting.js';

const SALE_COMMAND_REGEX = /^venda\s+(\d+)\s+(\d+)$/i;
const MAX_SALE_ITEMS = 20;

export function isSaleCommand(body: string): boolean {
  return SALE_COMMAND_REGEX.test(body.trim());
}

export async function handleSaleCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredSaleSession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return;
  }

  const match = body.trim().match(SALE_COMMAND_REGEX);
  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);
  const quantity = Number(match[2]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
    await message.reply('❌ Comando inválido. Use: *venda 1 5*');
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

  const currentStock = await getCurrentProductStock(product.id);

  if (currentStock === null) {
    await message.reply('⚠️ Produto indisponível. Faça uma nova consulta.');
    return;
  }

  if (currentStock < quantity) {
    await message.reply(
      `⚠️ *ESTOQUE INSUFICIENTE*\nDisponível: *${currentStock}* | Solicitado: *${quantity}*`
    );
    return;
  }

  const saleSession: SaleSession = {
    userId,
    chatId,
    step: 'awaiting_price_type',
    productId: product.id,
    reference: product.reference || lastQuery.normalizedMeasure,
    description: product.description,
    quantity,
    cashPrice: product.cashPrice,
    creditPrice: product.creditPrice,
    updatedAt: Date.now(),
  };
  saveSaleSession(saleSession);

  await message.reply(formatPriceTypeQuestion(saleSession));
}

export async function handleSaleConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredSaleSession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return true;
  }

  const session = getSaleSession(userId, chatId);
  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (session.step === 'awaiting_pending_assignee' && normalizedBody === '0') {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return true;
  }

  if (
    normalizedBody === '0' &&
    (session.step === 'awaiting_discount_type' || session.step === 'awaiting_discount_value')
  ) {
    await handleDiscountBackStep(message, session);
    return true;
  }

  if (isCancellationResponse(normalizedBody)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return true;
  }

  if (isBackResponse(normalizedBody) && canReturnFromAdditionalSale(session)) {
    await returnToPreparedSale(message, session);
    return true;
  }

  if (isDuplicateReceiptMessage(message, session)) {
    console.log('[SALE] Duplicate receipt media message ignored.');
    return true;
  }

  if (session.step === 'awaiting_additional_measure') {
    await handleAdditionalMeasureStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_additional_item') {
    await handleAdditionalItemStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_additional_quantity') {
    await handleAdditionalQuantityStep(message, session, body);
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return true;
  }

  if (session.step === 'awaiting_payment') {
    await handlePaymentStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_pending_assignee') {
    await handlePendingAssigneeStep(message, session);
    return true;
  }

  if (session.step === 'awaiting_price_type') {
    await handlePriceTypeStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_discount_type') {
    await handleDiscountTypeStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_discount_value') {
    await handleDiscountValueStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_discount_confirmation') {
    await handleDiscountConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_mixed_methods') {
    await handleMixedMethodsStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_mixed_amount') {
    await handleMixedAmountStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_photo') {
    await handlePhotoStep(message, session);
    return true;
  }

  if (session.step === 'awaiting_transfer_city') {
    await handleTransferCityStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_city_hall_confirmation') {
    await handleCityHallConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_invoice_name') {
    await handleInvoiceNameStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ *REGISTRANDO VENDA...*');
    return true;
  }

  return false;
}

async function handlePaymentStep(
  message: Message,
  session: SaleSession,
  normalizedBody: string
): Promise<void> {
  if (session.pendingSaleId && (isAddItemSelection(normalizedBody) || isDiscountSelection(normalizedBody))) {
    await message.reply(`Essa pendência já possui itens e valores definidos.\n\n${formatPaymentMenu(session)}`);
    return;
  }

  if (isAddItemSelection(normalizedBody)) {
    const items = getSaleItems(session);
    if (items.length >= MAX_SALE_ITEMS) {
      await message.reply(
        `Esta compra já atingiu o limite de ${MAX_SALE_ITEMS} itens.\n\n${formatPaymentMenu(session)}`
      );
      return;
    }

    saveSaleSession({
      ...session,
      items,
      step: 'awaiting_additional_measure',
      additionalMeasure: undefined,
      additionalProducts: undefined,
      additionalProduct: undefined,
      updatedAt: Date.now(),
    });
    await message.reply(formatAdditionalTireQuestion());
    return;
  }

  if (isDiscountSelection(normalizedBody)) {
    if (hasDiscount(session)) {
      await message.reply(
        `Um desconto já foi aplicado nesta venda.\n\n${formatPaymentMenu(session)}`
      );
      return;
    }

    const items = getSaleItems(session);
    if (items.length === 0 || session.totalValue === undefined) {
      clearSaleSession(session.userId, session.chatId);
      await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
      return;
    }

    const discountSession: SaleSession = {
      ...session,
      step: 'awaiting_discount_type',
      paymentMethod: undefined,
      pendingDiscountType: undefined,
      updatedAt: Date.now(),
    };
    saveSaleSession(discountSession);
    await message.reply(formatDiscountMenu());
    return;
  }

  const paymentMethod = parsePaymentMethod(normalizedBody);

  if (!paymentMethod) {
    await message.reply(`Forma de pagamento inválida.\n\n${formatPaymentMenu(session)}`);
    return;
  }

  if (session.pendingSaleId && paymentMethod === 'Pendência') {
    await message.reply(`Uma pendência não pode gerar outra pendência.\n\n${formatPaymentMenu(session)}`);
    return;
  }

  if (paymentMethod === 'Misto') {
    saveSaleSession({
      ...session,
      step: 'awaiting_mixed_methods',
      paymentMethod,
      updatedAt: Date.now(),
    });
    await message.reply(MIXED_PAYMENT_MENU);
    return;
  }

  if (paymentMethod === 'Pendência') {
    saveSaleSession({
      ...session,
      step: 'awaiting_pending_assignee',
      paymentMethod,
      pendingAssigneeId: undefined,
      pendingAssigneeName: undefined,
      updatedAt: Date.now(),
    });
    await message.reply(formatPendingAssigneeQuestion());
    return;
  }

  if (paymentMethod === 'Transferência') {
    saveSaleSession({
      ...session,
      step: 'awaiting_photo',
      paymentMethod: 'Nota',
      pendingReceiptMethods: ['Nota'],
      receipts: [],
      isTransferSale: true,
      transferCity: undefined,
      isCityHallSale: undefined,
      invoiceName: undefined,
      updatedAt: Date.now(),
    });
    await message.reply('📎 *NOTA/PEDIDO*\nEnvie a foto.');
    return;
  }

  await continueDirectPayment(message, { ...session, paymentMethod }, paymentMethod);
}

async function continueDirectPayment(
  message: Message,
  pricedSession: SaleSession,
  paymentMethod: Exclude<PaymentMethod, 'Misto' | 'Pendência'>
): Promise<void> {
  const cleanSession: SaleSession = {
    ...pricedSession,
    paymentMethod,
    isTransferSale: undefined,
    transferCity: undefined,
  };

  if (!isPaymentReceiptRequired(paymentMethod) && !cleanSession.pendingSaleId) {
    const confirmationSession: SaleSession = {
      ...cleanSession,
      step: 'awaiting_confirmation',
      pendingReceiptMethods: [],
      receipts: [],
      updatedAt: Date.now(),
    };
    saveSaleSession(confirmationSession);
    await message.reply(formatSaleConfirmation(confirmationSession));
    return;
  }

  const nextSession: SaleSession = {
    ...cleanSession,
    step: 'awaiting_photo',
    pendingReceiptMethods: [paymentMethod],
    receipts: [],
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);

  if (paymentMethod === 'Nota') {
    await message.reply('📎 *NOTA/PEDIDO*\nEnvie a foto.');
    return;
  }

  if (paymentMethod === 'Dinheiro') {
    await message.reply('📎 *COMPROVANTE — DINHEIRO*\nEnvie a foto do depósito/dinheiro.');
    return;
  }

  await message.reply('📎 *COMPROVANTE*\nEnvie a foto.');
}

async function handlePendingAssigneeStep(
  message: Message,
  session: SaleSession
): Promise<void> {
  const mentionedIds = [...new Set(message.mentionedIds ?? [])];
  if (mentionedIds.length !== 1) {
    await message.reply([
      mentionedIds.length > 1
        ? '❌ Marque apenas *um funcionário*.'
        : '❌ Marque o funcionário responsável usando *@*.',
      '',
      formatPendingAssigneeQuestion(),
    ].join('\n'));
    return;
  }

  const assignedId = mentionedIds[0]!;
  let assignedName = assignedId;
  try {
    const contacts = await message.getMentions();
    const assignedContact = contacts.find((contact) => contact.id._serialized === assignedId)
      ?? contacts[0];
    assignedName = assignedContact?.pushname
      || assignedContact?.name
      || assignedContact?.number
      || assignedId;
  } catch {
    // The WhatsApp id is enough to keep the assignment functional.
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_confirmation',
    paymentMethod: 'Pendência',
    pendingAssigneeId: assignedId,
    pendingAssigneeName: assignedName,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(formatPendingSaleConfirmation(nextSession));
}

async function handleAdditionalMeasureStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  const rawMeasure = body.trim().replace(/^pneu\s+/i, '');
  const normalizedMeasure = normalizeTireSize(rawMeasure);

  if (!normalizedMeasure) {
    await message.reply(
      [
        'Medida inválida.',
        '',
        'Digite outra medida ou *voltar* para manter os pneus anteriores.',
      ].join('\n')
    );
    return;
  }

  let products: QueriedProduct[];
  try {
    products = adjustAvailableProductsForCart(
      await findAvailableProductsByReference(normalizedMeasure),
      getSaleItems(session)
    );

    if (products.length === 0) {
      const activeProducts = await findActiveProductsByReference(normalizedMeasure);
      const hasDatabaseStock = activeProducts.some((product) => product.stock > 0);
      await message.reply(
        hasDatabaseStock
          ? `Todo o estoque disponível de ${normalizedMeasure} já está nesta compra.\n\nDigite outra medida ou *voltar*.`
          : `Nenhum pneu disponível para ${normalizedMeasure}.\n\nDigite outra medida ou *voltar*.`
      );
      return;
    }
  } catch (error) {
    console.error('[SALE] Error searching an additional tire:', error);
    await message.reply('Ocorreu um erro ao buscar a medida. Tente novamente ou digite *voltar*.');
    return;
  }

  saveSaleSession({
    ...session,
    step: 'awaiting_additional_item',
    additionalMeasure: normalizedMeasure,
    additionalProducts: products,
    additionalProduct: undefined,
    updatedAt: Date.now(),
  });
  await message.reply(formatProductList(products, normalizedMeasure));
  await message.reply(formatProductChoiceQuestion());
}

async function handleAdditionalItemStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  const selection = parseAdditionalItemSelection(body);
  if (!selection) {
    await message.reply(`❌ Opção inválida.\n\n${formatProductChoiceQuestion()}`);
    return;
  }

  const product = session.additionalProducts?.[selection.optionNumber - 1];
  if (!product) {
    await message.reply(`❌ Item inválido.\n\n${formatProductChoiceQuestion()}`);
    return;
  }

  const quantitySession: SaleSession = {
    ...session,
    step: 'awaiting_additional_quantity',
    additionalProduct: product,
    additionalProducts: undefined,
    updatedAt: Date.now(),
  };
  saveSaleSession(quantitySession);

  if (selection.quantity === undefined) {
    await message.reply(formatQuantityQuestion());
    return;
  }

  await prepareAdditionalSaleItem(message, quantitySession, selection.quantity);
}

async function handleAdditionalQuantityStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  const quantity = Number(body.trim());
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    await message.reply(
      `❌ Quantidade inválida.\n\n${formatQuantityQuestion()}`
    );
    return;
  }

  await prepareAdditionalSaleItem(message, session, quantity);
}

async function prepareAdditionalSaleItem(
  message: Message,
  session: SaleSession,
  quantity: number
): Promise<void> {
  const product = session.additionalProduct;
  if (!product) {
    saveSaleSession({
      ...session,
      step: 'awaiting_additional_measure',
      additionalMeasure: undefined,
      additionalProducts: undefined,
      additionalProduct: undefined,
      updatedAt: Date.now(),
    });
    await message.reply('Ocorreu um erro na seleção. Digite novamente a medida do pneu.');
    return;
  }

  let currentStock: number | null;
  try {
    currentStock = await getCurrentProductStock(product.id);
  } catch (error) {
    console.error('[SALE] Error checking additional tire stock:', error);
    await message.reply('Não consegui conferir o estoque agora. Tente novamente ou digite cancelar.');
    return;
  }
  if (currentStock === null) {
    saveSaleSession({
      ...session,
      step: 'awaiting_additional_measure',
      additionalMeasure: undefined,
      additionalProducts: undefined,
      additionalProduct: undefined,
      updatedAt: Date.now(),
    });
    await message.reply('Este produto não está mais disponível. Digite outra medida.');
    return;
  }

  const reservedQuantity = getReservedQuantity(getSaleItems(session), product.id);
  const availableQuantity = Math.max(0, currentStock - reservedQuantity);
  if (quantity > availableQuantity) {
    await message.reply(
      [
        'Quantidade indisponível para esta compra.',
        '',
        `Estoque atual: ${currentStock}`,
        `Já separado nesta compra: ${reservedQuantity}`,
        `Disponível para adicionar: ${availableQuantity}`,
        '',
        formatQuantityQuestion(),
      ].join('\n')
    );
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_price_type',
    productId: product.id,
    reference: product.reference || session.additionalMeasure || '',
    description: product.description,
    quantity,
    cashPrice: product.cashPrice,
    creditPrice: product.creditPrice,
    unitPrice: undefined,
    priceType: undefined,
    additionalMeasure: undefined,
    additionalProducts: undefined,
    additionalProduct: undefined,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(formatPriceTypeQuestion(nextSession));
}

async function handlePriceTypeStep(
  message: Message,
  session: SaleSession,
  normalizedBody: string
): Promise<void> {
  const priceType = parsePriceType(normalizedBody);

  if (!priceType) {
    await message.reply(`Opção inválida.\n\n${formatPriceTypeQuestion(session)}`);
    return;
  }

  const nextSession: SaleSession = {
    ...appendPricedItemToSession(session, priceType),
    step: 'awaiting_payment',
    paymentMethod: undefined,
    updatedAt: Date.now(),
  };

  saveSaleSession(nextSession);
  await message.reply(formatPaymentMenu(nextSession));
}

async function handleDiscountTypeStep(
  message: Message,
  session: SaleSession,
  normalizedBody: string
): Promise<void> {
  if (normalizedBody === '0' || isBackResponse(normalizedBody)) {
    await handleDiscountBackStep(message, session);
    return;
  }

  const discountType = parseDiscountType(normalizedBody);
  if (!discountType) {
    await message.reply(`❌ Opção inválida.\n\n${formatDiscountMenu()}`);
    return;
  }

  saveSaleSession({
    ...session,
    step: 'awaiting_discount_value',
    pendingDiscountType: discountType,
    updatedAt: Date.now(),
  });
  await message.reply(formatDiscountValueQuestion(discountType));
}

async function handleDiscountValueStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  if (isBackResponse(body)) {
    await handleDiscountBackStep(message, session);
    return;
  }

  const items = getSaleItems(session);
  const originalTotalInCents = items.reduce(
    (total, item) => total + Math.round(item.totalValue * 100),
    0
  );

  if (items.length === 0 || originalTotalInCents <= 0 || !session.pendingDiscountType) {
    clearSaleSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
    return;
  }

  const discountPercent = session.pendingDiscountType === 'percent'
    ? parseDiscountPercent(body)
    : null;
  const discountInCents = session.pendingDiscountType === 'percent'
    ? discountPercent === null
      ? null
      : Math.round(originalTotalInCents * discountPercent / 100)
    : parseCurrencyToCents(body);

  if (
    discountInCents === null ||
    discountInCents <= 0 ||
    discountInCents >= originalTotalInCents
  ) {
    await message.reply(
      `❌ *DESCONTO INVÁLIDO*\n\n${formatDiscountValueQuestion(
        session.pendingDiscountType,
        originalTotalInCents / 100
      )}`
    );
    return;
  }

  const totalValue = (originalTotalInCents - discountInCents) / 100;
  const discountedSession: SaleSession = {
    ...session,
    step: 'awaiting_discount_confirmation',
    unitPrice: items.length === 1 ? totalValue / session.quantity : session.unitPrice,
    totalValue,
    originalTotalValue: originalTotalInCents / 100,
    discountPercent: session.pendingDiscountType === 'percent'
      ? discountPercent ?? undefined
      : undefined,
    discountAmount: session.pendingDiscountType === 'amount'
      ? discountInCents / 100
      : undefined,
    updatedAt: Date.now(),
  };
  saveSaleSession(discountedSession);
  await message.reply(formatDiscountPreview(discountedSession));
}

async function handleDiscountBackStep(
  message: Message,
  session: SaleSession
): Promise<void> {
  if (session.step === 'awaiting_discount_value') {
    saveSaleSession({
      ...session,
      step: 'awaiting_discount_type',
      pendingDiscountType: undefined,
      updatedAt: Date.now(),
    });
    await message.reply(formatDiscountMenu());
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_payment',
    pendingDiscountType: undefined,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(formatPaymentMenu(nextSession));
}

async function handleDiscountConfirmationStep(
  message: Message,
  session: SaleSession,
  normalizedBody: string
): Promise<void> {
  const action = parseConfirmationAction(normalizedBody);

  if (action === 'cancel') {
    clearAllOperationSessions(session.userId, session.chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return;
  }

  if (action === 'back') {
    const items = getSaleItems(session);
    const nextSession: SaleSession = {
      ...session,
      step: 'awaiting_discount_type',
      unitPrice: items.at(-1)?.unitPrice ?? session.unitPrice,
      totalValue: session.originalTotalValue ?? session.totalValue,
      originalTotalValue: undefined,
      discountPercent: undefined,
      discountAmount: undefined,
      pendingDiscountType: undefined,
      updatedAt: Date.now(),
    };
    saveSaleSession(nextSession);
    await message.reply(formatDiscountMenu());
    return;
  }

  if (action !== 'confirm') {
    await message.reply(`❌ Opção inválida.\n\n${formatConfirmationOptions()}`);
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_payment',
    pendingDiscountType: undefined,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(`✅ *DESCONTO APLICADO*\n\n${formatPaymentMenu(nextSession)}`);
}

async function handleMixedMethodsStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  const mixedPaymentMethods = parseMixedPaymentMethods(body);

  if (!mixedPaymentMethods) {
    await message.reply(
      `Escolha exatamente duas formas diferentes.\n\n${MIXED_PAYMENT_MENU}`
    );
    return;
  }

  const mixedAmountMethod = chooseMixedAmountMethod(mixedPaymentMethods);

  if (!mixedAmountMethod) {
    await message.reply(`Não consegui identificar a divisão.\n\n${MIXED_PAYMENT_MENU}`);
    return;
  }

  const mixedSession: SaleSession = {
    ...session,
    paymentMethod: 'Misto',
    mixedPaymentMethods,
    mixedAmountMethod,
    updatedAt: Date.now(),
  };
  await startMixedAmountStep(message, mixedSession);
}

async function startMixedAmountStep(
  message: Message,
  session: SaleSession
): Promise<void> {
  const totalValue = session.totalValue;

  if (session.unitPrice === undefined || totalValue === undefined) {
    clearSaleSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
    return;
  }

  if (Math.round(totalValue * 100) < 2) {
    saveSaleSession({
      ...session,
      step: 'awaiting_payment',
      paymentMethod: undefined,
      updatedAt: Date.now(),
    });
    await message.reply(
      `Não é possível dividir ${formatCurrency(totalValue)} entre duas formas.\n\n${formatPaymentMenu(session)}`
    );
    return;
  }

  saveSaleSession({
    ...session,
    step: 'awaiting_mixed_amount',
    updatedAt: Date.now(),
  });

  await message.reply(formatMixedAmountQuestion(session.mixedAmountMethod!));
}

async function handleMixedAmountStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  if (
    !session.mixedPaymentMethods ||
    !session.mixedAmountMethod ||
    session.totalValue === undefined
  ) {
    clearSaleSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
    return;
  }

  const amountInCents = parseCurrencyToCents(body);
  const totalInCents = Math.round(session.totalValue * 100);
  const paymentBreakdown = amountInCents === null
    ? null
    : buildPaymentBreakdown(
        session.mixedPaymentMethods,
        session.mixedAmountMethod,
        amountInCents,
        totalInCents
      );

  if (!paymentBreakdown) {
    await message.reply(
      [
        '❌ *VALOR INVÁLIDO*',
        `Informe quanto foi pago em *${session.mixedAmountMethod}* (entre R$0,00 e ${formatCurrency(session.totalValue)}).`,
        'Ex.: *100,00*',
      ].join('\n')
    );
    return;
  }

  const pendingReceiptMethods = paymentBreakdown
    .map((part) => part.method)
    .filter((method): method is MixedPaymentMethod =>
      (method === 'Dinheiro' || method === 'PIX' || method === 'Cartão') &&
      (Boolean(session.pendingSaleId) || isPaymentReceiptRequired(method))
    );
  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_photo',
    paymentBreakdown,
    pendingReceiptMethods,
    receipts: [],
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(formatReceiptRequest(pendingReceiptMethods[0], true));
}

async function handlePhotoStep(message: Message, session: SaleSession): Promise<void> {
  const receiptMethod = session.pendingReceiptMethods?.[0];

  if (!receiptMethod) {
    clearSaleSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
    return;
  }

  if (!isReceiptImageMessage(message)) {
    await message.reply(
      receiptMethod === 'Dinheiro'
        ? formatMissingReceiptMessage(receiptMethod)
        : session.paymentMethod === 'Misto'
        ? `Envie a imagem do comprovante do *${formatMethodForSentence(receiptMethod)}* para continuar.`
        : formatMissingReceiptMessage(receiptMethod)
    );
    return;
  }

  const receiptMessageId = getReceiptMessageId(message);

  if (!receiptMessageId) {
    logReceiptMessageIdDiagnostics(message);
    await message.reply('Não consegui identificar a imagem. Envie a foto novamente.');
    return;
  }

  console.log('[SALE] Receipt image accepted', {
    messageId: receiptMessageId,
    type: message.type,
    from: message.from,
    author: message.author,
  });

  const receipts = [
    ...(session.receipts ?? []),
    {
      paymentMethod: receiptMethod,
      messageId: receiptMessageId,
      message,
    },
  ];
  const pendingReceiptMethods = session.pendingReceiptMethods?.slice(1) ?? [];

  if (receiptMethod === 'Nota') {
    const isTransferSale = session.isTransferSale === true;
    saveSaleSession({
      ...session,
      step: isTransferSale ? 'awaiting_transfer_city' : 'awaiting_city_hall_confirmation',
      receipts,
      pendingReceiptMethods,
      updatedAt: Date.now(),
    });
    await message.reply(
      isTransferSale
        ? `✅ Comprovante recebido.\n\n${formatTransferCityQuestion()}`
        : formatCityHallQuestion()
    );
    return;
  }

  const nextReceiptMethod = pendingReceiptMethods[0];

  if (nextReceiptMethod) {
    saveSaleSession({
      ...session,
      step: 'awaiting_photo',
      receipts,
      pendingReceiptMethods,
      updatedAt: Date.now(),
    });
    await message.reply(
      [
        `✅ Comprovante do *${formatMethodForSentence(receiptMethod)}* recebido.`,
        '',
        formatReceiptRequest(nextReceiptMethod, true),
      ].join('\n')
    );
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_confirmation',
    receipts,
    pendingReceiptMethods,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  const receiptConfirmation = session.paymentMethod === 'Misto'
    ? `✅ Comprovante do *${formatMethodForSentence(receiptMethod)}* recebido.`
    : '✅ Comprovante recebido.';
  await message.reply(`${receiptConfirmation}\n\n${formatSaleConfirmation(nextSession)}`);
}

async function handleTransferCityStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  const transferCity = body.trim();

  if (!transferCity) {
    await message.reply(`❌ Informe a cidade de destino.\n\n${formatTransferCityQuestion()}`);
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_confirmation',
    transferCity,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(formatSaleConfirmation(nextSession));
}

async function handleCityHallConfirmationStep(
  message: Message,
  session: SaleSession,
  normalizedBody: string
): Promise<void> {
  const isCityHallSale = parseCityHallResponse(normalizedBody);

  if (isCityHallSale === null) {
    await message.reply(`Resposta inválida.\n\n${formatCityHallQuestion()}`);
    return;
  }

  saveSaleSession({
    ...session,
    step: 'awaiting_invoice_name',
    isCityHallSale,
    updatedAt: Date.now(),
  });
  await message.reply('🧾 *NOME DA NOTA*\nEx.: *Prefeitura de Congo*');
}

async function handleInvoiceNameStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  const invoiceName = body.trim();

  if (!invoiceName) {
    await message.reply('❌ Informe o nome da nota. Ex.: *Prefeitura de Congo*');
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_confirmation',
    invoiceName,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(formatSaleConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: SaleSession,
  normalizedBody: string
): Promise<void> {
  const action = parseConfirmationAction(normalizedBody);

  if (action === 'cancel') {
    clearAllOperationSessions(session.userId, session.chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return;
  }

  if (action === 'back') {
    if (session.paymentMethod === 'Pendência' && !session.pendingSaleId) {
      saveSaleSession({
        ...session,
        step: 'awaiting_pending_assignee',
        pendingAssigneeId: undefined,
        pendingAssigneeName: undefined,
        updatedAt: Date.now(),
      });
      await message.reply(formatPendingAssigneeQuestion());
      return;
    }

    if (session.paymentMethod === 'Nota' && session.isTransferSale && session.transferCity) {
      saveSaleSession({
        ...session,
        step: 'awaiting_transfer_city',
        updatedAt: Date.now(),
      });
      await message.reply(formatTransferCityQuestion());
      return;
    }

    if (session.paymentMethod === 'Nota' && session.invoiceName) {
      saveSaleSession({
        ...session,
        step: 'awaiting_invoice_name',
        updatedAt: Date.now(),
      });
      await message.reply('🧾 *NOME DA NOTA*\nEx.: *Prefeitura de Congo*');
      return;
    }

    const nextSession: SaleSession = {
      ...session,
      step: 'awaiting_payment',
      paymentMethod: undefined,
      mixedPaymentMethods: undefined,
      mixedAmountMethod: undefined,
      paymentBreakdown: undefined,
      pendingReceiptMethods: undefined,
      receipts: undefined,
      isTransferSale: undefined,
      transferCity: undefined,
      isCityHallSale: undefined,
      invoiceName: undefined,
      updatedAt: Date.now(),
    };
    saveSaleSession(nextSession);
    await message.reply(formatPaymentMenu(nextSession));
    return;
  }

  if (action !== 'confirm') {
    await message.reply(`❌ Opção inválida.\n\n${formatConfirmationOptions()}`);
    return;
  }

  if (!session.paymentMethod || session.unitPrice === undefined || session.totalValue === undefined) {
    clearSaleSession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
    return;
  }

  saveSaleSession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  const sellerName = await getSellerName(message, session.userId);

  if (session.paymentMethod === 'Pendência') {
    if (!session.pendingAssigneeId || !session.pendingAssigneeName) {
      clearSaleSession(session.userId, session.chatId);
      await message.reply('Ocorreu um erro ao identificar o responsável. Inicie novamente.');
      return;
    }

    try {
      const pendingSale = await registerPendingSale({
        items: buildPendingPersistenceItems(session),
        createdByPhone: session.userId,
        createdByName: sellerName,
        assignedPhone: session.pendingAssigneeId,
        assignedName: session.pendingAssigneeName,
        totalValue: session.totalValue,
        originalTotalValue: session.originalTotalValue,
        discountPercent: session.discountPercent,
        discountAmount: session.discountAmount,
      });
      const confirmation = formatPendingSaleRegistered(pendingSale);
      await Promise.all([
        runPostCommitTask('pending sale group confirmation', () => message.reply(confirmation)),
        runPostCommitTask('pending sale boss notification', () =>
          sendBossTextNotification(`🔔 *NOVA PENDÊNCIA*\n\n${confirmation}`)
        ),
      ]);
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        await message.reply(
          `⚠️ Pendência cancelada. Estoque atual: *${error.currentStock}* | Solicitado: *${error.requestedQuantity}*`
        );
      } else if (error instanceof SaleProductNotFoundError) {
        await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      } else {
        console.error('[PENDING_SALE] Error registering pending sale:', error);
        await message.reply('Ocorreu um erro ao registrar a pendência. Tente novamente.');
      }
    } finally {
      clearSaleSession(session.userId, session.chatId);
    }
    return;
  }

  let registeredSale: Awaited<ReturnType<typeof registerSaleItems>>;

  try {
    registeredSale = await registerSaleItems({
      items: buildPersistenceItems(session),
      sellerPhone: session.pendingAssigneeId ?? session.userId,
      sellerName: session.pendingAssigneeName ?? sellerName,
      totalValue: session.totalValue,
      paymentMethod: session.paymentMethod,
      paymentBreakdown: session.paymentBreakdown,
      invoiceName: session.invoiceName,
      isCityHallSale: session.isCityHallSale,
      pendingSaleId: session.pendingSaleId,
    });
  } catch (error) {
    clearSaleSession(session.userId, session.chatId);

    if (error instanceof InsufficientStockError) {
      const unavailableItem = getSaleItems(session).find(
        (item) => item.productId === error.productId
      );
      await message.reply(
        [
          '⚠️ Venda cancelada.',
          ...(unavailableItem
            ? ['', `${unavailableItem.reference} — ${unavailableItem.description}`]
            : []),
          `Estoque atual: ${error.currentStock}`,
          `Quantidade solicitada: ${error.requestedQuantity}`,
        ].join('\n')
      );
      return;
    }

    if (error instanceof SaleProductNotFoundError) {
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }

    console.error('[SALE] Error registering sale:', error);
    await message.reply('Ocorreu um erro ao registrar a venda. Tente novamente.');
    return;
  }

  const groupMessage = formatRegisteredSale(
    session,
    registeredSale.saleGroupCode,
    session.pendingAssigneeName ?? sellerName,
    registeredSale.items[0]?.currentStock ?? 0,
    registeredSale.items
  );
  const bossMessage = formatBossSaleNotification(
    session,
    registeredSale.saleGroupCode,
    session.pendingAssigneeName ?? sellerName,
    registeredSale.items[0]?.currentStock ?? 0,
    registeredSale.items
  );

  await Promise.all([
    runPostCommitTask('sale group confirmation', () => message.reply(groupMessage)),
    runPostCommitTask('sale private owner notification', () => sendBossTextNotification(bossMessage)),
  ]);

  await forwardSaleReceiptsToBoss(session);

  clearSaleSession(session.userId, session.chatId);
}

function buildPendingPersistenceItems(session: SaleSession) {
  const displayItems = getSaleItems(session);
  const persistedItems = buildPersistenceItems(session);
  return displayItems.map((item, index) => ({
    ...item,
    unitPrice: persistedItems[index]!.unitPrice,
    totalValue: persistedItems[index]!.totalValue,
  }));
}

async function forwardSaleReceiptsToBoss(session: SaleSession): Promise<void> {
  for (const receipt of session.receipts ?? []) {
    try {
      console.log('[SALE] Forwarding receipt image to boss.', {
        paymentMethod: receipt.paymentMethod,
      });
      await forwardMessageToBoss(receipt.messageId, receipt.message);
    } catch (error) {
      console.error('[SALE] Error forwarding receipt image to boss:', {
        receiptMessageId: receipt.messageId,
        paymentMethod: receipt.paymentMethod,
        error,
      });
    }
  }
}

function isReceiptImageMessage(message: Message): boolean {
  return message.hasMedia && message.type === 'image';
}

function isDuplicateReceiptMessage(message: Message, session: SaleSession): boolean {
  const messageId = getReceiptMessageId(message);
  return Boolean(
    messageId && session.receipts?.some((receipt) => receipt.messageId === messageId)
  );
}

interface MessageIdLike {
  fromMe?: boolean;
  remote?: string;
  id?: string;
  _serialized?: string;
  participant?: string | { _serialized?: string; user?: string };
}

function getReceiptMessageId(message: Message): string | null {
  const id = message.id as MessageIdLike | undefined;

  if (id?._serialized) {
    return id._serialized;
  }

  if (id?.fromMe === undefined || !id.remote || !id.id) {
    return null;
  }

  const participant = getParticipantId(id.participant) || message.author;
  const serialized =
    participant && id.remote.includes('@g.us')
      ? `${id.fromMe}_${id.remote}_${id.id}_${participant}`
      : `${id.fromMe}_${id.remote}_${id.id}`;

  id._serialized = serialized;
  return serialized;
}

function getParticipantId(participant: MessageIdLike['participant']): string | null {
  if (!participant) {
    return null;
  }

  if (typeof participant === 'string') {
    return participant;
  }

  return participant._serialized || participant.user || null;
}

function logReceiptMessageIdDiagnostics(message: Message): void {
  const rawData = message.rawData as { id?: unknown };

  console.error('[SALE] Receipt image message has no recoverable serialized id.', {
    type: message.type,
    hasMedia: message.hasMedia,
    from: message.from,
    author: message.author,
    messageId: message.id,
    rawId: rawData.id,
  });
}

function canReturnFromAdditionalSale(session: SaleSession): boolean {
  return getExplicitSaleItems(session).length > 0 && [
    'awaiting_additional_measure',
    'awaiting_additional_item',
    'awaiting_additional_quantity',
    'awaiting_price_type',
  ].includes(session.step);
}

async function returnToPreparedSale(
  message: Message,
  session: SaleSession
): Promise<void> {
  const items = getExplicitSaleItems(session);
  const lastItem = items.at(-1)!;
  const sharedPriceType = items.every((item) => item.priceType === items[0]?.priceType)
    ? items[0]?.priceType
    : undefined;
  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_payment',
    productId: lastItem.productId,
    reference: lastItem.reference,
    description: lastItem.description,
    quantity: lastItem.quantity,
    cashPrice: lastItem.cashPrice,
    creditPrice: lastItem.creditPrice,
    unitPrice: lastItem.unitPrice,
    priceType: sharedPriceType,
    additionalMeasure: undefined,
    additionalProducts: undefined,
    additionalProduct: undefined,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply([
    '↩️ *PNEU ATUAL IGNORADO*',
    `Os *${items.length}* itens anteriores continuam na venda.`,
    '',
    formatPaymentMenu(nextSession),
  ].join('\n'));
}

async function getSellerName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}
