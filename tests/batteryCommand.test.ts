import assert from 'node:assert/strict';
import test from 'node:test';
import { BatteryBrand, Prisma, ProductCategory } from '@prisma/client';
import {
  filterBatteryProducts,
  isBatterySearchCommand,
  parseBatterySearchQuery,
} from '../src/services/batteryService.js';
import { formatBatteryList } from '../src/commands/batteryCommand.js';
import { formatProductChoiceQuestion } from '../src/commands/pneuCommand.js';
import { formatQuantityQuestion } from '../src/utils/operationPrompts.js';
import { formatSaleConfirmation } from '../src/commands/saleCommand.js';
import type { SaleSession } from '../src/utils/saleSessionStore.js';

const products: Parameters<typeof filterBatteryProducts>[0] = [
  {
    id: 'moura-60',
    reference: 'M60GD',
    description: '60AH 12V DIREITA',
    category: ProductCategory.BATTERY,
    batteryBrand: BatteryBrand.MOURA,
    stock: 3,
    stockLocation: null,
    cashPrice: new Prisma.Decimal(500),
    creditPrice: new Prisma.Decimal(529),
    imagePath: null,
  },
  {
    id: 'zetta-60',
    reference: 'Z60D',
    description: '60 AH 12V DIREITA',
    category: ProductCategory.BATTERY,
    batteryBrand: BatteryBrand.ZETTA,
    stock: 2,
    stockLocation: null,
    cashPrice: new Prisma.Decimal(400),
    creditPrice: new Prisma.Decimal(423.2),
    imagePath: null,
  },
  {
    id: 'moura-100',
    reference: 'M100HE',
    description: '100AH CAMINHÃO',
    category: ProductCategory.BATTERY,
    batteryBrand: BatteryBrand.MOURA,
    stock: 1,
    stockLocation: null,
    cashPrice: new Prisma.Decimal(900),
    creditPrice: new Prisma.Decimal(952.2),
    imagePath: null,
  },
];

test('recognizes direct battery searches without consuming ordinary numbers or messages', () => {
  assert.deepEqual(parseBatterySearchQuery('bateria 60'), {
    brand: null,
    terms: ['60'],
    label: '60',
  });
  assert.equal(isBatterySearchCommand('bateria 100'), true);
  assert.equal(isBatterySearchCommand('60ah'), false);
  assert.equal(isBatterySearchCommand('moura 60'), false);
  assert.equal(isBatterySearchCommand('zetta 60'), false);
  assert.equal(isBatterySearchCommand('M60GD'), false);
  assert.equal(isBatterySearchCommand('moura'), false);
  assert.equal(isBatterySearchCommand('baterias'), false);
  assert.equal(isBatterySearchCommand('60'), false);
  assert.equal(isBatterySearchCommand('bom dia'), false);
});

test('shows both brands for the informed battery capacity', () => {
  const sixtyAmp = filterBatteryProducts(products, parseBatterySearchQuery('bateria 60')!);
  assert.deepEqual(sixtyAmp.map((product) => product.id), ['moura-60', 'zetta-60']);
});

test('formats batteries distinctly while preserving the existing product workflow', () => {
  const text = formatBatteryList(
    products.slice(0, 2).map((product) => ({
      ...product,
      cashPrice: Number(product.cashPrice),
      creditPrice: Number(product.creditPrice),
    })),
    '60',
    false,
    false
  );
  assert.match(text, /^🔋 \*BATERIAS — 60\*/);
  assert.match(text, /MOURA — M60GD/);
  assert.match(text, /ZETTA — Z60D/);
  assert.doesNotMatch(text, /🛞/);
  assert.equal(
    formatProductChoiceQuestion(ProductCategory.BATTERY),
    '*ESCOLHA UMA BATERIA 🔋*\n*Digite o número da bateria:*'
  );
  assert.equal(formatQuantityQuestion(ProductCategory.BATTERY), '📦 *QUANTIDADE*\nQuantas baterias?');

  const sale: SaleSession = {
    userId: 'battery-sale-user',
    chatId: 'battery-sale-chat',
    step: 'awaiting_confirmation',
    productId: 'moura-60',
    reference: 'M60GD',
    description: '60AH 12V DIREITA',
    category: ProductCategory.BATTERY,
    batteryBrand: BatteryBrand.MOURA,
    quantity: 1,
    cashPrice: 500,
    creditPrice: 529,
    unitPrice: 500,
    totalValue: 500,
    paymentMethod: 'PIX',
    updatedAt: Date.now(),
  };
  assert.match(formatSaleConfirmation(sale), /🔋 \*M60GD — 60AH 12V DIREITA\*/);
});
