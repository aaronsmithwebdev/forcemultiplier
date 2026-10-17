CREATE TABLE "forcemultiplier"."FunraisinEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "eventDate" TIMESTAMP(3),
  "lastSeenScan" TEXT
);
CREATE TABLE "forcemultiplier"."FunraisinParticipant" (
  "memberId" TEXT NOT NULL PRIMARY KEY,
  "salesforceId" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "lastSeenScan" TEXT
);
CREATE INDEX "FunraisinParticipant_salesforceId_idx"
  ON "forcemultiplier"."FunraisinParticipant"("salesforceId");
CREATE TABLE "forcemultiplier"."FunraisinRegistration" (
  "historyId" TEXT NOT NULL PRIMARY KEY,
  "memberId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL,
  "complete" BOOLEAN NOT NULL,
  "archived" BOOLEAN NOT NULL,
  "lastSeenScan" TEXT,
  CONSTRAINT "FunraisinRegistration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "forcemultiplier"."FunraisinParticipant"("memberId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FunraisinRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "forcemultiplier"."FunraisinEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FunraisinRegistration_eventId_memberId_idx"
  ON "forcemultiplier"."FunraisinRegistration"("eventId", "memberId");
CREATE TABLE "forcemultiplier"."FunraisinDonation" (
  "donationId" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT,
  "salesforceId" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "status" TEXT,
  "lastSeenScan" TEXT,
  CONSTRAINT "FunraisinDonation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "forcemultiplier"."FunraisinEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "FunraisinDonation_eventId_salesforceId_idx"
  ON "forcemultiplier"."FunraisinDonation"("eventId", "salesforceId");
CREATE TABLE "forcemultiplier"."FunraisinSync" (
  "id" TEXT NOT NULL DEFAULT 'default' PRIMARY KEY,
  "orgId" TEXT,
  "baseUrl" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'full',
  "phase" TEXT NOT NULL DEFAULT 'events',
  "offset" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "scanId" TEXT,
  "scanUntil" TIMESTAMP(3),
  "lastFullAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "error" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['FunraisinEvent', 'FunraisinParticipant', 'FunraisinRegistration', 'FunraisinDonation', 'FunraisinSync'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE forcemultiplier.%I FROM PUBLIC', table_name);
    EXECUTE format('ALTER TABLE forcemultiplier.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE forcemultiplier.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE forcemultiplier.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END $$;
