CREATE TABLE "forcemultiplier"."DeliveryIssue" (
    "deliveryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "salesforceId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryIssue_pkey" PRIMARY KEY ("deliveryId", "key")
);

CREATE INDEX "DeliveryIssue_deliveryId_category_idx" ON "forcemultiplier"."DeliveryIssue"("deliveryId", "category");
ALTER TABLE "forcemultiplier"."DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "forcemultiplier"."DeliveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE "forcemultiplier"."DeliveryIssue" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."DeliveryIssue" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."DeliveryIssue" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."DeliveryIssue" ENABLE ROW LEVEL SECURITY;
