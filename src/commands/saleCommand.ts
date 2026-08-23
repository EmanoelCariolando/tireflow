import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  calculateSaleTotal,
  getCurrentProductStock,
  InsufficientStockError,
  registerSaleItems,
  SaleProductNotFoundError,
  type RegisteredSaleItem,
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
  ReceiptPaymentMethod,
  SalePriceType,
  SaleItem,
  SaleSession,
  saveSaleSession,
} from '../utils/saleSessionStore.js';
import { clearAllOperationSessions, hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import {
  buildPaymentBreakdown,
  chooseMixedAmountMethod,
  parseCurrencyToCents,
  parseMixedPaymentMethods,
} from '../utils/salePayment.js';
import {
  formatConfirmationOptions,
  formatOperationConfirmation,
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
import { allocateAmountByWeights } from '../utils/saleAllocation.js';
import { formatAdditionalTireQuestion, formatQuantityQuestion } from '../utils/operationPrompts.js';
import { formatMovementNumberMessage } from '../utils/movementMessageVisibility.js';
import { formatBinaryOptions, parseBinaryResponse } from '../utils/binaryResponse.js';
import env from '../config/env.js';

const SALE_COMMAND_REGEX = /^venda\s+(\d+)\s+(\d+)$/i;
const DISCOUNT_PERCENT = 3;
const MAX_SALE_ITEMS = 20;
const TRANSFER_PAYMENT_ENABLED = false;
const MIXED_PAYMENT_MENU = [
  '💳 *PAGAMENTO MISTO*',
  '',
  'Escolha duas formas:',
  '',
  '1️⃣ *Dinheiro*',
  '2️⃣ *PIX*',
  '3️⃣ *Cartão*',
  '',
  'Ex.: *1 e 2*',
].join('\n');

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

  if (session.step === 'awaiting_price_type') {
    await handlePriceTypeStep(message, session, normalizedBody);
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
    if (session.discountPercent) {
      await message.reply(
        `O desconto de ${session.discountPercent}% já foi aplicado.\n\n${formatPaymentMenu(session)}`
      );
      return;
    }

    const items = getSaleItems(session);
    if (items.length === 0 || session.totalValue === undefined) {
      clearSaleSession(session.userId, session.chatId);
      await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
      return;
    }

    const originalTotalInCents = items.reduce(
      (total, item) => total + Math.round(item.totalValue * 100),
      0
    );
    const discountInCents = Math.round(originalTotalInCents * DISCOUNT_PERCENT / 100);
    const totalValue = (originalTotalInCents - discountInCents) / 100;
    const discountedSession: SaleSession = {
      ...session,
      step: 'awaiting_discount_confirmation',
      paymentMethod: undefined,
      unitPrice: items.length === 1 ? totalValue / session.quantity : session.unitPrice,
      totalValue,
      originalTotalValue: originalTotalInCents / 100,
      discountPercent: DISCOUNT_PERCENT,
      updatedAt: Date.now(),
    };
    saveSaleSession(discountedSession);
    await message.reply(formatDiscountPreview(discountedSession));
    return;
  }

  const paymentMethod = parsePaymentMethod(normalizedBody);

  if (!paymentMethod) {
    await message.reply(`Forma de pagamento inválida.\n\n${formatPaymentMenu(session)}`);
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
  paymentMethod: Exclude<PaymentMethod, 'Misto'>
): Promise<void> {
  const cleanSession: SaleSession = {
    ...pricedSession,
    paymentMethod,
    isTransferSale: undefined,
    transferCity: undefined,
  };

  if (!isPaymentReceiptRequired(paymentMethod)) {
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
      step: 'awaiting_payment',
      unitPrice: items.at(-1)?.unitPrice ?? session.unitPrice,
      totalValue: session.originalTotalValue ?? session.totalValue,
      originalTotalValue: undefined,
      discountPercent: undefined,
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

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_payment',
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
      isPaymentReceiptRequired(method)
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

  let registeredSale: Awaited<ReturnType<typeof registerSaleItems>>;

  try {
    registeredSale = await registerSaleItems({
      items: buildPersistenceItems(session),
      sellerPhone: session.userId,
      sellerName,
      totalValue: session.totalValue,
      paymentMethod: session.paymentMethod,
      paymentBreakdown: session.paymentBreakdown,
      invoiceName: session.invoiceName,
      isCityHallSale: session.isCityHallSale,
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
    sellerName,
    registeredSale.items[0]?.currentStock ?? 0,
    registeredSale.items
  );
  const bossMessage = formatBossSaleNotification(
    session,
    registeredSale.saleGroupCode,
    sellerName,
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

export function parseCityHallResponse(value: string): boolean | null {
  const hasCommission = parseBinaryResponse(value);

  // The stored flag represents a city-hall/no-commission sale, the inverse of this question.
  return hasCommission === null ? null : !hasCommission;
}

function parsePaymentMethod(value: string): PaymentMethod | 'Transferência' | null {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (normalized === '1' || normalized === 'dinheiro') return 'Dinheiro';
  if (normalized === '2' || normalized === 'pix') return 'PIX';
  if (normalized === '3' || normalized === 'cartao') return 'Cartão';
  if (normalized === '4' || normalized === 'nota') return 'Nota';
  if (normalized === '5' || normalized === 'misto' || normalized === 'pagamento misto') {
    return 'Misto';
  }
  if (
    TRANSFER_PAYMENT_ENABLED &&
    (normalized === '8' || normalized === 'transferencia')
  ) {
    return 'Transferência';
  }

  return null;
}

function isDiscountSelection(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized === '6' || normalized === 'desconto';
}

function isAddItemSelection(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (
    normalized === '7' ||
    normalized === 'adicionar outro pneu' ||
    normalized === 'outro pneu' ||
    normalized === 'vender mais'
  );
}

function parseAdditionalItemSelection(value: string): {
  optionNumber: number;
  quantity?: number;
} | null {
  const match = value.trim().match(/^(?:venda\s+)?(\d+)(?:\s+(\d+))?$/i);
  if (!match) {
    return null;
  }

  const optionNumber = Number(match[1]);
  const quantity = match[2] === undefined ? undefined : Number(match[2]);
  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    return null;
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity <= 0)) {
    return null;
  }
  return { optionNumber, quantity };
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

function parsePriceType(value: string): SalePriceType | null {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized === '1' || normalized === 'avista' || normalized === 'a vista') {
    return 'À vista';
  }
  if (normalized === '2' || normalized === 'prazo' || normalized === 'a prazo') {
    return 'A prazo';
  }
  return null;
}

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(venda|entrada|ajuste|pre[cç]o|local)\b/i.test(normalizedBody);
}

function appendPricedItemToSession(
  session: SaleSession,
  priceType: SalePriceType
): SaleSession {
  const unitPrice = priceType === 'À vista' ? session.cashPrice : session.creditPrice;
  const newItem: SaleItem = {
    productId: session.productId,
    reference: session.reference,
    description: session.description,
    quantity: session.quantity,
    cashPrice: session.cashPrice,
    creditPrice: session.creditPrice,
    priceType,
    unitPrice,
    totalValue: calculateSaleTotal(session.quantity, unitPrice),
  };
  const items = [...getExplicitSaleItems(session), newItem];
  const originalTotalInCents = items.reduce(
    (total, item) => total + Math.round(item.totalValue * 100),
    0
  );
  const discountInCents = session.discountPercent
    ? Math.round(originalTotalInCents * session.discountPercent / 100)
    : 0;
  const totalValue = (originalTotalInCents - discountInCents) / 100;
  const sharedPriceType = items.every((item) => item.priceType === items[0]?.priceType)
    ? items[0]?.priceType
    : undefined;

  return {
    ...session,
    items,
    priceType: sharedPriceType,
    unitPrice,
    totalValue,
    originalTotalValue: session.discountPercent ? originalTotalInCents / 100 : undefined,
  };
}

function getExplicitSaleItems(session: SaleSession): SaleItem[] {
  return session.items ? session.items.map((item) => ({ ...item })) : [];
}

function getSaleItems(session: SaleSession): SaleItem[] {
  const items = getExplicitSaleItems(session);
  if (items.length > 0) {
    return items;
  }

  if (session.unitPrice === undefined || session.totalValue === undefined) {
    return [];
  }

  const priceType = session.priceType ??
    (session.unitPrice === session.creditPrice ? 'A prazo' : 'À vista');
  const baseTotalValue = session.originalTotalValue ?? session.totalValue;
  return [{
    productId: session.productId,
    reference: session.reference,
    description: session.description,
    quantity: session.quantity,
    cashPrice: session.cashPrice,
    creditPrice: session.creditPrice,
    priceType,
    unitPrice: baseTotalValue / session.quantity,
    totalValue: baseTotalValue,
  }];
}

function getReservedQuantity(items: SaleItem[], productId: string): number {
  return items
    .filter((item) => item.productId === productId)
    .reduce((total, item) => total + item.quantity, 0);
}

function adjustAvailableProductsForCart(
  products: QueriedProduct[],
  items: SaleItem[]
): QueriedProduct[] {
  return products
    .map((product) => ({
      ...product,
      stock: Math.max(0, product.stock - getReservedQuantity(items, product.id)),
    }))
    .filter((product) => product.stock > 0);
}

function buildPersistenceItems(session: SaleSession): Array<{
  productId: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
}> {
  const items = getSaleItems(session);
  const baseTotalsInCents = items.map((item) => Math.round(item.totalValue * 100));
  const allocatedTotalsInCents = allocateAmountByWeights(
    Math.round((session.totalValue ?? 0) * 100),
    baseTotalsInCents
  );

  return items.map((item, index) => {
    const totalValue = allocatedTotalsInCents[index]! / 100;
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: totalValue / item.quantity,
      totalValue,
    };
  });
}

function formatPaymentMenu(session?: SaleSession): string {
  const discountApplied = Boolean(session?.discountPercent && session.totalValue !== undefined);
  const selectedPrice = Boolean(session?.priceType && session.totalValue !== undefined);
  const items = session ? getSaleItems(session) : [];
  const multipleItems = items.length > 1;
  return [
    ...(multipleItems && session
      ? [
          '🛒 *RESUMO DA COMPRA*',
          '',
          ...formatConfirmationSaleItemLines(items),
          '',
          ...(discountApplied
            ? [
                `🧾 Subtotal: *${formatCurrency(session.originalTotalValue ?? 0)}*`,
                `🏷️ Desconto: *-${formatCurrency(
                  (session.originalTotalValue ?? 0) - (session.totalValue ?? 0)
                )}*`,
              ]
            : []),
          `💰 *TOTAL: ${formatCurrency(session.totalValue ?? 0)}*`,
          '',
        ]
      : selectedPrice
      ? [
          `🏷️ Valor selecionado: *${session!.priceType}*`,
          `💰 Total: *${formatCurrency(session!.totalValue!)}*`,
          '',
        ]
      : []),
    '💳 *FORMAS DE PAGAMENTO*',
    '',
    '1️⃣ *Dinheiro*',
    '2️⃣ *PIX*',
    '3️⃣ *Cartão*',
    '4️⃣ *Nota*',
    '5️⃣ *Pagamento misto*',
    `6️⃣ *Desconto de ${DISCOUNT_PERCENT}%*${discountApplied ? ' ✅' : ''}`,
    '7️⃣ *Adicionar outro pneu*',
    ...(TRANSFER_PAYMENT_ENABLED ? ['8️⃣ *Transferencia*'] : []),
  ].join('\n');
}

function formatPriceTypeQuestion(session: SaleSession): string {
  return [
    ...(getExplicitSaleItems(session).length > 0
      ? [
          '➕ *NOVO ITEM*',
        ]
      : []),
    '💰 *ESCOLHA O VALOR*',
    '',
    `1️⃣ 💰 À vista: *${formatCurrency(calculateSaleTotal(session.quantity, session.cashPrice))}*`,
    `2️⃣ 💳 A prazo: *${formatCurrency(calculateSaleTotal(session.quantity, session.creditPrice))}*`,
  ].join('\n');
}

export function formatCityHallQuestion(): string {
  return [
    '✅ Nota recebida.',
    '',
    '💵*Comissão*',
    '*Essa Nota Tem Comissão?*',
    formatBinaryOptions(),
  ].join('\n');
}

export function formatTransferCityQuestion(): string {
  return [
    '📍*Cidade*',
    '*Para Qual Cidade Vai esse Pneu?*',
  ].join('\n');
}

function formatTransferLines(session: SaleSession): string[] {
  if (!session.isTransferSale || !session.transferCity) {
    return [];
  }

  return [
    'Transferência: *Sim*',
    `Cidade: *${session.transferCity}*`,
  ];
}

function formatInvoiceLines(session: SaleSession): string[] {
  if (!session.invoiceName) {
    return [];
  }

  return [
    session.isCityHallSale
      ? 'Destino da nota: *Prefeitura (sem comissão)*'
      : 'Destino da nota: *Cliente (com comissão)*',
    `Nome da nota: *${session.invoiceName}*`,
  ];
}

function formatDiscountPreview(session: SaleSession): string {
  const originalTotal = session.originalTotalValue ?? 0;
  const discountValue = originalTotal - (session.totalValue ?? 0);
  return formatOperationConfirmation(
    '🏷️ *DESCONTO — CONFIRMAR*',
    [
      [`🏷️ Desconto: *${session.discountPercent}%* | Economia: *${formatCurrency(discountValue)}*`],
      [
        `💰 Total: ${formatCurrency(originalTotal)} → *${formatCurrency(session.totalValue ?? 0)}*`,
      ],
    ]
  );
}

export function formatSaleConfirmation(session: SaleSession): string {
  const items = getSaleItems(session);
  if (items.length > 1) {
    return formatOperationConfirmation(
      '🧾 *VENDA — CONFIRMAR*',
      [
        formatConfirmationSaleItemLines(items),
        [
          ...formatCompactPaymentLines(session),
          ...formatDiscountLines(session),
          ...formatTransferLines(session),
          ...formatInvoiceLines(session),
        ],
        [`💰 Total: *${formatCurrency(session.totalValue ?? 0)}*`],
      ]
    );
  }

  return formatOperationConfirmation(
    '🧾 *VENDA — CONFIRMAR*',
    [
      [
        `🛞 *${session.reference} — ${session.description}*`,
        `📤 Quantidade: ${formatSaleItemLine(session, false)}`,
      ],
      [
        ...formatConfirmationPaymentLines(session),
        ...formatDiscountLines(session),
        ...formatTransferLines(session),
        ...formatInvoiceLines(session),
      ],
      [`💰 Total: *${formatCurrency(session.totalValue ?? 0)}*`],
    ]
  );
}

export function formatRegisteredSale(
  session: SaleSession,
  movementCode: string,
  sellerName: string,
  currentStock: number,
  registeredItems?: RegisteredSaleItem[]
): string {
  const items = getSaleItems(session);
  if (items.length > 1) {
    return formatRegisteredMultiItemSale(
      '✅ *VENDA REGISTRADA*',
      session,
      movementCode,
      sellerName,
      registeredItems ?? []
    );
  }

  return [
    '✅ *VENDA REGISTRADA*',
    '',
    `*${session.reference}* — *${session.description}*`,
    formatSaleItemLine(session, true),
    ...formatPaymentLines(session),
    ...formatDiscountLines(session),
    ...formatTransferLines(session),
    ...formatInvoiceLines(session),
    '',
    `💰 *TOTAL: ${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    `📦 Estoque: *${currentStock}*`,
    ...formatMovementNumberMessage(`Movimentação: ${movementCode}`),
    `Vendedor: ${sellerName}`,
  ].join('\n');
}

export function formatBossSaleNotification(
  session: SaleSession,
  movementCode: string,
  sellerName: string,
  currentStock: number,
  registeredItems?: RegisteredSaleItem[]
): string {
  const items = getSaleItems(session);
  if (items.length > 1) {
    return formatRegisteredMultiItemSale(
      '🔔 *NOVA VENDA*',
      session,
      movementCode,
      sellerName,
      registeredItems ?? []
    );
  }

  return [
    '🔔 *NOVA VENDA*',
    '',
    `*${session.reference}* — *${session.description}*`,
    formatSaleItemLine(session, true),
    ...formatPaymentLines(session),
    ...formatDiscountLines(session),
    ...formatTransferLines(session),
    ...formatInvoiceLines(session),
    '',
    `💰 *TOTAL: ${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    `📦 Estoque: *${currentStock}*`,
    ...formatMovementNumberMessage(`Movimentação: ${movementCode}`),
    `Vendedor: ${sellerName}`,
  ].join('\n');
}

function formatRegisteredMultiItemSale(
  title: string,
  session: SaleSession,
  saleGroupCode: string,
  sellerName: string,
  registeredItems: RegisteredSaleItem[]
): string {
  const items = getSaleItems(session);
  return [
    title,
    '',
    ...formatRegisteredSaleItemLines(items, registeredItems),
    '',
    ...formatCompactPaymentLines(session),
    ...formatDiscountLines(session),
    ...formatTransferLines(session),
    ...formatInvoiceLines(session),
    `💰 *TOTAL: ${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    ...formatMovementNumberMessage(
      `🧾 *${saleGroupCode}* | Vendedor: ${sellerName}`,
      `Vendedor: ${sellerName}`
    ),
  ].join('\n');
}

function formatRegisteredSaleItemLines(
  items: SaleItem[],
  registeredItems: RegisteredSaleItem[]
): string[] {
  return items.flatMap((item, index) => [
    `${index + 1}. 🛞 *${item.reference} — ${item.description}*`,
    `📤 *${item.quantity} un.* | 💰 *${formatCurrency(item.totalValue)}* | 📦 Estoque: *${
      findFinalRegisteredStock(registeredItems, item.productId) ?? 'confirmado'
    }*`,
    ...(index < items.length - 1 ? [''] : []),
  ]);
}

function formatConfirmationSaleItemLines(items: SaleItem[]): string[] {
  return items.flatMap((item, index) => [
    `${index + 1}. 🛞 *${item.reference} — ${item.description}*`,
    `📤 *${item.quantity} un.* | 💰 *${formatCurrency(item.totalValue)}*`,
    ...(index < items.length - 1 ? [''] : []),
  ]);
}

function formatCompactPaymentLines(session: SaleSession): string[] {
  return formatPaymentLines(session);
}

function findFinalRegisteredStock(
  registeredItems: RegisteredSaleItem[],
  productId: string
): number | undefined {
  return [...registeredItems]
    .reverse()
    .find((item) => item.productId === productId)
    ?.currentStock;
}

async function getSellerName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}

function formatMixedAmountQuestion(paymentMethod: MixedPaymentMethod): string {
  return [
    '💳 *PAGAMENTO MISTO*',
    '',
    `Quanto foi pago em *${paymentMethod}*?`,
    'Ex.: 100,00',
  ].join('\n');
}

function formatReceiptRequest(
  paymentMethod: ReceiptPaymentMethod | undefined,
  identifyPaymentMethod: boolean
): string {
  if (!paymentMethod) {
    return 'Ocorreu um erro na sessão da venda. Faça a consulta novamente.';
  }

  if (paymentMethod === 'Nota') {
    return '📎 *NOTA/PEDIDO*\nEnvie a foto.';
  }

  if (paymentMethod === 'Dinheiro') {
    return '📎 *COMPROVANTE — DINHEIRO*\nEnvie a foto do depósito/dinheiro.';
  }

  return identifyPaymentMethod
    ? `📎 *COMPROVANTE — ${paymentMethod.toUpperCase()}*\nEnvie a foto.`
    : '📎 *COMPROVANTE*\nEnvie a foto.';
}

function formatMethodForSentence(paymentMethod: ReceiptPaymentMethod): string {
  return paymentMethod === 'PIX' ? 'PIX' : paymentMethod.toLowerCase();
}

export function isCashReceiptRequired(branchName = env.branchName): boolean {
  return /\bMONTEIRO\b/i.test(branchName);
}

function isPaymentReceiptRequired(
  paymentMethod: ReceiptPaymentMethod,
  branchName = env.branchName
): boolean {
  return paymentMethod !== 'Dinheiro' || isCashReceiptRequired(branchName);
}

function formatMissingReceiptMessage(paymentMethod: ReceiptPaymentMethod): string {
  if (paymentMethod === 'Dinheiro') {
    return '📎 Envie a foto do *depósito/dinheiro* para continuar.';
  }
  return '📎 Envie a *nota/comprovante* para continuar.';
}

function formatPaymentLines(session: SaleSession): string[] {
  if (session.paymentMethod !== 'Misto') {
    return [
      `Pagamento: *${session.paymentMethod}*${formatPriceTypeSuffix(session)}`,
    ];
  }

  return [
    `Pagamento: *Misto*${formatPriceTypeSuffix(session)}`,
    (session.paymentBreakdown ?? [])
      .map((part) => `*${part.method}*: *${formatCurrency(part.amount)}*`)
      .join(' | '),
  ].filter(Boolean);
}

function formatConfirmationPaymentLines(session: SaleSession): string[] {
  return formatPaymentLines(session);
}

function formatSaleItemLine(session: SaleSession, registered: boolean): string {
  const quantityLabel = registered ? 'unidades' : 'un.';
  if (session.discountPercent) {
    return `*${session.quantity} ${quantityLabel}*`;
  }
  return `*${session.quantity} ${quantityLabel}* × ${formatCurrency(session.unitPrice ?? 0)}`;
}

function formatPriceTypeSuffix(session: SaleSession): string {
  const priceType = getDisplayedPriceType(session);
  return priceType ? ` | Valor: *${priceType}*` : '';
}

function getDisplayedPriceType(session: SaleSession): string | undefined {
  const itemPriceTypes = [
    ...new Set(getExplicitSaleItems(session).map((item) => item.priceType)),
  ];

  if (itemPriceTypes.length > 1) {
    return 'Misto (acordo com cada item)';
  }

  return itemPriceTypes[0] ?? session.priceType;
}

function formatDiscountLines(session: SaleSession): string[] {
  if (
    !session.discountPercent ||
    session.originalTotalValue === undefined ||
    session.totalValue === undefined
  ) {
    return [];
  }

  const discountValue = session.originalTotalValue - session.totalValue;
  return [
    `Valor original: ${formatCurrency(session.originalTotalValue)}`,
    `*Desconto: ${session.discountPercent}%* (-${formatCurrency(discountValue)})`,
  ];
}
