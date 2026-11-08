import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Message } from 'whatsapp-web.js';

test('commission follows the final negotiated sale and preserves historical rates and session quotes', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(path.dirname(process.cwd()), path.resolve(os.tmpdir()));
  const root = await mkdtemp(path.join(os.tmpdir(), 'tireflow-financial-commission-'));
  const database = path.join(root, 'test.sqlite');
  await writeFile(database, '');
  process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: process.env, stdio: 'pipe',
  });
  const { prisma } = await import('../src/database/prisma.js');
  const { registerSaleItems } = await import('../src/services/saleService.js');
  const { registerPendingSale } = await import('../src/services/pendingSaleService.js');
  const { registerPriceChange } = await import('../src/services/priceService.js');
  const { saveLastQuery } = await import('../src/utils/lastQueryStore.js');
  const { handleSaleCommand, handleSaleConversation } = await import('../src/commands/saleCommand.js');
  const { getSaleSession } = await import('../src/utils/saleSessionStore.js');
  let nextId = 0;
  const makeProduct = () => prisma.product.create({ data: {
    reference: '175/70 R14', description: `SYNTHETIC ${++nextId}`, stock: 10,
    cashPrice: 100, creditPrice: 105.8, tenInstallmentPrice: 149.99,
  } });
  const seller = { sellerPhone: 'synthetic-seller', sellerName: 'Synthetic' };
  try {
    const original = await makeProduct();
    await registerSaleItems({ ...seller, paymentMethod: 'Dinheiro', totalValue: 100,
      items: [{ productId: original.id, quantity: 1, unitPrice: 100, totalValue: 100 }] });
    const historical = await prisma.movement.findMany({ where: { type: 'SALE', productId: original.id } });

    for (const pending of [false, true]) {
      for (const [total, discountPercent, expectedRate] of [
        [100, undefined, 2], [90, 10, 1], [90, undefined, 1], [120, undefined, 2], [108, 10, 1],
      ] as const) {
        await t.test(`${pending ? 'pending' : 'normal'} total=${total} explicitDiscount=${discountPercent ?? 0} rate=${expectedRate}`, async () => {
          const product = await makeProduct();
          const reservation = pending ? await registerPendingSale({
            items: [{ productId: product.id, reference: product.reference, description: product.description,
              quantity: 1, cashPrice: 100, creditPrice: 105.8, tenInstallmentPrice: 149.99,
              priceType: 'À vista', unitPrice: 100, totalValue: 100 }],
            createdByPhone: seller.sellerPhone, createdByName: seller.sellerName,
            assignedPhone: seller.sellerPhone, assignedName: seller.sellerName, totalValue: 100,
          }) : undefined;
          if (pending) await registerPriceChange({ productId: product.id,
            responsiblePhone: 'synthetic-price-user', responsibleName: 'Synthetic',
            oldCashPrice: 100, oldCreditPrice: 105.8, newCashPrice: 200 });
          const beforeProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
          await registerSaleItems({ ...seller, paymentMethod: 'Dinheiro', totalValue: total,
            items: [{ productId: product.id, quantity: 1, unitPrice: total, totalValue: total }],
            pendingSaleId: reservation?.id, allowPendingPriceChange: pending,
            originalTotalValue: discountPercent ? total / 0.9 : !pending && total < 100 ? 100 : undefined,
            discountPercent });
          const sale = await prisma.movement.findFirstOrThrow({ where: { type: 'SALE', productId: product.id } });
          assert.equal(Number(sale.totalValue), total);
          assert.equal(Number(sale.commissionPercent), expectedRate);
          assert.equal(Number(sale.totalValue) * Number(sale.commissionPercent) / 100, total * expectedRate / 100);
          const afterProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
          assert.equal(Number(afterProduct.cashPrice), Number(beforeProduct.cashPrice));
          assert.equal(Number(afterProduct.tenInstallmentPrice), Number(beforeProduct.tenInstallmentPrice));
        });
      }
    }

    for (const category of ['BATTERY', 'INNER_TUBE', 'MOTORCYCLE_INNER_TUBE', 'TIRE_FLAP'] as const) {
      await t.test(`category ${category} preserves its 1% exception`, async () => {
        const product = await makeProduct();
        await prisma.product.update({ where: { id: product.id }, data: { category } });
        await registerSaleItems({ ...seller, paymentMethod: 'Dinheiro', totalValue: 100,
          items: [{ productId: product.id, quantity: 1, unitPrice: 100, totalValue: 100 }] });
        const sale = await prisma.movement.findFirstOrThrow({ where: { type: 'SALE', productId: product.id } });
        assert.equal(Number(sale.commissionPercent), 1);
      });
    }
    for (const [repricedTotal, finalTotal, discountPercent, expectedRate] of [
      [95, 95, undefined, 1], [100, 100, undefined, 2], [105, 105, undefined, 2], [95, 85.50, 10, 1],
    ] as const) {
      await t.test(`a previously discounted pending sale repriced to ${repricedTotal}, final ${finalTotal}, keeps the authoritative quote`, async () => {
        const product = await makeProduct();
        const pending = await registerPendingSale({ createdByPhone: seller.sellerPhone, createdByName: seller.sellerName,
          assignedPhone: seller.sellerPhone, assignedName: seller.sellerName,
          totalValue: 90, originalTotalValue: 100, discountPercent: 10,
          items: [{ productId: product.id, reference: product.reference, description: product.description,
            quantity: 1, cashPrice: 100, creditPrice: 105.8, tenInstallmentPrice: 149.99,
            priceType: 'À vista', unitPrice: 90, totalValue: 90 }] });
        await registerSaleItems({ ...seller, operationId: `synthetic-pending-discount-${repricedTotal}-${finalTotal}`,
          pendingSaleId: pending.id, allowPendingPriceChange: true, paymentMethod: 'Dinheiro',
          totalValue: finalTotal, originalTotalValue: discountPercent ? repricedTotal : undefined, discountPercent,
          items: [{ productId: product.id, quantity: 1, unitPrice: finalTotal, totalValue: finalTotal }] });
        const sale = await prisma.movement.findFirstOrThrow({ where: { type: 'SALE', productId: product.id } });
        assert.equal(Number(sale.commissionPercent), expectedRate);
        assert.equal(Number(sale.totalValue), finalTotal);
        assert.equal(Number((await prisma.pendingSale.findUniqueOrThrow({ where: { id: pending.id } })).originalTotalValue), 100);
        const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
        assert.equal(Number(unchanged.cashPrice), 100);
        assert.equal(Number(unchanged.tenInstallmentPrice), 149.99);
      });
    }
    await t.test('a no-commission note remains exempt even with a discount', async () => {
      const product = await makeProduct();
      await registerSaleItems({ ...seller, paymentMethod: 'Nota', isCityHallSale: true,
        totalValue: 90, discountPercent: 10,
        items: [{ productId: product.id, quantity: 1, unitPrice: 90, totalValue: 90 }] });
      assert.equal(Number((await prisma.movement.findFirstOrThrow({ where: { type: 'SALE', productId: product.id } })).commissionPercent), 0);
    });

    for (const [selection, quotedPrice] of [['1', 100], ['2', 105.8], ['3', 149.99]] as const) {
      await t.test(`the confirmed price option ${selection} preserves the session quote`, async () => {
        const product = await makeProduct();
        const userId = `558300000000${selection}@c.us`;
        const chatId = '120363000000001@g.us';
        const replies: string[] = [];
        const message = { author: userId, from: chatId, getContact: async () => ({ pushname: 'Synthetic' }),
          reply: async (text: string) => { replies.push(text); },
        } as unknown as Message;
        saveLastQuery(userId, chatId, product.reference, [{ id: product.id, reference: product.reference,
          description: product.description, stock: product.stock, cashPrice: 100, creditPrice: 105.8, tenInstallmentPrice: 149.99 }]);
        await handleSaleCommand(message, 'venda 1 1');
        await handleSaleConversation(message, selection);
        await registerPriceChange({ productId: product.id, responsiblePhone: 'synthetic-price-user',
          responsibleName: 'Synthetic', oldCashPrice: 100, oldCreditPrice: 105.8, newCashPrice: 200 });
        await handleSaleConversation(message, '1');
        await handleSaleConversation(message, 'confirmar');
        assert.equal(getSaleSession(userId, chatId), null);
        const sale = await prisma.movement.findFirstOrThrow({ where: { type: 'SALE', productId: product.id } });
        assert.equal(Number(sale.unitPrice), quotedPrice);
        assert.equal(Number(sale.totalValue), quotedPrice);
        assert.equal(Number(sale.commissionPercent), 2, 'A protected quote is not a negotiated discount.');
        const currentProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
        assert.equal(Number(currentProduct.cashPrice), 200);
        assert.equal(Number(currentProduct.tenInstallmentPrice), 218.40);
        assert.ok(replies.some(text => text.includes('VENDA REGISTRADA')));
      });
    }
    assert.deepEqual(await prisma.movement.findMany({ where: { type: 'SALE', productId: original.id } }), historical);
  } finally {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});
