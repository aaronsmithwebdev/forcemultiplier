CREATE TABLE "forcemultiplier"."ContactMirror" (
  "orgId" TEXT NOT NULL,
  "salesforceId" TEXT NOT NULL,
  "email" TEXT,
  "normalizedEmail" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "optedOut" BOOLEAN NOT NULL,
  "systemModstamp" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "lastSeenScan" TEXT,
  CONSTRAINT "ContactMirror_pkey" PRIMARY KEY ("orgId", "salesforceId")
);
CREATE INDEX "ContactMirror_orgId_normalizedEmail_idx"
  ON "forcemultiplier"."ContactMirror"("orgId", "normalizedEmail");
CREATE TABLE "forcemultiplier"."ContactMirrorSync" (
  "id" TEXT NOT NULL DEFAULT 'salesforce',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "orgId" TEXT,
  "phase" TEXT NOT NULL DEFAULT 'bootstrap',
  "cursor" TIMESTAMP(3),
  "deletedThrough" TIMESTAMP(3),
  "scanUntil" TIMESTAMP(3),
  "queryCursor" TEXT,
  "scanId" TEXT,
  "total" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "lastFullCount" INTEGER,
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastCompletedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "error" TEXT,
  "enabledBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactMirrorSync_pkey" PRIMARY KEY ("id")
);
-- The previous migration created this sensitive audit table without RLS.
REVOKE ALL ON TABLE "forcemultiplier"."ContactMirror" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."ContactMirrorSync" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."MarketingResubscription" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ContactMirror" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."ContactMirrorSync" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."MarketingResubscription" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ContactMirror" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."ContactMirrorSync" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."MarketingResubscription" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."ContactMirror" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."ContactMirrorSync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."MarketingResubscription" ENABLE ROW LEVEL SECURITY;
