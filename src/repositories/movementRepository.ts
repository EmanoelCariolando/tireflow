import { prisma } from '../database/prisma.js';
import type { Prisma } from '@prisma/client';

export const movementRepository = {
  findByCode(code: string) {
    return prisma.movement.findUnique({
      where: { code },
      include: {
        product: true,
        user: true,
      },
    });
  },

  create(data: Prisma.MovementCreateInput) {
    return prisma.movement.create({
      data,
    });
  },

  findRecent(limit = 50) {
    return prisma.movement.findMany({
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
