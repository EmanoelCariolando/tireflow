import { MovementType, Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';
import { buildReferenceCandidates } from './productService.js';
import { calculateCreditPrice } from '../utils/productPricing.js';

export class ProductAlreadyExistsError extends Error {
  constructor(
    public readonly reference: string,
    public readonly description: string,
    public readonly isActive: boolean
  ) {
    super('A product with the same measure and description already exists.');
  }
}

interface RegisterNewProductInput {
  reference: string;
  description: string;
  initialStock: number;
  supplier?: string;
  cashPrice: number;
  stockLocation?: string | null;
  responsiblePhone: string;
  responsibleName: string;
}

interface RegisteredNewProduct {
  productId: string;
  movementCode: string | null;
}

export async function findEquivalentProduct(reference: string, description: string) {
  return productRepository.findByReferencesAndDescription(
    buildReferenceCandidates(reference),
    description
  );
}

export async function registerNewProduct(
  input: RegisterNewProductInput
): Promise<RegisteredNewProduct> {
  return withInventoryMutationLock(async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const existingProduct = await productRepository.findByReferencesAndDescription(
          buildReferenceCandidates(input.reference),
          input.description,
          tx
        );

        if (existingProduct) {
          throw new ProductAlreadyExistsError(
            existingProduct.reference,
            existingProduct.description,
            existingProduct.isActive
          );
        }

        const product = await productRepository.create(
          {
            reference: input.reference,
            description: input.description,
            stock: input.initialStock,
            minStock: 0,
            cashPrice: input.cashPrice,
            creditPrice: calculateCreditPrice(input.cashPrice),
            stockLocation: input.stockLocation ?? null,
          },
          tx
        );

        if (input.initialStock === 0) {
          return {
            productId: product.id,
            movementCode: null,
          };
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
              connect: { id: product.id },
            },
            user: {
              connect: { id: responsible.id },
            },
            quantity: input.initialStock,
            previousStock: 0,
            newStock: input.initialStock,
            supplier: input.supplier,
          },
          tx
        );

        return {
          productId: product.id,
          movementCode,
        };
      });
    } catch (error) {
      if (error instanceof ProductAlreadyExistsError) {
        throw error;
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ProductAlreadyExistsError(input.reference, input.description, true);
      }

      throw error;
    }
  });
}
