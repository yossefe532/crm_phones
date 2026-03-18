-- AlterTable
ALTER TABLE "FAQ" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CALL_SUPPORT';

-- Replace FAQ index to include type
DROP INDEX IF EXISTS "FAQ_tenantId_isPublished_idx";
CREATE INDEX "FAQ_tenantId_type_isPublished_idx" ON "FAQ"("tenantId", "type", "isPublished");

-- CreateTable
CREATE TABLE "SalesTip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceTitle" TEXT,
    "sourceUrl" TEXT,
    "tenantId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesTip_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesTip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesTip_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SalesTip_tenantId_isPublished_idx" ON "SalesTip"("tenantId", "isPublished");

-- CreateIndex
CREATE INDEX "SalesTip_tenantId_sortOrder_idx" ON "SalesTip"("tenantId", "sortOrder");
