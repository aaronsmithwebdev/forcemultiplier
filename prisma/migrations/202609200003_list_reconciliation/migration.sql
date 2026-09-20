ALTER TABLE "forcemultiplier"."AudienceMember" ADD COLUMN "normalizedEmail" TEXT;
UPDATE "forcemultiplier"."AudienceMember"
SET "normalizedEmail" = lower(trim("email"))
WHERE "email" IS NOT NULL
  AND length(trim("email")) <= 50
  AND trim("email") ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
CREATE INDEX "AudienceMember_runId_normalizedEmail_idx" ON "forcemultiplier"."AudienceMember"("runId", "normalizedEmail");

CREATE TABLE "forcemultiplier"."ManagedList" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "listName" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "initializedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."ManagedListMember" (
    "managedListId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "seenDeliveryId" TEXT NOT NULL,
    "desiredDeliveryId" TEXT,
    CONSTRAINT "ManagedListMember_pkey" PRIMARY KEY ("managedListId", "email")
);

ALTER TABLE "forcemultiplier"."DeliveryRun"
  ADD COLUMN "managedListId" TEXT,
  ADD COLUMN "activityKind" TEXT,
  ADD COLUMN "removed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconcileCursor" TEXT,
  ADD COLUMN "reconcileScannedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "ManagedList_accountId_listId_key" ON "forcemultiplier"."ManagedList"("accountId", "listId");
CREATE INDEX "ManagedListMember_managedListId_seenDeliveryId_idx" ON "forcemultiplier"."ManagedListMember"("managedListId", "seenDeliveryId");
CREATE INDEX "ManagedListMember_managedListId_desiredDeliveryId_idx" ON "forcemultiplier"."ManagedListMember"("managedListId", "desiredDeliveryId");
ALTER TABLE "forcemultiplier"."ManagedList" ADD CONSTRAINT "ManagedList_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "forcemultiplier"."Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forcemultiplier"."ManagedListMember" ADD CONSTRAINT "ManagedListMember_managedListId_fkey" FOREIGN KEY ("managedListId") REFERENCES "forcemultiplier"."ManagedList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forcemultiplier"."DeliveryRun" ADD CONSTRAINT "DeliveryRun_managedListId_fkey" FOREIGN KEY ("managedListId") REFERENCES "forcemultiplier"."ManagedList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "forcemultiplier"."DeliveryRun_one_active";
CREATE UNIQUE INDEX "DeliveryRun_one_active" ON "forcemultiplier"."DeliveryRun" ("audienceId") WHERE "status" IN ('pending','running','paused','reconciling');

REVOKE ALL ON TABLE "forcemultiplier"."ManagedList" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."ManagedListMember" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE forcemultiplier."ManagedList" FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON TABLE forcemultiplier."ManagedListMember" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
ALTER TABLE "forcemultiplier"."ManagedList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."ManagedListMember" ENABLE ROW LEVEL SECURITY;
