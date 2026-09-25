-- CreateTable
CREATE TABLE "CommercialUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "captureCode" TEXT NOT NULL,
    "personalCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "shopifyCaptureDiscountId" TEXT,
    "shopifyPersonalDiscountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommercialCustomerAttribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "commercialId" TEXT NOT NULL,
    "customerGid" TEXT,
    "customerEmail" TEXT,
    "orderGid" TEXT,
    "sourceCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "firstOrderAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommercialCustomerAttribution_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "CommercialUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "commercialId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT,
    "basisCents" INTEGER NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_validation',
    "validationDate" DATETIME,
    "payoutId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Commission_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "CommercialUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME
);

-- CreateTable
CREATE TABLE "B2BCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "referredByCode" TEXT,
    "commercialId" TEXT,
    "priceTier" TEXT NOT NULL DEFAULT 'direct_60',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArcadeRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerGid" TEXT,
    "email" TEXT,
    "keysSpent" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DiscountIssuance" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContactRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialUser_captureCode_key" ON "CommercialUser"("captureCode");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialUser_personalCode_key" ON "CommercialUser"("personalCode");

-- CreateIndex
CREATE INDEX "CommercialCustomerAttribution_shop_customerEmail_idx" ON "CommercialCustomerAttribution"("shop", "customerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialCustomerAttribution_shop_customerGid_key" ON "CommercialCustomerAttribution"("shop", "customerGid");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_shop_orderGid_commercialId_key" ON "Commission"("shop", "orderGid", "commercialId");

-- CreateIndex
CREATE INDEX "B2BCompany_shop_referredByCode_idx" ON "B2BCompany"("shop", "referredByCode");

-- CreateIndex
CREATE UNIQUE INDEX "ArcadeRedemption_code_key" ON "ArcadeRedemption"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountIssuance_code_key" ON "DiscountIssuance"("code");
