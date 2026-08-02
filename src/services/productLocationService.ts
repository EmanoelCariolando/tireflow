import { prisma } from '../database/prisma.js';
import { productRepository } from '../repositories/productRepository.js';
import { normalizeStockLocation } from '../utils/stockLocation.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';

export class ProductLocationNotFoundError extends Error {
  constructor() {
    super('Product was not found or is inactive.');
  }
}

export class ProductLocationChangedError extends Error {
  constructor(readonly currentLocation: string | null) {
    super('Product location changed during confirmation.');
  }
}

export class InvalidProductLocationError extends Error {
  constructor() {
    super('Product location is invalid.');
  }
}

interface RegisterProductLocationInput {
  productId: string;
  expectedLocation: string | null;
  newLocation: string;
}

interface RegisteredProductLocation {
  previousLocation: string | null;
  currentLocation: string;
}

export async function registerProductLocation(
  input: RegisterProductLocationInput
): Promise<RegisteredProductLocation> {
  const newLocation = normalizeStockLocation(input.newLocation);

  if (!newLocation) {
    throw new InvalidProductLocationError();
  }

  return withInventoryMutationLock(() =>
    prisma.$transaction(async (tx) => {
      const product = await productRepository.findById(input.productId, tx);

      if (!product || !product.isActive) {
        throw new ProductLocationNotFoundError();
      }

      const currentLocation = normalizeStockLocation(product.stockLocation);
      const expectedLocation = normalizeStockLocation(input.expectedLocation);

      if (currentLocation !== expectedLocation) {
        throw new ProductLocationChangedError(currentLocation);
      }

      const update = await productRepository.updateStockLocationIfActive(
        input.productId,
        newLocation,
        tx
      );

      if (update.count === 0) {
        throw new ProductLocationNotFoundError();
      }

      return {
        previousLocation: currentLocation,
        currentLocation: newLocation,
      };
    })
  );
}
