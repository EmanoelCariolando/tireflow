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
      select: {
        id: true,
        reference: true,
        description: true,
        stock: true,
        stockLocation: true,
        cashPrice: true,
        creditPrice: true,
        imagePath: true,
      },
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

  findDistinctActiveReferences(client: PrismaClientOrTransaction = prisma) {
    return client.product.findMany({
      distinct: ['reference'],
      select: {
        reference: true,
      },
      where: {
        isActive: true,
      },
      orderBy: {
        reference: 'asc',
      },
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

  findByReferencesAndDescription(
    references: string[],
    description: string,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.findFirst({
      where: {
        reference: {
          in: references,
        },
        description,
      },
      orderBy: {
        createdAt: 'asc',
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

  updateImagePathIfActive(
    id: string,
    imagePath: string,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.updateMany({
      where: {
        id,
        isActive: true,
      },
      data: {
        imagePath,
      },
    });
  },

  updateStockLocationIfActive(
    id: string,
    stockLocation: string,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.updateMany({
      where: {
        id,
        isActive: true,
      },
      data: {
        stockLocation,
      },
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

  increaseStockIfActive(
    id: string,
    quantity: number,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.updateMany({
      where: {
        id,
        isActive: true,
      },
      data: {
        stock: {
          increment: quantity,
        },
      },
    });
  },

  setStockIfActive(
    id: string,
    stock: number,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.updateMany({
      where: {
        id,
        isActive: true,
      },
      data: {
        stock,
      },
    });
  },

  updatePricesIfActive(
    id: string,
    cashPrice: number,
    creditPrice: number,
    client: PrismaClientOrTransaction = prisma
  ) {
    return client.product.updateMany({
      where: {
        id,
        isActive: true,
      },
      data: {
        cashPrice,
        creditPrice,
      },
    });
  },

  findActiveForStockReport(client: PrismaClientOrTransaction = prisma) {
    return client.product.findMany({
      where: {
        isActive: true,
      },
      orderBy: [
        { stock: 'asc' },
        { reference: 'asc' },
        { description: 'asc' },
      ],
    });
  },
};
