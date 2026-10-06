ALTER TABLE "forcemultiplier"."SuppressionEvent" ADD COLUMN "suppressionRevision" INTEGER;
ALTER TABLE "forcemultiplier"."Suppression" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "forcemultiplier"."MarketingResubscription" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'all_workspace_marketing',
  "consentAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "orgId" TEXT NOT NULL,
  "resendKeyHash" TEXT NOT NULL,
  "salesforceId" TEXT,
  "resendContactId" TEXT,
  "suppressionRevision" INTEGER NOT NULL DEFAULT 0,
  "previousSuppression" JSONB,
  "writeStartedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'processing',
  "error" TEXT,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "MarketingResubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketingResubscription_email_createdAt_idx"
  ON "forcemultiplier"."MarketingResubscription"("email", "createdAt");
