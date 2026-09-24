ALTER TABLE "forcemultiplier"."Campaign"
  ADD COLUMN "exclusionRules" JSONB NOT NULL DEFAULT '{"conjunction":"AND","items":[]}';

ALTER TABLE "forcemultiplier"."CampaignSend"
  ADD COLUMN "exclusionRules" JSONB NOT NULL DEFAULT '{"conjunction":"AND","items":[]}';
