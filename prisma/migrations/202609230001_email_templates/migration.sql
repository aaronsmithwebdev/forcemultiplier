CREATE TABLE "forcemultiplier"."EmailTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."EmailTemplateRevision" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "label" TEXT,
  "createdBy" TEXT NOT NULL,
  "automatic" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailTemplateRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailTemplate_updatedAt_idx" ON "forcemultiplier"."EmailTemplate"("updatedAt");
CREATE INDEX "EmailTemplateRevision_templateId_createdAt_idx" ON "forcemultiplier"."EmailTemplateRevision"("templateId", "createdAt");
ALTER TABLE "forcemultiplier"."EmailTemplateRevision" ADD CONSTRAINT "EmailTemplateRevision_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "forcemultiplier"."EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON TABLE "forcemultiplier"."EmailTemplate" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."EmailTemplateRevision" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."EmailTemplate" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."EmailTemplateRevision" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."EmailTemplate" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."EmailTemplateRevision" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."EmailTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."EmailTemplateRevision" ENABLE ROW LEVEL SECURITY;
