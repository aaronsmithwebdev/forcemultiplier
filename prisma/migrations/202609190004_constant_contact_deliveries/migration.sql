CREATE TABLE "forcemultiplier"."DeliveryRun" (
    "id" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "listName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cursor" TEXT,
    "activityId" TEXT,
    "activityProgress" INTEGER NOT NULL DEFAULT 0,
    "batch" JSONB,
    "total" INTEGER NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "submitted" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryRun_audienceId_createdAt_idx" ON "forcemultiplier"."DeliveryRun"("audienceId", "createdAt");
CREATE UNIQUE INDEX "DeliveryRun_one_active" ON "forcemultiplier"."DeliveryRun" ("audienceId") WHERE "status" IN ('pending','running','paused');

ALTER TABLE "forcemultiplier"."DeliveryRun" ADD CONSTRAINT "DeliveryRun_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "forcemultiplier"."Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE "forcemultiplier"."DeliveryRun" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE forcemultiplier."DeliveryRun" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
ALTER TABLE "forcemultiplier"."DeliveryRun" ENABLE ROW LEVEL SECURITY;
