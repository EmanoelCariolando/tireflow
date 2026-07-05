import { prisma } from '../database/prisma.js';
import type { MovementType, Prisma } from '@prisma/client';

type PrismaClientOrTransaction = Prisma.TransactionClient | typeof prisma;

export const movementRepository = {
  findByCode(code: string, client: PrismaClientOrTransaction = prisma) {
    return client.movement.findUnique({
      where: { code },
      include: {
        product: true,
        user: true,
      },
    });
  },

  create(data: Prisma.MovementCreateInput, client: PrismaClientOrTransaction = prisma) {
    return client.movement.create({
      data,
    });
  },

  countByType(type: MovementType, client: PrismaClientOrTransaction = prisma) {
    return client.movement.count({
      where: { type },
    });
  },

  findRecent(limit = 50, client: PrismaClientOrTransaction = prisma) {
    return client.movement.findMany({
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        product: true,
        user: true,
      },
    });
  },
};
