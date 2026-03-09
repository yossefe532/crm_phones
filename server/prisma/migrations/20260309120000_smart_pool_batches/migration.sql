CREATE TABLE "LeadBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "tenantId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeadBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Lead" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsappPhone" TEXT,
    "profileDetails" TEXT,
    "gender" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "hasProvidedName" BOOLEAN NOT NULL DEFAULT false,
    "isHiddenFromSales" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" DATETIME,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "recontactAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRecontactAt" DATETIME,
    "lastRecontactAt" DATETIME,
    "batchId" INTEGER,
    "tenantId" INTEGER NOT NULL,
    "agentId" INTEGER,
    "teamId" INTEGER,
    "courseId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LeadBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Lead" ("id", "name", "phone", "whatsappPhone", "gender", "status", "source", "notes", "recontactAttempts", "nextRecontactAt", "lastRecontactAt", "tenantId", "agentId", "teamId", "courseId", "createdAt")
SELECT "id", "name", "phone", "whatsappPhone", "gender", "status", "source", "notes", "recontactAttempts", "nextRecontactAt", "lastRecontactAt", "tenantId", "agentId", "teamId", "courseId", "createdAt"
FROM "Lead";

DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE INDEX "Lead_tenantId_idx" ON "Lead"("tenantId");
CREATE INDEX "Lead_teamId_idx" ON "Lead"("teamId");
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
CREATE INDEX "Lead_nextRecontactAt_idx" ON "Lead"("nextRecontactAt");
CREATE INDEX "Lead_batchId_idx" ON "Lead"("batchId");
CREATE INDEX "Lead_hasProvidedName_idx" ON "Lead"("hasProvidedName");
CREATE INDEX "Lead_isHiddenFromSales_idx" ON "Lead"("isHiddenFromSales");

CREATE TABLE "new_Interaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leadId" INTEGER NOT NULL,
    "userId" INTEGER,
    "type" TEXT NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Interaction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Interaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Interaction" ("id", "leadId", "type", "outcome", "notes", "date")
SELECT "id", "leadId", "type", "outcome", "notes", "date"
FROM "Interaction";

DROP TABLE "Interaction";
ALTER TABLE "new_Interaction" RENAME TO "Interaction";

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

CREATE INDEX "LeadBatch_tenantId_idx" ON "LeadBatch"("tenantId");
CREATE INDEX "LeadBatch_location_idx" ON "LeadBatch"("location");
