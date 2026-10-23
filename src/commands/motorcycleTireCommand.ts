import { ProductCategory } from '@prisma/client';
import type { Message } from 'whatsapp-web.js';
import { productRepository } from '../repositories/productRepository.js';
import { hasProductImageFile } from '../services/productPhotoStorage.js';
import { clearAllOperationSessions } from '../utils/operationSessionCoordinator.js';
import { clearMenuSession } from '../utils/menuSessionStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { clearLastQuery, saveLastQuery, type QueriedProduct } from '../utils/lastQueryStore.js';
import { saveProductActionSession } from '../utils/productActionSessionStore.js';
import { formatProductChoiceQuestion, formatProductList } from './pneuCommand.js';

export interface MotorcycleTireQuery {
  rim: number;
  zeroStock: boolean;
}

export function parseMotorcycleTireCommand(body: string): MotorcycleTireQuery | null {
  const match = body.trim().toLowerCase().replace(/\s+/g, ' ').match(/^(0\s+)?mt\s+(\d{1,2})$/);
  if (!match) return null;

  const rim = Number(match[2]);
  if (!Number.isSafeInteger(rim) || rim <= 0) return null;

  return { rim, zeroStock: Boolean(match[1]) };
}

export function getMotorcycleTireRim(reference: string): number | null {
  const match = reference.trim().toUpperCase().replace(/,/g, '.').match(/(?:R|[-/])\s*(\d{1,2})(?:\.\d+)?C?$/);
  if (!match) return null;
  const rim = Number(match[1]);
  return Number.isSafeInteger(rim) && rim > 0 ? rim : null;
}

export async function handleMotorcycleTireCommand(
  message: Message,
  body: string
): Promise<void> {
  const query = parseMotorcycleTireCommand(body);
  if (!query) return;

  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearLastQuery(userId, chatId);
  clearAllOperationSessions(userId, chatId);
  clearMenuSession(userId, chatId);

  try {
    const rows = await productRepository.findActiveMotorcycleTires(query.zeroStock);
    const products: QueriedProduct[] = rows
      .filter((row) => getMotorcycleTireRim(row.reference) === query.rim)
      .map((row) => ({
        ...row,
        cashPrice: Number(row.cashPrice),
        creditPrice: Number(row.creditPrice),
        tenInstallmentPrice:
          row.tenInstallmentPrice == null ? null : Number(row.tenInstallmentPrice),
        hasPhoto: hasProductImageFile(row.imagePath),
      }));

    if (products.length === 0) {
      await message.reply(
        query.zeroStock
          ? `✅ Nenhum pneu de moto aro *${query.rim}* está zerado.`
          : `📦 Nenhum pneu de moto aro *${query.rim}* disponível em estoque.`
      );
      return;
    }

    const title = `PNEUS DE MOTO — ARO ${query.rim}${query.zeroStock ? ' — ESTOQUE ZERO' : ''}`;
    saveLastQuery(userId, chatId, `mt ${query.rim}`, products);
    await message.reply(formatProductList(products, title));
    saveProductActionSession(
      userId,
      chatId,
      'awaiting_product',
      undefined,
      query.zeroStock ? 'zero_stock' : undefined
    );
    await message.reply(formatProductChoiceQuestion(ProductCategory.MOTORCYCLE_TIRE));
  } catch (error) {
    clearLastQuery(userId, chatId);
    console.error('[MOTORCYCLE TIRE]', error);
    await message.reply('❌ Erro na consulta de pneus de moto. Tente novamente.');
  }
}
