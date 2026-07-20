import { MovementType } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';

export class PriceProductNotFoundError extends Error {
  constructor() {
    super('Price product was not found or is inactive.');
  }
}

interface RegisterPriceChangeInput {
  productId: string;
  responsiblePhone: string;
  responsibleName: string;
  oldCashPrice: number;
  oldCreditPrice: number;
  newCashPrice: number;
  newCreditPrice: number;
}

interface RegisteredPriceChange {
  movementCode: string;
  currentStock: number;
}

function buildPriceChangeObservation(input: RegisterPriceChangeInput): string {
  return JSON.stringify({
    oldCashPrice: input.oldCashPrice,
    newCashPrice: input.newCashPrice,
    oldCreditPrice: input.oldCreditPrice,
    newCreditPrice: input.newCreditPrice,
  });
}

export async function registerPriceChange(
  input: RegisterPriceChangeInput
): Promise<RegisteredPriceChange> {
  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const product = await productRepository.findById(input.productId, tx);

    if (!product || !product.isActive) {
      throw new PriceProductNotFoundError();
    }

    const priceUpdate = await productRepository.updatePricesIfActive(
      input.productId,
      input.newCashPrice,
      input.newCreditPrice,
      tx
    );

    if (priceUpdate.count === 0) {
      throw new PriceProductNotFoundError();
    }

    const responsible = await userRepository.upsertByPhone(
      input.responsiblePhone,
      input.responsibleName,
      tx
    );
    const priceChangeCount = await movementRepository.countByType(MovementType.PRICE_CHANGE, tx);
    const movementCode = generateMovementCode('P', priceChangeCount + 1);

    await movementRepository.create(
      {
        code: movementCode,
        type: MovementType.PRICE_CHANGE,
        product: {
          connect: { id: input.productId },
        },
        user: {
          connect: { id: responsible.id },
        },
        unitPrice: input.newCashPrice,
        totalValue: input.newCreditPrice,
        observation: buildPriceChangeObservation(input),
        reason: 'Alteração de preço',
      },
      tx
    );

    return {
      movementCode,
      currentStock: product.stock,
    };
  }));
}
