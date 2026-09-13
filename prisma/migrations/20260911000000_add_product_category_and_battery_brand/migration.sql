ALTER TABLE "products" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'TIRE';
ALTER TABLE "products" ADD COLUMN "batteryBrand" TEXT;

CREATE INDEX "products_category_isActive_idx" ON "products"("category", "isActive");
