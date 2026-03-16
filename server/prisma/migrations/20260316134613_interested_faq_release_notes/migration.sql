-- CreateTable
CREATE TABLE "Suggestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "answer" TEXT,
    "answeredAt" DATETIME,
    "answeredById" INTEGER,
    "tenantId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Suggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Suggestion_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Suggestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FAQ" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "updatedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FAQ_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FAQ_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FAQ_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReleaseNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReleaseNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReleaseNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReleaseNoteRead" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "releaseNoteId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReleaseNoteRead_releaseNoteId_fkey" FOREIGN KEY ("releaseNoteId") REFERENCES "ReleaseNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReleaseNoteRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EmployeeProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "department" TEXT NOT NULL DEFAULT 'Sales',
    "jobTitle" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "dailyCallTarget" INTEGER NOT NULL DEFAULT 30,
    "dailyApprovalTarget" INTEGER NOT NULL DEFAULT 0,
    "dailyInterestedTarget" INTEGER NOT NULL DEFAULT 0,
    "simSerialNumber" TEXT,
    "simPhoneNumber" TEXT,
    "manualVipLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmployeeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EmployeeProfile" ("createdAt", "dailyApprovalTarget", "dailyCallTarget", "department", "id", "isActive", "jobTitle", "manualVipLimit", "phone", "simPhoneNumber", "simSerialNumber", "timezone", "updatedAt", "userId") SELECT "createdAt", "dailyApprovalTarget", "dailyCallTarget", "department", "id", "isActive", "jobTitle", "manualVipLimit", "phone", "simPhoneNumber", "simSerialNumber", "timezone", "updatedAt", "userId" FROM "EmployeeProfile";
DROP TABLE "EmployeeProfile";
ALTER TABLE "new_EmployeeProfile" RENAME TO "EmployeeProfile";
CREATE UNIQUE INDEX "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Suggestion_tenantId_idx" ON "Suggestion"("tenantId");

-- CreateIndex
CREATE INDEX "Suggestion_userId_idx" ON "Suggestion"("userId");

-- CreateIndex
CREATE INDEX "Suggestion_answeredById_idx" ON "Suggestion"("answeredById");

-- CreateIndex
CREATE INDEX "FAQ_tenantId_isPublished_idx" ON "FAQ"("tenantId", "isPublished");

-- CreateIndex
CREATE INDEX "FAQ_tenantId_sortOrder_idx" ON "FAQ"("tenantId", "sortOrder");

-- CreateIndex
CREATE INDEX "ReleaseNote_tenantId_publishedAt_idx" ON "ReleaseNote"("tenantId", "publishedAt");

-- CreateIndex
CREATE INDEX "ReleaseNote_tenantId_isPublished_idx" ON "ReleaseNote"("tenantId", "isPublished");

-- CreateIndex
CREATE INDEX "ReleaseNoteRead_userId_readAt_idx" ON "ReleaseNoteRead"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseNoteRead_releaseNoteId_userId_key" ON "ReleaseNoteRead"("releaseNoteId", "userId");
