-- Disable the secured Big Quiz API without deleting its rooms, identities or history.
-- Apply as one transaction. Keep the secured client blocked or serve an
-- unavailable page; do not restore legacy CRUD clients as an automatic fallback.
-- No legacy policies are restored or broadened. Secured rooms are never copied
-- into legacy tables. Re-enabling requires a reviewed, explicit GRANT migration.
SET LOCAL lock_timeout = '3s';
REVOKE ALL ON SCHEMA bigquiz_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA bigquiz_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bigquiz_private FROM PUBLIC, anon, authenticated;
DO $disable_api$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('bigquiz_create_room','bigquiz_host_resume','bigquiz_begin_run','bigquiz_host_publish','bigquiz_host_members','bigquiz_host_answers','bigquiz_host_buzzes','bigquiz_close_submissions','bigquiz_award','bigquiz_preview','bigquiz_join','bigquiz_my_membership','bigquiz_heartbeat','bigquiz_leave','bigquiz_player_state','bigquiz_answer','bigquiz_buzz') LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
 END LOOP;
END; $disable_api$;
