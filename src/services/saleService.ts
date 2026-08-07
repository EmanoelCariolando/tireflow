import { MovementType } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { allocatePaymentBreakdownAcrossTotals } from '../utils/saleAllocation.js';
import { serializePaymentBreakdown } from '../utils/salePayment.js';
import type {
  PaymentBreakdownPart,
  PaymentMethod,
} from '../utils/saleSessionStore.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';

export class SaleProductNotFoundError extends Error {
  constructor() {
    super('Sale product was not found or is inactive.');
  }
}

export class InsufficientStockError extends Error {
  constructor(
    readonly currentStock: number,
    readonly requestedQuantity: number,
    readonly productId?: string
  ) {
    super('Insufficient stock for sale.');
  }
}

export class InvalidPaymentBreakdownError extends Error {
  constructor() {
    super('Mixed payment breakdown is invalid.');
  }
}

export interface RegisterSaleItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
}

interface RegisterSaleInput extends RegisterSaleItemInput {
  sellerPhone: string;
  sellerName: string;
  paymentMethod: PaymentMethod;
  paymentBreakdown?: PaymentBreakdownPart[];
  invoiceName?: string;
  isCityHallSale?: boolean;
}

interface RegisteredSale {
  movementCode: string;
  currentStock: number;
  previousStock: number;
}

interface RegisterSaleItemsInput {
  items: RegisterSaleItemInput[];
  sellerPhone: string;
  sellerName: string;
  totalValue: number;
  paymentMethod: PaymentMethod;
  paymentBreakdown?: PaymentBreakdownPart[];
  invoiceName?: string;
  isCityHallSale?: boolean;
}

export interface RegisteredSaleItem extends RegisteredSale {
  productId: string;
}

export interface RegisteredSaleGroup {
  saleGroupCode: string;
  items: RegisteredSaleItem[];
}

export function calculateSaleTotal(quantity: number, unitPrice: number): number {
  return quantity * unitPrice;
}

export async function getCurrentProductStock(productId: string): Promise<number | null> {
  const product = await productRepository.findById(productId);

  if (!product || !product.isActive) {
    return null;
  }

  return product.stock;
}

export async function registerSale(input: RegisterSaleInput): Promise<RegisteredSale> {
  const registeredGroup = await registerSaleItems({
    items: [{
      productId: input.productId,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      totalValue: input.totalValue,
    }],
    sellerPhone: input.sellerPhone,
    sellerName: input.sellerName,
    totalValue: input.totalValue,
    paymentMethod: input.paymentMethod,
    paymentBreakdown: input.paymentBreakdown,
    invoiceName: input.invoiceName,
    isCityHallSale: input.isCityHallSale,
  });
  return registeredGroup.items[0]!;
}

export async function registerSaleItems(
  input: RegisterSaleItemsInput
): Promise<RegisteredSaleGroup> {
  if (!hasValidSaleItems(input.items, input.totalValue) || !hasValidPaymentBreakdown(input)) {
    throw new InvalidPaymentBreakdownError();
  }

  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const requestedByProduct = new Map<string, number>();
    for (const item of input.items) {
      requestedByProduct.set(
        item.productId,
        (requestedByProduct.get(item.productId) ?? 0) + item.quantity
      );
    }

    for (const [productId, requestedQuantity] of requestedByProduct) {
      const product = await productRepository.findById(productId, tx);

      if (!product || !product.isActive) {
        throw new SaleProductNotFoundError();
      }

      if (product.stock < requestedQuantity) {
        throw new InsufficientStockError(product.stock, requestedQuantity, productId);
      }
    }

    const seller = await userRepository.upsertByPhone(input.sellerPhone, input.sellerName, tx);
    const saleCount = await movementRepository.countByType(MovementType.SALE, tx);
    const saleGroupCode = generateMovementCode('V', saleCount + 1);
    const itemTotalsInCents = input.items.map((item) => Math.round(item.totalValue * 100));
    const itemPaymentBreakdowns = input.paymentMethod === 'Misto'
      ? allocatePaymentBreakdownAcrossTotals(input.paymentBreakdown!, itemTotalsInCents)
      : input.items.map(() => undefined);
    const registeredItems: RegisteredSaleItem[] = [];

    for (const [index, item] of input.items.entries()) {
      const product = await productRepository.findById(item.productId, tx);
      if (!product || !product.isActive) {
        throw new SaleProductNotFoundError();
      }

      const stockUpdate = await productRepository.decreaseStockIfAvailable(
        item.productId,
        item.quantity,
        tx
      );

      if (stockUpdate.count === 0) {
        const freshProduct = await productRepository.findById(item.productId, tx);
        throw new InsufficientStockError(
          freshProduct?.stock ?? 0,
          requestedByProduct.get(item.productId) ?? item.quantity,
          item.productId
        );
      }

      const updatedProduct = await productRepository.findById(item.productId, tx);
      if (!updatedProduct) {
        throw new SaleProductNotFoundError();
      }

      const movementCode = generateMovementCode('V', saleCount + index + 1);
      const currentStock = updatedProduct.stock;
      const previousStock = currentStock + item.quantity;

      await movementRepository.create(
        {
          code: movementCode,
          saleGroupCode,
          type: MovementType.SALE,
          product: {
            connect: { id: item.productId },
          },
          user: {
            connect: { id: seller.id },
          },
          quantity: item.quantity,
          previousStock,
          newStock: currentStock,
          unitPrice: item.unitPrice,
          totalValue: item.totalValue,
          paymentMethod: input.paymentMethod,
          paymentDetails: input.paymentMethod === 'Misto'
            ? serializePaymentBreakdown(itemPaymentBreakdowns[index])
            : undefined,
          invoiceName: input.paymentMethod === 'Nota' ? input.invoiceName : undefined,
          isCityHallSale: input.paymentMethod === 'Nota' && input.isCityHallSale === true,
        },
        tx
      );

      registeredItems.push({
        productId: item.productId,
        movementCode,
        currentStock,
        previousStock,
      });
    }

    return { saleGroupCode, items: registeredItems };
  }));
}

function hasValidSaleItems(items: RegisterSaleItemInput[], totalValue: number): boolean {
  return (
    items.length > 0 &&
    items.every((item) =>
      Boolean(item.productId) &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      Number.isFinite(item.unitPrice) &&
      item.unitPrice >= 0 &&
      Number.isFinite(item.totalValue) &&
      item.totalValue >= 0
    ) &&
    items.reduce((total, item) => total + Math.round(item.totalValue * 100), 0) ===
      Math.round(totalValue * 100)
  );
}

function hasValidPaymentBreakdown(
  input: Pick<RegisterSaleItemsInput, 'paymentMethod' | 'paymentBreakdown' | 'totalValue'>
): boolean {
  if (input.paymentMethod !== 'Misto') {
    return input.paymentBreakdown === undefined;
  }

  const parts = input.paymentBreakdown;

  if (
    !parts ||
    parts.length !== 2 ||
    new Set(parts.map((part) => part.method)).size !== 2 ||
    parts.some(
      (part) =>
        !['Dinheiro', 'PIX', 'Cartão'].includes(part.method) ||
        !Number.isFinite(part.amount) ||
        part.amount <= 0 ||
        Math.abs(part.amount * 100 - Math.round(part.amount * 100)) > 0.000001
    )
  ) {
    return false;
  }

  const partsTotalInCents = parts.reduce(
    (total, part) => total + Math.round(part.amount * 100),
    0
  );
  return partsTotalInCents === Math.round(input.totalValue * 100);
}
