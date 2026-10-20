-- Remove interactive access to scheduled, privileged maintenance.
-- Run transactionally. This never calls cleanup or changes its body/schedule.
-- The guards deliberately reject drift instead of altering an unknown setup.
SET LOCAL lock_timeout = '3s';

DO $cleanup_guard$
DECLARE fn oid;
BEGIN
  fn := to_regprocedure('public.cleanup_old_events()');
  IF fn IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND l.lanname='sql' AND p.prosecdef AND p.prokind='f'
      AND p.pronargs=0 AND p.prorettype='pg_catalog.void'::regtype
      AND p.proconfig=ARRAY['search_path=public']::text[]
      AND md5(replace(pg_catalog.pg_get_functiondef(p.oid), E'\r\n', E'\n'))
          ='12c3777638ef854b65ddc06cec78a36b'
  ) THEN
    RAISE EXCEPTION 'Cleanup definition changed since review';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='tierbrain-cleanup') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM cron.job WHERE jobname='tierbrain-cleanup'
         AND active AND schedule='0 * * * *' AND username='postgres'
         AND database=current_database()
         AND command ~* '^[[:space:]]*select[[:space:]]+public[.]cleanup_old_events[(][[:space:]]*[)][[:space:]]*;?[[:space:]]*$'
     ) THEN
    RAISE EXCEPTION 'Cleanup schedule changed since review';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=fn) <> 3
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=fn
         AND (pg_catalog.pg_get_userbyid(a.grantee) NOT IN ('authenticated', 'postgres', 'service_role')
              OR pg_catalog.pg_get_userbyid(a.grantor)<>'postgres'
              OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
     ) THEN
    RAISE EXCEPTION 'Cleanup execution grants changed since review';
  END IF;
  IF pg_catalog.has_function_privilege('anon', fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', fn, 'EXECUTE') IS DISTINCT FROM true
     OR NOT pg_catalog.has_function_privilege('postgres', fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected effective cleanup privileges';
  END IF;
END
$cleanup_guard$;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_events() FROM authenticated;

DO $cleanup_guard$
DECLARE fn oid;
BEGIN
  fn := to_regprocedure('public.cleanup_old_events()');
  IF fn IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND l.lanname='sql' AND p.prosecdef AND p.prokind='f'
      AND p.pronargs=0 AND p.prorettype='pg_catalog.void'::regtype
      AND p.proconfig=ARRAY['search_path=public']::text[]
      AND md5(replace(pg_catalog.pg_get_functiondef(p.oid), E'\r\n', E'\n'))
          ='12c3777638ef854b65ddc06cec78a36b'
  ) THEN
    RAISE EXCEPTION 'Cleanup definition changed since review';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='tierbrain-cleanup') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM cron.job WHERE jobname='tierbrain-cleanup'
         AND active AND schedule='0 * * * *' AND username='postgres'
         AND database=current_database()
         AND command ~* '^[[:space:]]*select[[:space:]]+public[.]cleanup_old_events[(][[:space:]]*[)][[:space:]]*;?[[:space:]]*$'
     ) THEN
    RAISE EXCEPTION 'Cleanup schedule changed since review';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=fn) <> 2
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=fn
         AND (pg_catalog.pg_get_userbyid(a.grantee) NOT IN ('postgres', 'service_role')
              OR pg_catalog.pg_get_userbyid(a.grantor)<>'postgres'
              OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
     ) THEN
    RAISE EXCEPTION 'Cleanup execution grants changed since review';
  END IF;
  IF pg_catalog.has_function_privilege('anon', fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', fn, 'EXECUTE') IS DISTINCT FROM false
     OR NOT pg_catalog.has_function_privilege('postgres', fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected effective cleanup privileges';
  END IF;
END
$cleanup_guard$;
