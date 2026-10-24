-- Disable race APIs without deleting rooms, members, events or receipts.
-- Do not restore the old scoreboard message-bus clients. Export the private
-- application backup before any later retention or removal decision.
SET LOCAL lock_timeout='3s';
REVOKE ALL ON SCHEMA race_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA race_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA race_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA race_private FROM PUBLIC,anon,authenticated;
DO $disable$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('race_enter','race_state','race_start','race_submit','race_heartbeat','race_leave','race_reset','cleanup_race_rooms') LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END $disable$;
NOTIFY pgrst,'reload schema';
