-- Backfill missing Lead.isVip column that exists in schema and is used by claim/create flows.
-- Without this column, Prisma throws P2022 and endpoints fail with:
-- - Failed to claim lead
-- - Failed to create lead
ALTER TABLE "Lead" ADD COLUMN "isVip" BOOLEAN NOT NULL DEFAULT false;
