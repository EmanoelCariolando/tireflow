import { Message } from 'whatsapp-web.js';
import { getLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import {
  clearEntrySession,
  EntryItem,
  EntrySession,
  getEntrySession,
  hasExpiredEntrySession,
  saveEntrySession,
} from '../utils/entrySessionStore.js';
import { clearAllOperationSessions, hasActiveOperationSession } from '../utils/operationSessionCoordinator.js';
import { runPostCommitTask } from '../services/postCommitTask.js';
import {
  EntryProductNotFoundError,
  registerEntryItems,
  RegisteredEntry,
} from '../services/entryService.js';
import { sendBossNotification } from '../services/notificationService.js';
import { isCancellationResponse, isConfirmationResponse } from '../utils/operationResponse.js';
import { calculateCreditPrice } from '../utils/productPricing.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import { findActiveProductsByReference } from '../services/productService.js';
import { formatProductList } from './pneuCommand.js';

const ENTRY_COMMAND_REGEX = /^entrada\s+(\d+)$/i;
const MAX_ENTRY_ITEMS = 20;

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

  await message.reply('📦 *ENTRADA — QUANTIDADE*\n\nDigite apenas o número.\nEx.: *20*');
}

export async function handleEntryConversation(message: Message, body: string): Promise<boolean> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);

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

  if (session.step === 'awaiting_quantity') {
    await handleQuantityStep(message, session, normalizedBody);
    return true;
  }

  if (session.step === 'awaiting_supplier') {
    await handleSupplierStep(message, session, body);
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

async function handleQuantityStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  const quantity = Number(normalizedBody);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    await message.reply('❌ Quantidade inválida. Digite um inteiro positivo. Ex.: *20*');
    return;
  }

  saveEntrySession({
    ...session,
    step: 'awaiting_supplier',
    quantity,
    updatedAt: Date.now(),
  });

  await message.reply('🚚 *ENTRADA — FORNECEDOR*\n\nInforme o fornecedor.\nEx.: *ABC Pneus*');
}

async function handleSupplierStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const supplier = body.trim();

  if (!supplier) {
    await message.reply('❌ Informe o fornecedor. Ex.: *ABC Pneus*');
    return;
  }

  const nextSession: EntrySession = {
    ...session,
    step: 'awaiting_price_decision',
    supplier,
    updatedAt: Date.now(),
  };

  saveEntrySession(nextSession);
  await message.reply(
    '💰 *VOCÊ QUER ALTERAR O PREÇO?*\nDigite *s* ou *n*.'
  );
}

async function handlePriceDecisionStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  if (/^(s|sim)$/i.test(normalizedBody)) {
    saveEntrySession({
      ...session,
      step: 'awaiting_cash_price',
      updatedAt: Date.now(),
    });
    await message.reply(
      '💰 *DIGITE O PREÇO À VISTA*\nEx.: *275,00*\n_O preço a prazo (+5,8%) será calculado automaticamente._'
    );
    return;
  }

  if (/^(n|n[aã]o)$/i.test(normalizedBody)) {
    const nextSession: EntrySession = {
      ...session,
      step: 'awaiting_additional_decision',
      updatedAt: Date.now(),
    };
    await finishCurrentItemAndAskForAnother(message, nextSession);
    return;
  }

  await message.reply('❌ Resposta inválida. Digite apenas *s* ou *n*.');
}

async function handleCashPriceStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const cashPrice = parsePriceValue(body);

  if (cashPrice === null) {
    await message.reply('❌ Preço inválido. Digite um valor maior ou igual a zero. Ex.: *275,00*');
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
  if (/^(s|sim)$/i.test(normalizedBody)) {
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
    await message.reply(formatAdditionalMeasureQuestion(session));
    return;
  }

  if (/^(n|n[aã]o)$/i.test(normalizedBody)) {
    const nextSession: EntrySession = {
      ...session,
      step: 'awaiting_confirmation',
      updatedAt: Date.now(),
    };
    saveEntrySession(nextSession);
    await message.reply(formatEntryConfirmation(nextSession));
    return;
  }

  await message.reply('❌ Resposta inválida. Digite apenas *s* ou *n*.');
}

