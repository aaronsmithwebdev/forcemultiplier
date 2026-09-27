ALTER TABLE "forcemultiplier"."CampaignRecipient"
ADD COLUMN "providerContactDeletedAt" TIMESTAMP(3);

CREATE INDEX "CampaignRecipient_email_idx"
ON "forcemultiplier"."CampaignRecipient"("email");

CREATE TABLE "forcemultiplier"."WorkspaceSettings" (
  "id" TEXT NOT NULL DEFAULT 'workspace',
  "resendContactRetentionDays" INTEGER NOT NULL DEFAULT 90,
  "resendCleanupLeaseUntil" TIMESTAMP(3),
  "resendCleanupNextRunAt" TIMESTAMP(3),
  "resendCleanupLastRunAt" TIMESTAMP(3),
  "resendCleanupLastDeleted" INTEGER NOT NULL DEFAULT 0,
  "resendCleanupError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceSettings_resendContactRetentionDays_check"
    CHECK ("resendContactRetentionDays" BETWEEN 1 AND 3650)
);

INSERT INTO "forcemultiplier"."WorkspaceSettings" ("id", "updatedAt")
VALUES ('workspace', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

REVOKE ALL ON TABLE "forcemultiplier"."WorkspaceSettings" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."WorkspaceSettings" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."WorkspaceSettings" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."WorkspaceSettings" ENABLE ROW LEVEL SECURITY;
