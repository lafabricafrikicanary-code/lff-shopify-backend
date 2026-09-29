-- V87 · Gestor persistente de familias LFF
CREATE TABLE "LffFamily" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "familyKey" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 999,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "isCustom" BOOLEAN NOT NULL DEFAULT false,
  "aliasesJson" TEXT,
  "logoFileId" TEXT,
  "logoUrl" TEXT,
  "motionFileId" TEXT,
  "motionUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LffFamily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LffFamily_shop_familyKey_key" ON "LffFamily"("shop", "familyKey");
CREATE INDEX "LffFamily_shop_category_sortOrder_idx" ON "LffFamily"("shop", "category", "sortOrder");
