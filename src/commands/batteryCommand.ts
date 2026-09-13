import { BatteryBrand, ProductCategory } from '@prisma/client';
import type { Message } from 'whatsapp-web.js';
import env from '../config/env.js';
import {
  findActiveBatteries,
  parseBatterySearchQuery,
} from '../services/batteryService.js';
import { isMessageFromGroupAdmin } from '../services/groupAdminService.js';
import { formatCurrency } from '../utils/formatCurrency.js';
import type { QueriedProduct } from '../utils/lastQueryStore.js';
import { saveLastQuery } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { clearMenuSession } from '../utils/menuSessionStore.js';
import { clearAllOperationSessions } from '../utils/operationSessionCoordinator.js';
import { saveProductActionSession } from '../utils/productActionSessionStore.js';
import { formatStockLocationLine, normalizeStockLocation } from '../utils/stockLocation.js';
import { formatProductChoiceQuestion } from './pneuCommand.js';

export { isBatterySearchCommand } from '../services/batteryService.js';

const BATTERY_HELP = [
  '🔋 *CONSULTAR BATERIA*',
  '',
  'Pesquise pela amperagem:',
  '*bateria 60*',
].join('\n');

function formatBatteryBrand(brand: BatteryBrand | null | undefined): string {
  if (brand === BatteryBrand.MOURA) return 'MOURA';
  if (brand === BatteryBrand.ZETTA) return 'ZETTA';
  return 'MARCA NÃO INFORMADA';
}

export function formatBatteryList(
  products: QueriedProduct[],
  queryLabel: string,
  zeroStock = false,
  showStockLocation = env.inventoryLocationsEnabled,
  showLocationRegistrationHint = showStockLocation
): string {
  const totalLabel = products.length === 1 ? '1 modelo' : `${products.length} modelos`;
  let text = zeroStock
    ? `🔋 *BATERIAS — ${queryLabel}*\n\n⚠️ *ESTOQUE ZERO — ${totalLabel}*\n`
    : `🔋 *BATERIAS — ${queryLabel}*\n\n`;

  products.forEach((product, index) => {
    text += `\n${index + 1}️⃣ *${formatBatteryBrand(product.batteryBrand)} — ${product.reference}*\n`;
    text += `📝 ${product.description}\n`;
    text += `📦 Estoque: *${product.stock}*\n`;
    if (showStockLocation) {
      const location =
        formatStockLocationLine(product.stockLocation, true) ?? '📍 Local: *não cadastrado*';
      text += `${location}\n`;
    }
    text += `💰 À vista: *${formatCurrency(product.cashPrice)}*\n`;
    text += `💳 A prazo: *${formatCurrency(product.creditPrice)}*`;
    if (product.hasPhoto) text += '\n📷';
    if (index < products.length - 1) text += '\n';
  });

  if (
    showLocationRegistrationHint &&
    showStockLocation &&
    products.some((product) => !normalizeStockLocation(product.stockLocation))
  ) {
    text += '\n📍 Para cadastrar o local:\nlocal <número>\nExemplo: local 1';
  }

  return text;
}

export async function handleBatteryCommand(message: Message, body: string): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearAllOperationSessions(userId, chatId);
  const query = parseBatterySearchQuery(body);

  if (!query || (!query.brand && query.terms.length === 0)) {
    await message.reply(BATTERY_HELP);
    return;
  }

  try {
    const activeProducts = await findActiveBatteries(query);
    const availableProducts = activeProducts.filter((product) => product.stock > 0);
    if (availableProducts.length === 0) {
      await message.reply(
        activeProducts.length > 0
          ? `📦 Bateria *${query.label}* cadastrada, mas com estoque *0*.`
          : `🔎 Nenhuma bateria encontrada para *${query.label}*.\n\n${BATTERY_HELP}`
      );
      return;
    }

    saveLastQuery(userId, chatId, query.label, availableProducts);
    const canUseAdminActions = await isMessageFromGroupAdmin(message);
    await message.reply(
      formatBatteryList(
        availableProducts,
        query.label,
        false,
        env.inventoryLocationsEnabled,
        canUseAdminActions
      )
    );
    clearMenuSession(userId, chatId);
    saveProductActionSession(userId, chatId, 'awaiting_product');
    await message.reply(formatProductChoiceQuestion(ProductCategory.BATTERY));
  } catch (error) {
    console.error('[BATTERY] Error:', error);
    await message.reply('❌ *ERRO NA CONSULTA DE BATERIA*\nTente novamente.');
  }
}

export async function handleZeroStockBatteryCommand(
  message: Message,
  body: string
): Promise<void> {
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearAllOperationSessions(userId, chatId);
  const query = parseBatterySearchQuery(body);

  if (!query || (!query.brand && query.terms.length === 0)) {
    await message.reply(`❌ Consulta inválida.\n\n${BATTERY_HELP}`);
    return;
  }

  try {
    const products = (await findActiveBatteries(query)).filter((product) => product.stock <= 0);
    if (products.length === 0) {
      await message.reply(`✅ Nenhuma bateria *${query.label}* está zerada.`);
      return;
    }

    saveLastQuery(userId, chatId, query.label, products);
    clearMenuSession(userId, chatId);
    await message.reply(formatBatteryList(products, query.label, true));
    saveProductActionSession(userId, chatId, 'awaiting_product', undefined, 'zero_stock');
    await message.reply(formatProductChoiceQuestion(ProductCategory.BATTERY));
  } catch (error) {
    console.error('[ZERO BATTERY STOCK] Error:', error);
    await message.reply('❌ *ERRO NA CONSULTA DE BATERIA*\nTente novamente.');
  }
}
