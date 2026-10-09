import { ProductCategory } from '@prisma/client';
import type { Message } from 'whatsapp-web.js';
import { prisma } from '../database/prisma.js';
import { formatProductList, formatProductChoiceQuestion } from './pneuCommand.js';
import { saveLastQuery, type QueriedProduct } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { clearAllOperationSessions } from '../utils/operationSessionCoordinator.js';
import { clearMenuSession } from '../utils/menuSessionStore.js';
import { saveProductActionSession } from '../utils/productActionSessionStore.js';
import { hasProductImageFile } from '../services/productPhotoStorage.js';

export function parseInnerTubeCommand(body: string): ProductCategory | null {
  const normalized = body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'camara') return ProductCategory.INNER_TUBE;
  if (normalized === 'camara mt') return ProductCategory.MOTORCYCLE_INNER_TUBE;
  return null;
}

export function formatInnerTubeList(products: QueriedProduct[], category: ProductCategory, zeroStock = false): string {
  const title = category === ProductCategory.MOTORCYCLE_INNER_TUBE ? 'CÂMARAS DE AR — MOTOS' : 'CÂMARAS DE AR — CARROS E AGRÍCOLAS';
  return formatProductList(products, `${title}${zeroStock ? ' — ESTOQUE ZERO' : ''}`).replace(/^🛞/, '⭕');
}

export async function handleInnerTubeCommand(message: Message, body: string, zeroStock = false): Promise<void> {
  const category = parseInnerTubeCommand(body);
  if (!category) return;
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearAllOperationSessions(userId, chatId);
  clearMenuSession(userId, chatId);
  try {
    const rows = await prisma.product.findMany({
      where: { category, isActive: true, stock: zeroStock ? { lte: 0 } : { gt: 0 } },
      orderBy: [{ reference: 'asc' }, { description: 'asc' }],
    });
    const products: QueriedProduct[] = rows.map(row => ({ ...row, cashPrice: Number(row.cashPrice), creditPrice: Number(row.creditPrice), hasPhoto: hasProductImageFile(row.imagePath) }));
    if (!products.length) {
      await message.reply(zeroStock ? '✅ Nenhuma câmara desta categoria está zerada.' : '📦 Nenhuma câmara desta categoria disponível em estoque.');
      return;
    }
    saveLastQuery(userId, chatId, body, products);
    await message.reply(formatInnerTubeList(products, category, zeroStock));
    saveProductActionSession(userId, chatId, 'awaiting_product', undefined, zeroStock ? 'zero_stock' : undefined);
    await message.reply(formatProductChoiceQuestion(category));
  } catch (error) {
    console.error('[INNER TUBE]', error);
    await message.reply('❌ Erro na consulta de câmaras de ar. Tente novamente.');
  }
}
