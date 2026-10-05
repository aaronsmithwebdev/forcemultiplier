ALTER TABLE "forcemultiplier"."SalesforceSuppressionSync"
ADD COLUMN "baselineConfirmedAt" TIMESTAMP(3),
ADD COLUMN "baselineConfirmedBy" TEXT;
