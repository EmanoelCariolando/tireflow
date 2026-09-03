import env from '../config/env.js';
import { type RegisteredSaleItem, calculateSaleTotal } from '../services/saleService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { formatMovementNumberMessage } from '../utils/movementMessageVisibility.js';
import { formatBinaryOptions } from '../utils/binaryResponse.js';
import { formatOperationConfirmation } from '../utils/operationResponse.js';
import type {
  MixedPaymentMethod,
  ReceiptPaymentMethod,
  SaleItem,
  SaleSession,
} from '../utils/saleSessionStore.js';
import {
  getExplicitSaleItems,
  getSaleItems,
  hasSaleDiscount,
} from '../utils/saleSessionHelpers.js';
import { TRANSFER_PAYMENT_ENABLED } from './saleParsers.js';

export const MIXED_PAYMENT_MENU = [
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

export function formatPaymentMenu(session?: SaleSession): string {
  const discountApplied = Boolean(
    session && hasSaleDiscount(session) && session.totalValue !== undefined
  );
  const selectedPrice = Boolean(session?.priceType && session.totalValue !== undefined);
  const items = session ? getSaleItems(session) : [];
  const multipleItems = items.length > 1;
  const resolvingPendingSale = Boolean(session?.pendingSaleId);
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
    ...(!resolvingPendingSale
      ? [
          `6️⃣ *Desconto*${discountApplied ? ' ✅' : ''}`,
          '7️⃣ *Adicionar outro pneu*',
          '8️⃣ *Pendência*',
          ...(TRANSFER_PAYMENT_ENABLED ? ['9️⃣ *Transferência*'] : []),
        ]
      : []),
  ].join('\n');
}

export function formatDiscountMenu(): string {
  return [
    '🏷️ *DESCONTO*',
    '1️⃣ *Desconto %*',
    '2️⃣ *Desconto R$*',
    '0️⃣ Voltar',
  ].join('\n');
}

export function formatDiscountValueQuestion(
  discountType: 'percent' | 'amount',
  originalTotal?: number
): string {
  if (discountType === 'percent') {
    return [
      '🏷️ *DESCONTO EM %*',
      '*Quantos % deseja retirar?*',
      '',
      'Ex.: *5*',
      '0️⃣ Voltar',
    ].join('\n');
  }

  return [
    '🏷️ *DESCONTO EM R$*',
    '*Quantos reais deseja retirar?*',
    ...(originalTotal !== undefined
      ? [`O valor deve ser menor que *${formatCurrency(originalTotal)}*.`]
      : []),
    '',
    'Ex.: *50,00*',
    '0️⃣ Voltar',
  ].join('\n');
}

export function formatPriceTypeQuestion(session: SaleSession): string {
  return [
    ...(getExplicitSaleItems(session).length > 0 ? ['➕ *NOVO ITEM*'] : []),
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
    '💵 *Comissão*',
    '*Essa Nota Tem Comissão?*',
    formatBinaryOptions(),
  ].join('\n');
}

export function formatTransferCityQuestion(): string {
  return ['📍 *Cidade*', '*Para Qual Cidade Vai esse Pneu?*'].join('\n');
}

