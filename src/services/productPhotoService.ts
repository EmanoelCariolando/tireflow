import type { Product } from '@prisma/client';
import { productRepository } from '../repositories/productRepository.js';
import {
  deleteProductImageFile,
  saveProductImageFile,
} from './productPhotoStorage.js';
import { withInventoryMutationLock } from './inventoryMutationLock.js';

export class ProductPhotoProductNotFoundError extends Error {
  constructor() {
    super('Product is not active or no longer exists.');
    this.name = 'ProductPhotoProductNotFoundError';
  }
}

export interface ReplaceProductPhotoResult {
  product: Product;
  imagePath: string;
  replaced: boolean;
}

export async function getActiveProductForPhoto(productId: string): Promise<Product | null> {
  const product = await productRepository.findById(productId);
  return product?.isActive ? product : null;
}

export async function replaceProductPhoto(
  productId: string,
  mimeType: string,
  base64Data: string
): Promise<ReplaceProductPhotoResult> {
  return withInventoryMutationLock(() => replaceProductPhotoLocked(productId, mimeType, base64Data));
}

async function replaceProductPhotoLocked(
  productId: string,
  mimeType: string,
  base64Data: string
): Promise<ReplaceProductPhotoResult> {
  const product = await getActiveProductForPhoto(productId);
  if (!product) {
    throw new ProductPhotoProductNotFoundError();
  }

  const imagePath = await saveProductImageFile(productId, mimeType, base64Data);

  try {
    const updated = await productRepository.updateImagePathIfActive(productId, imagePath);
    if (updated.count === 0) {
      throw new ProductPhotoProductNotFoundError();
    }
  } catch (error) {
    await deleteProductImageFile(imagePath).catch((cleanupError: unknown) => {
      console.warn('[PRODUCT_PHOTO] Could not remove an unassociated image file.', cleanupError);
    });
    throw error;
  }

  if (product.imagePath && product.imagePath !== imagePath) {
    await deleteProductImageFile(product.imagePath).catch((error: unknown) => {
      console.warn('[PRODUCT_PHOTO] Old product image could not be removed safely.', {
        productId,
        error,
      });
    });
  }

  return {
    product,
    imagePath,
    replaced: Boolean(product.imagePath),
  };
}
