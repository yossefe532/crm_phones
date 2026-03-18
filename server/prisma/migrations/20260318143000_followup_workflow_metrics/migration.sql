-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN "callDurationSec" INTEGER;

-- CreateTable
CREATE TABLE "FollowUpWorkflowSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "noAnswerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "noAnswerDelayMinutes" INTEGER NOT NULL DEFAULT 1440,
    "hesitantEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hesitantDelayMinutes" INTEGER NOT NULL DEFAULT 720,
    "slaTargetMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUpWorkflowSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "leadId" INTEGER NOT NULL,
    "agentId" INTEGER,
    "triggerStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "completionOutcome" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUpTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUpTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FollowUpTask_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpWorkflowSetting_tenantId_key" ON "FollowUpWorkflowSetting"("tenantId");

-- CreateIndex
CREATE INDEX "FollowUpTask_tenantId_status_dueAt_idx" ON "FollowUpTask"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_leadId_status_idx" ON "FollowUpTask"("leadId", "status");

-- CreateIndex
CREATE INDEX "FollowUpTask_agentId_status_idx" ON "FollowUpTask"("agentId", "status");
