ALTER TABLE "forcemultiplier"."ContactMirrorSync"
  ADD COLUMN "exclusions" JSONB NOT NULL DEFAULT '{"conjunction":"AND","items":[]}'::jsonb;
