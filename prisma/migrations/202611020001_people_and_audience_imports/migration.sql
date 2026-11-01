BEGIN;
-- CreateTable
CREATE TABLE "forcemultiplier"."Person" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "salesforceId" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "unavailable" BOOLEAN NOT NULL DEFAULT false,
    "mergedIntoId" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."PersonSource" (
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonSource_pkey" PRIMARY KEY ("orgId","source","sourceId")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."PersonEmail" (
    "personId" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "PersonEmail_pkey" PRIMARY KEY ("personId","email")
);

-- CreateTable
CREATE TABLE "forcemultiplier"."AudienceImport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "audienceId" TEXT,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "AudienceImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Person_orgId_email_idx" ON "forcemultiplier"."Person"("orgId", "email");

-- CreateIndex
CREATE INDEX "Person_mergedIntoId_idx" ON "forcemultiplier"."Person"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_orgId_salesforceId_key" ON "forcemultiplier"."Person"("orgId", "salesforceId");

-- CreateIndex
CREATE INDEX "AudienceImport_orgId_createdAt_idx" ON "forcemultiplier"."AudienceImport"("orgId", "createdAt");

-- AlterTable
ALTER TABLE "forcemultiplier"."AudienceMember" DROP CONSTRAINT "AudienceMember_pkey",
ADD COLUMN     "personId" TEXT,
ADD COLUMN     "deliveryKey" TEXT,
ADD CONSTRAINT "AudienceMember_pkey" PRIMARY KEY ("runId", "salesforceId");

-- AlterTable
ALTER TABLE "forcemultiplier"."ManualAudienceMember" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "forcemultiplier"."CampaignRecipient" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "forcemultiplier"."FunraisinParticipant" ADD COLUMN     "personId" TEXT,
ALTER COLUMN "salesforceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "forcemultiplier"."FunraisinDonation" ADD COLUMN     "personId" TEXT,
ALTER COLUMN "salesforceId" DROP NOT NULL;


-- Choose the newest captured Salesforce profile; never merge separate Contact IDs by email.
INSERT INTO "forcemultiplier"."Person" (id, "orgId", "salesforceId", email, "firstName", "lastName", "optedOut", source, "updatedAt")
SELECT DISTINCT ON ("orgId", "salesforceId")
  'sf_' || md5("orgId" || ':' || "salesforceId"), "orgId", "salesforceId", email, "firstName", "lastName", "optedOut", 'salesforce', NOW()
FROM (
  SELECT r."orgId", m."salesforceId", m."normalizedEmail" AS email, m.data->>'FirstName' AS "firstName", m.data->>'LastName' AS "lastName", m."optedOut", r."createdAt" AS stamp
  FROM "forcemultiplier"."AudienceMember" m JOIN "forcemultiplier"."PullRun" r ON r.id = m."runId"
  WHERE m."salesforceId" NOT LIKE 'manual:%'
  UNION ALL
  SELECT "orgId", "salesforceId", "normalizedEmail", "firstName", "lastName", "optedOut", "observedAt" FROM "forcemultiplier"."ContactMirror"
  UNION ALL
  SELECT s."orgId", p."salesforceId", p.email, p."firstName", CASE WHEN p."firstName" IS NOT NULL THEN NULLIF(trim(substr(p.name,length(p."firstName")+1)),'') END, false, '1970-01-01'::timestamp FROM "forcemultiplier"."FunraisinParticipant" p CROSS JOIN "forcemultiplier"."FunraisinSync" s WHERE s."orgId" IS NOT NULL
  UNION ALL
  SELECT s."orgId", d."salesforceId", d.email, d.name, NULL, false, '1970-01-01'::timestamp FROM "forcemultiplier"."FunraisinDonation" d CROSS JOIN "forcemultiplier"."FunraisinSync" s WHERE s."orgId" IS NOT NULL
) seeds ORDER BY "orgId", "salesforceId", stamp DESC;

INSERT INTO "forcemultiplier"."Person" (id, "orgId", email, source, "updatedAt")
SELECT DISTINCT 'local_' || md5("orgId" || ':' || email), "orgId", email, 'manual', NOW() FROM (
 SELECT a."orgId", m.email FROM "forcemultiplier"."ManualAudienceMember" m JOIN "forcemultiplier"."Audience" a ON a.id=m."audienceId"
 UNION SELECT r."orgId", m.email FROM "forcemultiplier"."AudienceMember" m JOIN "forcemultiplier"."PullRun" r ON r.id=m."runId" WHERE m."salesforceId" LIKE 'manual:%'
) seeds;

