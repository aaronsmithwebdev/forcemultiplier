CREATE TABLE "forcemultiplier"."UnsubscribeSync" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "accountId" TEXT,
    "orgId" TEXT,
    "cursor" TIMESTAMP(3),
    "scanCursor" TEXT,
    "scanUntil" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnsubscribeSync_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."UnsubscribeEvent" (
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "optOutAt" TIMESTAMP(3) NOT NULL,
    "optOutSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "salesforceId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "UnsubscribeEvent_pkey" PRIMARY KEY ("accountId", "orgId", "contactId")
);

CREATE INDEX "UnsubscribeEvent_accountId_orgId_status_availableAt_idx" ON "forcemultiplier"."UnsubscribeEvent"("accountId", "orgId", "status", "availableAt");
CREATE INDEX "UnsubscribeEvent_accountId_email_idx" ON "forcemultiplier"."UnsubscribeEvent"("accountId", "email");

REVOKE ALL ON TABLE "forcemultiplier"."UnsubscribeSync" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."UnsubscribeEvent" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."UnsubscribeSync" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."UnsubscribeEvent" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."UnsubscribeSync" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."UnsubscribeEvent" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."UnsubscribeSync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."UnsubscribeEvent" ENABLE ROW LEVEL SECURITY;
