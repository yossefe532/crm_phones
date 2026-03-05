-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "recontactAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN "nextRecontactAt" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "lastRecontactAt" DATETIME;

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
CREATE INDEX "Lead_nextRecontactAt_idx" ON "Lead"("nextRecontactAt");
