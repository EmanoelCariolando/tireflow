import { prisma } from '../database/prisma.js';
import type { Prisma } from '@prisma/client';

type PrismaClientOrTransaction = Prisma.TransactionClient | typeof prisma;

export const productRepository = {
  findById(id: string, client: PrismaClientOrTransaction = prisma) {
    return client.product.findUnique({
      where: { id },
    });
  },

  findActiveByReference(reference: string, client: PrismaClientOrTransaction = prisma) {
    return client.product.findMany({
      where: {
        reference,
        isActive: true,
      },
      orderBy: {
        description: 'asc',
      },
    });
  },

  findActiveByReferences(references: string[], client: PrismaClientOrTransaction = prisma) {
    return client.product.findMany({
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

  findAvailableByReferences(references: string[], client: PrismaClientOrTransaction = prisma) {
    return client.product.findMany({
      where: {
        reference: {
          in: references,
        },
        isActive: true,
        stock: {
          gt: 0,
        },
      },
      orderBy: [
        { reference: 'asc' },
        { description: 'asc' },
      ],
    });
  },

  findByReferenceAndDescription(
    reference: string,
    description: string,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.findFirst({
      where: {
        reference,
        description,
      },
    });
  },

  create(data: Prisma.ProductCreateInput, client: PrismaClientOrTransaction = prisma) {
    return client.product.create({
      data,
    });
  },

  updateStock(id: string, stock: number, client: PrismaClientOrTransaction = prisma) {
    return client.product.update({
      where: { id },
      data: { stock },
    });
  },

  decreaseStockIfAvailable(
    id: string,
    quantity: number,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.updateMany({
      where: {
        id,
        isActive: true,
        stock: {
          gte: quantity,
        },
      },
      data: {
        stock: {
          decrement: quantity,
        },
      },
    });
  },
};
