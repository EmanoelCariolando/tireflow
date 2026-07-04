import { prisma } from '../database/prisma.js';
import type { Prisma } from '@prisma/client';

export const sessionRepository = {
  findUserSession(userId: string, chatId: string) {
    return prisma.userSession.findUnique({
      where: {
        userId_chatId: {
          userId,
          chatId,
        },
      },
    });
  },

  upsertUserSession(
    userId: string,
    chatId: string,
    data: Omit<Prisma.UserSessionUncheckedCreateInput, 'id' | 'userId' | 'chatId' | 'createdAt' | 'updatedAt'>,
  ) {
    return prisma.userSession.upsert({
      where: {
        userId_chatId: {
          userId,
          chatId,
        },
      },
      create: {
        userId,
        chatId,
        ...data,
      },
      update: data,
    });
  },

  deleteUserSession(userId: string, chatId: string) {
    return prisma.userSession.deleteMany({
      where: {
        userId,
        chatId,
      },
    });
  },

  findSearchSession(userId: string, chatId: string) {
    return prisma.searchSession.findUnique({
      where: {
        userId_chatId: {
          userId,
          chatId,
        },
      },
    });
  },

  upsertSearchSession(
    userId: string,
    chatId: string,
    data: Omit<Prisma.SearchSessionUncheckedCreateInput, 'id' | 'userId' | 'chatId' | 'createdAt'>,
  ) {
    return prisma.searchSession.upsert({
      where: {
        userId_chatId: {
          userId,
          chatId,
        },
      },
      create: {
        userId,
        chatId,
        ...data,
      },
      update: data,
    });
  },

  deleteSearchSession(userId: string, chatId: string) {
    return prisma.searchSession.deleteMany({
      where: {
        userId,
        chatId,
      },
    });
  },
};
