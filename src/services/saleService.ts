import { MovementType } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
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
    readonly requestedQuantity: number
  ) {
    super('Insufficient stock for sale.');
  }
}

export class InvalidPaymentBreakdownError extends Error {
  constructor() {
    super('Mixed payment breakdown is invalid.');
  }
}

interface RegisterSaleInput {
  productId: string;
  sellerPhone: string;
  sellerName: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  paymentMethod: PaymentMethod;
  paymentBreakdown?: PaymentBreakdownPart[];
  invoiceName?: string;
}

interface RegisteredSale {
  movementCode: string;
  currentStock: number;
  previousStock: number;
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
  if (!hasValidPaymentBreakdown(input)) {
    throw new InvalidPaymentBreakdownError();
  }

  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const product = await productRepository.findById(input.productId, tx);

    if (!product || !product.isActive) {
      throw new SaleProductNotFoundError();
    }

    if (product.stock < input.quantity) {
      throw new InsufficientStockError(product.stock, input.quantity);
    }

    const stockUpdate = await productRepository.decreaseStockIfAvailable(
      input.productId,
      input.quantity,
      tx
    );

    if (stockUpdate.count === 0) {
      const freshProduct = await productRepository.findById(input.productId, tx);
      throw new InsufficientStockError(freshProduct?.stock ?? 0, input.quantity);
    }

    const updatedProduct = await productRepository.findById(input.productId, tx);

    if (!updatedProduct) {
      throw new SaleProductNotFoundError();
    }

    const seller = await userRepository.upsertByPhone(input.sellerPhone, input.sellerName, tx);
    const saleCount = await movementRepository.countByType(MovementType.SALE, tx);
    const movementCode = generateMovementCode('V', saleCount + 1);
    const currentStock = updatedProduct.stock;
    const previousStock = currentStock + input.quantity;

    await movementRepository.create(
      {
        code: movementCode,
        type: MovementType.SALE,
        product: {
          connect: { id: input.productId },
        },
        user: {
          connect: { id: seller.id },
        },
        quantity: input.quantity,
        previousStock,
        newStock: currentStock,
        unitPrice: input.unitPrice,
        totalValue: input.totalValue,
        paymentMethod: input.paymentMethod,
        paymentDetails: input.paymentMethod === 'Misto'
          ? serializePaymentBreakdown(input.paymentBreakdown)
          : undefined,
        invoiceName: input.paymentMethod === 'Nota' ? input.invoiceName : undefined,
      },
      tx
    );

    return {
      movementCode,
      currentStock,
      previousStock,
    };
  }));
}

function hasValidPaymentBreakdown(input: RegisterSaleInput): boolean {
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
