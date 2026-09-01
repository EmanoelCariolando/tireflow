import { Message } from 'whatsapp-web.js';
import { getLastQuery, updateLastQueryProductLocation } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearEntrySession,
  EntrySession,
  getEntrySession,
  hasExpiredEntrySession,
  saveEntrySession,
} from '../utils/entrySessionStore.js';
import {
  clearAllOperationSessions,
  hasActiveOperationSession,
  isNewOperationConversationCommand as isNewOperationCommand,
} from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import {
  EntryProductNotFoundError,
  registerEntryItems,
  RegisteredEntry,
} from '../services/entryService.js';
import { sendBossNotification } from '../services/notificationService.js';
import {
  formatConfirmationOptions,
  isBackResponse,
  isCancellationResponse,
  parseConfirmationAction,
} from '../utils/operationResponse.js';
import { calculateCreditPrice } from '../utils/productPricing.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import {
  findActiveProductsByReference,
  findSuggestedActiveReferences,
} from '../services/productService.js';
import {
  formatProductList,
  formatReferenceSuggestions,
  isTireSizeLikeCommand,
} from './pneuCommand.js';
import {
  formatAdditionalTireQuestion,
  formatCashPriceQuestion,
  formatQuantityQuestion,
  formatSupplierQuestion,
} from '../utils/operationPrompts.js';
import env from '../config/env.js';
import { parseStockLocationChoice } from '../utils/stockLocation.js';
import { parseBinaryResponse } from '../utils/binaryResponse.js';
import { handleEntryProductRegistrationStart } from './productRegistrationCommand.js';
import {
  buildCurrentEntryItem,
  getEntryItems,
  getExplicitEntryItems,
  MAX_ENTRY_INVOICE_NUMBER_LENGTH as MAX_INVOICE_NUMBER_LENGTH,
  normalizeEntryInvoiceNumber as normalizeInvoiceNumber,
  orderEntryProductsByStock,
  parseAdditionalEntryItemSelection as parseAdditionalItemSelection,
  parseEntryPriceValue as parsePriceValue,
} from '../utils/entrySessionHelpers.js';
import {
  formatAdditionalDecisionQuestion,
  formatAdditionalEntryHelp,
  formatAdditionalEntryProductChoiceQuestion,
  formatBossEntryNotification,
  formatEntryConfirmation,
  formatEntryLocationQuestion,
  formatInvoiceNumberQuestion,
  formatPriceDecisionQuestion,
  formatRegisteredEntry,
} from './entryFormatting.js';

export { orderEntryProductsByStock } from '../utils/entrySessionHelpers.js';
export {
  formatAdditionalEntryHelp,
  formatAdditionalEntryProductChoiceQuestion,
  formatBossEntryNotification,
  formatEntryConfirmation,
  formatEntryLocationQuestion,
  formatInvoiceNumberQuestion,
  formatRegisteredEntry,
} from './entryFormatting.js';

const ENTRY_COMMAND_REGEX = /^entrada\s+(\d+)$/i;
const MAX_ENTRY_ITEMS = 20;
const ADDITIONAL_ENTRY_HELP_DELAY_MS = 30_000;
const additionalEntryHelpTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function isEntryCommand(body: string): boolean {
  return ENTRY_COMMAND_REGEX.test(body.trim());
}

export async function handleEntryCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

  if (hasExpiredEntrySession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return;
  }

  if (hasActiveOperationSession(userId, chatId)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return;
  }

  const match = body.trim().match(ENTRY_COMMAND_REGEX);
  if (!match) {
    return;
  }

  const optionNumber = Number(match[1]);

  if (!Number.isInteger(optionNumber) || optionNumber <= 0) {
    await message.reply('❌ Comando inválido. Use: *entrada 1*');
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

  saveEntrySession({
    userId,
    chatId,
    step: 'awaiting_quantity',
    productId: product.id,
    reference: product.reference || lastQuery.normalizedMeasure,
    description: product.description,
    oldCashPrice: product.cashPrice,
    oldCreditPrice: product.creditPrice,
    updatedAt: Date.now(),
  });

  await message.reply(formatQuantityQuestion());
}

