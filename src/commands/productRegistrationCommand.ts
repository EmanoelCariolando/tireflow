import type { Message } from 'whatsapp-web.js';
import env from '../config/env.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  clearProductRegistrationSession,
  getProductRegistrationSession,
  hasExpiredProductRegistrationSession,
  ProductRegistrationSession,
  saveProductRegistrationSession,
} from '../utils/productRegistrationSessionStore.js';
import { normalizeStockLocation } from '../utils/stockLocation.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
} from '../utils/operationSessionCoordinator.js';
import {
  ProductAlreadyExistsError,
  registerNewProduct,
} from '../services/productRegistrationService.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { sendBossTextNotification } from '../services/notificationService.js';
import { isCancellationResponse, isConfirmationResponse } from '../utils/operationResponse.js';
import { calculateCreditPrice } from '../utils/productPricing.js';
import {
  formatCashPriceQuestion,
  formatQuantityQuestion,
  formatSupplierQuestion,
} from '../utils/operationPrompts.js';
import { formatMovementNumberMessage } from '../utils/movementMessageVisibility.js';

const PRODUCT_REGISTRATION_COMMAND_REGEX = /^(cadastrar|adicionar)\s+pneu$/i;
const MAX_TEXT_LENGTH = 120;

export function isProductRegistrationCommand(body: string): boolean {
  return PRODUCT_REGISTRATION_COMMAND_REGEX.test(body.trim());
}

export async function handleProductRegistrationStart(message: Message): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredProductRegistrationSession(userId, chatId)) {
    await message.reply('⌛ *CADASTRO EXPIRADO*\nAbra o menu e escolha *4* para recomeçar.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return;
  }

  saveProductRegistrationSession({
    userId,
    chatId,
    step: 'awaiting_measure',
    updatedAt: Date.now(),
  });

  await message.reply(formatMeasureQuestion());
}

export async function handleProductRegistrationConversation(
  message: Message,
  body: string
): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredProductRegistrationSession(userId, chatId)) {
    await message.reply('⌛ *CADASTRO EXPIRADO*\nAbra o menu e escolha *4* para recomeçar.');
    return true;
  }

  const session = getProductRegistrationSession(userId, chatId);

  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (isCancellationResponse(normalizedBody)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ *CADASTRO CANCELADO*\nNenhuma informação foi salva.');
    return true;
  }

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply(
      '⚠️ *CADASTRO EM ANDAMENTO*\nResponda à pergunta atual ou digite *cancelar*.'
    );
    return true;
  }

  switch (session.step) {
    case 'awaiting_measure':
      await handleMeasureStep(message, session, body);
      return true;
    case 'awaiting_description':
      await handleDescriptionStep(message, session, body);
      return true;
    case 'awaiting_initial_stock':
      await handleInitialStockStep(message, session, body);
      return true;
    case 'awaiting_supplier':
      await handleSupplierStep(message, session, body);
      return true;
    case 'awaiting_cash_price':
      await handleCashPriceStep(message, session, body);
      return true;
    case 'awaiting_location':
      await handleLocationStep(message, session, body);
      return true;
    case 'awaiting_confirmation':
      await handleConfirmationStep(message, session, normalizedBody);
      return true;
    case 'processing':
      await message.reply('⏳ *CADASTRANDO PNEU...*');
      return true;
  }
}

async function handleMeasureStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const reference = normalizeTireSize(body);

  if (!reference) {
    await message.reply(
      [
        '❌ *MEDIDA INVÁLIDA*',
        '',
        'Digite só a medida, sem marca/modelo ou especificações.',
        'Ex.: *175/70 R14*, *110/90-17*, *18.4/30* ou *31x10.50R15*',
        '',
        'Tente novamente ou digite *cancelar*.',
      ].join('\n')
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'awaiting_description',
    reference,
    updatedAt: Date.now(),
  });

  await message.reply(formatDescriptionQuestion(reference));
}

async function handleDescriptionStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const description = normalizeProductDescription(body);

  if (!description) {
    await message.reply(
      [
        '❌ *DESCRIÇÃO INVÁLIDA*',
        '',
        `Informe marca/modelo em 2 a ${MAX_TEXT_LENGTH} caracteres.`,
        'Ex.: *PIRELLI MT60 TRASEIRO 60P*',
        'Tente novamente ou digite *cancelar*.',
      ].join('\n')
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'awaiting_initial_stock',
    description,
    updatedAt: Date.now(),
  });

  await message.reply(formatQuantityQuestion());
}

async function handleInitialStockStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const initialStock = parseNonNegativeInteger(body);

  if (initialStock === null) {
    await message.reply(
      `❌ Estoque inválido. Digite um inteiro maior ou igual a zero.\n\n${formatQuantityQuestion()}`
    );
    return;
  }

  const nextSession: ProductRegistrationSession = {
    ...session,
    step: initialStock > 0 ? 'awaiting_supplier' : 'awaiting_cash_price',
    initialStock,
    updatedAt: Date.now(),
  };
  saveProductRegistrationSession(nextSession);

  if (initialStock > 0) {
    await message.reply(formatSupplierQuestion());
    return;
  }

  await message.reply(formatCashPriceQuestion());
}

