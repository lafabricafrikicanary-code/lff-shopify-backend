ALTER TABLE "CommercialUser"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "about" TEXT,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordSalt" TEXT,
  ADD COLUMN "forceChange" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "shopifyCustomerId" TEXT;

CREATE TABLE "CommercialApplication" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "channel" TEXT,
  "about" TEXT,
  "inviterCode" TEXT,
  "passwordHash" TEXT NOT NULL,
  "passwordSalt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "commercialId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "CommercialApplication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialApplication_shop_email_key" ON "CommercialApplication"("shop", "email");
CREATE INDEX "CommercialApplication_shop_status_idx" ON "CommercialApplication"("shop", "status");

CREATE TABLE "CommercialSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "commercialId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercialSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialSession_tokenHash_key" ON "CommercialSession"("tokenHash");
CREATE INDEX "CommercialSession_commercialId_expiresAt_idx" ON "CommercialSession"("commercialId", "expiresAt");
ALTER TABLE "CommercialSession" ADD CONSTRAINT "CommercialSession_commercialId_fkey" FOREIGN KEY ("commercialId") REFERENCES "CommercialUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "passwordHash" TEXT NOT NULL,
  "passwordSalt" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "forceChange" BOOLEAN NOT NULL DEFAULT false,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "totalActiveSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminUser_shop_username_key" ON "AdminUser"("shop", "username");
CREATE INDEX "AdminUser_shop_role_idx" ON "AdminUser"("shop", "role");

CREATE TABLE "AdminSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_adminUserId_expiresAt_idx" ON "AdminSession"("adminUserId", "expiresAt");
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
