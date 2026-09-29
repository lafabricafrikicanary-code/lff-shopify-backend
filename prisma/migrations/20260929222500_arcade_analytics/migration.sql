-- V89 · Arcade analytics persistente
CREATE TABLE "ArcadeSession" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "game" TEXT NOT NULL,
  "customerId" TEXT,
  "visitorId" TEXT,
  "playerLabel" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "seconds" INTEGER,
  "result" TEXT NOT NULL DEFAULT 'started',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArcadeSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArcadeSession_shop_sessionKey_key"
  ON "ArcadeSession"("shop", "sessionKey");
CREATE INDEX "ArcadeSession_shop_startedAt_idx"
  ON "ArcadeSession"("shop", "startedAt");
CREATE INDEX "ArcadeSession_shop_game_startedAt_idx"
  ON "ArcadeSession"("shop", "game", "startedAt");
CREATE INDEX "ArcadeSession_shop_customerId_idx"
  ON "ArcadeSession"("shop", "customerId");
CREATE INDEX "ArcadeSession_shop_visitorId_idx"
  ON "ArcadeSession"("shop", "visitorId");