async function handleSupplierStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const supplier = normalizeShortText(body);

  if (!supplier) {
    await message.reply(
      `❌ Fornecedor inválido. Use de 2 a ${MAX_TEXT_LENGTH} caracteres.\n\n${formatSupplierQuestion()}`
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'awaiting_cash_price',
    supplier,
    updatedAt: Date.now(),
  });
  await message.reply(formatCashPriceQuestion());
}

async function handleCashPriceStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const cashPrice = parseProductRegistrationPrice(body);

  if (cashPrice === null) {
    await message.reply(`❌ Preço à vista inválido.\n\n${formatCashPriceQuestion()}`);
    return;
  }

  const nextSession: ProductRegistrationSession = {
    ...session,
    step: env.inventoryLocationsEnabled ? 'awaiting_location' : 'awaiting_confirmation',
    cashPrice,
    creditPrice: calculateCreditPrice(cashPrice),
    stockLocation: null,
    updatedAt: Date.now(),
  };
  saveProductRegistrationSession(nextSession);

  if (env.inventoryLocationsEnabled) {
    await message.reply(
      [
        '📍 *CADASTRO — LOCAL*',
        '',
        'Use 1 a 20 letras/números, sem espaços.',
        'Ex.: *CG*, *W3* ou *PMAIS*',
        'Sem local definido: *pular* | Sair: *cancelar*',
      ].join('\n')
    );
    return;
  }

  await message.reply(formatProductRegistrationConfirmation(nextSession));
}

async function handleLocationStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const normalizedBody = body.trim().toLowerCase();
  const stockLocation = normalizedBody === 'pular' ? null : normalizeStockLocation(body);

  if (normalizedBody !== 'pular' && !stockLocation) {
    await message.reply(
      [
        '❌ *LOCAL INVÁLIDO*',
        '',
        'Use 1 a 20 letras/números, sem espaços.',
        'Ex.: *CG*, *W3*, *PMAIS* ou *pular*',
      ].join('\n')
    );
    return;
  }

  const nextSession: ProductRegistrationSession = {
    ...session,
    step: 'awaiting_confirmation',
    stockLocation,
    updatedAt: Date.now(),
  };
  saveProductRegistrationSession(nextSession);
  await message.reply(formatProductRegistrationConfirmation(nextSession));
}

async function handleConfirmationStep(
  message: Message,
  session: ProductRegistrationSession,
  normalizedBody: string
): Promise<void> {
  if (!isConfirmationResponse(normalizedBody)) {
    await message.reply(
      'Responda: *confirmar* para salvar ou *cancelar* para sair.'
    );
    return;
  }

  if (!isCompleteSession(session)) {
    clearProductRegistrationSession(session.userId, session.chatId);
    await message.reply(
      'Ocorreu um erro nos dados do cadastro. Nenhum pneu foi criado. Abra o menu e tente novamente.'
    );
    return;
  }

  saveProductRegistrationSession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  const responsibleName = await getResponsibleName(message, session.userId);

  try {
    const registered = await registerNewProduct({
      reference: session.reference,
      description: session.description,
      initialStock: session.initialStock,
      supplier: session.supplier,
      cashPrice: session.cashPrice,
      stockLocation: session.stockLocation,
      responsiblePhone: session.userId,
      responsibleName,
    });

    await Promise.all([
      runPostCommitTask('product registration group confirmation', () =>
        message.reply(formatRegisteredProduct(session, registered.movementCode))
      ),
      runPostCommitTask('product registration private owner notification', () =>
        sendBossTextNotification(
          formatBossProductRegistrationNotification(
            session,
            registered.movementCode,
            responsibleName
          )
        )
      ),
    ]);
  } catch (error) {
    if (error instanceof ProductAlreadyExistsError) {
      await message.reply(
        [
          '⚠️ *PNEU JÁ CADASTRADO*',
          '',
          `Medida: ${error.reference}`,
          `Descrição: ${error.description}`,
          `Situação: ${error.isActive ? 'ativo' : 'inativo'}`,
          '',
          'Nenhum cadastro duplicado foi criado.',
          error.isActive
            ? `Para consultar, digite: pneu ${error.reference}`
            : 'O cadastro existente está inativo e precisa ser verificado no banco antes de ser reutilizado.',
        ].join('\n')
      );
    } else {
      console.error('[PRODUCT_REGISTRATION] Error registering product:', error);
      await message.reply(
        'Ocorreu um erro ao cadastrar o pneu. Nenhuma confirmação adicional é necessária. Consulte a medida antes de tentar novamente.'
      );
    }
  } finally {
    clearProductRegistrationSession(session.userId, session.chatId);
  }
}

