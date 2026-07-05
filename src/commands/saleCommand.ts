import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  calculateSaleTotal,
  getCurrentProductStock,
  getUnitPriceForPayment,
  InsufficientStockError,
  registerSale,
  SaleProductNotFoundError,
} from '../services/saleService.js';
import { sendBossNotification } from '../services/notificationService.js';
import {
  clearSaleSession,
  getSaleSession,
  hasExpiredSaleSession,
  PaymentMethod,
  SaleSession,
  saveSaleSession,
} from '../utils/saleSessionStore.js';

const SALE_COMMAND_REGEX = /^venda\s+(\d+)\s+(\d+)$/i;

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

  if (getSaleSession(userId, chatId)) {
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

  saveSaleSession({
    userId,
    chatId,
    step: 'awaiting_payment',
    productId: product.id,
    reference: product.reference || lastQuery.normalizedMeasure,
    description: product.description,
    quantity,
    cashPrice: product.cashPrice,
    creditPrice: product.creditPrice,
    updatedAt: Date.now(),
  });

  await message.reply(
    'Forma de pagamento?\n\n1️⃣ Dinheiro\n2️⃣ PIX\n3️⃣ Cartão\n4️⃣ Nota'
  );
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

  if (normalizedBody === 'cancelar') {
    clearSaleSession(userId, chatId);
    await message.reply('❌ Operação cancelada.');
    return true;
  }

  if (session.step === 'awaiting_payment') {
    await handlePaymentStep(message, session, normalizedBody);
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
  const paymentMethod = parsePaymentMethod(normalizedBody);

  if (!paymentMethod) {
    await message.reply('Forma de pagamento inválida.\n\n1️⃣ Dinheiro\n2️⃣ PIX\n3️⃣ Cartão\n4️⃣ Nota');
    return;
  }

  const pricedSession = applyPaymentToSession(session, paymentMethod);

  if (paymentMethod === 'Dinheiro') {
    const nextSession: SaleSession = {
      ...pricedSession,
      step: 'awaiting_confirmation',
      updatedAt: Date.now(),
    };
    saveSaleSession(nextSession);
    await message.reply(formatSaleConfirmation(nextSession));
    return;
  }

  const nextSession: SaleSession = {
    ...pricedSession,
    step: 'awaiting_photo',
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);

  if (paymentMethod === 'Nota') {
    await message.reply('Envie a foto da nota/pedido.');
    return;
  }

  await message.reply('Envie a foto do comprovante.');
}

async function handlePhotoStep(message: Message, session: SaleSession): Promise<void> {
  if (!message.hasMedia || message.type !== 'image') {
    await message.reply('Envie a imagem da nota/comprovante para continuar.');
    return;
  }

  const receiptMedia = await message.downloadMedia();

  if (session.paymentMethod === 'Nota') {
    saveSaleSession({
      ...session,
      step: 'awaiting_invoice_name',
      receiptMedia,
      updatedAt: Date.now(),
    });
    await message.reply('Nome da nota?\n\nExemplo:\nPrefeitura de Congo');
    return;
  }

  const nextSession: SaleSession = {
    ...session,
    step: 'awaiting_confirmation',
    receiptMedia,
    updatedAt: Date.now(),
  };
  saveSaleSession(nextSession);
  await message.reply(formatSaleConfirmation(nextSession));
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
  if (normalizedBody !== 'confirmar') {
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

  try {
    await message.reply(groupMessage);

    if (session.receiptMedia) {
      await message.reply(session.receiptMedia);
    }
  } catch (error) {
    console.error('[SALE] Error sending sale message to group:', error);
  }

  try {
    await sendBossNotification(
      formatBossSaleNotification(session, registeredSale.movementCode, sellerName, registeredSale.currentStock),
      session.receiptMedia
    );
  } catch (error) {
    console.error('[SALE] Error sending boss notification:', error);
  }

  clearSaleSession(session.userId, session.chatId);
}

function parsePaymentMethod(value: string): PaymentMethod | null {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (normalized === '1' || normalized === 'dinheiro') return 'Dinheiro';
  if (normalized === '2' || normalized === 'pix') return 'PIX';
  if (normalized === '3' || normalized === 'cartao') return 'Cartão';
  if (normalized === '4' || normalized === 'nota') return 'Nota';

  return null;
}

function applyPaymentToSession(session: SaleSession, paymentMethod: PaymentMethod): SaleSession {
  const unitPrice = getUnitPriceForPayment(paymentMethod, session.cashPrice, session.creditPrice);

  return {
    ...session,
    paymentMethod,
    unitPrice,
    totalValue: calculateSaleTotal(session.quantity, unitPrice),
  };
}

function formatSaleConfirmation(session: SaleSession): string {
  return [
    '⚠️ Confirmar venda?',
    '',
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    `Quantidade: ${session.quantity}`,
    `Valor unitário: ${formatCurrency(session.unitPrice ?? 0)}`,
    `Total da venda: ${formatCurrency(session.totalValue ?? 0)}`,
    `Pagamento: ${session.paymentMethod}`,
    ...(session.receiptMedia ? ['Foto da nota/comprovante: recebida'] : []),
    ...(session.invoiceName ? [`Nome da nota: ${session.invoiceName}`] : []),
    '',
    'Digite: confirmar ou cancelar',
  ].join('\n');
}

function formatRegisteredSale(
  session: SaleSession,
  movementCode: string,
  sellerName: string,
  currentStock: number
): string {
  return [
    '✅ Venda registrada',
    '',
    `Movimentação: ${movementCode}`,
    `Produto: ${session.reference}`,
    `Descrição: ${session.description}`,
    `Quantidade: ${session.quantity}`,
    `Valor unitário: ${formatCurrency(session.unitPrice ?? 0)}`,
    `Total da venda: ${formatCurrency(session.totalValue ?? 0)}`,
    `Pagamento: ${session.paymentMethod}`,
    ...(session.invoiceName ? [`Nome da nota: ${session.invoiceName}`] : []),
    `Vendedor: ${sellerName}`,
    '',
    `Estoque atual: ${currentStock}`,
  ].join('\n');
}

function formatBossSaleNotification(
  session: SaleSession,
  movementCode: string,
  sellerName: string,
  currentStock: number
): string {
  return [
    '🔔 Nova venda',
    '',
    `Movimentação: ${movementCode}`,
    `${sellerName} vendeu ${session.quantity} pneus`,
    `${session.reference} ${session.description}`,
    '',
    `Valor unitário: ${formatCurrency(session.unitPrice ?? 0)}`,
    `Total da venda: ${formatCurrency(session.totalValue ?? 0)}`,
    `Pagamento: ${session.paymentMethod}`,
    ...(session.invoiceName ? [`Nome da nota: ${session.invoiceName}`] : []),
    `Estoque atual: ${currentStock}`,
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
