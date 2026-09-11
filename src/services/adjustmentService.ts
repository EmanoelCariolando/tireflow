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

export class AdjustmentStockChangedError extends Error {
  constructor() {
    super('Product stock changed while the adjustment was being prepared.');
  }
}

export class AdjustmentInsufficientStockError extends Error {
  constructor() {
    super('The source product does not have enough stock for this adjustment.');
  }
}

export class AdjustmentSameProductError extends Error {
  constructor() {
    super('The source and destination products must be different.');
  }
}

interface RegisterAdjustmentInput {
  productId: string;
  responsiblePhone: string;
  responsibleName: string;
  newStock: number;
  reason: string;
  expectedStock?: number;
}

interface RegisteredAdjustment {
  movementCode: string;
  previousStock: number;
  currentStock: number;
}

interface RegisterStockTransferInput {
  sourceProductId: string;
  targetProductId: string;
  responsiblePhone: string;
  responsibleName: string;
  quantity: number;
  reason: string;
  expectedSourceStock?: number;
  expectedTargetStock?: number;
}

interface RegisteredStockTransfer {
  sourceMovementCode: string;
  targetMovementCode: string;
  sourcePreviousStock: number;
  sourceCurrentStock: number;
  targetPreviousStock: number;
  targetCurrentStock: number;
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
    if (input.expectedStock !== undefined && previousStock !== input.expectedStock) {
      throw new AdjustmentStockChangedError();
    }

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
        quantity: Math.abs(input.newStock - previousStock),
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

export async function registerStockTransfer(
  input: RegisterStockTransferInput
): Promise<RegisteredStockTransfer> {
  if (input.sourceProductId === input.targetProductId) {
    throw new AdjustmentSameProductError();
  }

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new AdjustmentInsufficientStockError();
  }

  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const source = await productRepository.findById(input.sourceProductId, tx);
    const target = await productRepository.findById(input.targetProductId, tx);

    if (!source?.isActive || !target?.isActive) {
      throw new AdjustmentProductNotFoundError();
    }

    if (
      (input.expectedSourceStock !== undefined && source.stock !== input.expectedSourceStock) ||
      (input.expectedTargetStock !== undefined && target.stock !== input.expectedTargetStock)
    ) {
      throw new AdjustmentStockChangedError();
    }

    if (source.stock < input.quantity) {
      throw new AdjustmentInsufficientStockError();
    }

    const sourceUpdate = await productRepository.decreaseStockIfAvailable(
      source.id,
      input.quantity,
      tx
    );
    const targetUpdate = await productRepository.increaseStockIfActive(
      target.id,
      input.quantity,
      tx
    );

    if (sourceUpdate.count === 0) {
      throw new AdjustmentInsufficientStockError();
    }
    if (targetUpdate.count === 0) {
      throw new AdjustmentProductNotFoundError();
    }

    const responsible = await userRepository.upsertByPhone(
      input.responsiblePhone,
      input.responsibleName,
      tx
    );
    const adjustmentCount = await movementRepository.countByType(MovementType.ADJUSTMENT, tx);
    const sourceMovementCode = generateMovementCode('A', adjustmentCount + 1);
    const targetMovementCode = generateMovementCode('A', adjustmentCount + 2);
    const transferPair = `${sourceMovementCode}/${targetMovementCode}`;

    await movementRepository.create(
      {
        code: sourceMovementCode,
        type: MovementType.ADJUSTMENT,
        product: { connect: { id: source.id } },
        user: { connect: { id: responsible.id } },
        quantity: input.quantity,
        previousStock: source.stock,
        newStock: source.stock - input.quantity,
        reason: input.reason,
        observation: `Transferência ${transferPair} para ${target.reference} — ${target.description}`,
      },
      tx
    );

    await movementRepository.create(
      {
        code: targetMovementCode,
        type: MovementType.ADJUSTMENT,
        product: { connect: { id: target.id } },
        user: { connect: { id: responsible.id } },
        quantity: input.quantity,
        previousStock: target.stock,
        newStock: target.stock + input.quantity,
        reason: input.reason,
        observation: `Transferência ${transferPair} de ${source.reference} — ${source.description}`,
      },
      tx
    );

    return {
      sourceMovementCode,
      targetMovementCode,
      sourcePreviousStock: source.stock,
      sourceCurrentStock: source.stock - input.quantity,
      targetPreviousStock: target.stock,
      targetCurrentStock: target.stock + input.quantity,
    };
  }));
}
