import { Message } from 'whatsapp-web.js';
import { normalizeTireSize } from '../utils/normalizeTireSize.js';
import { saveLastQuery, QueriedProduct } from '../utils/lastQueryStore.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { clearAllOperationSessions } from '../utils/operationSessionCoordinator.js';
import { formatStockLocationLine, normalizeStockLocation } from '../utils/stockLocation.js';
import {
  findActiveProductsByReference,
  findAvailableProductsByReference,
  findSuggestedActiveReferences,
} from '../services/productService.js';
import env from '../config/env.js';

/**
 * Pneu Command - Fase 6 (Consulta real no banco)
 * 
 * Responsibilities:
 * - Detect a standalone tire size
 * - Normalize the tire size (175/70 R14 etc.)
 * - Return a numbered list of active matching products with stock
 * - Save the last query in memory for 5 minutes (per SPEC)
 * 
 * Does NOT start any sale/operation by itself.
 * Sale is handled by saleCommand.
 */

export function formatProductList(
  products: QueriedProduct[],
  normalized: string,
  showStockLocation?: boolean
): string {
  let text = `🛞 *${normalized}*\n\n`;
  const locationsEnabled = showStockLocation ?? env.inventoryLocationsEnabled;

  products.forEach((product, index) => {
    const num = index + 1;
    text += `${num}️⃣ *${product.description}*\n`;
    text += `📦 Estoque: *${product.stock}*\n`;
    if (locationsEnabled) {
      const stockLocationLine =
        formatStockLocationLine(product.stockLocation, true) ?? '📍 Local: *não cadastrado*';
      text += `${stockLocationLine}\n`;
    }
    text += `💰 À vista: *${formatCurrency(product.cashPrice)}*\n`;
    text += `💳 A prazo: *${formatCurrency(product.creditPrice)}*\n`;
    if (product.hasPhoto) text += '📷\n';

    if (index < products.length - 1) {
      text += '\n';
    }
  });

  if (
    locationsEnabled &&
    products.some((product) => !normalizeStockLocation(product.stockLocation))
  ) {
    text += '\n📍 Para cadastrar o local:\nlocal <número>\nExemplo: local 1';
  }

  return text;
}

export function isPneuHelpCommand(body: string): boolean {
  return /^(pneu|pneus)$/i.test(body.trim());
}

export function isPneuCommand(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized.startsWith('pneu ');
}

export async function handleLegacyPneuCommandNotice(message: Message): Promise<void> {
  await message.reply(
    'ℹ️ A consulta mudou. Agora, digite apenas a medida.\nEx.: *175 70 14*'
  );
}

/**
 * A standalone size is a shortcut for the existing "pneu <medida>" query.
 * Rely on the query normalizer so ordinary text is not mistaken for a lookup.
 */
export function isStandaloneTireSizeCommand(body: string): boolean {
  return normalizeTireSize(body) !== null;
}

export function isTireSizeLikeCommand(body: string): boolean {
  const value = body.trim().toUpperCase();
  if (!value || !/^[0-9.,/\-\sRXCL]+$/.test(value)) return false;
  return (value.match(/\d+(?:[.,]\d+)?/g) ?? []).length >= 2;
}

export function formatReferenceSuggestions(suggestions: string[]): string {
  if (suggestions.length === 0) return '';

  return [
    'Você quis dizer:',
    ...suggestions.map((reference) => `• *${reference}*`),
    '',
    'Digite novamente a medida correta.',
  ].join('\n');
}

export function formatResolvedReferenceNotice(
  normalized: string,
  products: QueriedProduct[]
): string {
  const references = [...new Set(products.map((product) => product.reference))];
  if (references.length === 0 || references.includes(normalized)) return '';

  if (references.length === 1) {
    return `🔎 Medida encontrada como: *${references[0]}*`;
  }

  return `🔎 Referências equivalentes: ${references
    .map((reference) => `*${reference}*`)
    .join(', ')}`;
}

function formatInvalidMeasure(suggestions: string[]): string {
  return [
    '❌ *MEDIDA INVÁLIDA*',
    '',
    'Use uma destas formas:',
    '*175/70 R14*',
    '*175 70 14*',
    '*175-70-14*',
    ...(suggestions.length > 0 ? ['', formatReferenceSuggestions(suggestions)] : []),
  ].join('\n');
}