export async function handleEntryConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearAdditionalEntryHelpTimer(userId, chatId);

  if (hasExpiredEntrySession(userId, chatId)) {
    await message.reply('⌛ *OPERAÇÃO EXPIRADA*\nInicie novamente.');
    return true;
  }

  const session = getEntrySession(userId, chatId);
  if (!session) {
    return false;
  }

  const normalizedBody = body.trim().toLowerCase();

  if (isCancellationResponse(normalizedBody)) {
    clearAllOperationSessions(userId, chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return true;
  }

  if (isBackResponse(normalizedBody) && session.step === 'awaiting_additional_item') {
    await requestAnotherEntryMeasure(message, session);
    return true;
  }

  if (isBackResponse(normalizedBody) && canReturnFromAdditionalEntry(session)) {
    await returnToPreparedEntry(message, session);
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

  if (isNewOperationCommand(normalizedBody)) {
    await message.reply('⚠️ *OPERAÇÃO EM ANDAMENTO*\nResponda: *confirmar* ou *cancelar*.');
    return true;
  }

  if (session.step === 'awaiting_invoice_number') {
    await handleInvoiceNumberStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_quantity') {
    await handleQuantityStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_supplier') {
    await handleSupplierStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_location') {
    await handleEntryLocationStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_price_decision') {
    await handlePriceDecisionStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_cash_price') {
    await handleCashPriceStep(message, session, body);
    return true;
  }

  if (session.step === 'awaiting_additional_decision') {
    await handleAdditionalDecisionStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_confirmation') {
    await handleConfirmationStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'processing') {
    await message.reply('⏳ *REGISTRANDO ENTRADA...*');
    return true;
  }

  return false;
}

async function handleInvoiceNumberStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const invoiceNumber = normalizeInvoiceNumber(body);

  if (!invoiceNumber) {
    await message.reply(
      `❌ Número da nota inválido. Use até ${MAX_INVOICE_NUMBER_LENGTH} caracteres (letras, números, espaços, ponto, barra ou hífen).\n\n${formatInvoiceNumberQuestion()}`
    );
    return;
  }

  saveEntrySession({
    ...session,
    step: 'awaiting_supplier',
    invoiceNumber,
    updatedAt: Date.now(),
  });
  await message.reply(formatSupplierQuestion());
}

async function handleQuantityStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  const quantity = Number(normalizedBody);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    await message.reply(
      `❌ Quantidade inválida. Digite um inteiro positivo.\n\n${formatQuantityQuestion()}`
    );
    return;
  }

  const noteSupplier = getExplicitEntryItems(session)[0]?.supplier;
  if (noteSupplier) {
    saveEntrySession({
      ...session,
      step: env.inventoryLocationsEnabled ? 'awaiting_location' : 'awaiting_price_decision',
      quantity,
      supplier: noteSupplier,
      updatedAt: Date.now(),
    });
    await message.reply(
      env.inventoryLocationsEnabled
        ? formatEntryLocationQuestion()
        : formatPriceDecisionQuestion()
    );
    return;
  }

  saveEntrySession({
    ...session,
    step: 'awaiting_invoice_number',
    quantity,
    updatedAt: Date.now(),
  });

  await message.reply(formatInvoiceNumberQuestion());
}

async function handleSupplierStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const supplier = body.trim();

  if (!supplier) {
    await message.reply(`❌ Fornecedor inválido.\n\n${formatSupplierQuestion()}`);
    return;
  }

  const nextSession: EntrySession = {
    ...session,
    step: env.inventoryLocationsEnabled ? 'awaiting_location' : 'awaiting_price_decision',
    supplier,
    updatedAt: Date.now(),
  };

  saveEntrySession(nextSession);
  await message.reply(
    env.inventoryLocationsEnabled
      ? formatEntryLocationQuestion()
      : formatPriceDecisionQuestion()
  );
}

async function handleEntryLocationStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const stockLocation = parseStockLocationChoice(body);

  if (!stockLocation) {
    await message.reply(`❌ *LOCAL INVÁLIDO*\n\n${formatEntryLocationQuestion()}`);
    return;
  }

  saveEntrySession({
    ...session,
    step: 'awaiting_price_decision',
    stockLocation,
    updatedAt: Date.now(),
  });
  await message.reply(formatPriceDecisionQuestion());
}

