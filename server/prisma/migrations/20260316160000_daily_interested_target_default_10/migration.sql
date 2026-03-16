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
    "dailyInterestedTarget" INTEGER NOT NULL DEFAULT 10,
    "simSerialNumber" TEXT,
    "simPhoneNumber" TEXT,
    "manualVipLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmployeeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EmployeeProfile" ("createdAt", "dailyApprovalTarget", "dailyCallTarget", "dailyInterestedTarget", "department", "id", "isActive", "jobTitle", "manualVipLimit", "phone", "simPhoneNumber", "simSerialNumber", "timezone", "updatedAt", "userId") SELECT "createdAt", "dailyApprovalTarget", "dailyCallTarget", "dailyInterestedTarget", "department", "id", "isActive", "jobTitle", "manualVipLimit", "phone", "simPhoneNumber", "simSerialNumber", "timezone", "updatedAt", "userId" FROM "EmployeeProfile";
DROP TABLE "EmployeeProfile";
ALTER TABLE "new_EmployeeProfile" RENAME TO "EmployeeProfile";
CREATE UNIQUE INDEX "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
