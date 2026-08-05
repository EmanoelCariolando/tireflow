import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  calculateSaleTotal,
  getCurrentProductStock,
  InsufficientStockError,
  registerSale,
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
  ReceiptPaymentMethod,
  SalePriceType,
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
import { isCancellationResponse, isConfirmationResponse } from '../utils/operationResponse.js';

const SALE_COMMAND_REGEX = /^venda\s+(\d+)\s+(\d+)$/i;
const DISCOUNT_PERCENT = 3;
const MIXED_PAYMENT_MENU = [
  'Quais foram as duas formas de pagamento usadas?',
  '',
  '1️⃣ Dinheiro',
  '2️⃣ PIX',
  '3️⃣ Cartão',
  '',
  'Exemplo: 1 e 2',
].join('\n');

export function isSaleCommand(body: string): boolean {
  return SALE_COMMAND_REGEX.test(body.trim());
}

export async function handleSaleCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredSaleSession(userId, chatId)) {
    await message.reply('⏳ Operação cancelada por inatividade.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
    return;
  }

  const match = body.trim().match(SALE_COMMAND_REGEX);
  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);
  const quantity = Number(match[2]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
    await message.reply('Comando inválido. Exemplo: venda 1 5');
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

  if (currentStock < quantity) {
    await message.reply(
      `⚠️ Venda cancelada.\n\nEstoque atual: ${currentStock}\nQuantidade solicitada: ${quantity}`
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
    await message.reply('⏳ Operação cancelada por inatividade.');
    return true;
  }

  const session = getSaleSession(userId, chatId);
  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (isCancellationResponse(normalizedBody)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ Operação cancelada.');
    return true;
  }

  if (isDuplicateReceiptMessage(message, session)) {
    console.log('[SALE] Duplicate receipt media message ignored.');
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ Você possui uma operação em andamento.\n\nDigite: confirmar ou cancelar');
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

  if (session.step === 'awaiting_invoice_name') {
    await handleInvoiceNameStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ Venda em processamento. Aguarde um instante.');
    return true;
  }

  return false;
}

async function handlePaymentStep(
  message: Message,
  session: SaleSession,
  normalizedBody: string
): Promise<void> {
  if (isDiscountSelection(normalizedBody)) {
    if (session.discountPercent) {
      await message.reply(
        `O desconto de ${session.discountPercent}% já foi aplicado.\n\n${formatPaymentMenu(session)}`
      );
      return;
    }

    if (
      !session.priceType ||
      session.unitPrice === undefined ||
      session.totalValue === undefined
    ) {
      clearSaleSession(session.userId, session.chatId);
      await message.reply('Ocorreu um erro na sessão da venda. Faça a consulta novamente.');
      return;
    }

    const originalTotalInCents = Math.round(session.totalValue * 100);
    const discountInCents = Math.round(originalTotalInCents * DISCOUNT_PERCENT / 100);
    const totalValue = (originalTotalInCents - discountInCents) / 100;
    const discountedSession: SaleSession = {
      ...session,
      step: 'awaiting_discount_confirmation',
      paymentMethod: undefined,
      unitPrice: totalValue / session.quantity,
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
  };

  const nextSession: SaleSession = {
    ...cleanSession,
    step: 'awaiting_photo',
    pendingReceiptMethods: [paymentMethod],
    receipts: [],
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);

  if (paymentMethod === 'Nota') {
    await message.reply('Envie a foto da nota/pedido.');
    return;
  }

  if (paymentMethod === 'Dinheiro') {
    await message.reply('Envie a foto do depósito/dinheiro.');
    return;
  }

  await message.reply('Envie a foto do comprovante.');
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
    ...applyPriceTypeToSession(session, priceType),
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
  if (!isConfirmationResponse(normalizedBody)) {
    await message.reply('Digite: confirmar ou cancelar');
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_payment',
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(`✅ Desconto confirmado.\n\n${formatPaymentMenu(nextSession)}`);
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

  await message.reply(formatMixedAmountQuestion(totalValue, session.mixedAmountMethod!));
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
        `Informe quanto foi pago em ${session.mixedAmountMethod}.`,
        `O valor deve ser maior que R$0,00 e menor que ${formatCurrency(session.totalValue)}.`,
        '',
        'Exemplo: 100,00',
      ].join('\n')
    );
    return;
  }

  const pendingReceiptMethods = paymentBreakdown
    .map((part) => part.method)
    .filter((method): method is MixedPaymentMethod =>
      method === 'Dinheiro' || method === 'PIX' || method === 'Cartão'
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
        ? `Envie a imagem do comprovante do ${formatMethodForSentence(receiptMethod)} para continuar.`
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
    saveSaleSession({
      ...session,
      step: 'awaiting_invoice_name',
      receipts,
      pendingReceiptMethods,
      updatedAt: Date.now(),
    });
    await message.reply('✅ Comprovante recebido.\n\nNome da nota?\n\nExemplo:\nPrefeitura de Congo');
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
        `✅ Comprovante do ${formatMethodForSentence(receiptMethod)} recebido.`,
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
    ? `✅ Comprovante do ${formatMethodForSentence(receiptMethod)} recebido.`
    : '✅ Comprovante recebido.';
  await message.reply(`${receiptConfirmation}\n\n${formatSaleConfirmation(nextSession)}`);
}

async function handleInvoiceNameStep(
  message: Message,
  session: SaleSession,
  body: string
): Promise<void> {
  const invoiceName = body.trim();

  if (!invoiceName) {
    await message.reply('Nome da nota?\n\nExemplo:\nPrefeitura de Congo');
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
  if (!isConfirmationResponse(normalizedBody)) {
    await message.reply('Digite: confirmar ou cancelar');
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

  let registeredSale: Awaited<ReturnType<typeof registerSale>>;

  try {
    registeredSale = await registerSale({
      productId: session.productId,
      sellerPhone: session.userId,
      sellerName,
      quantity: session.quantity,
      unitPrice: session.unitPrice,
      totalValue: session.totalValue,
      paymentMethod: session.paymentMethod,
      paymentBreakdown: session.paymentBreakdown,
      invoiceName: session.invoiceName,
    });
  } catch (error) {
    clearSaleSession(session.userId, session.chatId);

    if (error instanceof InsufficientStockError) {
      await message.reply(
        `⚠️ Venda cancelada.\n\nEstoque atual: ${error.currentStock}\nQuantidade solicitada: ${error.requestedQuantity}`
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
    registeredSale.movementCode,
    sellerName,
    registeredSale.currentStock
  );
  const bossMessage = formatBossSaleNotification(
    session,
    registeredSale.movementCode,
    sellerName,
    registeredSale.currentStock
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

function parsePaymentMethod(value: string): PaymentMethod | null {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (normalized === '1' || normalized === 'dinheiro') return 'Dinheiro';
  if (normalized === '2' || normalized === 'pix') return 'PIX';
  if (normalized === '3' || normalized === 'cartao') return 'Cartão';
  if (normalized === '4' || normalized === 'nota') return 'Nota';
  if (normalized === '5' || normalized === 'misto' || normalized === 'pagamento misto') {
    return 'Misto';
  }

  return null;
}

function isDiscountSelection(value: string): boolean {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized === '6' || normalized === 'desconto';
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

function applyPriceTypeToSession(
  session: SaleSession,
  priceType: SalePriceType
): SaleSession {
  const unitPrice = priceType === 'À vista' ? session.cashPrice : session.creditPrice;

  return {
    ...session,
    priceType,
    unitPrice,
    totalValue: calculateSaleTotal(session.quantity, unitPrice),
  };
}

function formatPaymentMenu(session?: SaleSession): string {
  const discountApplied = Boolean(session?.discountPercent && session.totalValue !== undefined);
  const selectedPrice = Boolean(session?.priceType && session.totalValue !== undefined);
  return [
    ...(selectedPrice
      ? [
          `Valor selecionado: *${session!.priceType}*`,
          `💰 ${discountApplied ? 'Total com desconto' : 'Total'}: *${formatCurrency(session!.totalValue!)}*`,
          '',
        ]
      : []),
    'Forma de pagamento?',
    '',
    '1️⃣ *Dinheiro*',
    '2️⃣ *PIX*',
    '3️⃣ *Cartão*',
    '4️⃣ *Nota*',
    '5️⃣ *Pagamento misto*',
    `6️⃣ *Desconto de ${DISCOUNT_PERCENT}%*${discountApplied ? ' — já aplicado' : ''}`,
  ].join('\n');
}

function formatPriceTypeQuestion(session: SaleSession): string {
  return [
    'Usar valor à vista ou a prazo?',
    '',
    `1️⃣ *À vista* — ${formatCurrency(calculateSaleTotal(session.quantity, session.cashPrice))}`,
    `2️⃣ *A prazo* — ${formatCurrency(calculateSaleTotal(session.quantity, session.creditPrice))}`,
  ].join('\n');
}

function formatDiscountPreview(session: SaleSession): string {
  const originalTotal = session.originalTotalValue ?? 0;
  const discountValue = originalTotal - (session.totalValue ?? 0);
  return [
    '🏷️ *APLICAR DESCONTO?*',
    '',
    `Valor ${session.priceType?.toLowerCase()}: ${formatCurrency(originalTotal)}`,
    `Desconto de ${session.discountPercent}%: -${formatCurrency(discountValue)}`,
    '',
    `💰 Novo total: *${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    'Digite: confirmar ou cancelar',
  ].join('\n');
}

export function formatSaleConfirmation(session: SaleSession): string {
  return [
    '⚠️ *CONFIRMAR VENDA?*',
    '',
    `*${session.reference}* — *${session.description}*`,
    formatSaleItemLine(session, false),
    ...formatConfirmationPaymentLines(session),
    ...formatDiscountLines(session, true),
    ...(session.invoiceName ? [`Nome da nota: ${session.invoiceName}`] : []),
    '',
    `💰 Total: *${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    'Digite: confirmar ou cancelar',
  ].join('\n');
}

export function formatRegisteredSale(
  session: SaleSession,
  movementCode: string,
  sellerName: string,
  currentStock: number
): string {
  return [
    '✅ *VENDA REGISTRADA*',
    '',
    `*${session.reference}* — *${session.description}*`,
    formatSaleItemLine(session, true),
    ...formatPaymentLines(session),
    ...formatDiscountLines(session, false),
    ...(session.invoiceName ? [`Nome da nota: ${session.invoiceName}`] : []),
    '',
    `💰 *TOTAL: ${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    `📦 Estoque: ${currentStock}`,
    `Movimentação: ${movementCode}`,
    `Vendedor: ${sellerName}`,
  ].join('\n');
}

export function formatBossSaleNotification(
  session: SaleSession,
  movementCode: string,
  sellerName: string,
  currentStock: number
): string {
  return [
    '🔔 *NOVA VENDA*',
    '',
    `*${session.reference}* — *${session.description}*`,
    formatSaleItemLine(session, true),
    ...formatPaymentLines(session),
    ...formatDiscountLines(session, false),
    ...(session.invoiceName ? [`Nome da nota: ${session.invoiceName}`] : []),
    '',
    `💰 *TOTAL: ${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    `📦 Estoque: ${currentStock}`,
    `Movimentação: ${movementCode}`,
    `Vendedor: ${sellerName}`,
  ].join('\n');
}

async function getSellerName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}

function formatMixedAmountQuestion(
  totalValue: number,
  paymentMethod: MixedPaymentMethod
): string {
  return [
    `Valor total da venda: *${formatCurrency(totalValue)}*`,
    '',
    `Quanto foi pago em ${paymentMethod}?`,
    '',
    'Exemplo: 100,00',
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
    return 'Envie a foto da nota/pedido.';
  }

  if (paymentMethod === 'Dinheiro') {
    return 'Envie a foto do depósito/dinheiro.';
  }

  return identifyPaymentMethod
    ? `Envie a foto do comprovante do ${formatMethodForSentence(paymentMethod)}.`
    : 'Envie a foto do comprovante.';
}

function formatMethodForSentence(paymentMethod: ReceiptPaymentMethod): string {
  return paymentMethod === 'PIX' ? 'PIX' : paymentMethod.toLowerCase();
}

function formatMissingReceiptMessage(paymentMethod: ReceiptPaymentMethod): string {
  if (paymentMethod === 'Dinheiro') {
    return 'Envie a foto do depósito/dinheiro para continuar.';
  }
  return 'Envie a imagem da nota/comprovante para continuar.';
}

function formatPaymentLines(session: SaleSession): string[] {
  if (session.paymentMethod !== 'Misto') {
    return [
      `Pagamento: ${session.paymentMethod}${formatPriceTypeSuffix(session, false)}`,
    ];
  }

  return [
    `Pagamento: Misto${formatPriceTypeSuffix(session, false)}`,
    ...(session.paymentBreakdown ?? []).map(
      (part) => `${part.method}: ${formatCurrency(part.amount)}`
    ),
  ];
}

function formatConfirmationPaymentLines(session: SaleSession): string[] {
  if (session.paymentMethod !== 'Misto') {
    return [
      `Pagamento: *${session.paymentMethod}*${formatPriceTypeSuffix(session, true)}`,
    ];
  }

  return [
    `Pagamento: *Misto*${formatPriceTypeSuffix(session, true)}`,
    (session.paymentBreakdown ?? [])
      .map((part) => `${part.method}: *${formatCurrency(part.amount)}*`)
      .join(' | '),
  ].filter(Boolean);
}

function formatSaleItemLine(session: SaleSession, registered: boolean): string {
  const quantityLabel = registered ? 'unidades' : 'un.';
  if (session.discountPercent) {
    return `*${session.quantity} ${quantityLabel}*`;
  }
  return `*${session.quantity} ${quantityLabel}* × ${formatCurrency(session.unitPrice ?? 0)}`;
}

function formatPriceTypeSuffix(session: SaleSession, bold: boolean): string {
  if (!shouldShowPriceType(session)) {
    return '';
  }
  return bold
    ? ` | Valor: *${session.priceType}*`
    : ` | Valor: ${session.priceType}`;
}

function shouldShowPriceType(session: SaleSession): boolean {
  return Boolean(
    session.priceType &&
    (
      session.discountPercent ||
      session.paymentMethod === 'Cartão' ||
      session.paymentMethod === 'Nota' ||
      (session.paymentMethod === 'Misto' && session.mixedPaymentMethods?.includes('Cartão'))
    )
  );
}

function formatDiscountLines(session: SaleSession, bold: boolean): string[] {
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
    bold
      ? `Desconto: *${session.discountPercent}% (-${formatCurrency(discountValue)})*`
      : `Desconto: ${session.discountPercent}% (-${formatCurrency(discountValue)})`,
  ];
}
