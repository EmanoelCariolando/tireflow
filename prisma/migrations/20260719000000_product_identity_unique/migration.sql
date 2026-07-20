-- Prevent duplicate products when seed/import is executed repeatedly.
CREATE UNIQUE INDEX "products_reference_description_key" ON "products"("reference", "description");
