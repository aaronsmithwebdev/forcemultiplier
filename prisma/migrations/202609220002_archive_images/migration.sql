CREATE TABLE "forcemultiplier"."ArchiveImageImport" (
  "id" TEXT NOT NULL DEFAULT 'constant-contact',
  "accountId" TEXT NOT NULL,
  "cutoff" TIMESTAMP(3) NOT NULL,
  "mediaFolder" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'inventory',
  "cursor" TEXT,
  "scanned" INTEGER NOT NULL DEFAULT 0,
  "leaseUntil" TIMESTAMP(3),
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArchiveImageImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forcemultiplier"."ArchivedImage" (
  "accountId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "storagePath" TEXT,
  "sha256" TEXT,
  "contentType" TEXT,
  "error" TEXT,
  "emailIds" TEXT[] NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArchivedImage_pkey" PRIMARY KEY ("accountId","url")
);

REVOKE ALL ON TABLE "forcemultiplier"."ArchiveImageImport" FROM PUBLIC;
REVOKE ALL ON TABLE "forcemultiplier"."ArchivedImage" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ArchiveImageImport" FROM anon;
    REVOKE ALL ON TABLE "forcemultiplier"."ArchivedImage" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "forcemultiplier"."ArchiveImageImport" FROM authenticated;
    REVOKE ALL ON TABLE "forcemultiplier"."ArchivedImage" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "forcemultiplier"."ArchiveImageImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forcemultiplier"."ArchivedImage" ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-archive-images', 'email-archive-images', true, 10485760, ARRAY['image/png','image/jpeg','image/gif','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "ForceMultiplier archive image uploads" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'email-archive-images'
  AND name ~ '^[0-9a-f]{64}[.](png|jpg|gif|webp)$'
);
