import { MovementType } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';

export class AdjustmentProductNotFoundError extends Error {
  constructor() {
    super('Adjustment product was not found or is inactive.');
  }
}

interface RegisterAdjustmentInput {
  productId: string;
  responsiblePhone: string;
  responsibleName: string;
  newStock: number;
  reason: string;
}

interface RegisteredAdjustment {
  movementCode: string;
  previousStock: number;
  currentStock: number;
}

export async function registerAdjustment(
  input: RegisterAdjustmentInput
): Promise<RegisteredAdjustment> {
  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const product = await productRepository.findById(input.productId, tx);

    if (!product || !product.isActive) {
      throw new AdjustmentProductNotFoundError();
    }

    const previousStock = product.stock;
    const stockUpdate = await productRepository.setStockIfActive(
      input.productId,
      input.newStock,
      tx
    );

    if (stockUpdate.count === 0) {
      throw new AdjustmentProductNotFoundError();
    }

    const responsible = await userRepository.upsertByPhone(
      input.responsiblePhone,
      input.responsibleName,
      tx
    );
    const adjustmentCount = await movementRepository.countByType(MovementType.ADJUSTMENT, tx);
    const movementCode = generateMovementCode('A', adjustmentCount + 1);

    await movementRepository.create(
      {
        code: movementCode,
        type: MovementType.ADJUSTMENT,
        product: {
          connect: { id: input.productId },
        },
        user: {
          connect: { id: responsible.id },
        },
        previousStock,
        newStock: input.newStock,
        reason: input.reason,
      },
      tx
    );

    return {
      movementCode,
      previousStock,
      currentStock: input.newStock,
    };
  }));
}
