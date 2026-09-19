-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "forcemultiplier";

-- CreateTable
CREATE TABLE "forcemultiplier"."Admin" (
    "id" TEXT NOT NULL DEFAULT 'owner',
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."Session" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."RateLimit" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."Connection" (
    "provider" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "loginUrl" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tokens" TEXT,
    "externalId" TEXT,
    "label" TEXT,
    "instanceUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "refreshLeaseUntil" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."OAuthAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "connectionVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."Audience" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "query" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Audience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."PullRun" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "query" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "orgId" TEXT NOT NULL,
    "cursor" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PullRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."AudienceMember" (
    "runId" TEXT NOT NULL,
    "salesforceId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,

    CONSTRAINT "AudienceMember_pkey" PRIMARY KEY ("runId","salesforceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "forcemultiplier"."Admin"("email");

-- CreateIndex
CREATE INDEX "PullRun_audienceId_createdAt_idx" ON "forcemultiplier"."PullRun"("audienceId", "createdAt");

-- AddForeignKey
ALTER TABLE "forcemultiplier"."Session" ADD CONSTRAINT "Session_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "forcemultiplier"."Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."OAuthAttempt" ADD CONSTRAINT "OAuthAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "forcemultiplier"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."PullRun" ADD CONSTRAINT "PullRun_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "forcemultiplier"."Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."AudienceMember" ADD CONSTRAINT "AudienceMember_runId_fkey" FOREIGN KEY ("runId") REFERENCES "forcemultiplier"."PullRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No browser/Data API role may read credentials or audience data in this schema.
REVOKE ALL ON SCHEMA "forcemultiplier" FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA "forcemultiplier" FROM PUBLIC;
DO $$ DECLARE role_name text; table_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA forcemultiplier FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA forcemultiplier FROM %I', role_name);
    END IF;
  END LOOP;
  FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'forcemultiplier' LOOP
    EXECUTE format('ALTER TABLE forcemultiplier.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
-- A resumable run owns the audience until it completes or is explicitly cancelled.
CREATE UNIQUE INDEX "PullRun_one_active" ON "forcemultiplier"."PullRun" ("audienceId") WHERE "status" IN ('pending','running','paused');
