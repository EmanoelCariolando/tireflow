import type { Message } from 'whatsapp-web.js';
import env from '../config/env.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  clearProductRegistrationSession,
  getProductRegistrationSession,
  hasExpiredProductRegistrationSession,
  ProductRegistrationSession,
  saveProductRegistrationSession,
} from '../utils/productRegistrationSessionStore.js';
import { parseStockLocationChoice } from '../utils/stockLocation.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
  isProductRegistrationNavigationCommand as isNewOperationCommand,
} from '../utils/operationSessionCoordinator.js';
import {
  ProductAlreadyExistsError,
  registerNewProduct,
} from '../services/productRegistrationService.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import { sendBossTextNotification } from '../services/notificationService.js';
import {
  formatConfirmationOptions,
  isCancellationResponse,
  parseConfirmationAction,
} from '../utils/operationResponse.js';
import { calculateCreditPrice } from '../utils/productPricing.js';
import {
  formatCashPriceQuestion,
  formatSupplierQuestion,
} from '../utils/operationPrompts.js';
import {
  getEntrySession,
  saveEntrySession,
} from '../utils/entrySessionStore.js';
import { parseBinaryResponse } from '../utils/binaryResponse.js';
import {
  normalizeProductDescription,
  normalizeProductShortText as normalizeShortText,
  MAX_PRODUCT_TEXT_LENGTH as MAX_TEXT_LENGTH,
  parseNonNegativeInteger,
  parseProductRegistrationPrice,
} from './productRegistrationParsers.js';
import {
  formatAdditionalProductRegistrationQuestion,
  formatBossEntryProductRegistrationNotification,
  formatBossProductRegistrationNotification,
  formatEntryProductRegistered,
  formatProductDescriptionQuestion as formatDescriptionQuestion,
  formatProductMeasureQuestion as formatMeasureQuestion,
  formatProductQuantityQuestion,
  formatProductRegistrationConfirmation,
  formatProductRegistrationFinished,
  formatProductRegistrationLocationQuestion,
  formatRegisteredProduct,
} from './productRegistrationFormatting.js';

export {
  normalizeProductDescription,
  parseNonNegativeInteger,
  parseProductRegistrationPrice,
} from './productRegistrationParsers.js';
export { formatProductRegistrationConfirmation } from './productRegistrationFormatting.js';

const PRODUCT_REGISTRATION_COMMAND_REGEX = /^(cadastrar|adicionar)\s+pneu$/i;

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