async function handleAdditionalMeasureStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const rawMeasure = body.trim().replace(/^pneu\s+/i, '');
  const normalizedMeasure = normalizeTireSize(rawMeasure);

  if (!normalizedMeasure) {
    await message.reply('❌ Medida inválida. Digite somente a medida. Ex.: *275 80 22.5*');
    return;
  }

  try {
    const products = await findActiveProductsByReference(normalizedMeasure);

    if (products.length === 0) {
      await message.reply(
        `Nenhum pneu encontrado para *${normalizedMeasure}*.\nDigite outra medida ou *cancelar*.`
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
    await message.reply([
      formatProductList(products, normalizedMeasure),
      '',
      'Para adicionar, digite: *entrada <número>*',
      'Ex.: *entrada 1*',
    ].join('\n'));
  } catch (error) {
    console.error('[ENTRY] Error searching an additional tire:', error);
    await message.reply('Ocorreu um erro ao buscar a medida. Tente novamente ou digite *cancelar*.');
  }
}

async function handleAdditionalItemStep(
  message: Message,
  session: EntrySession,
  body: string
): Promise<void> {
  const optionNumber = parseAdditionalItemSelection(body);

  if (optionNumber === null) {
    await message.reply('❌ Opção inválida. Use: *entrada 1*');
    return;
  }

  const product = session.additionalProducts?.[optionNumber - 1];
  if (!product) {
    await message.reply('❌ Item inválido. Use um número da lista mostrada.');
    return;
  }

  saveEntrySession({
    ...session,
    step: 'awaiting_quantity',
    productId: product.id,
    reference: product.reference || session.additionalMeasure || '',
    description: product.description,
    oldCashPrice: product.cashPrice,
    oldCreditPrice: product.creditPrice,
    quantity: undefined,
    supplier: undefined,
    newCashPrice: undefined,
    newCreditPrice: undefined,
    additionalMeasure: undefined,
    additionalProducts: undefined,
    updatedAt: Date.now(),
  });
  await message.reply('📦 *NOVO PNEU — QUANTIDADE*\n\nQuantos pneus chegaram?\nEx.: *20*');
}

async function handleConfirmationStep(
  message: Message,
  session: EntrySession,
  normalizedBody: string
): Promise<void> {
  if (!isConfirmationResponse(normalizedBody)) {
    await message.reply('Responda: *confirmar* ou *cancelar*.');
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
        newCashPrice: item.newCashPrice,
      })),
      responsiblePhone: session.userId,
      responsibleName,
    });
    registeredItems = registeredGroup.items;
  } catch (error) {
    clearEntrySession(session.userId, session.chatId);

    if (error instanceof EntryProductNotFoundError) {
      await message.reply('⚠️ Produto não está mais disponível. Faça uma nova consulta.');
      return;
    }

    console.error('[ENTRY] Error registering entry:', error);
    await message.reply('Ocorreu um erro ao registrar a entrada. Tente novamente.');
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

function isNewOperationCommand(normalizedBody: string): boolean {
  return /^(venda|entrada|ajuste|pre[cç]o|local)\b/i.test(normalizedBody);
}

function parseAdditionalItemSelection(value: string): number | null {
  const match = value.trim().match(/^(?:entrada\s+)?(\d+)$/i);
  if (!match) {
    return null;
  }

  const optionNumber = Number(match[1]);
  return Number.isInteger(optionNumber) && optionNumber > 0 ? optionNumber : null;
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

function buildCurrentEntryItem(session: EntrySession): EntryItem | null {
  if (!session.quantity || !session.supplier) {
    return null;
  }

  return {
    productId: session.productId,
    reference: session.reference,
    description: session.description,
    oldCashPrice: session.oldCashPrice,
    oldCreditPrice: session.oldCreditPrice,
    quantity: session.quantity,
    supplier: session.supplier,
    newCashPrice: session.newCashPrice,
    newCreditPrice: session.newCreditPrice,
  };
}

function getExplicitEntryItems(session: EntrySession): EntryItem[] {
  return session.items?.map((item) => ({ ...item })) ?? [];
}

function getEntryItems(session: EntrySession): EntryItem[] {
  const items = getExplicitEntryItems(session);
  if (items.length > 0) {
    return items;
  }

  const currentItem = buildCurrentEntryItem(session);
  return currentItem ? [currentItem] : [];
}

function formatAdditionalDecisionQuestion(session: EntrySession): string {
  return [
    '➕ *QUER ADICIONAR MAIS ALGUM PNEU?*',
    '',
    `Itens preparados: *${getEntryItems(session).length}*`,
    '',
    'Responda: *s* ou *n*.',
  ].join('\n');
}

function formatAdditionalMeasureQuestion(session: EntrySession): string {
  return [
    '➕ *ADICIONAR PNEU*',
    '',
    `Itens preparados: *${getEntryItems(session).length}*`,
    'Digite a medida. Ex.: *275 80 22.5*',
  ].join('\n');
}

export function formatEntryConfirmation(session: EntrySession): string {
  const items = getEntryItems(session);
  if (items.length > 1) {
    return [
      '📦 *ENTRADA — CONFIRMAR*',
      '',
      ...formatCompactEntryItemLines(items),
      '',
      `📦 Total de itens: *${items.length}*`,
      'Responda: *confirmar* ou *cancelar*.',
    ].join('\n');
  }

  const item = items[0] ?? buildCurrentEntryItem(session);
  if (!item) {
    return 'Ocorreu um erro na sessão da entrada. Faça a consulta novamente.';
  }

  return [
    '📦 *ENTRADA — CONFIRMAR*',
    '',
    `🛞 *${item.reference} — ${item.description}*`,
    '',
    `📥 Quantidade: *+${item.quantity}*`,
    `🚚 Fornecedor: *${item.supplier}*`,
    ...(item.newCashPrice !== undefined && item.newCreditPrice !== undefined
      ? [
          '',
          `💰 À vista: ${formatCurrency(item.oldCashPrice)} → *${formatCurrency(item.newCashPrice)}*`,
          `💳 A prazo (+5,8%): ${formatCurrency(item.oldCreditPrice)} → *${formatCurrency(item.newCreditPrice)}*`,
        ]
      : ['', '🏷️ Preços: *sem alteração*']),
    '',
    'Responda: *confirmar* ou *cancelar*.',
  ].join('\n');
}

export function formatRegisteredEntry(
  session: EntrySession,
  responsibleName: string,
  registeredItems: RegisteredEntry[]
): string {
  const items = getEntryItems(session);
  if (items.length > 1) {
    return formatRegisteredEntryItems(
      '✅ *ENTRADAS REGISTRADAS*',
      items,
      responsibleName,
      registeredItems
    );
  }

  const item = items[0]!;
  const registered = registeredItems[0]!;
  return [
    '✅ *ENTRADA REGISTRADA*',
    '',
    `🛞 *${item.reference} — ${item.description}*`,
    '',
    `📥 Entrada: *+${item.quantity}*`,
    `📦 Estoque atual: *${registered.currentStock}*`,
    `🚚 Fornecedor: *${item.supplier}*`,
    ...(item.newCashPrice !== undefined && item.newCreditPrice !== undefined
      ? [
          '',
          `💰 À vista: ${formatCurrency(item.oldCashPrice)} → *${formatCurrency(item.newCashPrice)}*`,
          `💳 A prazo: ${formatCurrency(item.oldCreditPrice)} → *${formatCurrency(item.newCreditPrice)}*`,
        ]
      : []),
    '',
    `🧾 Movimentação: *${registered.movementCode}*`,
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatBossEntryNotification(
  session: EntrySession,
  responsibleName: string,
  registeredItems: RegisteredEntry[]
): string {
  const items = getEntryItems(session);
  if (items.length > 1) {
    return formatRegisteredEntryItems(
      '📦 *NOVAS ENTRADAS*',
      items,
      responsibleName,
      registeredItems
    );
  }

  const item = items[0]!;
  const registered = registeredItems[0]!;
  return [
    '📦 *NOVA ENTRADA*',
    '',
    `🛞 *${item.reference} — ${item.description}*`,
    '',
    `📥 Entrada: *+${item.quantity}*`,
    `📦 Estoque atual: *${registered.currentStock}*`,
    `🚚 Fornecedor: *${item.supplier}*`,
    ...(item.newCashPrice !== undefined && item.newCreditPrice !== undefined
      ? [
          '',
          `💰 À vista: ${formatCurrency(item.oldCashPrice)} → *${formatCurrency(item.newCashPrice)}*`,
          `💳 A prazo: ${formatCurrency(item.oldCreditPrice)} → *${formatCurrency(item.newCreditPrice)}*`,
        ]
      : []),
    '',
    `🧾 Movimentação: *${registered.movementCode}*`,
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatCompactEntryItemLines(items: EntryItem[]): string[] {
  return items.flatMap((item, index) => formatCompactEntryItem(item, index));
}

function formatCompactEntryItem(item: EntryItem, index: number): string[] {
  const itemHeader = `${index + 1}. *${item.reference} — ${item.description}*`;

  if (item.newCashPrice !== undefined && item.newCreditPrice !== undefined) {
    return [
      itemHeader,
      `📥 Adicionou: *+${item.quantity}* | 💰 À vista: ${formatCurrency(item.newCashPrice)}`,
      `📃 A prazo: ${formatCurrency(item.newCreditPrice)}`,
    ];
  }

  return [
    itemHeader,
    `📥 Adicionou: *+${item.quantity}* | 🏷️ sem alteração`,
  ];
}

function formatRegisteredEntryItems(
  title: string,
  items: EntryItem[],
  responsibleName: string,
  registeredItems: RegisteredEntry[]
): string {
  const lines = items.flatMap((item, index) => {
    const registered = registeredItems[index];
    return [
      ...formatCompactEntryItem(item, index),
      `📦 Estoque atual: *${registered?.currentStock ?? '?'}* | 🧾 *${registered?.movementCode ?? '?'}*`,
    ];
  });

  return [
    title,
    '',
    ...lines,
    '',
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
