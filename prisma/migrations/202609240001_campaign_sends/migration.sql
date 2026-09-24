ALTER TABLE "forcemultiplier"."Campaign"
  ADD COLUMN "audienceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "exclusionAudienceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "manualExclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "forcemultiplier"."CampaignSend" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "content" JSONB NOT NULL,
  "subject" TEXT NOT NULL,
  "fromName" TEXT NOT NULL,
  "fromEmail" TEXT NOT NULL,
  "includeAudienceIds" TEXT[] NOT NULL,
  "excludeAudienceIds" TEXT[] NOT NULL,
  "includeRunIds" TEXT[] NOT NULL,
  "excludeRunIds" TEXT[] NOT NULL,
  "manualExclusions" TEXT[] NOT NULL,
  "counts" JSONB NOT NULL DEFAULT '{}',
  "segmentId" TEXT,
  "importId" TEXT,
  "broadcastId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "error" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "CampaignSend_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CampaignSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "forcemultiplier"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "forcemultiplier"."CampaignRecipient" (
  "sendId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "salesforceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'selected',
  "providerEmailId" TEXT,
  "messageId" TEXT,
  "lastEventAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("sendId", "email"),
  CONSTRAINT "CampaignRecipient_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "forcemultiplier"."CampaignSend"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CampaignSend_campaignId_key" ON "forcemultiplier"."CampaignSend"("campaignId");
CREATE UNIQUE INDEX "CampaignSend_broadcastId_key" ON "forcemultiplier"."CampaignSend"("broadcastId");
CREATE INDEX "CampaignSend_status_createdAt_idx" ON "forcemultiplier"."CampaignSend"("status", "createdAt");
CREATE INDEX "CampaignRecipient_sendId_status_idx" ON "forcemultiplier"."CampaignRecipient"("sendId", "status");

REVOKE ALL ON TABLE "forcemultiplier"."CampaignSend" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."CampaignRecipient" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."CampaignSend" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."CampaignRecipient" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."CampaignSend" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."CampaignRecipient" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."CampaignSend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."CampaignRecipient" ENABLE ROW LEVEL SECURITY;