export function normalizeProductDescription(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized.length >= 2 && normalized.length <= MAX_TEXT_LENGTH ? normalized : null;
}

function normalizeShortText(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 2 && normalized.length <= MAX_TEXT_LENGTH ? normalized : null;
}

export function parseNonNegativeInteger(value: string): number | null {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseProductRegistrationPrice(value: string): number | null {
  const compact = value.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  let normalized: string;

  if (/^\d+$/.test(compact)) {
    normalized = compact;
  } else if (/^\d+,\d{1,2}$/.test(compact)) {
    normalized = compact.replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(compact)) {
    normalized = compact;
  } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(compact)) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(compact)) {
    normalized = compact.replace(/,/g, '');
  } else {
    return null;
  }

  const price = Number(normalized);

  if (!Number.isFinite(price) || price < 0) {
    return null;
  }

  return Math.round(price * 100) / 100;
}

export function formatProductRegistrationConfirmation(
  session: ProductRegistrationSession
): string {
  return [
    '🧾 *CADASTRO — CONFIRMAR*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `📦 Estoque inicial: *${session.initialStock}*`,
    ...(session.initialStock
      ? [`🚚 Fornecedor: *${session.supplier}*`]
      : []),
    '',
    `💰 À vista: *${formatCurrency(session.cashPrice ?? 0)}*`,
    `💳 A prazo (+5,8%): *${formatCurrency(session.creditPrice ?? 0)}*`,
    ...(env.inventoryLocationsEnabled
      ? ['', `📍 Local: *${session.stockLocation ?? 'não cadastrado'}*`]
      : []),
    '',
    'Responda: *confirmar* ou *cancelar*.',
  ].join('\n');
}

function formatMeasureQuestion(): string {
  return [
    '🆕 *CADASTRO — MEDIDA*',
    '',
    'Digite apenas a medida, sem marca/modelo ou especificações.',
    'Ex.: *175/70 R14*, *110/90-17*, *18.4/30* ou *31x10.50R15*',
    '',
    'Para sair: *cancelar*',
  ].join('\n');
}

function formatDescriptionQuestion(reference: string): string {
  return [
    '🏷️ *CADASTRO — DESCRIÇÃO*',
    '',
    `Medida: *${reference}*`,
    'Informe marca/modelo e detalhes úteis, sem repetir a medida.',
    'Ex.: *PIRELLI MT60 TRASEIRO 60P*',
    'Para sair: *cancelar*',
  ].join('\n');
}

function isCompleteSession(session: ProductRegistrationSession): session is ProductRegistrationSession & {
  reference: string;
  description: string;
  initialStock: number;
  cashPrice: number;
  creditPrice: number;
  stockLocation: string | null;
} {
  return Boolean(
    session.reference &&
      session.description &&
      session.initialStock !== undefined &&
      (session.initialStock === 0 || session.supplier) &&
      session.cashPrice !== undefined &&
      session.creditPrice !== undefined &&
      session.stockLocation !== undefined
  );
}

function formatRegisteredProduct(
  session: ProductRegistrationSession,
  movementCode: string | null
): string {
  return [
    '✅ *PNEU CADASTRADO*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `📦 Estoque inicial: *${session.initialStock}*`,
    ...(movementCode
      ? formatMovementNumberMessage(`🧾 Entrada inicial: *${movementCode}*`)
      : []),
    '',
    `💰 À vista: *${formatCurrency(session.cashPrice ?? 0)}*`,
    `💳 A prazo: *${formatCurrency(session.creditPrice ?? 0)}*`,
    ...(env.inventoryLocationsEnabled
      ? [`📍 Local: *${session.stockLocation ?? 'não cadastrado'}*`]
      : []),
    '',
    `🔎 Consultar: *pneu ${session.reference}*`,
    ...(session.initialStock === 0
      ? ['', 'ℹ️ O pneu foi cadastrado, mas a consulta informará estoque zero até que seja feita uma entrada.']
      : []),
  ].join('\n');
}

function formatBossProductRegistrationNotification(
  session: ProductRegistrationSession,
  movementCode: string | null,
  responsibleName: string
): string {
  return [
    '🆕 *NOVO PNEU CADASTRADO*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    '',
    `📦 Estoque inicial: *${session.initialStock}*`,
    ...(movementCode
      ? formatMovementNumberMessage(`🧾 Entrada inicial: *${movementCode}*`)
      : []),
    `💰 À vista: *${formatCurrency(session.cashPrice ?? 0)}*`,
    `💳 A prazo: *${formatCurrency(session.creditPrice ?? 0)}*`,
    '',
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(menu|venda|entrada|ajuste|pre[cç]o|local|addfoto|cadastrar\s+pneu|adicionar\s+pneu)\b/i.test(
    normalizedBody
  );
}

async function getResponsibleName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}
