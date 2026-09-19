ALTER TABLE "forcemultiplier"."DeliveryRun"
ADD COLUMN "mappings" JSONB NOT NULL DEFAULT '[]';
