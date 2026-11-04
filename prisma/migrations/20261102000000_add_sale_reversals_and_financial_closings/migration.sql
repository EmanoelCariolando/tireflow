CREATE TABLE "financial_closings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "period" TEXT NOT NULL,
  "closedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedById" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "financialText" TEXT NOT NULL,
  "commissionText" TEXT NOT NULL,
  FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "financial_closings_period_key" ON "financial_closings"("period");

CREATE TABLE "financial_closing_sellers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "closingId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "paidAt" DATETIME,
  "paidById" TEXT,
  FOREIGN KEY ("closingId") REFERENCES "financial_closings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "financial_closing_sellers_closingId_sellerId_key" ON "financial_closing_sellers"("closingId", "sellerId");

CREATE TABLE "sale_reversals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestJson" TEXT NOT NULL,
  "saleGroupCode" TEXT NOT NULL,
  "authorizedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sale_reversals_code_key" ON "sale_reversals"("code");
CREATE UNIQUE INDEX "sale_reversals_operationId_key" ON "sale_reversals"("operationId");
CREATE INDEX "sale_reversals_createdAt_idx" ON "sale_reversals"("createdAt");
CREATE INDEX "sale_reversals_saleGroupCode_idx" ON "sale_reversals"("saleGroupCode");

CREATE TABLE "sale_reversal_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reversalId" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "amount" DECIMAL NOT NULL CHECK ("amount" >= 0),
  "paymentDetails" TEXT NOT NULL,
  FOREIGN KEY ("reversalId") REFERENCES "sale_reversals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("movementId") REFERENCES "movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sale_reversal_items_reversalId_movementId_key" ON "sale_reversal_items"("reversalId", "movementId");
CREATE UNIQUE INDEX "sale_reversal_items_reversalId_position_key" ON "sale_reversal_items"("reversalId", "position");
CREATE INDEX "sale_reversal_items_movementId_idx" ON "sale_reversal_items"("movementId");

CREATE TABLE "sale_reversal_returns" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "operationId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "reversalItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "authorizedById" TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("reversalItemId") REFERENCES "sale_reversal_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("movementId") REFERENCES "movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sale_reversal_returns_operationId_key" ON "sale_reversal_returns"("operationId");
CREATE UNIQUE INDEX "sale_reversal_returns_movementId_key" ON "sale_reversal_returns"("movementId");
CREATE INDEX "sale_reversal_returns_reversalItemId_idx" ON "sale_reversal_returns"("reversalItemId");

CREATE TABLE "commission_adjustments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reversalItemId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "amount" DECIMAL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closingId" TEXT,
  FOREIGN KEY ("reversalItemId") REFERENCES "sale_reversal_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("closingId") REFERENCES "financial_closings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "commission_adjustments_reversalItemId_key" ON "commission_adjustments"("reversalItemId");
CREATE INDEX "commission_adjustments_closingId_createdAt_idx" ON "commission_adjustments"("closingId", "createdAt");
