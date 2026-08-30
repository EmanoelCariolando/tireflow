import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('creates new products atomically, records initial stock and blocks equivalent duplicates', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'tireflow-product-registration-'));
  const databasePath = path.join(temporaryRoot, 'registration.db');
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  await writeFile(databasePath, '');
  const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  process.env.DATABASE_URL = databaseUrl;

  const { prisma } = await import('../src/database/prisma.js');
  const {
    ProductAlreadyExistsError,
    registerNewProduct,
  } = await import('../src/services/productRegistrationService.js');

  try {
    const registeredWithStock = await registerNewProduct({
      reference: '18.4/30',
      description: 'ALLIANCE AGRI NOVA 14 LONAS',
      initialStock: 2,
      supplier: 'JTR Pneus',
      cashPrice: 4600,
      stockLocation: 'W3',
      responsiblePhone: 'registration-user',
      responsibleName: 'Registration User',
    });

    const productWithStock = await prisma.product.findUniqueOrThrow({
      where: { id: registeredWithStock.productId },
    });
    assert.equal(productWithStock.reference, '18.4/30');
    assert.equal(productWithStock.description, 'ALLIANCE AGRI NOVA 14 LONAS');
    assert.equal(productWithStock.stock, 2);
    assert.equal(productWithStock.minStock, 0);
    assert.equal(productWithStock.stockLocation, 'W3');
    assert.equal(Number(productWithStock.cashPrice), 4600);
    assert.equal(Number(productWithStock.creditPrice), 4866.8);
    assert.match(registeredWithStock.movementCode ?? '', /^#E-\d{6}$/);

    const initialEntry = await prisma.movement.findUniqueOrThrow({
      where: { code: registeredWithStock.movementCode! },
    });
    assert.equal(initialEntry.type, 'ENTRY');
    assert.equal(initialEntry.quantity, 2);
    assert.equal(initialEntry.previousStock, 0);
    assert.equal(initialEntry.newStock, 2);
    assert.equal(initialEntry.supplier, 'JTR Pneus');

    const registeredWithoutStock = await registerNewProduct({
      reference: '110/90 R17',
      description: 'PIRELLI MT60 TRASEIRO 60P',
      initialStock: 0,
      cashPrice: 500,
      responsiblePhone: 'registration-user',
      responsibleName: 'Registration User',
    });
    assert.equal(registeredWithoutStock.movementCode, null);
    assert.equal(
      (await prisma.product.findUniqueOrThrow({ where: { id: registeredWithoutStock.productId } }))
        .stock,
      0
    );
    assert.equal(await prisma.movement.count(), 1);

    await assert.rejects(
      registerNewProduct({
        reference: '18.4-30',
        description: 'ALLIANCE AGRI NOVA 14 LONAS',
        initialStock: 5,
        supplier: 'Outro fornecedor',
        cashPrice: 4700,
        responsiblePhone: 'other-user',
        responsibleName: 'Other User',
      }),
      ProductAlreadyExistsError
    );
    assert.equal(await prisma.product.count(), 2);
    assert.equal(await prisma.movement.count(), 1);

    const {
      handleProductRegistrationConversation,
      handleProductRegistrationStart,
    } = await import('../src/commands/productRegistrationCommand.js');
    const { handleEntryConversation } = await import('../src/commands/entryCommand.js');
    const {
      clearEntrySession,
      getEntrySession,
      saveEntrySession,
    } = await import('../src/utils/entrySessionStore.js');
    const {
      clearProductRegistrationSession,
      getProductRegistrationSession,
    } = await import('../src/utils/productRegistrationSessionStore.js');
    const { default: env } = await import('../src/config/env.js');
    const previousLocationsFlag = env.inventoryLocationsEnabled;
    const previousBossPrivateNumber = env.bossPrivateNumber;
    const userId = 'entry-registration-integration-user';
    const chatId = 'entry-registration-integration-group@g.us';
    const replies: string[] = [];
    const message = {
      author: userId,
      from: chatId,
      reply: async (text: string) => {
        replies.push(text);
        return undefined;
      },
      getContact: async () => ({ pushname: 'Integration User' }),
    } as any;

    try {
      env.inventoryLocationsEnabled = false;
      env.bossPrivateNumber = '';
      saveEntrySession({
        userId,
        chatId,
        step: 'awaiting_additional_measure',
        productId: registeredWithoutStock.productId,
        reference: '110/90 R17',
        description: 'PIRELLI MT60 TRASEIRO 60P',
        oldCashPrice: 500,
        oldCreditPrice: 529,
        invoiceNumber: 'NF-CADASTRO-1',
        items: [{
          productId: registeredWithoutStock.productId,
          reference: '110/90 R17',
          description: 'PIRELLI MT60 TRASEIRO 60P',
          oldCashPrice: 500,
          oldCreditPrice: 529,
          quantity: 1,
          supplier: 'Fornecedor Integrado',
        }],
        updatedAt: Date.now(),
      });

      await handleEntryConversation(message, '205/55 R16');
      assert.equal(getEntrySession(userId, chatId)?.step, 'awaiting_additional_item');
      assert.match(replies.at(-1) ?? '', /Nenhum pneu encontrado/);
      assert.match(replies.at(-1) ?? '', /\*cadastro\*/);

      await handleEntryConversation(message, 'cadastro');
      assert.equal(replies.at(-1), '🆕 *MEDIDA*\n*Digite a medida:*');
      await handleProductRegistrationConversation(message, '205/55 R16');
      assert.match(replies.at(-1) ?? '', /MARCA DO PNEU/);
      await handleProductRegistrationConversation(message, 'MICHELIN PRIMACY 4 91V');
      await handleProductRegistrationConversation(message, '3');
      await handleProductRegistrationConversation(message, '499,90');
      await handleProductRegistrationConversation(message, '1');

      const preparedEntry = getEntrySession(userId, chatId);
      assert.equal(preparedEntry?.step, 'awaiting_additional_decision');
      assert.equal(preparedEntry?.items?.length, 2);
      assert.equal(preparedEntry?.items?.[1]?.quantity, 3);
      assert.equal(preparedEntry?.items?.[1]?.supplier, 'Fornecedor Integrado');
      assert.match(replies.at(-2) ?? '', /PNEU CADASTRADO E ADICIONADO À NOTA/);
      assert.doesNotMatch(replies.at(-2) ?? '', /QUER ADICIONAR MAIS ALGUM PNEU/);
      assert.equal(
        replies.at(-1),
        '➕ *QUER ADICIONAR MAIS ALGUM PNEU?*\n\n' +
          'Itens preparados: *2*\n\n' +
          '1️⃣ *Sim* | 2️⃣ *Não*'
      );

      const createdProductId = preparedEntry?.items?.[1]?.productId;
      assert.ok(createdProductId);
      assert.equal(
        (await prisma.product.findUniqueOrThrow({ where: { id: createdProductId } })).stock,
        0
      );

      await handleEntryConversation(message, '2');
      await handleEntryConversation(message, '1');

      assert.equal(getEntrySession(userId, chatId), null);
      assert.equal(
        (await prisma.product.findUniqueOrThrow({ where: { id: createdProductId } })).stock,
        3
      );
      const createdProductEntry = await prisma.movement.findFirstOrThrow({
        where: { productId: createdProductId, type: 'ENTRY' },
      });
      assert.equal(createdProductEntry.quantity, 3);
      assert.equal(createdProductEntry.invoiceNumber, 'NF-CADASTRO-1');
      assert.equal(createdProductEntry.supplier, 'Fornecedor Integrado');

      await handleProductRegistrationStart(message);
      await handleProductRegistrationConversation(message, '195/65 R15');
      await handleProductRegistrationConversation(message, 'CONTINENTAL POWERCONTACT 2');
      await handleProductRegistrationConversation(message, '0');
      await handleProductRegistrationConversation(message, '450');
      await handleProductRegistrationConversation(message, '1');

      assert.equal(
        getProductRegistrationSession(userId, chatId)?.step,
        'awaiting_additional_decision'
      );
      assert.equal(getProductRegistrationSession(userId, chatId)?.registeredProductCount, 1);
      assert.match(
        replies.at(-1) ?? '',
        /➕ \*QUER ADICIONAR MAIS ALGUM PNEU\?\*\n\nItens preparados: \*1\*\n\n1️⃣ \*Sim\* \| 2️⃣ \*Não\*$/
      );

      await handleProductRegistrationConversation(message, '2');
      assert.equal(getProductRegistrationSession(userId, chatId), null);
    } finally {
      env.inventoryLocationsEnabled = previousLocationsFlag;
      env.bossPrivateNumber = previousBossPrivateNumber;
      clearProductRegistrationSession(userId, chatId);
      clearEntrySession(userId, chatId);
    }
  } finally {
    await prisma.$disconnect();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
