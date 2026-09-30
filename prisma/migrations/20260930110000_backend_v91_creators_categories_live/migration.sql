-- V91 · YouTubers/creadores, categorias publicables, vinculacion familia->creador,
-- atribucion por ultimo codigo valido, compras propias y presencia de trafico en tiempo real.

ALTER TABLE "CommercialUser"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'commercial',
  ADD COLUMN "brandName" TEXT,
  ADD COLUMN "promoPercent" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "firstSaleRateBps" INTEGER NOT NULL DEFAULT 3000,
  ADD COLUMN "referralRateBps" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "ownProductRateBps" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CommercialApplication"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'commercial',
  ADD COLUMN "brandName" TEXT,
  ADD COLUMN "promoPercent" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "Commission"
  ADD COLUMN "commissionType" TEXT NOT NULL DEFAULT 'commercial',
  ADD COLUMN "detailsJson" TEXT;

ALTER TABLE "BoxSubscription"
  ADD COLUMN "country" TEXT;

ALTER TABLE "LffFamily"
  ADD COLUMN "creatorId" TEXT;

CREATE INDEX "LffFamily_shop_creatorId_idx" ON "LffFamily"("shop", "creatorId");
ALTER TABLE "LffFamily" ADD CONSTRAINT "LffFamily_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "CommercialUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LffCategory" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "categoryKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 999,
  "state" TEXT NOT NULL DEFAULT 'published',
  "isCustom" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LffCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LffCategory_shop_categoryKey_key" ON "LffCategory"("shop", "categoryKey");
CREATE UNIQUE INDEX "LffCategory_shop_name_key" ON "LffCategory"("shop", "name");
CREATE INDEX "LffCategory_shop_state_sortOrder_idx" ON "LffCategory"("shop", "state", "sortOrder");

CREATE TABLE "CreatorProduct" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "productHandle" TEXT,
  "familyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreatorProduct_shop_productGid_key" ON "CreatorProduct"("shop", "productGid");
CREATE INDEX "CreatorProduct_shop_creatorId_idx" ON "CreatorProduct"("shop", "creatorId");
CREATE INDEX "CreatorProduct_shop_familyKey_idx" ON "CreatorProduct"("shop", "familyKey");
ALTER TABLE "CreatorProduct" ADD CONSTRAINT "CreatorProduct_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "CommercialUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommercialOwnPurchase" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "commercialId" TEXT NOT NULL,
  "orderGid" TEXT NOT NULL,
  "orderName" TEXT,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT,
  "code" TEXT NOT NULL,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialOwnPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialOwnPurchase_shop_orderGid_commercialId_key"
  ON "CommercialOwnPurchase"("shop", "orderGid", "commercialId");
CREATE INDEX "CommercialOwnPurchase_shop_commercialId_createdAt_idx"
  ON "CommercialOwnPurchase"("shop", "commercialId", "createdAt");
ALTER TABLE "CommercialOwnPurchase" ADD CONSTRAINT "CommercialOwnPurchase_commercialId_fkey"
  FOREIGN KEY ("commercialId") REFERENCES "CommercialUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrafficPresence" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "sessionKey" TEXT,
  "customerId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'web',
  "sourceDetail" TEXT,
  "commercialCode" TEXT,
  "companyId" TEXT,
  "path" TEXT,
  "referrer" TEXT,
  "ipHash" TEXT,
  "countryCode" TEXT,
  "country" TEXT,
  "region" TEXT,
  "city" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "userAgent" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrafficPresence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrafficPresence_shop_visitorId_key" ON "TrafficPresence"("shop", "visitorId");
CREATE INDEX "TrafficPresence_shop_lastSeenAt_idx" ON "TrafficPresence"("shop", "lastSeenAt");
CREATE INDEX "TrafficPresence_shop_source_lastSeenAt_idx" ON "TrafficPresence"("shop", "source", "lastSeenAt");
CREATE INDEX "TrafficPresence_shop_ipHash_idx" ON "TrafficPresence"("shop", "ipHash");
