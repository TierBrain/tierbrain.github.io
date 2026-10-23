-- Disable both secured Throne editions without deleting data or restoring
-- unrestricted legacy clients. Apply atomically; explicit reviewed grants are
-- required to re-enable. Do not copy owned rooms into legacy tables.
SET LOCAL lock_timeout='3s';
REVOKE ALL ON SCHEMA throne_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA throne_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA throne_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA throne_private FROM PUBLIC,anon,authenticated;
DO $disable$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'throne\_%' ESCAPE '\' LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END $disable$;