async function handlePriceDecisionStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  const shouldChangePrice = parseBinaryResponse(normalizedBody);

  if (shouldChangePrice === true) {
    saveEntrySession({
      ...session,
      step: 'awaiting_cash_price',
      updatedAt: Date.now(),
    });
    await message.reply(formatCashPriceQuestion());
    return;
  }

  if (shouldChangePrice === false) {
    const nextSession: EntrySession = {
      ...session,
      step: 'awaiting_additional_decision',
      updatedAt: Date.now(),
    };
    await finishCurrentItemAndAskForAnother(message, nextSession);
    return;
  }

  await message.reply(`❌ Resposta inválida.\n\n${formatPriceDecisionQuestion()}`);
}

async function handleCashPriceStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const cashPrice = parsePriceValue(body);

  if (cashPrice === null) {
    await message.reply(`❌ Preço inválido.\n\n${formatCashPriceQuestion()}`);
    return;
  }

  const nextSession: EntrySession = {
    ...session,
    step: 'awaiting_additional_decision',
    newCashPrice: cashPrice,
    newCreditPrice: calculateCreditPrice(cashPrice),
    updatedAt: Date.now(),
  };

  await finishCurrentItemAndAskForAnother(message, nextSession);
}

async function finishCurrentItemAndAskForAnother(
  message: Message,
  session: EntrySession
): Promise<void> {
  const item = buildCurrentEntryItem(session);

  if (!item) {
    clearEntrySession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da entrada. Faça a consulta novamente.');
    return;
  }

  const nextSession: EntrySession = {
    ...session,
    step: 'awaiting_additional_decision',
    items: [...getExplicitEntryItems(session), item],
    updatedAt: Date.now(),
  };
  saveEntrySession(nextSession);
  await message.reply(formatAdditionalDecisionQuestion(nextSession));
}

async function handleAdditionalDecisionStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  const shouldAddItem = parseBinaryResponse(normalizedBody);

  if (shouldAddItem === true) {
    const items = getEntryItems(session);

    if (items.length >= MAX_ENTRY_ITEMS) {
      const nextSession: EntrySession = {
        ...session,
        step: 'awaiting_confirmation',
        updatedAt: Date.now(),
      };
      saveEntrySession(nextSession);
      await message.reply(
        `Limite de ${MAX_ENTRY_ITEMS} itens atingido.\n\n${formatEntryConfirmation(nextSession)}`
      );
      return;
    }

    saveEntrySession({
      ...session,
      step: 'awaiting_additional_measure',
      additionalMeasure: undefined,
      additionalProducts: undefined,
      updatedAt: Date.now(),
    });
    await message.reply(formatAdditionalTireQuestion());
    return;
  }

  if (shouldAddItem === false) {
    const nextSession: EntrySession = {
      ...session,
      step: 'awaiting_confirmation',
      updatedAt: Date.now(),
    };
    saveEntrySession(nextSession);
    await message.reply(formatEntryConfirmation(nextSession));
    return;
  }

  await message.reply(`❌ Resposta inválida.\n\n${formatAdditionalDecisionQuestion(session)}`);
}

async function handleAdditionalMeasureStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const rawMeasure = body.trim().replace(/^pneu\s+/i, '');
  const normalizedMeasure = normalizeTireSize(rawMeasure);

  if (!normalizedMeasure) {
    try {
      const suggestions = await findSuggestedActiveReferences(rawMeasure);
      const suggestionText = formatReferenceSuggestions(suggestions);
      await message.reply(
        '❌ *MEDIDA INVÁLIDA*' +
          (suggestionText
            ? `\n\n${suggestionText}`
            : '\n\nDigite novamente a medida correta ou envie *voltar*.')
      );
    } catch (error) {
      console.error('[ENTRY] Error suggesting an additional tire measure:', error);
      await message.reply(
        '❌ *MEDIDA INVÁLIDA*\n\nDigite novamente a medida correta ou envie *voltar*.'
      );
    }
    return;
  }

  try {
    const products = orderEntryProductsByStock(
      await findActiveProductsByReference(normalizedMeasure)
    );

    if (products.length === 0) {
      const suggestions = await findSuggestedActiveReferences(rawMeasure);
      const suggestionText = formatReferenceSuggestions(suggestions);
      saveEntrySession({
        ...session,
        step: 'awaiting_additional_item',
        additionalMeasure: normalizedMeasure,
        additionalProducts: [],
        updatedAt: Date.now(),
      });
      await message.reply(
        [
          `🔎 Nenhum pneu encontrado para *${normalizedMeasure}*.`,
          ...(suggestionText ? ['', suggestionText] : []),
          '',
          formatAdditionalEntryHelp(),
        ].join('\n')
      );
      return;
    }

    saveEntrySession({
      ...session,
      step: 'awaiting_additional_item',
      additionalMeasure: normalizedMeasure,
      additionalProducts: products,
      updatedAt: Date.now(),
    });
    await message.reply(formatProductList(products, normalizedMeasure));
    await message.reply(formatAdditionalEntryProductChoiceQuestion());
    scheduleAdditionalEntryHelp(message, session.userId, session.chatId, normalizedMeasure);
  } catch (error) {
    console.error('[ENTRY] Error searching an additional tire:', error);
    await message.reply('Ocorreu um erro ao buscar a medida. Tente novamente ou digite *voltar*.');
  }
}

