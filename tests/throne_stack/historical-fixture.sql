-- LOCAL DISPOSABLE STACK ONLY. Never apply this fixture to a hosted project.
-- The identity probe is installed exclusively by tests/show_stack/bootstrap.sql.
DO $fixture$
BEGIN
 IF pg_catalog.to_regprocedure('public.stack_whoami()') IS NULL THEN
  RAISE EXCEPTION 'Disposable Auth/PostgREST fixture required; refusing historical test inserts';
 END IF;
END
$fixture$;
INSERT INTO public.legends(game,name,streak,flawless,questions,players,created_at)
SELECT v.game,v.name,v.streak,v.flawless,3,2,'2026-01-01T00:00:00Z'::timestamptz
FROM (VALUES
 ('throne:THRONE_HTTP_SCOPE','HTTP legacy general target',3,false),
 ('throne:THRONE_HTTP_OTHER','HTTP legacy other group',9,true),
 ('throne-bible:THRONE_HTTP_SCOPE','HTTP legacy Bible target',5,true)
) AS v(game,name,streak,flawless)
WHERE NOT EXISTS (SELECT 1 FROM public.legends l WHERE l.game=v.game AND l.name=v.name);
