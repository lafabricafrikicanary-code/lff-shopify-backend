-- CreateTable
CREATE TABLE "ArcadeDiscountCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "source" TEXT NOT NULL DEFAULT 'precreated',
    "assignedToEmail" TEXT,
    "assignedCustomerId" TEXT,
    "assignedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ArcadeDiscountCode_code_key" ON "ArcadeDiscountCode"("code");

-- CreateIndex
CREATE INDEX "ArcadeDiscountCode_shop_discountPercent_status_idx" ON "ArcadeDiscountCode"("shop", "discountPercent", "status");
