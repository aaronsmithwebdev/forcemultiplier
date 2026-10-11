ALTER TABLE "forcemultiplier"."ContactMirror"
  ADD COLUMN "extraFields" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "forcemultiplier"."ContactMirrorSync"
  ADD COLUMN "fields" JSONB NOT NULL DEFAULT '[]'::jsonb;
