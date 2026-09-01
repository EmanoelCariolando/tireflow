import type { RegisteredEntry } from '../services/entryService.js';
import { formatBinaryOptions } from '../utils/binaryResponse.js';
import type { EntryItem, EntrySession } from '../utils/entrySessionStore.js';
import {
  buildCurrentEntryItem,
  getEntryItems,
} from '../utils/entrySessionHelpers.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { formatMovementNumberMessage } from '../utils/movementMessageVisibility.js';
import { formatOperationConfirmation } from '../utils/operationResponse.js';
import { formatStockLocationQuestion } from '../utils/operationPrompts.js';
import { formatProductChoiceQuestion } from './pneuCommand.js';

export function formatAdditionalEntryProductChoiceQuestion(): string {
  return formatProductChoiceQuestion();
}

export function formatAdditionalEntryHelp(): string {
  return [
    '🔎 *NÃO ACHOU O PNEU NA LISTA?*',
    '',
    '➕ *Cadastrar esta medida*',
    'Digite *cadastro*.',
    'O pneu será cadastrado e adicionado automaticamente à nota.',
    '',
    '🔄 *Pesquisar outra medida*',
    'Digite a nova medida diretamente ou envie *voltar*.',
    'Ex.: *175 70 13*',
  ].join('\n');
}

export function formatAdditionalDecisionQuestion(session: EntrySession): string {
  return [
    '➕ *QUER ADICIONAR MAIS ALGUM PNEU?*',
    '',
    `Itens preparados: *${getEntryItems(session).length}*`,
    '',
    formatBinaryOptions(),
  ].join('\n');
}

export function formatPriceDecisionQuestion(): string {
  return `💰 *VOCÊ QUER ALTERAR O PREÇO?*\n${formatBinaryOptions()}`;
}

export function formatInvoiceNumberQuestion(): string {
  return '📋 *NÚMERO DA NOTA*\nnúmero da nota fiscal:';
}

export function formatEntryLocationQuestion(): string {
  return formatStockLocationQuestion();
}

