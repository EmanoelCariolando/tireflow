import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { productRepository } from '../repositories/productRepository.js';
import { normalizeProductDescription } from '../utils/productText.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';
import { buildReferenceCandidates } from './productService.js';

export class ProductNameNotFoundError extends Error {}
export class ProductNameChangedError extends Error {}
export class DuplicateProductNameError extends Error {}
export class InvalidProductNameError extends Error {}

interface RenameProductInput {
  productId: string;
  expectedDescription: string;
  newDescription: string;
}

export async function renameProduct(input: RenameProductInput): Promise<string> {
  const description = normalizeProductDescription(input.newDescription);
  if (!description) throw new InvalidProductNameError();

  return withInventoryMutationLock(async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const product = await productRepository.findById(input.productId, tx);
        if (!product?.isActive) throw new ProductNameNotFoundError();
        if (product.description !== input.expectedDescription) throw new ProductNameChangedError();
        if (product.description === description) return description;

        const duplicate = await productRepository.findByReferencesAndDescription(
          buildReferenceCandidates(product.reference), description, tx
        );
        if (duplicate && duplicate.id !== product.id) throw new DuplicateProductNameError();

        const updated = await productRepository.updateDescriptionIfUnchanged(
          product.id, input.expectedDescription, description, tx
        );
        if (updated.count !== 1) throw new ProductNameChangedError();
        return description;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateProductNameError();
      }
      throw error;
    }
  });
}
