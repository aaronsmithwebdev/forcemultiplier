CREATE TABLE "forcemultiplier"."SyncSchedule" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "listName" TEXT NOT NULL,
    "mappings" JSONB NOT NULL DEFAULT '[]',
    "cadence" TEXT NOT NULL,
    "intervalHours" INTEGER,
    "localTime" TEXT,
    "weekday" INTEGER,
    "timeZone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."SyncRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "scheduleVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "listName" TEXT NOT NULL,
    "mappings" JSONB NOT NULL DEFAULT '[]',
    "pullRunId" TEXT,
    "deliveryRunId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncSchedule_audienceId_key" ON "forcemultiplier"."SyncSchedule"("audienceId");
CREATE INDEX "SyncSchedule_enabled_nextRunAt_idx" ON "forcemultiplier"."SyncSchedule"("enabled", "nextRunAt");
CREATE INDEX "SyncRun_status_availableAt_idx" ON "forcemultiplier"."SyncRun"("status", "availableAt");
CREATE INDEX "SyncRun_scheduleId_createdAt_idx" ON "forcemultiplier"."SyncRun"("scheduleId", "createdAt");
CREATE UNIQUE INDEX "SyncRun_one_active" ON "forcemultiplier"."SyncRun" ("scheduleId") WHERE "status" IN ('pending','pulling','delivering');

ALTER TABLE "forcemultiplier"."SyncSchedule" ADD CONSTRAINT "SyncSchedule_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "forcemultiplier"."Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forcemultiplier"."SyncRun" ADD CONSTRAINT "SyncRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "forcemultiplier"."SyncSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE "forcemultiplier"."SyncSchedule" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."SyncRun" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE forcemultiplier."SyncSchedule" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE forcemultiplier."SyncRun" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
ALTER TABLE "forcemultiplier"."SyncSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."SyncRun" ENABLE ROW LEVEL SECURITY;
