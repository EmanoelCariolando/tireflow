import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCT_UPLOAD_DIRECTORY, PROJECT_ROOT } from '../config/appPaths.js';
export const MAX_PRODUCT_IMAGE_BYTES = 20 * 1024 * 1024;

const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class UnsupportedProductImageError extends Error {
  constructor() {
    super('Unsupported product image format.');
    this.name = 'UnsupportedProductImageError';
  }
}

export class ProductImageTooLargeError extends Error {
  constructor() {
    super('Product image exceeds the maximum allowed size.');
    this.name = 'ProductImageTooLargeError';
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.trim().toLowerCase().split(';')[0] ?? '';
}

function sanitizeProductId(productId: string): string {
  const safeId = productId.replace(/[^a-zA-Z0-9_-]/g, '');
  return safeId || 'unknown';
}

function hasExpectedImageSignature(imageBuffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return imageBuffer.length >= 3 && imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    return (
      imageBuffer.length >= 8 &&
      imageBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }

  if (mimeType === 'image/webp') {
    return (
      imageBuffer.length >= 12 &&
      imageBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      imageBuffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }

  return false;
}

function getSafeAbsolutePath(imagePath: string): string | null {
  if (!imagePath || path.isAbsolute(imagePath)) {
    return null;
  }

  const absolutePath = path.resolve(PROJECT_ROOT, imagePath.replace(/[\\/]+/g, path.sep));
  const relativeToUploads = path.relative(PRODUCT_UPLOAD_DIRECTORY, absolutePath);

  if (
    !relativeToUploads ||
    relativeToUploads.startsWith('..') ||
    path.isAbsolute(relativeToUploads)
  ) {
    return null;
  }

  return absolutePath;
}

export async function saveProductImageFile(
  productId: string,
  mimeType: string,
  base64Data: string
): Promise<string> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const extension = EXTENSION_BY_MIME_TYPE[normalizedMimeType];

  if (!extension || !base64Data) {
    throw new UnsupportedProductImageError();
  }

  const estimatedSize = Math.floor((base64Data.length * 3) / 4);
  if (estimatedSize > MAX_PRODUCT_IMAGE_BYTES) {
    throw new ProductImageTooLargeError();
  }

  const imageBuffer = Buffer.from(base64Data, 'base64');
  if (imageBuffer.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new ProductImageTooLargeError();
  }
  if (!hasExpectedImageSignature(imageBuffer, normalizedMimeType)) {
    throw new UnsupportedProductImageError();
  }

  await mkdir(PRODUCT_UPLOAD_DIRECTORY, { recursive: true });

  const filename = `product-${sanitizeProductId(productId)}-${Date.now()}-${randomUUID()}.${extension}`;
  const absolutePath = path.join(PRODUCT_UPLOAD_DIRECTORY, filename);
  await writeFile(absolutePath, imageBuffer, { flag: 'wx' });

  return path.posix.join('uploads', 'products', filename);
}

export async function readProductImageFile(imagePath: string): Promise<Buffer | null> {
  const absolutePath = getSafeAbsolutePath(imagePath);
  if (!absolutePath) {
    return null;
  }

  try {
    return await readFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function resolveProductImagePath(imagePath: string): string | null {
  return getSafeAbsolutePath(imagePath);
}

export function hasProductImageFile(imagePath: string | null | undefined): boolean {
  if (!imagePath) {
    return false;
  }

  const absolutePath = getSafeAbsolutePath(imagePath);
  return absolutePath !== null && existsSync(absolutePath);
}

export async function deleteProductImageFile(imagePath: string): Promise<boolean> {
  const absolutePath = getSafeAbsolutePath(imagePath);
  if (!absolutePath) {
    return false;
  }

  try {
    await unlink(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
