import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  deleteProductImageFile,
  hasProductImageFile,
  MAX_PRODUCT_IMAGE_BYTES,
  ProductImageTooLargeError,
  readProductImageFile,
  resolveProductImagePath,
  saveProductImageFile,
  UnsupportedProductImageError,
} from '../src/services/productPhotoStorage.js';
import { replaceProductPhoto } from '../src/services/productPhotoService.js';
import { productRepository } from '../src/repositories/productRepository.js';

const validImages = [
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), '.jpg'],
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), '.png'],
  ['image/webp', Buffer.from('RIFF0000WEBP', 'ascii'), '.webp'],
] as const;

test('salva JPEG, PNG e WebP com nome próprio seguro e caminho relativo', async () => {
  for (const [mimeType, buffer, extension] of validImages) {
    const imagePath = await saveProductImageFile('../unsafe product', mimeType, buffer.toString('base64'));
    assert.match(imagePath, /^uploads\/products\/product-unsafeproduct-/);
    assert.ok(imagePath.endsWith(extension));
    assert.equal(hasProductImageFile(imagePath), true);
    assert.deepEqual(await readProductImageFile(imagePath), buffer);
    assert.equal(await deleteProductImageFile(imagePath), true);
    assert.equal(hasProductImageFile(imagePath), false);
  }
});

test('rejeita MIME não suportado e conteúdo que não corresponde ao formato', async () => {
  await assert.rejects(
    saveProductImageFile('product', 'image/gif', Buffer.from('GIF89a').toString('base64')),
    UnsupportedProductImageError
  );
  await assert.rejects(
    saveProductImageFile('product', 'image/jpeg', Buffer.from('not an image').toString('base64')),
    UnsupportedProductImageError
  );
});

test('rejeita imagem acima de 20 MB antes de gravar no disco', async () => {
  const oversizedImage = Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1);
  oversizedImage.set([0xff, 0xd8, 0xff], 0);

  await assert.rejects(
    saveProductImageFile('oversized-product', 'image/jpeg', oversizedImage.toString('base64')),
    ProductImageTooLargeError
  );
});

test('não resolve nem apaga caminhos fora de uploads/products', async () => {
  assert.equal(resolveProductImagePath('../package.json'), null);
  assert.equal(hasProductImageFile('../package.json'), false);
  assert.equal(await deleteProductImageFile('../package.json'), false);
  assert.ok((await readFile('package.json', 'utf8')).includes('"name": "tireflow"'));
});

test('schema e migration persistem imagePath fora da sessão da aplicação', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const migration = await readFile(
    'prisma/migrations/20260718000000_add_product_image_path/migration.sql',
    'utf8'
  );
  assert.match(schema, /imagePath\s+String\?/);
  assert.match(migration, /ALTER TABLE "products" ADD COLUMN "imagePath" TEXT/);
});

test('substituição associa o novo caminho e remove com segurança o arquivo anterior', async () => {
  const oldImagePath = await saveProductImageFile(
    'replacement-product',
    'image/jpeg',
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')
  );
  let persistedImagePath = oldImagePath;
  const mutableRepository = productRepository as unknown as {
    findById: (id: string) => Promise<Record<string, unknown> | null>;
    updateImagePathIfActive: (id: string, imagePath: string) => Promise<{ count: number }>;
  };
  const originalFindById = mutableRepository.findById;
  const originalUpdateImagePath = mutableRepository.updateImagePathIfActive;
  let newImagePath: string | undefined;

  mutableRepository.findById = async (id: string) => ({
    id,
    reference: '175/70/14',
    description: 'ITARO 203',
    imagePath: persistedImagePath,
    stock: 9,
    minStock: 0,
    cashPrice: 299,
    creditPrice: 313.95,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mutableRepository.updateImagePathIfActive = async (_id: string, imagePath: string) => {
    persistedImagePath = imagePath;
    return { count: 1 };
  };

  try {
    const result = await replaceProductPhoto(
      'replacement-product',
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    );
    newImagePath = result.imagePath;
    assert.equal(result.replaced, true);
    assert.equal(persistedImagePath, result.imagePath);
    assert.equal(await readProductImageFile(oldImagePath), null);
    assert.ok(await readProductImageFile(result.imagePath));
  } finally {
    mutableRepository.findById = originalFindById;
    mutableRepository.updateImagePathIfActive = originalUpdateImagePath;
    if (newImagePath) {
      await deleteProductImageFile(newImagePath);
    }
    await deleteProductImageFile(oldImagePath);
  }
});
