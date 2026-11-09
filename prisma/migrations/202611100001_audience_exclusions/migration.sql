ALTER TABLE "forcemultiplier"."Audience"
  ADD COLUMN "exclusionAudienceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "forcemultiplier"."DeliveryRun"
  ADD COLUMN "excludeRunIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
