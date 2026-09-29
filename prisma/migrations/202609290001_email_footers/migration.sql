CREATE TABLE "forcemultiplier"."EmailFooter" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "html" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailFooter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailFooter_updatedAt_idx"
ON "forcemultiplier"."EmailFooter"("updatedAt");

CREATE UNIQUE INDEX "EmailFooter_one_default_idx"
ON "forcemultiplier"."EmailFooter"("isDefault")
WHERE "isDefault" = true;

INSERT INTO "forcemultiplier"."EmailFooter" (
  "id",
  "name",
  "html",
  "isDefault",
  "createdBy",
  "updatedAt"
) VALUES (
  'default-footer',
  'Mito Foundation',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #dfe5dc;margin-top:24px"><tr><td style="padding:24px 20px;text-align:center;font-family:Arial,sans-serif;color:#5f6e66;font-size:12px;line-height:1.6"><p style="margin:0 0 4px"><strong style="color:#1d3029">Mito Foundation</strong></p><p style="margin:0 0 4px">Supporting the mitochondrial disease community.</p><p style="margin:0"><a href="https://www.mito.org.au" style="color:#256248">mito.org.au</a></p></td></tr></table>',
  true,
  'system',
  CURRENT_TIMESTAMP
);

ALTER TABLE "forcemultiplier"."Campaign"
ADD COLUMN "footerId" TEXT;

UPDATE "forcemultiplier"."Campaign"
SET "footerId" = 'default-footer';

ALTER TABLE "forcemultiplier"."Campaign"
ALTER COLUMN "footerId" SET NOT NULL;

ALTER TABLE "forcemultiplier"."Campaign"
ADD CONSTRAINT "Campaign_footerId_fkey"
FOREIGN KEY ("footerId") REFERENCES "forcemultiplier"."EmailFooter"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Campaign_footerId_idx"
ON "forcemultiplier"."Campaign"("footerId");

ALTER TABLE "forcemultiplier"."CampaignSend"
ADD COLUMN "footerName" TEXT,
ADD COLUMN "footerHtml" TEXT;

UPDATE "forcemultiplier"."CampaignSend" AS send
SET
  "footerName" = footer."name",
  "footerHtml" = footer."html"
FROM "forcemultiplier"."Campaign" AS campaign
JOIN "forcemultiplier"."EmailFooter" AS footer
  ON footer."id" = campaign."footerId"
WHERE campaign."id" = send."campaignId";

ALTER TABLE "forcemultiplier"."CampaignSend"
ALTER COLUMN "footerName" SET NOT NULL,
ALTER COLUMN "footerHtml" SET NOT NULL;