UPDATE "forcemultiplier"."AudienceMember" SET "deliveryKey"="salesforceId";
ALTER TABLE "forcemultiplier"."AudienceMember" ALTER COLUMN "deliveryKey" SET NOT NULL;
CREATE UNIQUE INDEX "AudienceMember_runId_deliveryKey_key" ON "forcemultiplier"."AudienceMember"("runId","deliveryKey");
-- Salesforce/CC cursors retain their old immutable ordering key. In-progress Funraisin
-- pulls require a fresh cursor because their source now groups by internal person identity.
UPDATE "forcemultiplier"."PullRun" SET status='cancelled',error='Person identities changed. Start a new Funraisin pull.',"leaseUntil"=NULL WHERE query LIKE '{%' AND status IN ('pending','running','paused');
UPDATE "forcemultiplier"."AudienceMember" m SET "personId" = CASE WHEN m."salesforceId" LIKE 'manual:%' THEN 'local_' || md5(r."orgId" || ':' || m.email) ELSE 'sf_' || md5(r."orgId" || ':' || m."salesforceId") END FROM "forcemultiplier"."PullRun" r WHERE r.id=m."runId";
ALTER TABLE "forcemultiplier"."AudienceMember" DROP CONSTRAINT "AudienceMember_pkey", ALTER COLUMN "personId" SET NOT NULL, ALTER COLUMN "salesforceId" DROP NOT NULL, ADD PRIMARY KEY ("runId", "personId");
UPDATE "forcemultiplier"."AudienceMember" SET "salesforceId"=NULL WHERE "salesforceId" LIKE 'manual:%';
UPDATE "forcemultiplier"."ManualAudienceMember" m SET "personId"='local_' || md5(a."orgId" || ':' || m.email) FROM "forcemultiplier"."Audience" a WHERE a.id=m."audienceId";
ALTER TABLE "forcemultiplier"."ManualAudienceMember" ALTER COLUMN "personId" SET NOT NULL;
UPDATE "forcemultiplier"."CampaignRecipient" c SET "personId"=p.id FROM "forcemultiplier"."Person" p, "forcemultiplier"."CampaignSend" s, "forcemultiplier"."PullRun" r WHERE s.id=c."sendId" AND r.id=ANY(s."includeRunIds") AND p."orgId"=r."orgId" AND (p."salesforceId"=c."salesforceId" OR (c."salesforceId" LIKE 'manual:%' AND p.email=c.email AND p.source='manual'));
UPDATE "forcemultiplier"."CampaignRecipient" SET "salesforceId"=NULL WHERE "salesforceId" LIKE 'manual:%';
UPDATE "forcemultiplier"."FunraisinParticipant" f SET "personId"=p.id FROM "forcemultiplier"."Person" p, "forcemultiplier"."FunraisinSync" s WHERE p."orgId"=s."orgId" AND p."salesforceId"=f."salesforceId";
UPDATE "forcemultiplier"."FunraisinDonation" f SET "personId"=p.id FROM "forcemultiplier"."Person" p, "forcemultiplier"."FunraisinSync" s WHERE p."orgId"=s."orgId" AND p."salesforceId"=f."salesforceId";
ALTER TABLE "forcemultiplier"."FunraisinParticipant" ALTER COLUMN "personId" SET NOT NULL;
ALTER TABLE "forcemultiplier"."FunraisinDonation" ALTER COLUMN "personId" SET NOT NULL;
INSERT INTO "forcemultiplier"."PersonSource" ("orgId",source,"sourceId","personId") SELECT p."orgId",'funraisin-participant',f."memberId",p.id FROM "forcemultiplier"."FunraisinParticipant" f JOIN "forcemultiplier"."Person" p ON p.id=f."personId";
INSERT INTO "forcemultiplier"."PersonSource" ("orgId",source,"sourceId","personId") SELECT p."orgId",'funraisin-donation',f."donationId",p.id FROM "forcemultiplier"."FunraisinDonation" f JOIN "forcemultiplier"."Person" p ON p.id=f."personId";
INSERT INTO "forcemultiplier"."PersonEmail" ("personId",email) SELECT id,email FROM "forcemultiplier"."Person" WHERE email IS NOT NULL UNION SELECT "personId","normalizedEmail" FROM "forcemultiplier"."AudienceMember" WHERE "normalizedEmail" IS NOT NULL ON CONFLICT DO NOTHING;
-- AddForeignKey
ALTER TABLE "forcemultiplier"."AudienceMember" ADD CONSTRAINT "AudienceMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "forcemultiplier"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."ManualAudienceMember" ADD CONSTRAINT "ManualAudienceMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "forcemultiplier"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_personId_fkey" FOREIGN KEY ("personId") REFERENCES "forcemultiplier"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."FunraisinParticipant" ADD CONSTRAINT "FunraisinParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "forcemultiplier"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."FunraisinDonation" ADD CONSTRAINT "FunraisinDonation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "forcemultiplier"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."PersonSource" ADD CONSTRAINT "PersonSource_personId_fkey" FOREIGN KEY ("personId") REFERENCES "forcemultiplier"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forcemultiplier"."PersonEmail" ADD CONSTRAINT "PersonEmail_personId_fkey" FOREIGN KEY ("personId") REFERENCES "forcemultiplier"."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['Person','PersonSource','PersonEmail','AudienceImport','ManualAudienceMember'] LOOP
  EXECUTE format('ALTER TABLE forcemultiplier.%I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('REVOKE ALL ON TABLE forcemultiplier.%I FROM PUBLIC', table_name);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE forcemultiplier.%I FROM anon',table_name); END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE forcemultiplier.%I FROM authenticated',table_name); END IF;
 END LOOP;
END $$;

COMMIT;
