-- Synthetic acceptance fixture only. No production rows or scheduler extension.
-- The function body/ACL and cron metadata reproduce the reviewed baseline.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.answers (id text PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TABLE public.buzzes (id text PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TABLE public.players (id text PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TABLE public.rooms (id text PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TABLE public.scores (id text PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TABLE public.legends (id text PRIMARY KEY, created_at timestamptz NOT NULL);

CREATE OR REPLACE FUNCTION public.cleanup_old_events()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from public.answers where created_at < now() - interval '6 hours';
  delete from public.buzzes  where created_at < now() - interval '6 hours';
  delete from public.players where created_at < now() - interval '6 hours';
  delete from public.rooms   where created_at < now() - interval '6 hours';
$function$;
REVOKE ALL ON FUNCTION public.cleanup_old_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO authenticated, service_role;

-- A passive stand-in for the catalog: no cron jobs run in this fixture.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigint PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  database text NOT NULL,
  username text NOT NULL,
  active boolean NOT NULL,
  jobname text NOT NULL
);
INSERT INTO cron.job(jobid,schedule,command,database,username,active,jobname)
VALUES (1,'0 * * * *','select public.cleanup_old_events()',current_database(),
        'postgres',true,'tierbrain-cleanup');

-- These fixed sentinels expose any unexpected data changes during migration.
DO $seed$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['answers','buzzes','players','rooms','scores','legends'] LOOP
    EXECUTE format('INSERT INTO public.%I(id,created_at) VALUES
      (''synthetic_old'',''2000-01-01T00:00:00Z''),
      (''synthetic_future'',''2100-01-01T00:00:00Z'')', table_name);
  END LOOP;
END
$seed$;