export function formatEntryConfirmation(session: EntrySession): string {
  const items = getEntryItems(session);
  const invoiceLine = formatEntryInvoiceLine(session);
  if (items.length > 1) {
    return formatOperationConfirmation('📦 *ENTRADA — CONFIRMAR*', [
      formatCompactEntryItemLines(items),
      [...(invoiceLine ? [invoiceLine] : []), `📦 Total de itens: *${items.length}*`],
    ]);
  }

  const item = items[0] ?? buildCurrentEntryItem(session);
  if (!item) {
    return 'Ocorreu um erro na sessão da entrada. Faça a consulta novamente.';
  }

  const prices =
    item.newCashPrice !== undefined && item.newCreditPrice !== undefined
      ? `💰 À vista: ${formatCurrency(item.oldCashPrice)} → *${formatCurrency(item.newCashPrice)}* | 💳 A prazo: ${formatCurrency(item.oldCreditPrice)} → *${formatCurrency(item.newCreditPrice)}*`
      : `💰 À vista: *${formatCurrency(item.oldCashPrice)}* | 💳 A prazo: *${formatCurrency(item.oldCreditPrice)}*`;

  return formatOperationConfirmation('📦 *ENTRADA — CONFIRMAR*', [
    [
      `🛞 *${item.reference} — ${item.description}*`,
      `📥 Quantidade: *+${item.quantity}*`,
    ],
    formatEntrySupplierAndInvoiceLines(item, session),
    [prices],
    ...(item.stockLocation ? [[`📍 Local: *${item.stockLocation}*`]] : []),
  ]);
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
      formatEntryInvoiceLine(session),
      items,
      responsibleName,
      registeredItems,
      false
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
    ...formatOptionalEntryInvoiceLine(session),
    ...(item.newCashPrice !== undefined && item.newCreditPrice !== undefined
      ? [
          '',
          `💰 À vista: ${formatCurrency(item.oldCashPrice)} → *${formatCurrency(item.newCashPrice)}*`,
          `💳 A prazo: ${formatCurrency(item.oldCreditPrice)} → *${formatCurrency(item.newCreditPrice)}*`,
        ]
      : []),
    '',
    ...formatMovementNumberMessage(`🧾 Movimentação: *${registered.movementCode}*`),
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

export function formatBossEntryNotification(
  session: EntrySession,
  responsibleName: string,
  registeredItems: RegisteredEntry[]
): string {
  const items = getEntryItems(session);
  if (items.length > 1) {
    return formatRegisteredEntryItems(
      '📦 *NOVAS ENTRADAS*',
      formatEntryInvoiceLine(session),
      items,
      responsibleName,
      registeredItems,
      true
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
    ...formatOptionalEntryInvoiceLine(session),
    ...(item.newCashPrice !== undefined && item.newCreditPrice !== undefined
      ? [
          '',
          `💰 À vista: ${formatCurrency(item.oldCashPrice)} → *${formatCurrency(item.newCashPrice)}*`,
          `💳 A prazo: ${formatCurrency(item.oldCreditPrice)} → *${formatCurrency(item.newCreditPrice)}*`,
        ]
      : []),
    ...formatEntryLocationChange(registered),
    '',
    ...formatMovementNumberMessage(`🧾 Movimentação: *${registered.movementCode}*`),
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatCompactEntryItemLines(items: EntryItem[]): string[] {
  return items.flatMap((item, index) => formatCompactEntryItem(item, index));
}

function formatCompactEntryItem(
  item: EntryItem,
  index: number,
  includeLocation = true
): string[] {
  const itemHeader = `${index + 1}. *${item.reference} — ${item.description}*`;

  if (item.newCashPrice !== undefined && item.newCreditPrice !== undefined) {
    return [
      itemHeader,
      `📥 Adicionou: *+${item.quantity}* | 💰 À vista: ${formatCurrency(item.newCashPrice)}`,
      `📃 A prazo: ${formatCurrency(item.newCreditPrice)}`,
      ...(includeLocation && item.stockLocation ? [`📍 Local: *${item.stockLocation}*`] : []),
    ];
  }

  return [
    itemHeader,
    `📥 Adicionou: *+${item.quantity}* | 🏷️ sem alteração`,
    ...(includeLocation && item.stockLocation ? [`📍 Local: *${item.stockLocation}*`] : []),
  ];
}

function formatEntrySupplierAndInvoiceLines(
  item: EntryItem,
  session: Pick<EntrySession, 'invoiceName' | 'invoiceNumber'>
): string[] {
  return [
    [
      `🚚 Fornecedor: *${item.supplier}*`,
      ...(session.invoiceNumber ? [`📃 Número da nota: *${session.invoiceNumber}*`] : []),
    ].join(' | '),
    ...(session.invoiceName ? [`🧾 Nome da nota: *${session.invoiceName}*`] : []),
  ];
}

function formatRegisteredEntryItems(
  title: string,
  invoiceLine: string | null,
  items: EntryItem[],
  responsibleName: string,
  registeredItems: RegisteredEntry[],
  includeLocationChange: boolean
): string {
  const lines = items.flatMap((item, index) => {
    const registered = registeredItems[index];
    return [
      ...formatCompactEntryItem(item, index, false),
      ...(includeLocationChange && registered ? formatEntryLocationChange(registered) : []),
      ...formatMovementNumberMessage(
        `📦 Estoque atual: *${registered?.currentStock ?? '?'}* | 🧾 *${registered?.movementCode ?? '?'}*`,
        `📦 Estoque atual: *${registered?.currentStock ?? '?'}*`
      ),
    ];
  });

  return [
    title,
    '',
    ...lines,
    '',
    ...(invoiceLine ? [invoiceLine] : []),
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

function formatEntryInvoiceLine(
  session: Pick<EntrySession, 'invoiceName' | 'invoiceNumber'>
): string | null {
  if (session.invoiceName && session.invoiceNumber) {
    return `🧾 Nota: *${session.invoiceName}* | Nº: *${session.invoiceNumber}*`;
  }

  if (session.invoiceNumber) {
    return `🧾 Nº da nota: *${session.invoiceNumber}*`;
  }

  return session.invoiceName ? `🧾 Nome da nota: *${session.invoiceName}*` : null;
}

function formatOptionalEntryInvoiceLine(
  session: Pick<EntrySession, 'invoiceName' | 'invoiceNumber'>
): string[] {
  const line = formatEntryInvoiceLine(session);
  return line ? [line] : [];
}

function formatEntryLocationChange(registered: RegisteredEntry): string[] {
  if (!registered.currentLocation) return [];

  const location =
    registered.previousLocation && registered.previousLocation !== registered.currentLocation
      ? `${registered.previousLocation} → ${registered.currentLocation}`
      : registered.currentLocation;

  return ['', `📍 Local: *${location}*`];
}
