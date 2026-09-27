-- PostgreSQL baseline for La Fabrica Friki backend.
-- This migration targets a NEW empty PostgreSQL database.

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommercialUser" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "captureCode" TEXT NOT NULL,
    "personalCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "shopifyCaptureDiscountId" TEXT,
    "shopifyPersonalDiscountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommercialUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommercialCustomerAttribution" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "commercialId" TEXT NOT NULL,
    "customerGid" TEXT,
    "customerEmail" TEXT,
    "orderGid" TEXT,
    "sourceCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "firstOrderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommercialCustomerAttribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "commercialId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT,
    "basisCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_validation',
    "validationDate" TIMESTAMP(3),
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "B2BCompany" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "referredByCode" TEXT,
    "commercialId" TEXT,
    "priceTier" TEXT NOT NULL DEFAULT 'direct_60',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "B2BCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArcadeRedemption" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerGid" TEXT,
    "email" TEXT,
    "keysSpent" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    CONSTRAINT "ArcadeRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArcadeDiscountCode" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "source" TEXT NOT NULL DEFAULT 'precreated',
    "assignedToEmail" TEXT,
    "assignedCustomerId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArcadeDiscountCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscountIssuance" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "percent" INTEGER NOT NULL,
    "usageLimit" INTEGER,
    "combinesWithJson" TEXT,
    "shopifyDiscountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscountIssuance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payloadJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detailsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactRequest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialUser_captureCode_key" ON "CommercialUser"("captureCode");
CREATE UNIQUE INDEX "CommercialUser_personalCode_key" ON "CommercialUser"("personalCode");
CREATE INDEX "CommercialCustomerAttribution_shop_customerEmail_idx" ON "CommercialCustomerAttribution"("shop", "customerEmail");
CREATE UNIQUE INDEX "CommercialCustomerAttribution_shop_customerGid_key" ON "CommercialCustomerAttribution"("shop", "customerGid");
CREATE UNIQUE INDEX "Commission_shop_orderGid_commercialId_key" ON "Commission"("shop", "orderGid", "commercialId");
CREATE INDEX "B2BCompany_shop_referredByCode_idx" ON "B2BCompany"("shop", "referredByCode");
CREATE UNIQUE INDEX "ArcadeRedemption_code_key" ON "ArcadeRedemption"("code");
CREATE UNIQUE INDEX "ArcadeDiscountCode_code_key" ON "ArcadeDiscountCode"("code");
CREATE INDEX "ArcadeDiscountCode_shop_discountPercent_status_idx" ON "ArcadeDiscountCode"("shop", "discountPercent", "status");
CREATE UNIQUE INDEX "DiscountIssuance_code_key" ON "DiscountIssuance"("code");

ALTER TABLE "CommercialCustomerAttribution"
  ADD CONSTRAINT "CommercialCustomerAttribution_commercialId_fkey"
  FOREIGN KEY ("commercialId") REFERENCES "CommercialUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Commission"
  ADD CONSTRAINT "Commission_commercialId_fkey"
  FOREIGN KEY ("commercialId") REFERENCES "CommercialUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Commission"
  ADD CONSTRAINT "Commission_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
