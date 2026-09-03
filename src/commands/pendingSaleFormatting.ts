import type { PendingSaleWithDetails, ReturnedPendingSale } from '../services/pendingSaleService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getSaleItems } from '../utils/saleSessionHelpers.js';
import type { SaleSession } from '../utils/saleSessionStore.js';

export function formatPendingAssigneeQuestion(): string {
  return [
    '⏳ *RESPONSÁVEL PELA PENDÊNCIA*',
    '',
    'Marque *um funcionário* responsável por confirmar essa venda.',
    '',
    'Ex.: *@fulano*',
    '0️⃣ ❌ Cancelar',
  ].join('\n');
}

export function formatPendingSaleConfirmation(session: SaleSession): string {
  const items = getSaleItems(session);
  return [
    '⏳ *PENDÊNCIA — CONFIRMAR*',
    '',
    ...items.flatMap((item, index) => [
      `${index + 1}. 🛞 *${item.reference} — ${item.description}*`,
      `📤 Quantidade: *${item.quantity} un.* | 💰 *${formatCurrency(item.totalValue)}*`,
      ...(index < items.length - 1 ? [''] : []),
    ]),
    '',
    `👤 Responsável: *${session.pendingAssigneeName ?? session.pendingAssigneeId ?? 'não informado'}*`,
    `💰 Total previsto: *${formatCurrency(session.totalValue ?? 0)}*`,
    '',
    '⚠️ Ao confirmar, os pneus sairão do estoque e ficarão aguardando a confirmação de Monteiro.',
    '',
    '1️⃣ ✅ Confirmar',
    '2️⃣ ↩️ Voltar',
    '0️⃣ ❌ Cancelar',
  ].join('\n');
}

export function formatPendingSaleRegistered(pendingSale: PendingSaleWithDetails): string {
  return [
    '✅ *PENDÊNCIA REGISTRADA*',
    '',
    ...formatPendingItems(pendingSale, true),
    '',
    `👤 Responsável: *${pendingSale.assignedTo.name}*`,
    `💰 Total previsto: *${formatCurrency(Number(pendingSale.totalValue))}*`,
    '📦 Os pneus já saíram do estoque.',
    '',
    'Para conferir depois, digite: *pendente*',
  ].join('\n');
}

export function formatPendingSaleList(pendingSales: PendingSaleWithDetails[]): string {
  if (pendingSales.length === 0) {
    return '✅ *PENDÊNCIAS*\nNenhuma venda pendente no momento.';
  }

  const lines = ['⏳ *PENDÊNCIAS DE VENDA*', ''];
  let lastAssigneeId = '';
  pendingSales.forEach((pendingSale, index) => {
    if (pendingSale.assignedUserId !== lastAssigneeId) {
      if (lastAssigneeId) lines.push('');
      lines.push(`👤 *${pendingSale.assignedTo.name}*`);
      lastAssigneeId = pendingSale.assignedUserId;
    }
    lines.push(`${formatOptionNumber(index + 1)} ${formatPendingItemSummary(pendingSale)}`);
    lines.push(`   💰 *${formatCurrency(Number(pendingSale.totalValue))}* | desde ${formatDate(pendingSale.createdAt)}`);
  });
  lines.push('', 'Digite o *número* da pendência que deseja conferir.', '0️⃣ ❌ Cancelar');
  return lines.join('\n');
}

export function formatPendingStatusQuestion(pendingSale: PendingSaleWithDetails): string {
  return [
    '💵 *SITUAÇÃO DA PENDÊNCIA*',
    '',
    `👤 Responsável: *${pendingSale.assignedTo.name}*`,
    ...formatPendingItems(pendingSale, false),
    '',
    '*O que aconteceu com esses pneus?*',
    '',
    '1️⃣ ✅ Foram vendidos',
    '2️⃣ 📍 Ainda estão em Monteiro',
    '3️⃣ ↩️ Voltaram para o estoque',
    '0️⃣ ❌ Cancelar',
  ].join('\n');
}

export function formatPendingKeptOpen(pendingSale: PendingSaleWithDetails): string {
  return [
    '📍 *PENDÊNCIA MANTIDA*',
    '',
    `${formatPendingItemSummary(pendingSale)} ainda está em Monteiro.`,
    'O estoque permanece reservado e os lembretes continuarão normalmente.',
  ].join('\n');
}

export function formatPendingReturned(result: ReturnedPendingSale): string {
  return [
    '↩️ *PENDÊNCIA ENCERRADA*',
    '',
    ...result.pendingSale.items.flatMap((item) => {
      const stock = result.stocks.find((entry) => entry.productId === item.productId)?.currentStock;
      return [
        `🛞 *${item.reference} — ${item.description}*`,
        `📥 Retorno: *${item.quantity} un.* | 📦 Estoque: *${stock ?? 'atualizado'}*`,
      ];
    }),
    '',
    'Motivo: pneus não vendidos e devolvidos ao estoque.',
  ].join('\n');
}

export function formatPendingReminder(pendingSales: PendingSaleWithDetails[]): string {
  const assignees = uniqueAssignees(pendingSales);
  return [
    '⏳ *LEMBRETE DE PENDÊNCIAS*',
    '',
    assignees.map((assignee) => mentionToken(assignee.phone)).join(' '),
    '',
    `Existem *${pendingSales.length} ${pendingSales.length === 1 ? 'venda em aberto' : 'vendas em aberto'}* aguardando confirmação.`,
    ...pendingSales.map((pendingSale, index) =>
      `${formatOptionNumber(index + 1)} *${pendingSale.assignedTo.name}* — ${formatPendingItemSummary(pendingSale)}`
    ),
    '',
    'Para informar se vendeu ou devolveu, digite: *pendente*',
  ].join('\n');
}

export function getPendingMentionIds(pendingSales: PendingSaleWithDetails[]): string[] {
  return uniqueAssignees(pendingSales).map((assignee) => assignee.phone);
}

function formatPendingItems(pendingSale: PendingSaleWithDetails, showStock: boolean): string[] {
  return pendingSale.items.flatMap((item, index) => [
    `${index + 1}. 🛞 *${item.reference} — ${item.description}*`,
    `📤 Quantidade: *${item.quantity} un.*${showStock ? ` | 📦 Estoque: *${item.reservedStock}*` : ''}`,
    ...(index < pendingSale.items.length - 1 ? [''] : []),
  ]);
}

function formatPendingItemSummary(pendingSale: PendingSaleWithDetails): string {
  return pendingSale.items
    .map((item) => `${item.quantity}x ${item.reference} — ${item.description}`)
    .join(' | ');
}

function uniqueAssignees(pendingSales: PendingSaleWithDetails[]): Array<{ phone: string }> {
  return [...new Map(
    pendingSales.map((pendingSale) => [pendingSale.assignedTo.phone, { phone: pendingSale.assignedTo.phone }])
  ).values()];
}

function mentionToken(phone: string): string {
  const user = phone.split('@', 1)[0]?.split(':', 1)[0] || phone;
  return `@${user}`;
}

function formatOptionNumber(value: number): string {
  const keycaps: Record<number, string> = {
    1: '1️⃣', 2: '2️⃣', 3: '3️⃣', 4: '4️⃣', 5: '5️⃣',
    6: '6️⃣', 7: '7️⃣', 8: '8️⃣', 9: '9️⃣', 10: '🔟',
  };
  return keycaps[value] ?? `${value}.`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
