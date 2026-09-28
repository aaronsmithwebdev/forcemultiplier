ALTER TABLE "forcemultiplier"."Campaign"
ADD COLUMN "serviceNotice" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "forcemultiplier"."CampaignSend"
ADD COLUMN "replyToEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN "serviceNotice" BOOLEAN NOT NULL DEFAULT false;
