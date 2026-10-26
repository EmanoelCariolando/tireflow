import { ProductCategory } from '@prisma/client';
import type { Message } from 'whatsapp-web.js';
import { prisma } from '../database/prisma.js';
import { formatProductList, formatProductChoiceQuestion } from './pneuCommand.js';
import { clearLastQuery, saveLastQuery, type QueriedProduct } from '../utils/lastQueryStore.js';
import { getMessageChatId, getMessageUserId } from '../utils/messageContext.js';
import { clearAllOperationSessions } from '../utils/operationSessionCoordinator.js';
import { clearMenuSession } from '../utils/menuSessionStore.js';
import { saveProductActionSession } from '../utils/productActionSessionStore.js';
import { hasProductImageFile } from '../services/productPhotoStorage.js';

export function isTireFlapCommand(body: string): boolean {
  return /^protetor$/i.test(body.trim());
}

export async function handleTireFlapCommand(message: Message, zeroStock = false): Promise<void> {
  const userId = getMessageUserId(message), chatId = getMessageChatId(message);
  clearLastQuery(userId, chatId);
  clearAllOperationSessions(userId, chatId);
  clearMenuSession(userId, chatId);
  try {
    const rows = await prisma.product.findMany({
      where: { category: ProductCategory.TIRE_FLAP, isActive: true, stock: zeroStock ? { lte: 0 } : { gt: 0 } },
      orderBy: [{ reference: 'asc' }, { description: 'asc' }],
    });
    const products: QueriedProduct[] = rows.map(row => ({ ...row, cashPrice: Number(row.cashPrice),
      creditPrice: Number(row.creditPrice), tenInstallmentPrice: row.tenInstallmentPrice == null ? null : Number(row.tenInstallmentPrice),
      hasPhoto: hasProductImageFile(row.imagePath) }));
    if (!products.length) {
      await message.reply(zeroStock ? '✅ Nenhum protetor está zerado.' : '📦 Nenhum protetor disponível em estoque.');
      return;
    }
    saveLastQuery(userId, chatId, 'protetor', products);
    await message.reply(formatProductList(products, `PROTETORES${zeroStock ? ' — ESTOQUE ZERO' : ''}`).replace(/^🛞/, '🛡️'));
    saveProductActionSession(userId, chatId, 'awaiting_product', undefined, zeroStock ? 'zero_stock' : undefined);
    await message.reply(formatProductChoiceQuestion(ProductCategory.TIRE_FLAP));
  } catch (error) {
    clearLastQuery(userId, chatId);
    console.error('[TIRE FLAP]', error);
    await message.reply('❌ Erro na consulta de protetores. Tente novamente.');
  }
}
