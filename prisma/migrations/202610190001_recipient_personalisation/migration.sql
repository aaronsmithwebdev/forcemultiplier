ALTER TABLE "forcemultiplier"."CampaignRecipient" ADD COLUMN "data" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "FunraisinDonation_salesforceId_idx" ON "forcemultiplier"."FunraisinDonation"("salesforceId");

-- ponytail: Resend properties are shared by contacts. Serialize personalised broadcast preparation;
-- use campaign-scoped provider properties if concurrent preparation becomes necessary.
CREATE UNIQUE INDEX "CampaignSend_one_funraisin_broadcast"
ON "forcemultiplier"."CampaignSend" ((1))
WHERE NOT "serviceNotice" AND status IN ('pending', 'importing', 'ready')
  AND (content::text LIKE '%contact.Funraisin%' OR "footerContent"::text LIKE '%contact.Funraisin%');
