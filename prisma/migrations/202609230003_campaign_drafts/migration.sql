CREATE TABLE "forcemultiplier"."Campaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "subject" TEXT NOT NULL DEFAULT '',
  "preheader" TEXT NOT NULL DEFAULT '',
  "fromName" TEXT NOT NULL DEFAULT '',
  "fromEmail" TEXT NOT NULL DEFAULT '',
  "replyToEmail" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Campaign_updatedAt_idx" ON "forcemultiplier"."Campaign"("updatedAt");

REVOKE ALL ON TABLE "forcemultiplier"."Campaign" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."Campaign" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."Campaign" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."Campaign" ENABLE ROW LEVEL SECURITY;
