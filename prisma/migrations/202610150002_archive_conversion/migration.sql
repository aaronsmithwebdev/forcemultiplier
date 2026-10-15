ALTER TABLE "forcemultiplier"."Campaign"
ADD COLUMN "sourceArchiveId" TEXT,
ADD COLUMN "conversionReport" JSONB;

CREATE INDEX "Campaign_sourceArchiveId_idx" ON "forcemultiplier"."Campaign"("sourceArchiveId");

ALTER TABLE "forcemultiplier"."Campaign"
ADD CONSTRAINT "Campaign_sourceArchiveId_fkey" FOREIGN KEY ("sourceArchiveId") REFERENCES "forcemultiplier"."ArchivedEmail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
