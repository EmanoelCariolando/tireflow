-- CreateTable
CREATE TABLE "pending_sales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "assignedUserId" TEXT NOT NULL,
    "totalValue" DECIMAL NOT NULL,
    "originalTotalValue" DECIMAL,
    "discountPercent" DECIMAL,
    "discountAmount" DECIMAL,
    "completedSaleGroupCode" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pending_sales_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pending_sales_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pending_sale_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pendingSaleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cashPrice" DECIMAL NOT NULL,
    "creditPrice" DECIMAL NOT NULL,
    "priceType" TEXT NOT NULL,
    "unitPrice" DECIMAL NOT NULL,
    "totalValue" DECIMAL NOT NULL,
    "previousStock" INTEGER NOT NULL,
    "reservedStock" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_sale_items_pendingSaleId_fkey" FOREIGN KEY ("pendingSaleId") REFERENCES "pending_sales" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pending_sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_sales_code_key" ON "pending_sales"("code");

-- CreateIndex
CREATE INDEX "pending_sales_status_createdAt_idx" ON "pending_sales"("status", "createdAt");

-- CreateIndex
CREATE INDEX "pending_sales_assignedUserId_status_idx" ON "pending_sales"("assignedUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pending_sale_items_pendingSaleId_position_key" ON "pending_sale_items"("pendingSaleId", "position");

-- CreateIndex
CREATE INDEX "pending_sale_items_productId_idx" ON "pending_sale_items"("productId");
