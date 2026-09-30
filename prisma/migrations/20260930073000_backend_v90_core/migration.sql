-- V90 · Persistencia real: favoritos/retención, reseñas, gastos, clientes/Club/Caja,
-- comerciales/pagos, B2B, tráfico propio, recuperación de acceso y cola de mensajería.

-- Ampliación B2B existente.
ALTER TABLE "B2BCompany"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordSalt" TEXT,
  ADD COLUMN "forceChange" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "shopifyCustomerId" TEXT,
  ADD COLUMN "firstOrderUsed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedAt" TIMESTAMP(3);

CREATE INDEX "B2BCompany_shop_contactEmail_idx" ON "B2BCompany"("shop", "contactEmail");
CREATE INDEX "B2BCompany_shop_status_idx" ON "B2BCompany"("shop", "status");

-- Ampliación pagos comerciales.
ALTER TABLE "Payout"
  ADD COLUMN "commercialId" TEXT,
  ADD COLUMN "method" TEXT,
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "paidBy" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Payout" ALTER COLUMN "updatedAt" DROP DEFAULT;
CREATE INDEX "Payout_shop_commercialId_status_idx" ON "Payout"("shop", "commercialId", "status");


CREATE TABLE "B2BOrder" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "commercialId" TEXT,
  "orderGid" TEXT NOT NULL,
  "orderName" TEXT,
  "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT,
  "status" TEXT NOT NULL DEFAULT 'paid',
  "paidAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "refundedCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "B2BOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "B2BOrder_shop_orderGid_companyId_key" ON "B2BOrder"("shop", "orderGid", "companyId");
CREATE INDEX "B2BOrder_shop_companyId_createdAt_idx" ON "B2BOrder"("shop", "companyId", "createdAt");
CREATE INDEX "B2BOrder_shop_commercialId_createdAt_idx" ON "B2BOrder"("shop", "commercialId", "createdAt");
ALTER TABLE "B2BOrder" ADD CONSTRAINT "B2BOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "B2BCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustomerAccount" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "passwordHash" TEXT NOT NULL,
  "passwordSalt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
  "forceChange" BOOLEAN NOT NULL DEFAULT false,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "shopifyCustomerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerAccount_shop_email_key" ON "CustomerAccount"("shop", "email");
CREATE INDEX "CustomerAccount_shop_status_idx" ON "CustomerAccount"("shop", "status");
CREATE INDEX "CustomerAccount_shop_shopifyCustomerId_idx" ON "CustomerAccount"("shop", "shopifyCustomerId");

CREATE TABLE "CustomerSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");
CREATE INDEX "CustomerSession_customerId_expiresAt_idx" ON "CustomerSession"("customerId", "expiresAt");
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ClubProfile" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "marketingConsent" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClubProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClubProfile_customerId_key" ON "ClubProfile"("customerId");
CREATE INDEX "ClubProfile_shop_email_idx" ON "ClubProfile"("shop", "email");
ALTER TABLE "ClubProfile" ADD CONSTRAINT "ClubProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BoxSubscription" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "customerId" TEXT,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "postal" TEXT,
  "city" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_payment',
  "monthlyPriceCents" INTEGER NOT NULL DEFAULT 1500,
  "monthlyVoucherCents" INTEGER NOT NULL DEFAULT 1500,
  "provider" TEXT,
  "providerSubscriptionId" TEXT,
  "startedAt" TIMESTAMP(3),
  "nextRenewalAt" TIMESTAMP(3),
  "nextBoxAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BoxSubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BoxSubscription_shop_email_status_idx" ON "BoxSubscription"("shop", "email", "status");
CREATE INDEX "BoxSubscription_customerId_status_idx" ON "BoxSubscription"("customerId", "status");
ALTER TABLE "BoxSubscription" ADD CONSTRAINT "BoxSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BoxVoucher" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 1500,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "shopifyDiscountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "redeemedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "BoxVoucher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BoxVoucher_code_key" ON "BoxVoucher"("code");
CREATE INDEX "BoxVoucher_shop_status_idx" ON "BoxVoucher"("shop", "status");
ALTER TABLE "BoxVoucher" ADD CONSTRAINT "BoxVoucher_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BoxSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Favorite" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "visitorId" TEXT,
  "customerId" TEXT,
  "customerEmail" TEXT,
  "productGid" TEXT NOT NULL,
  "productHandle" TEXT,
  "productTitle" TEXT,
  "productImage" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "firstFavoritedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastFavoritedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "purchasedAt" TIMESTAMP(3),
  "orderGid" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Favorite_shop_identityKey_productGid_key" ON "Favorite"("shop", "identityKey", "productGid");
