import { prisma } from '../database/prisma.js';
import type { Prisma } from '@prisma/client';

export const productRepository = {
  findById(id: string) {
    return prisma.product.findUnique({
      where: { id },
    });
  },

  findActiveByReference(reference: string) {
    return prisma.product.findMany({
      where: {
        reference,
        isActive: true,
      },
      orderBy: {
        description: 'asc',
      },
    });
  },

  findActiveByReferences(references: string[]) {
    return prisma.product.findMany({
      where: {
        reference: {
          in: references,
        },
        isActive: true,
      },
      orderBy: [
        { reference: 'asc' },
        { description: 'asc' },
      ],
    });
  },

  findByReferenceAndDescription(reference: string, description: string) {
    return prisma.product.findFirst({
      where: {
        reference,
        description,
      },
    });
  },

  create(data: Prisma.ProductCreateInput) {
    return prisma.product.create({
      data,
    });
  },

  updateStock(id: string, stock: number) {
    return prisma.product.update({
      where: { id },
      data: { stock },
    });
  },
};
