-- Optional for compatibility with historical movements; new entries always provide it.
ALTER TABLE "movements" ADD COLUMN "invoiceNumber" TEXT;

CREATE INDEX "movements_invoiceNumber_idx" ON "movements"("invoiceNumber");
