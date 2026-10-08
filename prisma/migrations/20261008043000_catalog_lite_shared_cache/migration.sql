-- V140 · Shared public catalog snapshot, no destructive statements.
CREATE TABLE "LffCatalogLiteSnapshot" (
    "shop" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "products" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LffCatalogLiteSnapshot_pkey" PRIMARY KEY ("shop","category")
);
