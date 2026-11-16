-- Disable Ruffled Feathers phone rooms without deleting data. Apply atomically;
-- explicit reviewed grants are required to re-enable. One-screen play is unaffected.
SET LOCAL lock_timeout='3s';
REVOKE ALL ON SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;
DO $disable$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'ruffled\_%' ESCAPE '\' LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END $disable$;
