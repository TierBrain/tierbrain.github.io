\set ON_ERROR_STOP on
\getenv auth_db_password AUTH_DB_PASSWORD
\getenv rest_db_password REST_DB_PASSWORD

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN CREATEROLE NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
END $$;
ALTER ROLE supabase_auth_admin PASSWORD :'auth_db_password';
ALTER ROLE authenticator PASSWORD :'rest_db_password';
ALTER ROLE supabase_auth_admin SET search_path = auth, public, extensions;
GRANT anon, authenticated TO authenticator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO supabase_auth_admin;

-- Standard claim accessor, consumed only through independently verified HTTP JWTs.
-- It is not evidence by itself; acceptance.mjs proves Auth -> PostgREST -> auth.uid().
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
-- GoTrue's initial migration replaces auth.uid(). It must own this pre-created
-- function, which the disposable identity probe below needs at creation time.
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

-- Disposable test fixture only: this is not copied into the website or production migration.
CREATE OR REPLACE FUNCTION public.stack_whoami() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT pg_catalog.jsonb_build_object(
    'uid', auth.uid(),
    'role', current_user,
    'is_anonymous', NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb -> 'is_anonymous'
  )
$$;
REVOKE ALL ON FUNCTION public.stack_whoami() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stack_whoami() TO authenticated;
