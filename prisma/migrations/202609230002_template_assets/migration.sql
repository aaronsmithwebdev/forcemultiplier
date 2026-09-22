INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-template-assets', 'email-template-assets', true, 10485760, ARRAY['image/png','image/jpeg','image/gif','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "ForceMultiplier template asset listing" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'email-template-assets');

CREATE POLICY "ForceMultiplier template asset uploads" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'email-template-assets'
  AND name ~ '^[0-9a-f-]{36}[.](png|jpg|gif|webp)$'
);
