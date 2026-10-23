-- Disable protected move-family APIs, retain every room/member/action/receipt.
-- Do not restore legacy REST clients or mirror private rows to public tables.
SET LOCAL lock_timeout='3s';
REVOKE ALL ON SCHEMA party_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
DO $disable$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('party_create_room','party_host_resume','party_begin_run','party_host_publish','party_host_members','party_host_actions','party_host_close','party_preview','party_join','party_my_membership','party_heartbeat','party_leave','party_player_state','party_submit','party_activity_start','party_event') LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END $disable$;
NOTIFY pgrst,'reload schema';