export async function handlePneuHelpCommand(message: Message): Promise<void> {
  await message.reply(formatPneuHelp());
}

export function formatPneuHelp(
  inventoryLocationsEnabled = env.inventoryLocationsEnabled
): string {
  return [
    '🛞 *PNEUS — COMANDOS*',
    '',
    '🔎 *<medida>* — consultar pneus com estoque',
    'Ex.: *175 70 14*',
    '⚠️ *zero <medida>* — consultar somente os zerados',
    'Ex.: *zero 175 70 14*',
    '',
    'Após consultar, use o número do item:',
    '🛒 *venda 1 2* — vender 2 unidades',
    '📦 *entrada 1* — repor estoque',
    '🧮 *ajuste 1* — corrigir estoque',
    ...(inventoryLocationsEnabled
      ? [
          '📍 *local 1* — alterar localização',
        ]
      : []),
    '💰 *preco 1* — alterar preços',
    '📷 *foto 1* — ver foto',
    '➕ *addfoto 1* — adicionar/substituir foto',
    '',
    '_O número corresponde ao item da última consulta._',
  ].join('\n');
}

export async function handlePneuCommand(message: Message, rawMeasure: string): Promise<void> {
  const startedAt = Date.now();

  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearAllOperationSessions(userId, chatId);

  try {
    const normalized = normalizeTireSize(rawMeasure);

    if (!normalized) {
      const suggestions = await findSuggestedActiveReferences(rawMeasure);
      await message.reply(formatInvalidMeasure(suggestions));
      return;
    }

    const queryStartedAt = Date.now();
    const matches = await findAvailableProductsByReference(normalized);
    const queryMs = Date.now() - queryStartedAt;

    if (matches.length === 0) {
      const activeMatches = await findActiveProductsByReference(normalized);

      if (activeMatches.length > 0) {
        const totalStock = activeMatches.reduce((sum, product) => sum + product.stock, 0);
        const replyStartedAt = Date.now();
        const referenceNotice = formatResolvedReferenceNotice(normalized, activeMatches);
        const noticePrefix = referenceNotice ? `${referenceNotice}\n\n` : '';

        if (totalStock <= 0) {
          await message.reply(`${noticePrefix}📦 *${normalized}* — estoque *0*.`);
        } else {
          await message.reply(
            `${noticePrefix}⚠️ Nenhum pneu de *${normalized}* disponível.`
          );
        }

        const replyMs = Date.now() - replyStartedAt;
        console.log(
          `[PNEU] ${message.from} -> ${normalized} (0 disponíveis, ${activeMatches.length} ativos, estoque=${totalStock}) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
            Date.now() - startedAt
          }`
        );
        return;
      }

      const replyStartedAt = Date.now();
      const suggestions = await findSuggestedActiveReferences(rawMeasure);
      const suggestionText = formatReferenceSuggestions(suggestions);
      await message.reply(
        `🔎 Nenhum pneu encontrado para *${normalized}*.` +
          (suggestionText ? `\n\n${suggestionText}` : '')
      );
      const replyMs = Date.now() - replyStartedAt;
      console.log(
        `[PNEU] ${message.from} -> ${normalized} (0 produtos) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
          Date.now() - startedAt
        }`
      );
      return;
    }

    // Save last consultation (5 minute TTL) - required for indexed commands
    saveLastQuery(userId, chatId, normalized, matches);

    const referenceNotice = formatResolvedReferenceNotice(normalized, matches);
    const response =
      (referenceNotice ? `${referenceNotice}\n\n` : '') +
      formatProductList(matches, normalized);
    const replyStartedAt = Date.now();
    await message.reply(response);
    const replyMs = Date.now() - replyStartedAt;

    console.log(
      `[PNEU] ${message.from} -> ${normalized} (${matches.length} produtos) queryMs=${queryMs} replyMs=${replyMs} totalMs=${
        Date.now() - startedAt
      }`
    );
  } catch (error) {
    console.error('[PNEU] Error:', error);
    await message.reply('❌ *ERRO NA CONSULTA*\nTente novamente.');
  }
}
