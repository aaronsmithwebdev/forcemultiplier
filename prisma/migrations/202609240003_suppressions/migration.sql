CREATE TABLE "forcemultiplier"."Suppression" (
  "email" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'global_unsubscribe',
  "source" TEXT NOT NULL,
  "sourceRef" TEXT,
  "occurredAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Suppression_pkey" PRIMARY KEY ("email")
);

CREATE INDEX "Suppression_createdAt_idx" ON "forcemultiplier"."Suppression"("createdAt");

REVOKE ALL ON TABLE "forcemultiplier"."Suppression" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."Suppression" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."Suppression" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."Suppression" ENABLE ROW LEVEL SECURITY;