CREATE INDEX "Favorite_shop_customerId_productGid_idx" ON "Favorite"("shop", "customerId", "productGid");
CREATE INDEX "Favorite_shop_customerEmail_productGid_idx" ON "Favorite"("shop", "customerEmail", "productGid");
CREATE INDEX "Favorite_shop_status_lastFavoritedAt_idx" ON "Favorite"("shop", "status", "lastFavoritedAt");

CREATE TABLE "RetentionCampaign" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "favoriteId" TEXT NOT NULL,
  "productGid" TEXT NOT NULL,
  "customerId" TEXT,
  "customerEmail" TEXT,
  "percent" INTEGER NOT NULL DEFAULT 20,
  "status" TEXT NOT NULL DEFAULT 'waiting',
  "code" TEXT,
  "shopifyDiscountId" TEXT,
  "eligibleAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "redeemedAt" TIMESTAMP(3),
  "purchasedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetentionCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetentionCampaign_favoriteId_key" ON "RetentionCampaign"("favoriteId");
CREATE UNIQUE INDEX "RetentionCampaign_code_key" ON "RetentionCampaign"("code");
CREATE INDEX "RetentionCampaign_shop_status_eligibleAt_idx" ON "RetentionCampaign"("shop", "status", "eligibleAt");
CREATE INDEX "RetentionCampaign_shop_customerEmail_idx" ON "RetentionCampaign"("shop", "customerEmail");
ALTER TABLE "RetentionCampaign" ADD CONSTRAINT "RetentionCampaign_favoriteId_fkey" FOREIGN KEY ("favoriteId") REFERENCES "Favorite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductReview" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "productGid" TEXT,
  "productHandle" TEXT,
  "productTitle" TEXT,
  "category" TEXT,
  "name" TEXT NOT NULL,
  "orderRef" TEXT,
  "rating" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "imageFileId" TEXT,
  "imageUrl" TEXT,
  "source" TEXT NOT NULL DEFAULT 'customer_web',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "registeredBy" TEXT,
  "moderatedBy" TEXT,
  "moderatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductReview_shop_productGid_status_hidden_idx" ON "ProductReview"("shop", "productGid", "status", "hidden");
CREATE INDEX "ProductReview_shop_productHandle_status_hidden_idx" ON "ProductReview"("shop", "productHandle", "status", "hidden");
CREATE INDEX "ProductReview_shop_status_createdAt_idx" ON "ProductReview"("shop", "status", "createdAt");

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "concept" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "receiptFileId" TEXT,
  "receiptUrl" TEXT,
  "receiptName" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Expense_shop_expenseDate_idx" ON "Expense"("shop", "expenseDate");
CREATE INDEX "Expense_shop_category_idx" ON "Expense"("shop", "category");

CREATE TABLE "AccessRecoveryRequest" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "accountId" TEXT,
  "email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "source" TEXT NOT NULL DEFAULT 'self_service',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "handledAt" TIMESTAMP(3),
  "handledBy" TEXT,
  "notes" TEXT,
  CONSTRAINT "AccessRecoveryRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessRecoveryRequest_shop_accountType_status_idx" ON "AccessRecoveryRequest"("shop", "accountType", "status");
CREATE INDEX "AccessRecoveryRequest_shop_email_idx" ON "AccessRecoveryRequest"("shop", "email");

CREATE TABLE "B2BSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "B2BSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "B2BSession_tokenHash_key" ON "B2BSession"("tokenHash");
CREATE INDEX "B2BSession_companyId_expiresAt_idx" ON "B2BSession"("companyId", "expiresAt");
ALTER TABLE "B2BSession" ADD CONSTRAINT "B2BSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "B2BCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrafficEvent" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "visitorId" TEXT,
  "customerId" TEXT,
  "sessionKey" TEXT,
  "event" TEXT NOT NULL DEFAULT 'page_view',
  "source" TEXT NOT NULL DEFAULT 'web',
  "sourceDetail" TEXT,
  "path" TEXT,
  "referrer" TEXT,
  "campaign" TEXT,
  "medium" TEXT,
  "content" TEXT,
  "term" TEXT,
  "commercialCode" TEXT,
  "companyId" TEXT,
  "metadataJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrafficEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrafficEvent_shop_createdAt_idx" ON "TrafficEvent"("shop", "createdAt");
CREATE INDEX "TrafficEvent_shop_source_createdAt_idx" ON "TrafficEvent"("shop", "source", "createdAt");
CREATE INDEX "TrafficEvent_shop_event_createdAt_idx" ON "TrafficEvent"("shop", "event", "createdAt");

CREATE TABLE "OutboundMessage" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  "payloadJson" TEXT,
  "relatedType" TEXT,
  "relatedId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_provider',
  "provider" TEXT,
  "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OutboundMessage_shop_status_channel_idx" ON "OutboundMessage"("shop", "status", "channel");
CREATE INDEX "OutboundMessage_shop_relatedType_relatedId_idx" ON "OutboundMessage"("shop", "relatedType", "relatedId");
