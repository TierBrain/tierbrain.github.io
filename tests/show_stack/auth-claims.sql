\set ON_ERROR_STOP on

-- Disposable local fixture only. Run AFTER GoTrue reports healthy and completes
-- its migrations, and BEFORE starting PostgREST. Never apply this to production.
-- GoTrue's initial self-hosted migration installs a legacy single-GUC accessor;
-- PostgREST 14 supplies verified claims as request.jwt.claims JSON instead.
DO $fixture_guard$
BEGIN
  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('auth.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Run GoTrue migrations before restoring the local claim accessor';
  END IF;
END;
$fixture_guard$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
