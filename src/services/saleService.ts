import { MovementType } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { PaymentMethod } from '../utils/saleSessionStore.js';
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

interface RegisterSaleInput {
  productId: string;
  sellerPhone: string;
  sellerName: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  paymentMethod: PaymentMethod;
  invoiceName?: string;
}

interface RegisteredSale {
  movementCode: string;
  currentStock: number;
  previousStock: number;
}

export function getUnitPriceForPayment(
  paymentMethod: PaymentMethod,
  cashPrice: number,
  creditPrice: number
): number {
  return paymentMethod === 'Dinheiro' || paymentMethod === 'PIX'
    ? cashPrice
    : creditPrice;
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
