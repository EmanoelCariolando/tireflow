import { MovementType, PendingSaleStatus, Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import type { SaleItem } from '../utils/saleSessionStore.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';
import { InsufficientStockError, SaleProductNotFoundError } from './saleService.js';

const pendingSaleInclude = {
  assignedTo: true,
  createdBy: true,
  items: {
    include: { product: true },
    orderBy: { position: 'asc' as const },
  },
} satisfies Prisma.PendingSaleInclude;

export type PendingSaleWithDetails = Prisma.PendingSaleGetPayload<{
  include: typeof pendingSaleInclude;
}>;

export interface RegisterPendingSaleInput {
  items: SaleItem[];
  createdByPhone: string;
  createdByName: string;
  assignedPhone: string;
  assignedName: string;
  totalValue: number;
  originalTotalValue?: number;
  discountPercent?: number;
  discountAmount?: number;
}

export interface ReturnedPendingSale {
  pendingSale: PendingSaleWithDetails;
  stocks: Array<{ productId: string; currentStock: number }>;
}

export class PendingSaleNotOpenError extends Error {
  constructor() {
    super('Pending sale is no longer open.');
  }
}

export async function registerPendingSale(
  input: RegisterPendingSaleInput
): Promise<PendingSaleWithDetails> {
  validatePendingSaleInput(input);

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
      if (!product || !product.isActive) throw new SaleProductNotFoundError();
      if (product.stock < requestedQuantity) {
        throw new InsufficientStockError(product.stock, requestedQuantity, productId);
      }
    }

    const createdBy = await userRepository.upsertByPhone(
      input.createdByPhone,
      input.createdByName,
      tx
    );
    const assignedTo = input.assignedPhone === input.createdByPhone
      ? createdBy
      : await userRepository.upsertByPhone(input.assignedPhone, input.assignedName, tx);
    const sequence = await tx.pendingSale.count() + 1;
    const pendingSale = await tx.pendingSale.create({
      data: {
        code: `#PD-${String(sequence).padStart(6, '0')}`,
        createdBy: { connect: { id: createdBy.id } },
        assignedTo: { connect: { id: assignedTo.id } },
        totalValue: input.totalValue,
        originalTotalValue: input.originalTotalValue,
        discountPercent: input.discountPercent,
        discountAmount: input.discountAmount,
      },
    });

    for (const [position, item] of input.items.entries()) {
      const product = await productRepository.findById(item.productId, tx);
      if (!product || !product.isActive) throw new SaleProductNotFoundError();

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
      if (!updatedProduct) throw new SaleProductNotFoundError();

      await tx.pendingSaleItem.create({
        data: {
          pendingSaleId: pendingSale.id,
          position,
          productId: item.productId,
          reference: item.reference,
          description: item.description,
          quantity: item.quantity,
          cashPrice: item.cashPrice,
          creditPrice: item.creditPrice,
          priceType: item.priceType,
          unitPrice: item.unitPrice,
          totalValue: item.totalValue,
          previousStock: updatedProduct.stock + item.quantity,
          reservedStock: updatedProduct.stock,
        },
      });
    }

    return tx.pendingSale.findUniqueOrThrow({
      where: { id: pendingSale.id },
      include: pendingSaleInclude,
    });
  }));
}

export function findOpenPendingSales(): Promise<PendingSaleWithDetails[]> {
  return prisma.pendingSale.findMany({
    where: { status: PendingSaleStatus.OPEN },
    include: pendingSaleInclude,
    orderBy: [{ assignedTo: { name: 'asc' } }, { createdAt: 'asc' }],
  });
}

export function findOpenPendingSaleById(id: string): Promise<PendingSaleWithDetails | null> {
  return prisma.pendingSale.findFirst({
    where: { id, status: PendingSaleStatus.OPEN },
    include: pendingSaleInclude,
  });
}

export async function returnPendingSaleToStock(
  pendingSaleId: string,
  responsiblePhone: string,
  responsibleName: string
): Promise<ReturnedPendingSale> {
  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const pendingSale = await tx.pendingSale.findUnique({
      where: { id: pendingSaleId },
      include: pendingSaleInclude,
    });
    if (!pendingSale || pendingSale.status !== PendingSaleStatus.OPEN) {
      throw new PendingSaleNotOpenError();
    }

    const claimed = await tx.pendingSale.updateMany({
      where: { id: pendingSaleId, status: PendingSaleStatus.OPEN },
      data: { status: PendingSaleStatus.RETURNED, resolvedAt: new Date() },
    });
    if (claimed.count !== 1) throw new PendingSaleNotOpenError();

    const responsible = await userRepository.upsertByPhone(
      responsiblePhone,
      responsibleName,
      tx
    );
    const adjustmentCount = await movementRepository.countByType(MovementType.ADJUSTMENT, tx);
    const stocks: ReturnedPendingSale['stocks'] = [];

    for (const [index, item] of pendingSale.items.entries()) {
      const productBefore = await productRepository.findById(item.productId, tx);
      if (!productBefore) throw new SaleProductNotFoundError();

      const productAfter = await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
      await movementRepository.create({
        code: generateMovementCode('A', adjustmentCount + index + 1),
        type: MovementType.ADJUSTMENT,
        product: { connect: { id: item.productId } },
        user: { connect: { id: responsible.id } },
        quantity: item.quantity,
        previousStock: productBefore.stock,
        newStock: productAfter.stock,
        observation: `Retorno da pendência ${pendingSale.code}`,
        reason: 'Pneu não vendido e devolvido ao estoque',
      }, tx);
      stocks.push({ productId: item.productId, currentStock: productAfter.stock });
    }

    return {
      pendingSale: {
        ...pendingSale,
        status: PendingSaleStatus.RETURNED,
        resolvedAt: pendingSale.resolvedAt ?? new Date(),
      },
      stocks,
    };
  }));
}

function validatePendingSaleInput(input: RegisterPendingSaleInput): void {
  const itemTotalInCents = input.items.reduce(
    (total, item) => total + Math.round(item.totalValue * 100),
    0
  );
  if (
    input.items.length === 0 ||
    !input.createdByPhone ||
    !input.assignedPhone ||
    !Number.isFinite(input.totalValue) ||
    itemTotalInCents !== Math.round(input.totalValue * 100) ||
    input.items.some((item) =>
      !item.productId ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.unitPrice) ||
      !Number.isFinite(item.totalValue)
    )
  ) {
    throw new Error('Invalid pending sale data.');
  }
}

export function decimalToNumber(value: Prisma.Decimal | null): number | undefined {
  return value === null ? undefined : value.toNumber();
}
