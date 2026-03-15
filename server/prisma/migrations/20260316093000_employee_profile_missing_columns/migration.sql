-- Backfill columns that exist in schema.prisma but were never added through migrations.
-- This fixes Prisma P2022 errors in environments that only use prisma migrate deploy.
ALTER TABLE "EmployeeProfile" ADD COLUMN "simSerialNumber" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "simPhoneNumber" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "manualVipLimit" INTEGER;
