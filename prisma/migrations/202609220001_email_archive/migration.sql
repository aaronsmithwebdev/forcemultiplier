CREATE TABLE "forcemultiplier"."ArchiveImport" (
  "id" TEXT NOT NULL DEFAULT 'constant-contact',
  "accountId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "cursor" TEXT,
  "scanned" INTEGER NOT NULL DEFAULT 0,
  "stored" INTEGER NOT NULL DEFAULT 0,
  "missing" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3),
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArchiveImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."ArchivedEmail" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "campaignType" TEXT NOT NULL,
  "campaignName" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "preheader" TEXT,
  "fromName" TEXT,
  "fromEmail" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "sendCount" INTEGER NOT NULL DEFAULT 0,
  "sourceHtml" TEXT,
  "previewHtml" TEXT,
  "previewText" TEXT,
  "permalink" TEXT,
  "sourceHash" TEXT,
  "warning" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArchivedEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArchivedEmail_accountId_activityId_key" ON "forcemultiplier"."ArchivedEmail"("accountId", "activityId");
CREATE INDEX "ArchivedEmail_accountId_sentAt_idx" ON "forcemultiplier"."ArchivedEmail"("accountId", "sentAt");
CREATE INDEX "ArchivedEmail_accountId_campaignId_idx" ON "forcemultiplier"."ArchivedEmail"("accountId", "campaignId");

REVOKE ALL ON TABLE "forcemultiplier"."ArchiveImport" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."ArchivedEmail" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ArchiveImport" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."ArchivedEmail" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ArchiveImport" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."ArchivedEmail" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."ArchiveImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."ArchivedEmail" ENABLE ROW LEVEL SECURITY;
