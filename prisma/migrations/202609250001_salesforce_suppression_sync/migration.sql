CREATE TABLE "forcemultiplier"."SalesforceSuppressionSync" (
  "id" TEXT NOT NULL DEFAULT 'salesforce',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "orgId" TEXT,
  "cursor" TIMESTAMP(3),
  "scanCursor" TEXT,
  "scanUntil" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "error" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesforceSuppressionSync_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."SuppressionEvent" (
  "id" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "orgId" TEXT,
  "email" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'global_unsubscribe',
  "direction" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRef" TEXT,
  "occurredAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "salesforceId" TEXT,
  "campaignId" TEXT,
  "campaignName" TEXT,
  "subject" TEXT,
  "providerMessageId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'recorded',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error" TEXT,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "SuppressionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SuppressionEvent_dedupeKey_key" ON "forcemultiplier"."SuppressionEvent"("dedupeKey");
CREATE INDEX "SuppressionEvent_direction_status_availableAt_idx" ON "forcemultiplier"."SuppressionEvent"("direction", "status", "availableAt");
CREATE INDEX "SuppressionEvent_email_recordedAt_idx" ON "forcemultiplier"."SuppressionEvent"("email", "recordedAt");
CREATE INDEX "SuppressionEvent_orgId_recordedAt_idx" ON "forcemultiplier"."SuppressionEvent"("orgId", "recordedAt");

INSERT INTO "forcemultiplier"."SuppressionEvent" (
  "id", "dedupeKey", "email", "direction", "source", "sourceRef",
  "occurredAt", "recordedAt", "status", "processedAt"
)
SELECT
  'legacy-' || md5("email"),
  'legacy:' || md5("email"),
  "email",
  'import_to_forcemultiplier',
  "source",
  "sourceRef",
  "occurredAt",
  "createdAt",
  'recorded',
  "createdAt"
FROM "forcemultiplier"."Suppression"
ON CONFLICT ("dedupeKey") DO NOTHING;

REVOKE ALL ON TABLE "forcemultiplier"."SalesforceSuppressionSync" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."SuppressionEvent" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."SalesforceSuppressionSync" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."SuppressionEvent" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."SalesforceSuppressionSync" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."SuppressionEvent" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."SalesforceSuppressionSync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."SuppressionEvent" ENABLE ROW LEVEL SECURITY;