function formatTransferLines(session: SaleSession): string[] {
  if (!session.isTransferSale || !session.transferCity) {
    return [];
  }

  return ['Transferência: *Sim*', `Cidade: *${session.transferCity}*`];
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

export function formatDiscountPreview(session: SaleSession): string {
  const originalTotal = session.originalTotalValue ?? 0;
  const discountValue = originalTotal - (session.totalValue ?? 0);
  return formatOperationConfirmation('🏷️ *DESCONTO — CONFIRMAR*', [
    [formatDiscountSummary(session, discountValue)],
    [`💰 Total: ${formatCurrency(originalTotal)} → *${formatCurrency(session.totalValue ?? 0)}*`],
  ]);
}

function formatDiscountSummary(session: SaleSession, discountValue: number): string {
  return session.discountPercent
    ? `🏷️ Desconto: *${session.discountPercent}%* | Economia: *${formatCurrency(discountValue)}*`
    : `🏷️ Desconto: *${formatCurrency(discountValue)}*`;
}

export function formatSaleConfirmation(session: SaleSession): string {
  const items = getSaleItems(session);
  if (items.length > 1) {
    return formatOperationConfirmation('🧾 *VENDA — CONFIRMAR*', [
      formatConfirmationSaleItemLines(items),
      [
        ...formatCompactPaymentLines(session),
        ...formatDiscountLines(session),
        ...formatTransferLines(session),
        ...formatInvoiceLines(session),
      ],
      [`💰 Total: *${formatCurrency(session.totalValue ?? 0)}*`],
    ]);
  }

  return formatOperationConfirmation('🧾 *VENDA — CONFIRMAR*', [
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
  ]);
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
    ...formatPendingOriginLines(session),
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
    ...formatPendingOriginLines(session),
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
    ...formatPendingOriginLines(session),
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
    .find((item) => item.productId === productId)?.currentStock;
}

export function formatMixedAmountQuestion(paymentMethod: MixedPaymentMethod): string {
  return [
    '💳 *PAGAMENTO MISTO*',
    '',
    `Quanto foi pago em *${paymentMethod}*?`,
    'Ex.: 100,00',
  ].join('\n');
}

export function formatReceiptRequest(
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

export function formatMethodForSentence(paymentMethod: ReceiptPaymentMethod): string {
  return paymentMethod === 'PIX' ? 'PIX' : paymentMethod.toLowerCase();
}

export function isCashReceiptRequired(branchName = env.branchName): boolean {
  return /\bMONTEIRO\b/i.test(branchName);
}

export function isPaymentReceiptRequired(
  paymentMethod: ReceiptPaymentMethod,
  branchName = env.branchName
): boolean {
  return paymentMethod !== 'Dinheiro' || isCashReceiptRequired(branchName);
}

export function formatMissingReceiptMessage(paymentMethod: ReceiptPaymentMethod): string {
  if (paymentMethod === 'Dinheiro') {
    return '📎 Envie a foto do *depósito/dinheiro* para continuar.';
  }
  return '📎 Envie a *nota/comprovante* para continuar.';
}

function formatPaymentLines(session: SaleSession): string[] {
  if (session.paymentMethod !== 'Misto') {
    return [`Pagamento: *${session.paymentMethod}*${formatPriceTypeSuffix(session)}`];
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
  if (hasSaleDiscount(session)) {
    return `*${session.quantity} ${quantityLabel}*`;
  }
  return `*${session.quantity} ${quantityLabel}* × ${formatCurrency(session.unitPrice ?? 0)}`;
}

function formatPriceTypeSuffix(session: SaleSession): string {
  const priceType = getDisplayedPriceType(session);
  return priceType ? ` | Valor: *${priceType}*` : '';
}

function getDisplayedPriceType(session: SaleSession): string | undefined {
  const itemPriceTypes = [...new Set(getExplicitSaleItems(session).map((item) => item.priceType))];

  if (itemPriceTypes.length > 1) {
    return 'Misto (acordo com cada item)';
  }

  return itemPriceTypes[0] ?? session.priceType;
}

function formatDiscountLines(session: SaleSession): string[] {
  if (
    !hasSaleDiscount(session) ||
    session.originalTotalValue === undefined ||
    session.totalValue === undefined
  ) {
    return [];
  }

  const discountValue = session.originalTotalValue - session.totalValue;
  return [
    `Valor original: ${formatCurrency(session.originalTotalValue)}`,
    session.discountPercent
      ? `*Desconto: ${session.discountPercent}%* (-${formatCurrency(discountValue)})`
      : `*Desconto: ${formatCurrency(discountValue)}*`,
  ];
}

function formatPendingOriginLines(session: SaleSession): string[] {
  return session.wasPending ? ['⏳ _Estava pendente_'] : [];
}
