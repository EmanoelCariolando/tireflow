import { prisma } from '../database/prisma.js';

// Only the dates and fields needed by the report; never load all open pendencies.
export const pendingSaleReportRepository = {
  findByDateRange(start: Date, end: Date) {
    return prisma.pendingSale.findMany({
      where: { OR: [
        { createdAt: { gte: start, lt: end } },
        { resolvedAt: { gte: start, lt: end } },
      ] },
      select: {
        code: true, createdAt: true, resolvedAt: true, status: true, completedSaleGroupCode: true,
        createdBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
        items: {
          orderBy: { position: 'asc' },
          select: {
            productId: true, reference: true, description: true, quantity: true, previousStock: true, reservedStock: true,
            product: { select: { stockLocation: true, category: true } },
          },
        },
      },
    });
  },
};

export type ReportPendingSale = Awaited<ReturnType<typeof pendingSaleReportRepository.findByDateRange>>[number];
