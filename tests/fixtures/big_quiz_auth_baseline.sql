-- Synthetic baseline for sequential application of all three existing migrations.
-- Deliberately includes current-score/cleanup prerequisites, invented rows only.
-- Synthetic PostgreSQL-only fixture. This is not GoTrue or JWT verification.
-- The driver alone sets this claim after choosing a synthetic actor. Production
-- must obtain auth.uid() from a JWT verified by the real Auth/PostgREST stack.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $uid$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$uid$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Deliberately permissive legacy stand-ins expose accidental edits, copies, or
-- changes to shared policies. They contain invented sentinels only. They are
-- not a claim that these minimal table definitions reproduce production schema.
DO $legacy$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rooms','players','answers','buzzes','legends'] LOOP
    EXECUTE format('CREATE TABLE public.%I (
      id bigint PRIMARY KEY, created_at timestamptz NOT NULL,
      payload jsonb NOT NULL)', t);
    EXECUTE format('INSERT INTO public.%I VALUES
      (101,''2000-01-01T00:00:00Z'',''{"sentinel":"synthetic old legacy"}''),
      (102,''2100-01-01T00:00:00Z'',''{"sentinel":"synthetic future legacy"}'')', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY synthetic_legacy_access ON public.%I
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO anon, authenticated', t);
  END LOOP;
END
$legacy$;
CREATE TABLE public.scores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  quiz_id text NOT NULL,
  group_code text NOT NULL,
  name text NOT NULL,
  correct integer NOT NULL,
  level integer NOT NULL,
  time_left integer NOT NULL
);
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.scores TO anon, authenticated;
GRANT ALL ON SEQUENCE public.scores_id_seq TO anon, authenticated;
CREATE POLICY "read scores" ON public.scores FOR SELECT TO anon USING (true);
CREATE POLICY "add scores" ON public.scores FOR INSERT TO anon WITH CHECK (
  ((correct >= 0) AND (correct <= 20))
  AND ((level >= 1) AND (level <= 4))
  AND ((char_length(name) >= 1) AND (char_length(name) <= 20))
  AND ((char_length(group_code) >= 1) AND (char_length(group_code) <= 24))
  AND ((char_length(quiz_id) >= 1) AND (char_length(quiz_id) <= 48))
);

INSERT INTO public.scores(id,created_at,quiz_id,group_code,name,correct,level,time_left) OVERRIDING SYSTEM VALUE VALUES
 (101,'2000-01-01T00:00:00Z','synthetic_quiz','SYNTHETIC','Old score',3,1,10),
 (102,'2100-01-01T00:00:00Z','synthetic_quiz','SYNTHETIC','Future score',4,2,20);

CREATE SEQUENCE public.synthetic_legacy_sequence;
GRANT USAGE ON SEQUENCE public.synthetic_legacy_sequence TO anon;

CREATE FUNCTION public.cleanup_old_events() RETURNS void LANGUAGE sql
SECURITY DEFINER SET search_path TO 'public' AS $cleanup$
  delete from public.answers where created_at < now() - interval '6 hours';
  delete from public.buzzes  where created_at < now() - interval '6 hours';
  delete from public.players where created_at < now() - interval '6 hours';
  delete from public.rooms   where created_at < now() - interval '6 hours';
$cleanup$;
REVOKE ALL ON FUNCTION public.cleanup_old_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO authenticated, service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigint PRIMARY KEY, jobname text NOT NULL, schedule text NOT NULL,
  command text NOT NULL, database text NOT NULL, username text NOT NULL, active boolean NOT NULL
);
INSERT INTO cron.job VALUES
  (1,'tierbrain-cleanup','0 * * * *','select public.cleanup_old_events()',current_database(),'postgres',true);

-- Exercise explicit revocation even when platform defaults grant new objects
-- broadly. These defaults affect only subsequently created synthetic objects.
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
