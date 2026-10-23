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

export function parseRetreadedTireCommand(body: string): ProductCategory | null {
  const normalized = body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'coberto') return ProductCategory.RETREADED_TIRE;
  if (normalized === 'coberto mt') return ProductCategory.MOTORCYCLE_RETREADED_TIRE;
  return null;
}

export function formatRetreadedTireList(products: QueriedProduct[], category: ProductCategory, zeroStock = false): string {
  const title = category === ProductCategory.MOTORCYCLE_RETREADED_TIRE ? 'PNEUS COBERTOS — MOTOS' : 'PNEUS COBERTOS — CARROS E MÁQUINAS';
  return formatProductList(products, `${title}${zeroStock ? ' — ESTOQUE ZERO' : ''}`);
}

export async function handleRetreadedTireCommand(message: Message, body: string, zeroStock = false): Promise<void> {
  const category = parseRetreadedTireCommand(body);
  if (!category) return;
  const userId = getMessageUserId(message);
  const chatId = getMessageChatId(message);
  clearLastQuery(userId, chatId);
  clearAllOperationSessions(userId, chatId);
  clearMenuSession(userId, chatId);
  try {
    const rows = await prisma.product.findMany({
      where: { category, isActive: true, stock: zeroStock ? { lte: 0 } : { gt: 0 } },
      orderBy: [{ reference: 'asc' }, { description: 'asc' }],
    });
    const products: QueriedProduct[] = rows.map(row => ({ ...row, cashPrice: Number(row.cashPrice), creditPrice: Number(row.creditPrice), tenInstallmentPrice: row.tenInstallmentPrice == null ? null : Number(row.tenInstallmentPrice), hasPhoto: hasProductImageFile(row.imagePath) }));
    if (!products.length) {
      await message.reply(zeroStock ? '✅ Nenhum pneu coberto desta categoria está zerado.' : '📦 Nenhum pneu coberto desta categoria disponível em estoque.');
      return;
    }
    saveLastQuery(userId, chatId, body, products);
    await message.reply(formatRetreadedTireList(products, category, zeroStock));
    saveProductActionSession(userId, chatId, 'awaiting_product', undefined, zeroStock ? 'zero_stock' : undefined);
    await message.reply(formatProductChoiceQuestion(category));
  } catch (error) {
    clearLastQuery(userId, chatId);
    console.error('[RETREADED TIRE]', error);
    await message.reply('❌ Erro na consulta de pneus cobertos. Tente novamente.');
  }
}
