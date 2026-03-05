/*
  Warnings:

  - Added the required column `tenantId` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Team` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Lead` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `MessageTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Tenant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "Tenant" ("name", "slug", "updatedAt")
VALUES ('Legacy Tenant', 'legacy', CURRENT_TIMESTAMP);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "teamId" INTEGER,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("email", "id", "name", "password", "role", "tenantId", "teamId")
SELECT
  "email",
  "id",
  "name",
  "password",
  "role",
  (SELECT "id" FROM "Tenant" WHERE "slug" = 'legacy' LIMIT 1),
  "teamId"
FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE INDEX "User_teamId_idx" ON "User"("teamId");
CREATE TABLE "new_Team" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "leadId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Team_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("createdAt", "id", "leadId", "name", "tenantId", "updatedAt")
SELECT
  "createdAt",
  "id",
  "leadId",
  "name",
  (SELECT "id" FROM "Tenant" WHERE "slug" = 'legacy' LIMIT 1),
  "updatedAt"
FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE UNIQUE INDEX "Team_leadId_key" ON "Team"("leadId");
CREATE INDEX "Team_tenantId_idx" ON "Team"("tenantId");
CREATE UNIQUE INDEX "Team_tenantId_name_key" ON "Team"("tenantId", "name");
CREATE TABLE "new_Lead" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsappPhone" TEXT,
    "gender" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "recontactAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextRecontactAt" DATETIME,
    "lastRecontactAt" DATETIME,
    "tenantId" INTEGER NOT NULL,
    "agentId" INTEGER,
    "teamId" INTEGER,
    "courseId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lead" ("agentId", "courseId", "createdAt", "gender", "id", "lastRecontactAt", "name", "nextRecontactAt", "notes", "phone", "recontactAttempts", "source", "status", "teamId", "tenantId")
SELECT
  "agentId",
  "courseId",
  "createdAt",
  "gender",
  "id",
  "lastRecontactAt",
  "name",
  "nextRecontactAt",
  "notes",
  "phone",
  "recontactAttempts",
  "source",
  "status",
  "teamId",
  (SELECT "id" FROM "Tenant" WHERE "slug" = 'legacy' LIMIT 1)
FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE INDEX "Lead_tenantId_idx" ON "Lead"("tenantId");
CREATE INDEX "Lead_teamId_idx" ON "Lead"("teamId");
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
CREATE INDEX "Lead_nextRecontactAt_idx" ON "Lead"("nextRecontactAt");
CREATE TABLE "new_MessageTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    CONSTRAINT "MessageTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MessageTemplate" ("content", "id", "status", "tenantId")
SELECT
  "content",
  "id",
  "status",
  (SELECT "id" FROM "Tenant" WHERE "slug" = 'legacy' LIMIT 1)
FROM "MessageTemplate";
DROP TABLE "MessageTemplate";
ALTER TABLE "new_MessageTemplate" RENAME TO "MessageTemplate";
CREATE INDEX "MessageTemplate_tenantId_idx" ON "MessageTemplate"("tenantId");
CREATE UNIQUE INDEX "MessageTemplate_tenantId_status_key" ON "MessageTemplate"("tenantId", "status");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_name_key" ON "Tenant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
