-- Private early-access intake. No public table reads or direct writes.
-- Apply atomically. No existing application data or Auth settings are changed.
SET LOCAL lock_timeout = '3s';
DO $guard$ BEGIN
  IF pg_catalog.to_regclass('public.host_leads') IS NOT NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='submit_host_lead'
  ) THEN
    RAISE EXCEPTION 'Host lead intake already exists; review before applying';
  END IF;
END $guard$;

CREATE TABLE public.host_leads (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  email text COLLATE "C" NOT NULL UNIQUE,
  context text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (email = lower(btrim(email)) AND octet_length(email) BETWEEN 3 AND 254
    AND char_length(split_part(email,'@',1)) BETWEEN 1 AND 64
    AND email !~ '[[:cntrl:]]'
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  CHECK (context IS NULL OR context IN ('pub','office','church','school','party','other'))
);
CREATE INDEX host_leads_created_at ON public.host_leads(created_at);
ALTER TABLE public.host_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.host_leads FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.host_leads IS
  'Private early-access email/context; only validated public submission RPC. No public read policy.';

CREATE FUNCTION public.submit_host_lead(p_email text, p_context text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  email_value text := lower(btrim(p_email));
  context_value text := nullif(btrim(p_context),'');
  total_count bigint;
  daily_count bigint;
  day_start timestamptz := date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  IF email_value IS NULL OR octet_length(email_value) NOT BETWEEN 3 AND 254
    OR char_length(split_part(email_value,'@',1)) NOT BETWEEN 1 AND 64
    OR email_value ~ '[[:cntrl:]]'
    OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE='22023';
  END IF;
  IF context_value IS NOT NULL AND context_value NOT IN ('pub','office','church','school','party','other') THEN
    RAISE EXCEPTION 'Choose a listed event context' USING ERRCODE='22023';
  END IF;
  -- Serialize capacity checks with inserts, including concurrent duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended('tierbrain:host-lead-intake:v1',0));
  SELECT count(*),count(*) FILTER (WHERE created_at >= day_start)
    INTO total_count,daily_count FROM public.host_leads;
  -- Check global availability before deduplication so a full intake does not
  -- disclose whether the supplied email is already on the private list.
  IF total_count >= 10000 OR daily_count >= 1000 THEN
    RAISE EXCEPTION 'Early access signup is temporarily unavailable; please try again later'
      USING ERRCODE='54000';
  END IF;
  INSERT INTO public.host_leads(email,context) VALUES (email_value,context_value)
    ON CONFLICT (email) DO NOTHING;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.submit_host_lead(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_host_lead(text,text) TO anon,authenticated;
COMMENT ON FUNCTION public.submit_host_lead(text,text) IS
  'Intended public opt-in intake. Generic acknowledgement for new and duplicate email; no personal data returned. Global 10000-total/1000-per-UTC-day capacity.';
NOTIFY pgrst,'reload schema';
