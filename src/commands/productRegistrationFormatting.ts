import env from '../config/env.js';
import { formatBinaryOptions } from '../utils/binaryResponse.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { formatMovementNumberMessage } from '../utils/movementMessageVisibility.js';
import { formatOperationConfirmation } from '../utils/operationResponse.js';
import {
  formatQuantityQuestion,
  formatStockLocationQuestion,
} from '../utils/operationPrompts.js';
import type { ProductRegistrationSession } from '../utils/productRegistrationSessionStore.js';

export function formatProductRegistrationConfirmation(
  session: ProductRegistrationSession
): string {
  return formatOperationConfirmation(
    session.origin === 'entry'
      ? '🧾 *CADASTRO NA NOTA — CONFIRMAR*'
      : '🧾 *CADASTRO — CONFIRMAR*',
    [
      [
        `🛞 *${session.reference} — ${session.description}*`,
        session.origin === 'entry'
          ? `📥 Quantidade na nota: *+${session.initialStock}*`
          : `📦 Estoque inicial: *${session.initialStock}*`,
      ],
      ...(session.origin !== 'entry' && session.initialStock
        ? [[`🚚 Fornecedor: *${session.supplier}*`]]
        : []),
      [
        `💰 À vista: *${formatCurrency(session.cashPrice ?? 0)}* | 💳 A prazo: *${formatCurrency(session.creditPrice ?? 0)}*`,
      ],
      ...(env.inventoryLocationsEnabled
        ? [[`📍 Local: *${session.stockLocation ?? 'não cadastrado'}*`]]
        : []),
    ]
  );
}

export function formatProductRegistrationLocationQuestion(canSkip = true): string {
  return formatStockLocationQuestion(canSkip);
}

export function formatProductMeasureQuestion(): string {
  return ['🆕 *MEDIDA*', '*Digite a medida:*'].join('\n');
}

export function formatProductDescriptionQuestion(reference: string): string {
  if (reference === 'RODA') {
    return [
      '🏷️ *CADASTRO — DESCRIÇÃO DA RODA*',
      'Informe modelo, quantidade de furos e medida.',
      'Ex.: *275 8 FUROS (22.5X7.50)*',
    ].join('\n');
  }

  return [
    '🏷️*MARCA DO PNEU*',
    '*Informe marca/modelo:*',
    '',
    'Ex.: PIRELLI MT60 TRASEIRO 60P',
  ].join('\n');
}

export function formatProductQuantityQuestion(
  reference: string | undefined,
  origin?: ProductRegistrationSession['origin']
): string {
  if (origin === 'entry') {
    return reference === 'RODA'
      ? '📦 *QUANTIDADE NA NOTA*\nQuantas rodas serão adicionadas?'
      : '📦 *QUANTIDADE NA NOTA*\nQuantos pneus serão adicionados?';
  }

  if (reference === 'RODA') {
    return '📦 *QUANTIDADE*\nQuantas rodas?';
  }

  return formatQuantityQuestion();
}

export function formatEntryProductRegistered(session: ProductRegistrationSession): string {
  return [
    '✅ *PNEU CADASTRADO E ADICIONADO À NOTA*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    `📥 Quantidade: *+${session.initialStock}*`,
    `💰 À vista: *${formatCurrency(session.cashPrice ?? 0)}* | 💳 A prazo: *${formatCurrency(session.creditPrice ?? 0)}*`,
    ...(env.inventoryLocationsEnabled && session.stockLocation
      ? [`📍 Local: *${session.stockLocation}*`]
      : []),
  ].join('\n');
}

export function formatBossEntryProductRegistrationNotification(
  session: ProductRegistrationSession,
  responsibleName: string
): string {
  return [
    '🆕 *NOVO PNEU CADASTRADO DURANTE UMA ENTRADA*',
    '',
    `🛞 *${session.reference} — ${session.description}*`,
    `📥 Quantidade preparada na nota: *+${session.initialStock}*`,
    `💰 À vista: *${formatCurrency(session.cashPrice ?? 0)}*`,
    `💳 A prazo: *${formatCurrency(session.creditPrice ?? 0)}*`,
    ...(env.inventoryLocationsEnabled && session.stockLocation
      ? [`📍 Local: *${session.stockLocation}*`]
      : []),
    '',
    `👤 Responsável: *${responsibleName}*`,
  ].join('\n');
}

export function formatRegisteredProduct(
  session: ProductRegistrationSession,
  movementCode: string | null,
  registeredProductCount: number
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
      ? [
          '',
          'ℹ️ O pneu foi cadastrado, mas a consulta informará estoque zero até que seja feita uma entrada.',
        ]
      : []),
    '',
    formatAdditionalProductRegistrationQuestion(registeredProductCount),
  ].join('\n');
}

export function formatAdditionalProductRegistrationQuestion(
  registeredProductCount: number
): string {
  return [
    '➕ *QUER ADICIONAR MAIS ALGUM PNEU?*',
    '',
    `Itens preparados: *${registeredProductCount}*`,
    '',
    formatBinaryOptions(),
  ].join('\n');
}

export function formatProductRegistrationFinished(registeredProductCount: number): string {
  return [
    '✅ *CADASTRO FINALIZADO*',
    `Pneus cadastrados: *${registeredProductCount}*`,
  ].join('\n');
}

export function formatBossProductRegistrationNotification(
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
