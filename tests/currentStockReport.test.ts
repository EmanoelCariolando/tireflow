import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { ProductCategory } from '@prisma/client';
import type { Message, MessageMedia } from 'whatsapp-web.js';
import { productRepository } from '../src/repositories/productRepository.js';
import { movementRepository } from '../src/repositories/movementRepository.js';
import { buildCurrentStockReportPdf, buildInventoryReportPdf } from '../src/services/monthlyReportService.js';
import { handleCurrentStockReportCommand, handleMonthlyInventoryReportConversation } from '../src/commands/monthlyInventoryReportCommand.js';
import { getMonthlyInventoryReportSession, clearMonthlyInventoryReportSession } from '../src/utils/monthlyInventoryReportSessionStore.js';
import { handleMenuCommand, handleMenuSelection } from '../src/commands/menuCommand.js';

function pdfText(buffer: Buffer): string {
  return [...buffer.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1'))
    .flatMap((stream) => [...stream.matchAll(/\[([^\]]+)\] TJ/g)]
      .map((line) => [...line[1]!.matchAll(/<([0-9a-f]+)>/gi)]
        .map((hex) => Buffer.from(hex[1]!, 'hex').toString('latin1')).join('')))
    .join('\n');
}

test('stock PDF reads current tires without consulting movement history; monthly PDF never queries current stock', async (t) => {
  t.mock.method(movementRepository, 'findByDateRange', async () => { throw new Error('History unavailable'); });
  t.mock.method(productRepository, 'findActiveWithPositiveStock', async () => [
    { id: 't', category: ProductCategory.TIRE, reference: '175/70 R14', description: 'PNEU TESTE ATUAL', stock: 7, stockLocation: null },
    { id: 'b', category: ProductCategory.BATTERY, reference: '60AH', description: 'BATERIA EXCLUIDA', stock: 3, stockLocation: null },
  ]);
  const stock = await buildCurrentStockReportPdf(new Date(2026, 8, 28, 18));
  const text = pdfText(stock.pdfBuffer);
  assert.match(text, /PNEU TESTE ATUAL/);
  assert.doesNotMatch(text, /BATERIA EXCLUIDA|MAIS VENDIDOS|ZERARAM NO/);
  assert.equal(stock.pdfFileName, 'pneus-estoque-atual-2026-09-28.pdf');
  t.mock.restoreAll();
  t.mock.method(productRepository, 'findActiveWithPositiveStock', async () => { throw new Error('Must not load stock'); });
  t.mock.method(movementRepository, 'findByDateRange', async () => []);
  const monthly = await buildInventoryReportPdf({ start: new Date(2026, 8, 1), end: new Date(2026, 8, 29), key: 'test' });
  assert.match(pdfText(monthly.pdfBuffer), /MAIS VENDIDOS/);
  assert.doesNotMatch(pdfText(monthly.pdfBuffer), /CONTADO|PNEUS EM ESTOQUE ATUAL/);
});

test('menu stock option skips dates, supports retry, sends PDF and clears session', async () => {
  const replies: unknown[] = [];
  const message = { author: 'stock-user', from: 'stock-group@g.us', reply: async (content: unknown) => { replies.push(content); } } as unknown as Message;
  let attempts = 0;
  const dependencies = {
    now: () => new Date(2026, 8, 28),
    buildReport: async () => { throw new Error('Monthly builder must not run'); },
    buildStockReport: async () => {
      if (++attempts === 1) throw new Error('Temporary failure');
      return { pdfBuffer: Buffer.from('%PDF-test'), pdfFileName: 'estoque.pdf' };
    },
    createPdfMedia: () => ({ mimetype: 'application/pdf' }) as MessageMedia,
  };
  try {
    await handleMenuCommand(message);
    await handleMenuSelection(message, '6');
    assert.equal(getMonthlyInventoryReportSession(message.author!, message.from)?.mode, 'stock');
    assert.doesNotMatch(String(replies.at(-1)), /DATA INICIAL|Escolher período/);
    await handleMonthlyInventoryReportConversation(message, '1', dependencies);
    assert.equal(getMonthlyInventoryReportSession(message.author!, message.from)?.step, 'awaiting_confirmation');
    await handleMonthlyInventoryReportConversation(message, '1', dependencies);
    assert.deepEqual(replies.at(-1), { mimetype: 'application/pdf' });
    assert.equal(getMonthlyInventoryReportSession(message.author!, message.from), null);
    await handleCurrentStockReportCommand(message);
    await handleMonthlyInventoryReportConversation(message, '0', dependencies);
    assert.equal(attempts, 2);
    assert.equal(getMonthlyInventoryReportSession(message.author!, message.from), null);
  } finally {
    clearMonthlyInventoryReportSession(message.author!, message.from);
  }
});