export async function handleEntryProductRegistrationStart(
  message: Message
): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  saveProductRegistrationSession({
    userId,
    chatId,
    step: 'awaiting_measure',
    origin: 'entry',
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

  if (session.origin === 'entry') {
    const entrySession = getEntrySession(userId, chatId);
    if (!entrySession) {
      clearProductRegistrationSession(userId, chatId);
      await message.reply('⌛ *ENTRADA EXPIRADA*\nInicie a entrada novamente.');
      return true;
    }
    saveEntrySession(entrySession);
  }

  const normalizedBody = body.trim().toLowerCase();

  if (isCancellationResponse(normalizedBody)) {
    if (session.origin === 'entry') {
      clearProductRegistrationSession(userId, chatId);
      await message.reply([
        '❌ *CADASTRO CANCELADO*',
        'Os pneus já preparados continuam na nota.',
        '',
        'Digite *cadastro* para tentar novamente ou *voltar* para pesquisar outra medida.',
      ].join('\n'));
      return true;
    }
    if (session.step === 'awaiting_additional_decision') {
      clearProductRegistrationSession(userId, chatId);
      await message.reply(formatProductRegistrationFinished(session.registeredProductCount ?? 1));
      return true;
    }
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
    case 'awaiting_additional_decision':
      await handleAdditionalRegistrationDecisionStep(message, session, normalizedBody);
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
        'Para cadastrar uma roda, digite apenas: *RODA*',
        'Na próxima pergunta, informe aro, furos e medida da roda.',
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

  await message.reply(formatProductQuantityQuestion(session.reference, session.origin));
}

async function handleInitialStockStep(
  message: Message,
  session: ProductRegistrationSession,
  body: string
): Promise<void> {
  const initialStock = parseNonNegativeInteger(body);

  if (initialStock === null || (session.origin === 'entry' && initialStock === 0)) {
    await message.reply(
      session.origin === 'entry'
        ? `❌ Quantidade inválida. Digite um inteiro maior que zero.\n\n${formatProductQuantityQuestion(session.reference, session.origin)}`
        : `❌ Estoque inválido. Digite um inteiro maior ou igual a zero.\n\n${formatProductQuantityQuestion(session.reference)}`
    );
    return;
  }

  const nextSession: ProductRegistrationSession = {
    ...session,
    step: session.origin === 'entry'
      ? 'awaiting_cash_price'
      : initialStock > 0
        ? 'awaiting_supplier'
        : 'awaiting_cash_price',
    initialStock,
    updatedAt: Date.now(),
  };
  saveProductRegistrationSession(nextSession);

  if (session.origin !== 'entry' && initialStock > 0) {
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
    await message.reply(formatProductRegistrationLocationQuestion(session.origin !== 'entry'));
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
  const canSkipLocation = session.origin !== 'entry';
  const stockLocation = canSkipLocation && normalizedBody === 'pular'
    ? null
    : parseStockLocationChoice(body);

  if (!stockLocation && !(canSkipLocation && normalizedBody === 'pular')) {
    await message.reply(
      [
        '❌ *LOCAL INVÁLIDO*',
        '',
        formatProductRegistrationLocationQuestion(canSkipLocation),
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
  const action = parseConfirmationAction(normalizedBody);

  if (action === 'cancel') {
    if (session.origin === 'entry') {
      clearProductRegistrationSession(session.userId, session.chatId);
      await message.reply([
        '❌ *CADASTRO CANCELADO*',
        'Os pneus já preparados continuam na nota.',
        '',
        'Digite *cadastro* para tentar novamente ou *voltar* para pesquisar outra medida.',
      ].join('\n'));
      return;
    }
    clearAllOperationSessions(session.userId, session.chatId);
    await message.reply('❌ *CADASTRO CANCELADO*\nNenhuma informação foi salva.');
    return;
  }

  if (action === 'back') {
    const previousStep = env.inventoryLocationsEnabled
      ? 'awaiting_location'
      : 'awaiting_cash_price';
    saveProductRegistrationSession({
      ...session,
      step: previousStep,
      updatedAt: Date.now(),
    });
    await message.reply(
      env.inventoryLocationsEnabled
        ? formatProductRegistrationLocationQuestion(session.origin !== 'entry')
        : formatCashPriceQuestion()
    );
    return;
  }

  if (action !== 'confirm') {
    await message.reply(`❌ Opção inválida.\n\n${formatConfirmationOptions()}`);
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

  if (session.origin === 'entry') {
    await registerProductInsideEntry(message, session, responsibleName);
    return;
  }

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

    const registeredProductCount = (session.registeredProductCount ?? 0) + 1;
    saveProductRegistrationSession({
      userId: session.userId,
      chatId: session.chatId,
      step: 'awaiting_additional_decision',
      registeredProductCount,
      updatedAt: Date.now(),
    });

    await Promise.all([
      runPostCommitTask('product registration group confirmation', () =>
        message.reply(
          formatRegisteredProduct(session, registered.movementCode, registeredProductCount)
        )
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
    clearProductRegistrationSession(session.userId, session.chatId);
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
  }
}

async function handleAdditionalRegistrationDecisionStep(
  message: Message,
  session: ProductRegistrationSession,
  normalizedBody: string
): Promise<void> {
  const shouldRegisterAnother = parseBinaryResponse(normalizedBody);

  if (shouldRegisterAnother === true) {
    saveProductRegistrationSession({
      userId: session.userId,
      chatId: session.chatId,
      step: 'awaiting_measure',
      registeredProductCount: session.registeredProductCount ?? 1,
      updatedAt: Date.now(),
    });
    await message.reply(formatMeasureQuestion());
    return;
  }

  if (shouldRegisterAnother === false) {
    const registeredProductCount = session.registeredProductCount ?? 1;
    clearProductRegistrationSession(session.userId, session.chatId);
    await message.reply(formatProductRegistrationFinished(registeredProductCount));
    return;
  }

  await message.reply(
    `❌ Resposta inválida.\n\n${formatAdditionalProductRegistrationQuestion(session.registeredProductCount ?? 1)}`
  );
}

async function registerProductInsideEntry(
  message: Message,
  session: ProductRegistrationSession & {
    reference: string;
    description: string;
    initialStock: number;
    cashPrice: number;
    creditPrice: number;
    stockLocation: string | null;
  },
  responsibleName: string
): Promise<void> {
  const entrySession = getEntrySession(session.userId, session.chatId);
  const preparedItems = entrySession?.items ?? [];
  const noteSupplier = preparedItems[0]?.supplier;

  if (!entrySession || preparedItems.length === 0 || !noteSupplier) {
    clearProductRegistrationSession(session.userId, session.chatId);
    await message.reply(
      'Ocorreu um erro ao recuperar a nota em andamento. Nenhum pneu foi cadastrado.'
    );
    return;
  }

  try {
    const registered = await registerNewProduct({
      reference: session.reference,
      description: session.description,
      initialStock: 0,
      cashPrice: session.cashPrice,
      stockLocation: session.stockLocation,
      responsiblePhone: session.userId,
      responsibleName,
    });

    const stockLocation = session.stockLocation ?? undefined;
    const nextItems = [
      ...preparedItems,
      {
        productId: registered.productId,
        reference: session.reference,
        description: session.description,
        oldCashPrice: session.cashPrice,
        oldCreditPrice: session.creditPrice,
        quantity: session.initialStock,
        supplier: noteSupplier,
        stockLocation,
      },
    ];

    saveEntrySession({
      ...entrySession,
      step: 'awaiting_additional_decision',
      productId: registered.productId,
      reference: session.reference,
      description: session.description,
      oldCashPrice: session.cashPrice,
      oldCreditPrice: session.creditPrice,
      quantity: session.initialStock,
      supplier: noteSupplier,
      stockLocation,
      newCashPrice: undefined,
      newCreditPrice: undefined,
      items: nextItems,
      additionalMeasure: undefined,
      additionalProducts: undefined,
      updatedAt: Date.now(),
    });
    clearProductRegistrationSession(session.userId, session.chatId);

    await Promise.all([
      runPostCommitTask('entry product registration group confirmation', async () => {
        await message.reply(formatEntryProductRegistered(session));
        await message.reply(formatAdditionalProductRegistrationQuestion(nextItems.length));
      }),
      runPostCommitTask('entry product registration private owner notification', () =>
        sendBossTextNotification(
          formatBossEntryProductRegistrationNotification(session, responsibleName)
        )
      ),
    ]);
  } catch (error) {
    clearProductRegistrationSession(session.userId, session.chatId);

    if (error instanceof ProductAlreadyExistsError) {
      await message.reply([
        '⚠️ *PNEU JÁ CADASTRADO*',
        `${error.reference} — ${error.description}`,
        '',
        'Nenhum cadastro duplicado foi criado e os itens anteriores continuam na nota.',
        'Digite *voltar* para pesquisar a medida novamente.',
      ].join('\n'));
      return;
    }

    console.error('[PRODUCT_REGISTRATION] Error registering product inside entry:', error);
    await message.reply([
      'Ocorreu um erro ao cadastrar o pneu. Nenhuma informação nova foi salva.',
      'Os itens anteriores continuam na nota. Digite *cadastro* para tentar novamente ou *voltar*.',
    ].join('\n'));
  }
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
      (session.origin === 'entry' || session.initialStock === 0 || session.supplier) &&
      session.cashPrice !== undefined &&
      session.creditPrice !== undefined &&
      session.stockLocation !== undefined
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
