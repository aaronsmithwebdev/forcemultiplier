ALTER TABLE "forcemultiplier"."FunraisinParticipant" ADD COLUMN "dateOfBirth" DATE;

-- Completed snapshots keep their original fields until the audience is pulled again.
UPDATE "forcemultiplier"."Audience"
SET fields = fields || '["FunraisinDateOfBirth"]'::jsonb
WHERE "sourceType" = 'funraisin'
  AND query::jsonb->>'people' = 'entrants'
  AND NOT fields @> '["FunraisinDateOfBirth"]'::jsonb;
