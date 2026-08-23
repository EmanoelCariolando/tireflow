import { MovementType } from '@prisma/client';
import { prisma } from '../database/prisma.js';
import { movementRepository } from '../repositories/movementRepository.js';
import { productRepository } from '../repositories/productRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateMovementCode } from '../utils/generateMovementCode.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';
import { calculateCreditPrice } from '../utils/productPricing.js';
import { normalizeStockLocation } from '../utils/stockLocation.js';

export class EntryProductNotFoundError extends Error {
  constructor() {
    super('Entry product was not found or is inactive.');
  }
}

export interface RegisterEntryItemInput {
  productId: string;
  quantity: number;
  supplier: string;
  stockLocation?: string;
  newCashPrice?: number;
}

interface RegisterEntryInput extends RegisterEntryItemInput {
  invoiceName?: string;
  invoiceNumber?: string;
  responsiblePhone: string;
  responsibleName: string;
}

interface RegisterEntryItemsInput {
  items: RegisterEntryItemInput[];
  invoiceName?: string;
  invoiceNumber?: string;
  responsiblePhone: string;
  responsibleName: string;
}

export interface RegisteredEntry {
  productId: string;
  movementCode: string;
  previousStock: number;
  currentStock: number;
  previousLocation: string | null;
  currentLocation: string | null;
}

export interface RegisteredEntryGroup {
  items: RegisteredEntry[];
}

export async function registerEntry(input: RegisterEntryInput): Promise<RegisteredEntry> {
  const registeredGroup = await registerEntryItems({
    items: [{
      productId: input.productId,
      quantity: input.quantity,
      supplier: input.supplier,
      stockLocation: input.stockLocation,
      newCashPrice: input.newCashPrice,
    }],
    invoiceName: input.invoiceName,
    invoiceNumber: input.invoiceNumber,
    responsiblePhone: input.responsiblePhone,
    responsibleName: input.responsibleName,
  });
  return registeredGroup.items[0]!;
}

export async function registerEntryItems(
  input: RegisterEntryItemsInput
): Promise<RegisteredEntryGroup> {
  if (!hasValidEntryItems(input.items)) {
    throw new Error('Invalid entry items.');
  }

  if (input.invoiceName !== undefined && !input.invoiceName.trim()) {
    throw new Error('Invalid entry invoice name.');
  }

  if (input.invoiceNumber !== undefined && !input.invoiceNumber.trim()) {
    throw new Error('Invalid entry invoice number.');
  }

  return withInventoryMutationLock(() => prisma.$transaction(async (tx) => {
    const responsible = await userRepository.upsertByPhone(
      input.responsiblePhone,
      input.responsibleName,
      tx
    );
    const entryCount = await movementRepository.countByType(MovementType.ENTRY, tx);
    const priceChangeCount = await movementRepository.countByType(MovementType.PRICE_CHANGE, tx);
    const registeredItems: RegisteredEntry[] = [];
    let priceMovementOffset = 0;

    for (const [index, item] of input.items.entries()) {
      const product = await productRepository.findById(item.productId, tx);

      if (!product || !product.isActive) {
        throw new EntryProductNotFoundError();
      }

      const previousStock = product.stock;

      if (item.stockLocation !== undefined) {
        const locationUpdate = await productRepository.updateStockLocationIfActive(
          item.productId,
          item.stockLocation,
          tx
        );

        if (locationUpdate.count === 0) {
          throw new EntryProductNotFoundError();
        }
      }

      if (item.newCashPrice !== undefined) {
        const newCreditPrice = calculateCreditPrice(item.newCashPrice);
        const priceUpdate = await productRepository.updatePricesIfActive(
          item.productId,
          item.newCashPrice,
          newCreditPrice,
          tx
        );

        if (priceUpdate.count === 0) {
          throw new EntryProductNotFoundError();
        }

        priceMovementOffset += 1;
        const priceMovementCode = generateMovementCode(
          'P',
          priceChangeCount + priceMovementOffset
        );

        await movementRepository.create(
          {
            code: priceMovementCode,
            type: MovementType.PRICE_CHANGE,
            product: { connect: { id: item.productId } },
            user: { connect: { id: responsible.id } },
            unitPrice: item.newCashPrice,
            totalValue: newCreditPrice,
            observation: JSON.stringify({
              oldCashPrice: Number(product.cashPrice),
              newCashPrice: item.newCashPrice,
              oldCreditPrice: Number(product.creditPrice),
              newCreditPrice,
            }),
            reason: 'Alteração de preço na entrada',
          },
          tx
        );
      }

      const stockUpdate = await productRepository.increaseStockIfActive(
        item.productId,
        item.quantity,
        tx
      );

      if (stockUpdate.count === 0) {
        throw new EntryProductNotFoundError();
      }

      const updatedProduct = await productRepository.findById(item.productId, tx);

      if (!updatedProduct) {
        throw new EntryProductNotFoundError();
      }

      const movementCode = generateMovementCode('E', entryCount + index + 1);

      await movementRepository.create(
        {
          code: movementCode,
          type: MovementType.ENTRY,
          product: {
            connect: { id: item.productId },
          },
          user: {
            connect: { id: responsible.id },
          },
          quantity: item.quantity,
          previousStock,
          newStock: updatedProduct.stock,
          supplier: item.supplier,
          invoiceName: input.invoiceName,
          invoiceNumber: input.invoiceNumber,
        },
        tx
      );

      registeredItems.push({
        productId: item.productId,
        movementCode,
        previousStock,
        currentStock: updatedProduct.stock,
        previousLocation: normalizeStockLocation(product.stockLocation),
        currentLocation: normalizeStockLocation(updatedProduct.stockLocation),
      });
    }

    return { items: registeredItems };
  }));
}

function hasValidEntryItems(items: RegisterEntryItemInput[]): boolean {
  return items.length > 0 && items.every((item) =>
    Boolean(item.productId) &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0 &&
    Boolean(item.supplier.trim()) &&
    (item.stockLocation === undefined ||
      normalizeStockLocation(item.stockLocation) === item.stockLocation) &&
    (item.newCashPrice === undefined ||
      (Number.isFinite(item.newCashPrice) && item.newCashPrice >= 0))
  );
}