export function scheduleAdditionalEntryHelp(
  message: Message,
  userId: string,
  chatId: string,
  measure: string,
  delayMs = ADDITIONAL_ENTRY_HELP_DELAY_MS
): void {
  clearAdditionalEntryHelpTimer(userId, chatId);
  const key = buildAdditionalEntryHelpTimerKey(userId, chatId);
  const timer = setTimeout(() => {
    additionalEntryHelpTimers.delete(key);
    const currentSession = getEntrySession(userId, chatId);

    if (
      currentSession?.step !== 'awaiting_additional_item' ||
      currentSession.additionalMeasure !== measure
    ) {
      return;
    }

    void message.reply(formatAdditionalEntryHelp()).catch((error) => {
      console.error('[ENTRY] Error sending additional tire help:', error);
    });
  }, delayMs);
  timer.unref?.();
  additionalEntryHelpTimers.set(key, timer);
}

function clearAdditionalEntryHelpTimer(userId: string, chatId: string): void {
  const key = buildAdditionalEntryHelpTimerKey(userId, chatId);
  const timer = additionalEntryHelpTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    additionalEntryHelpTimers.delete(key);
  }
}

function buildAdditionalEntryHelpTimerKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

async function handleAdditionalItemStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const trimmedBody = body.trim();

  if (/^(cadastro|cadastrar)$/i.test(trimmedBody)) {
    await handleEntryProductRegistrationStart(message);
    return;
  }

  const rawMeasure = trimmedBody.replace(/^pneu\s+/i, '');
  if (normalizeTireSize(rawMeasure) || isTireSizeLikeCommand(rawMeasure)) {
    await handleAdditionalMeasureStep(message, session, rawMeasure);
    return;
  }

  const optionNumber = parseAdditionalItemSelection(trimmedBody);

  if (optionNumber === null) {
    await message.reply(
      `❌ Opção inválida.\n\n${formatAdditionalEntryProductChoiceQuestion()}\n\n${formatAdditionalEntryHelp()}`
    );
    return;
  }

  const product = session.additionalProducts?.[optionNumber - 1];
  if (!product) {
    await message.reply(`❌ Item inválido.\n\n${formatAdditionalEntryProductChoiceQuestion()}`);
    return;
  }

  const noteSupplier = getExplicitEntryItems(session)[0]?.supplier;
  saveEntrySession({
    ...session,
    step: 'awaiting_quantity',
    productId: product.id,
    reference: product.reference || session.additionalMeasure || '',
    description: product.description,
    oldCashPrice: product.cashPrice,
    oldCreditPrice: product.creditPrice,
    quantity: undefined,
    supplier: noteSupplier,
    stockLocation: undefined,
    newCashPrice: undefined,
    newCreditPrice: undefined,
    additionalMeasure: undefined,
    additionalProducts: undefined,
    updatedAt: Date.now(),
  });
  await message.reply(formatQuantityQuestion());
}

async function requestAnotherEntryMeasure(
  message: Message,
  session: EntrySession
): Promise<void> {
  saveEntrySession({
    ...session,
    step: 'awaiting_additional_measure',
    additionalMeasure: undefined,
    additionalProducts: undefined,
    updatedAt: Date.now(),
  });
  await message.reply(formatAdditionalTireQuestion());
}

