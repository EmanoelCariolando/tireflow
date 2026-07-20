import { MovementType } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';

export class EntryProductNotFoundError extends Error {
  constructor() {
    super('Entry product was not found or is inactive.');
  }
}

interface RegisterEntryInput {
  productId: string;
  responsiblePhone: string;
  responsibleName: string;
  quantity: number;
  supplier: string;
}

interface RegisteredEntry {
  movementCode: string;
  previousStock: number;
  currentStock: number;
}

export async function registerEntry(input: RegisterEntryInput): Promise<RegisteredEntry> {
  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const product = await productRepository.findById(input.productId, tx);

    if (!product || !product.isActive) {
      throw new EntryProductNotFoundError();
    }

    const previousStock = product.stock;
    const stockUpdate = await productRepository.increaseStockIfActive(
      input.productId,
      input.quantity,
      tx
    );

    if (stockUpdate.count === 0) {
      throw new EntryProductNotFoundError();
    }

    const updatedProduct = await productRepository.findById(input.productId, tx);

    if (!updatedProduct) {
      throw new EntryProductNotFoundError();
    }

    const responsible = await userRepository.upsertByPhone(
      input.responsiblePhone,
      input.responsibleName,
      tx
    );
    const entryCount = await movementRepository.countByType(MovementType.ENTRY, tx);
    const movementCode = generateMovementCode('E', entryCount + 1);

    await movementRepository.create(
      {
        code: movementCode,
        type: MovementType.ENTRY,
        product: {
          connect: { id: input.productId },
        },
        user: {
          connect: { id: responsible.id },
        },
        quantity: input.quantity,
        previousStock,
        newStock: updatedProduct.stock,
        supplier: input.supplier,
      },
      tx
    );

    return {
      movementCode,
      previousStock,
      currentStock: updatedProduct.stock,
    };
  }));
}
