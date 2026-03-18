-- QA Sampling Settings
CREATE TABLE "QASamplingSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "samplingRate" INTEGER NOT NULL DEFAULT 20,
    "minDailySample" INTEGER NOT NULL DEFAULT 5,
    "targetScore" REAL NOT NULL DEFAULT 85,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QASamplingSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "QASamplingSetting_tenantId_key" ON "QASamplingSetting"("tenantId");

-- QA Scorecards
CREATE TABLE "QAScorecard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "agentId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "leadId" INTEGER,
    "interactionId" INTEGER,
    "score" REAL NOT NULL,
    "maxScore" REAL NOT NULL DEFAULT 100,
    "rating" TEXT NOT NULL DEFAULT 'PASS',
    "checklistJson" TEXT,
    "notes" TEXT,
    "callDate" DATETIME,
    "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QAScorecard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QAScorecard_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QAScorecard_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QAScorecard_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QAScorecard_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "QAScorecard_tenantId_evaluatedAt_idx" ON "QAScorecard"("tenantId", "evaluatedAt");
CREATE INDEX "QAScorecard_agentId_evaluatedAt_idx" ON "QAScorecard"("agentId", "evaluatedAt");
CREATE INDEX "QAScorecard_reviewerId_evaluatedAt_idx" ON "QAScorecard"("reviewerId", "evaluatedAt");
CREATE INDEX "QAScorecard_interactionId_idx" ON "QAScorecard"("interactionId");

-- A/B Tests
CREATE TABLE "ABTest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "hypothesis" TEXT,
    "startAt" DATETIME,
    "endAt" DATETIME,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ABTest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ABTest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ABTest_tenantId_status_channel_idx" ON "ABTest"("tenantId", "status", "channel");
CREATE INDEX "ABTest_tenantId_createdAt_idx" ON "ABTest"("tenantId", "createdAt");

CREATE TABLE "ABTestVariant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "testId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ABTestVariant_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ABTestVariant_testId_key_key" ON "ABTestVariant"("testId", "key");
CREATE INDEX "ABTestVariant_testId_idx" ON "ABTestVariant"("testId");

CREATE TABLE "ABTestEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "testId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "userId" INTEGER,
    "leadId" INTEGER,
    "eventType" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ABTestEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ABTestEvent_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ABTest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ABTestEvent_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ABTestVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ABTestEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ABTestEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ABTestEvent_tenantId_createdAt_idx" ON "ABTestEvent"("tenantId", "createdAt");
CREATE INDEX "ABTestEvent_testId_variantId_eventType_idx" ON "ABTestEvent"("testId", "variantId", "eventType");
CREATE INDEX "ABTestEvent_userId_createdAt_idx" ON "ABTestEvent"("userId", "createdAt");

-- Gamification
CREATE TABLE "GamificationSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerCall" INTEGER NOT NULL DEFAULT 1,
    "pointsPerInterested" INTEGER NOT NULL DEFAULT 5,
    "pointsPerAgreed" INTEGER NOT NULL DEFAULT 12,
    "pointsPerQaPass" INTEGER NOT NULL DEFAULT 8,
    "dailyGoalPoints" INTEGER NOT NULL DEFAULT 30,
    "weeklyGoalPoints" INTEGER NOT NULL DEFAULT 150,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GamificationSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GamificationSetting_tenantId_key" ON "GamificationSetting"("tenantId");

CREATE TABLE "GamificationPointLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "referenceId" INTEGER,
    "points" INTEGER NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GamificationPointLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GamificationPointLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GamificationPointLog_tenantId_periodType_periodStart_idx" ON "GamificationPointLog"("tenantId", "periodType", "periodStart");
CREATE INDEX "GamificationPointLog_userId_periodType_periodStart_idx" ON "GamificationPointLog"("userId", "periodType", "periodStart");

-- Release note global visibility
ALTER TABLE "ReleaseNote" ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ReleaseNote_isGlobal_publishedAt_idx" ON "ReleaseNote"("isGlobal", "publishedAt");
