CREATE TABLE "forcemultiplier"."ResubscribeJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "orgId" TEXT,
    "listId" TEXT NOT NULL,
    "listName" TEXT NOT NULL,
    "presentField" TEXT,
    "amountField" TEXT,
    "minimumAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "nextChunk" INTEGER NOT NULL DEFAULT 0,
    "uploaded" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResubscribeJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."ResubscribeMember" (
    "jobId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "salesforceId" TEXT,
    "data" JSONB,
    "priority" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contactId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "ResubscribeMember_pkey" PRIMARY KEY ("jobId", "email")
);

CREATE TABLE "forcemultiplier"."ResubscribeDay" (
    "clientKey" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "contacts" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ResubscribeDay_pkey" PRIMARY KEY ("clientKey", "day")
);

CREATE TABLE "forcemultiplier"."ResubscribeWorker" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "leaseUntil" TIMESTAMP(3),
    CONSTRAINT "ResubscribeWorker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResubscribeJob_status_createdAt_idx" ON "forcemultiplier"."ResubscribeJob"("status", "createdAt");
CREATE INDEX "ResubscribeMember_jobId_status_priority_email_idx" ON "forcemultiplier"."ResubscribeMember"("jobId", "status", "priority", "email");
ALTER TABLE "forcemultiplier"."ResubscribeMember" ADD CONSTRAINT "ResubscribeMember_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "forcemultiplier"."ResubscribeJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeJob" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeMember" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeDay" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeWorker" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeJob" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeMember" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeDay" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeWorker" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeJob" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeMember" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeDay" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."ResubscribeWorker" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."ResubscribeJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."ResubscribeMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."ResubscribeDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."ResubscribeWorker" ENABLE ROW LEVEL SECURITY;
