CREATE TABLE "forcemultiplier"."FunraisinIssue" (
  "phase" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "lastSeenScan" TEXT,
  CONSTRAINT "FunraisinIssue_pkey" PRIMARY KEY ("phase", "sourceId")
);
REVOKE ALL ON TABLE "forcemultiplier"."FunraisinIssue" FROM PUBLIC;
ALTER TABLE "forcemultiplier"."FunraisinIssue" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."FunraisinIssue" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."FunraisinIssue" FROM authenticated;
  END IF;
END $$;
