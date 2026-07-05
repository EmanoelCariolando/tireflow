import { prisma } from '../database/prisma.js';
import type { Prisma } from '@prisma/client';

type PrismaClientOrTransaction = Prisma.TransactionClient | typeof prisma;

export const userRepository = {
  findById(id: string, client: PrismaClientOrTransaction = prisma) {
    return client.user.findUnique({
      where: { id },
    });
  },

  findByPhone(phone: string, client: PrismaClientOrTransaction = prisma) {
    return client.user.findUnique({
      where: { phone },
    });
  },

  create(data: Prisma.UserCreateInput, client: PrismaClientOrTransaction = prisma) {
    return client.user.create({
      data,
    });
  },

  update(id: string, data: Prisma.UserUpdateInput, client: PrismaClientOrTransaction = prisma) {
    return client.user.update({
      where: { id },
      data,
    });
  },

  upsertByPhone(phone: string, name: string, client: PrismaClientOrTransaction = prisma) {
    return client.user.upsert({
      where: { phone },
      update: {
        name,
        isActive: true,
      },
      create: {
        phone,
        name,
      },
    });
  },
};
