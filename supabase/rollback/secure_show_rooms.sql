-- Disable the secured Show API without deleting its rooms, identities or history.
-- Apply as one transaction. Keep the secured client blocked or serve an
-- unavailable page; do not restore legacy CRUD clients as an automatic fallback.
-- No legacy policies are restored or broadened. Secured rooms are never copied
-- into legacy tables. Re-enabling requires a reviewed, explicit GRANT migration.
SET LOCAL lock_timeout = '3s';
REVOKE ALL ON SCHEMA show_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA show_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA show_private FROM PUBLIC, anon, authenticated;
DO $disable_api$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('show_create_room','show_host_resume','show_begin_run','show_host_publish','show_host_members','show_host_answers','show_host_buzzes','show_close_submissions','show_award','show_preview','show_join','show_my_membership','show_heartbeat','show_leave','show_player_state','show_answer','show_buzz') LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
 END LOOP;
END; $disable_api$;
