-- Customer <-> Clerk identity sync, package B1 (schema only).
-- See docs/identity/CLERK-SYNC-DESIGN.md for the full design and the P0
-- holes it fixes. This migration only adds columns/tables and backfills
-- values that are safe to compute from existing data — no sync logic runs
-- here (that is B2/B3, in data-sync).
--
-- Que hace en prod:
--   1. users: nuevo enum UserType (STAFF/CUSTOMER) + columna userType
--      (default STAFF, no rompe nada existente); nuevo enum ClerkSyncStatus +
--      columnas de estado de sync (clerkSyncStatus default PENDING,
--      clerkSyncAttempts, clerkSyncedAt, clerkSyncError, clerkSyncHash,
--      clerkEventAt), todas nullable u con default seguro.
--   2. users.email: normaliza a lower(trim(email)) las filas que no colisionan
--      con otra fila tras normalizar (deja intactas las que colisionarian,
--      con comentario abajo).
--   3. buyers: nueva columna userId (FK -> users, ON DELETE SET NULL) +
--      @@unique([tenantId, userId]) + index. Nullable: la mayoria de buyers
--      creados por staff nunca tienen login.
--   4. tenants: nueva columna customer_portal_enabled (default false) +
--      UPDATE puntual para activarla en el tenant del portal HtownAutos
--      (50197477-9e89-4465-bed5-99c638c435a0).
--   5. Tabla nueva clerk_webhook_events (idempotencia de webhooks Clerk -> CRM,
--      B3). PK = svix-id, nunca generado localmente.
--
-- Idempotente: CREATE TYPE / ADD CONSTRAINT envueltos en DO $$ ... EXCEPTION
-- WHEN duplicate_object; ADD COLUMN / CREATE INDEX / CREATE TABLE con
-- IF NOT EXISTS. Puede reintentarse sin romper si un deploy anterior quedo a
-- medias. Ningun DROP.
--
-- Rollback: no hay uno automatico. Si hiciera falta deshacerla: DROP TABLE
-- clerk_webhook_events; ALTER TABLE buyers DROP COLUMN userId (primero DROP
-- CONSTRAINT del FK); ALTER TABLE tenants DROP COLUMN customer_portal_enabled;
-- ALTER TABLE users DROP COLUMN userType, clerkSyncStatus, clerkSyncAttempts,
-- clerkSyncedAt, clerkSyncError, clerkSyncHash, clerkEventAt; DROP TYPE
-- "UserType", "ClerkSyncStatus". La normalizacion de email (paso 2) no tiene
-- rollback (no hay forma de recuperar el casing original) — es intencional,
-- lower(trim()) es un subconjunto valido del email original.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "UserType" AS ENUM ('STAFF', 'CUSTOMER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ClerkSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "userType" "UserType" NOT NULL DEFAULT 'STAFF';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerkSyncStatus" "ClerkSyncStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerkSyncAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerkSyncedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerkSyncError" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerkSyncHash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerkEventAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_userType_idx" ON "users"("userType");
CREATE INDEX IF NOT EXISTS "users_clerkSyncStatus_idx" ON "users"("clerkSyncStatus");

-- Normalize existing users.email to lower(trim()) so it matches Clerk's
-- verified email 1:1 (Clerk always returns lowercase). Only touches rows
-- whose normalized form does NOT collide with another row's normalized
-- email — email has a UNIQUE constraint, so a blind UPDATE could throw or
-- silently merge two accounts. Rows that would collide are left as-is; they
-- need a human decision (tracked separately, not blocked by this migration).
UPDATE "users" u
SET "email" = lower(trim(u."email"))
WHERE u."email" <> lower(trim(u."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "users" u2
    WHERE u2."id" <> u."id"
      AND lower(trim(u2."email")) = lower(trim(u."email"))
  );

-- AlterTable: buyers
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "buyers_tenantId_userId_key" ON "buyers"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "buyers_userId_idx" ON "buyers"("userId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "buyers" ADD CONSTRAINT "buyers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: tenants
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "customer_portal_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Enable the customer portal on the canonical HtownAutos portal tenant. This
-- is the only tenant with a live customer portal today.
UPDATE "tenants" SET "customer_portal_enabled" = true WHERE "id" = '50197477-9e89-4465-bed5-99c638c435a0';

-- CreateTable
CREATE TABLE IF NOT EXISTS "clerk_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clerk_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "clerk_webhook_events_type_idx" ON "clerk_webhook_events"("type");
CREATE INDEX IF NOT EXISTS "clerk_webhook_events_processedAt_idx" ON "clerk_webhook_events"("processedAt");
