-- LFF Backend V92 · Pedidos rápidos B2B reales mediante Draft Orders de Shopify.
CREATE TABLE "B2BQuickOrder" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "commercialId" TEXT,
  "draftOrderGid" TEXT,
  "draftOrderName" TEXT,
  "orderGid" TEXT,
  "orderName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'creating',
  "discountPercent" INTEGER NOT NULL,
  "originalSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  "professionalTotalCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT,
  "itemsJson" TEXT NOT NULL,
  "invoiceUrl" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "B2BQuickOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "B2BQuickOrder_shop_draftOrderGid_key" ON "B2BQuickOrder"("shop", "draftOrderGid");
CREATE INDEX "B2BQuickOrder_shop_companyId_createdAt_idx" ON "B2BQuickOrder"("shop", "companyId", "createdAt");
CREATE INDEX "B2BQuickOrder_shop_status_createdAt_idx" ON "B2BQuickOrder"("shop", "status", "createdAt");
CREATE INDEX "B2BQuickOrder_shop_orderGid_idx" ON "B2BQuickOrder"("shop", "orderGid");
ALTER TABLE "B2BQuickOrder" ADD CONSTRAINT "B2BQuickOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "B2BCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
