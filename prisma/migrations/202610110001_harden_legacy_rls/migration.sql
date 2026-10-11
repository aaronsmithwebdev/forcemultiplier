-- Legacy public tables are optional in fresh installations. The private footer
-- table is part of the current application and must exist.
ALTER TABLE "forcemultiplier"."EmailFooter" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "forcemultiplier"."EmailFooter" FROM PUBLIC;

DO $$
DECLARE
  table_name text;
  role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON TABLE forcemultiplier."EmailFooter" FROM %I', role_name);
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'Contact', 'ContactProperty', 'IntegrationAccount', 'IntegrationFieldMap',
    'ListSync', 'ListSyncContact', 'SalesforceToken', 'SyncJob'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
      FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
