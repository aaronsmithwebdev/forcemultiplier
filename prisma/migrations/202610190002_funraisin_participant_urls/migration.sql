ALTER TABLE "forcemultiplier"."FunraisinEvent" ADD COLUMN "eventKey" TEXT;
ALTER TABLE "forcemultiplier"."FunraisinParticipant" ADD COLUMN "username" TEXT;
ALTER TABLE "forcemultiplier"."FunraisinSync" ADD COLUMN "participantUrlsVersion" INTEGER NOT NULL DEFAULT 0;

-- Existing audiences gain the fields; completed snapshots retain their original field catalog.
UPDATE "forcemultiplier"."Audience"
SET fields = fields || '["FunraisinUsername", "FunraisinEventKey", "FunraisinFundraisingUrl"]'::jsonb
WHERE "sourceType" = 'funraisin';
