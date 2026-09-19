-- The recovered 2025 init migration created empty legacy scaffolding in the NEW
-- schema. The live legacy data remains in public. Remove only the empty copies.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM forcemultiplier."Contact")
    OR EXISTS (SELECT 1 FROM forcemultiplier."SalesforceToken")
    OR EXISTS (SELECT 1 FROM forcemultiplier."SyncJob") THEN
    RAISE EXCEPTION 'Refusing to remove nonempty legacy scaffolding';
  END IF;
END $$;
DROP TABLE forcemultiplier."Contact";
DROP TABLE forcemultiplier."SalesforceToken";
DROP TABLE forcemultiplier."SyncJob";