async function handleConfirmationStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  const action = parseConfirmationAction(normalizedBody);

  if (action === 'cancel') {
    clearAllOperationSessions(session.userId, session.chatId);
    await message.reply('❌ *OPERAÇÃO CANCELADA*');
    return;
  }

  if (action === 'back') {
    const nextSession: EntrySession = {
      ...session,
      step: 'awaiting_additional_decision',
      updatedAt: Date.now(),
    };
    saveEntrySession(nextSession);
    await message.reply(formatAdditionalDecisionQuestion(nextSession));
    return;
  }

  if (action !== 'confirm') {
    await message.reply(`❌ Opção inválida.\n\n${formatConfirmationOptions()}`);
    return;
  }

  const items = getEntryItems(session);
  if (items.length === 0) {
    clearEntrySession(session.userId, session.chatId);
    await message.reply('Ocorreu um erro na sessão da entrada. Faça a consulta novamente.');
    return;
  }

  saveEntrySession({
    ...session,
    step: 'processing',
    updatedAt: Date.now(),
  });

  const responsibleName = await getResponsibleName(message, session.userId);

  let registeredItems: RegisteredEntry[];

  try {
    const registeredGroup = await registerEntryItems({
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        supplier: item.supplier,
        stockLocation: item.stockLocation,
        newCashPrice: item.newCashPrice,
      })),
      invoiceName: session.invoiceName,
      invoiceNumber: session.invoiceNumber,
      responsiblePhone: session.userId,
      responsibleName,
    });
    registeredItems = registeredGroup.items;

    for (const item of items) {
      if (item.stockLocation) {
        updateLastQueryProductLocation(
          session.userId,
          session.chatId,
          item.productId,
          item.stockLocation
        );
      }
    }
  } catch (error) {
    if (error instanceof EntryProductNotFoundError) {
      clearEntrySession(session.userId, session.chatId);
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }

    saveEntrySession({
      ...session,
      step: 'awaiting_confirmation',
      updatedAt: Date.now(),
    });
    console.error('[ENTRY] Error registering entry:', error);
    await message.reply([
      '❌ *NÃO FOI POSSÍVEL REGISTRAR A ENTRADA*',
      'Nenhum item foi registrado e a nota continua preparada.',
      '',
      'Tente confirmar novamente ou escolha outra opção:',
      formatConfirmationOptions(),
    ].join('\n'));
    return;
  }

  await runPostCommitTask('entry group confirmation', () =>
    message.reply(
      formatRegisteredEntry(session, responsibleName, registeredItems)
    )
  );

  await runPostCommitTask('entry private owner notification', () =>
    sendBossNotification(
      formatBossEntryNotification(session, responsibleName, registeredItems)
    )
  );

  clearEntrySession(session.userId, session.chatId);
}

function canReturnFromAdditionalEntry(session: EntrySession): boolean {
  return getExplicitEntryItems(session).length > 0 && [
    'awaiting_additional_measure',
    'awaiting_additional_item',
    'awaiting_quantity',
    'awaiting_supplier',
    'awaiting_location',
    'awaiting_price_decision',
    'awaiting_cash_price',
  ].includes(session.step);
}

async function returnToPreparedEntry(
  message: Message,
  session: EntrySession
): Promise<void> {
  const items = getExplicitEntryItems(session);
  const lastItem = items.at(-1)!;
  const nextSession: EntrySession = {
    ...session,
    step: 'awaiting_additional_decision',
    productId: lastItem.productId,
    reference: lastItem.reference,
    description: lastItem.description,
    oldCashPrice: lastItem.oldCashPrice,
    oldCreditPrice: lastItem.oldCreditPrice,
    quantity: lastItem.quantity,
    supplier: lastItem.supplier,
    stockLocation: lastItem.stockLocation,
    newCashPrice: lastItem.newCashPrice,
    newCreditPrice: lastItem.newCreditPrice,
    items,
    additionalMeasure: undefined,
    additionalProducts: undefined,
    updatedAt: Date.now(),
  };
  saveEntrySession(nextSession);
  await message.reply([
    '↩️ *PNEU ATUAL IGNORADO*',
    `Os *${items.length}* itens anteriores continuam na entrada.`,
    '',
    formatAdditionalDecisionQuestion(nextSession),
  ].join('\n'));
}

async function getResponsibleName(message: Message, fallback: string): Promise<string> {
  try {
    const contact = await message.getContact();
    return contact.pushname || contact.name || contact.number || fallback;
  } catch {
    return fallback;
  }
}
