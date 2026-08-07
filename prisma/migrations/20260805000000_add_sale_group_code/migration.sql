-- Groups the stock movements that belong to the same multi-item sale.
ALTER TABLE "movements" ADD COLUMN "saleGroupCode" TEXT;

CREATE INDEX "movements_saleGroupCode_idx" ON "movements"("saleGroupCode");
