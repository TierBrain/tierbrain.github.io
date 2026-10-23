-- Final cutover only: deploy and verify every secured host/phone client first.
-- No application row, private API, score policy, cleanup function or cron change.
-- Run in a transaction (Supabase migrations do this); any guard failure rolls back.
SET LOCAL lock_timeout='3s';
DO $retire$
DECLARE
  tables CONSTANT text[] := ARRAY['rooms','players','answers','buzzes','legends'];
  rel record;
  pol record;
  seq record;
  app text;
  priv text;
  cols text;
  observed jsonb;
  expected CONSTANT jsonb := '[
    ["answers","answers_ins","a",null,"true"],
    ["answers","answers_sel","r","true",null],
    ["buzzes","buzzes_ins","a",null,"true"],
    ["buzzes","buzzes_sel","r","true",null],
    ["legends","legends_ins","a",null,"true"],
    ["legends","legends_sel","r","true",null],
    ["players","players_del","d","true",null],
    ["players","players_ins","a",null,"true"],
    ["players","players_sel","r","true",null],
    ["players","players_upd","w","true","true"],
    ["rooms","rooms_ins","a",null,"true"],
    ["rooms","rooms_sel","r","true",null],
    ["rooms","rooms_upd","w","true","true"]
  ]'::jsonb;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Legacy cutover must run as the reviewed postgres owner';
  END IF;
  IF to_regclass('public.moves') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected public.moves drift: review its data and callers before cutover';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(tables)
        AND c.relkind='r' AND c.relowner='postgres'::regrole
        AND c.relrowsecurity AND NOT c.relforcerowsecurity) <> 5 THEN
    RAISE EXCEPTION 'Legacy table existence/owner/kind/RLS drift';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Application role bypass drift';
  END IF;

  -- This is deliberately not a blanket revoke on public or its functions.
  -- A missing API means one of the remaining families has not migrated yet.
  FOR rel IN SELECT * FROM (VALUES
      ('show_private','show_',17), ('bigquiz_private','bigquiz_',17),
      ('throne_private','throne_',19), ('party_private','party_',16)
    ) AS required(schema_name,prefix,total) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=rel.schema_name)
       OR (SELECT count(*) FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND left(p.proname,length(rel.prefix))=rel.prefix) <> rel.total
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND left(p.proname,length(rel.prefix))=rel.prefix
             AND (NOT p.prosecdef OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
                  OR has_function_privilege('anon',p.oid,'EXECUTE')
                  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'])) THEN
      RAISE EXCEPTION 'Secured API prerequisite drift: %',rel.prefix;
    END IF;
  END LOOP;

  -- An unreviewed definer RPC could bypass table revocations. Abort rather than
  -- changing an unrelated API or declaring a cutover with an accessible alias.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef
        AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
        AND NOT (left(p.proname,5)='show_' OR left(p.proname,8)='bigquiz_'
                 OR left(p.proname,7)='throne_' OR left(p.proname,6)='party_')) THEN
    RAISE EXCEPTION 'Unexpected callable definer API: review before legacy cutover';
  END IF;

  LOCK TABLE public.rooms, public.players, public.answers, public.buzzes, public.legends
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT jsonb_agg(jsonb_build_array(c.relname,p.polname,p.polcmd,
           pg_catalog.pg_get_expr(p.polqual,p.polrelid),
           pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY c.relname,p.polname)
    INTO observed
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(tables);
  IF observed IS DISTINCT FROM expected OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(tables)
        AND (NOT p.polpermissive OR p.polroles IS DISTINCT FROM ARRAY[0::oid])) THEN
    RAISE EXCEPTION 'Legacy policies differ from the reviewed 13 PUBLIC true policies';
  END IF;

  -- Views are separate entry points, including security-definer owner views.
  -- Do not silently change an unexpected view's access contract.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite rw ON rw.oid=d.objid AND d.classid='pg_rewrite'::regclass
    JOIN pg_catalog.pg_class v ON v.oid=rw.ev_class
    JOIN pg_catalog.pg_class t ON t.oid=d.refobjid AND d.refclassid='pg_class'::regclass
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY(tables) AND v.relkind IN ('v','m')
      AND (has_table_privilege('anon',v.oid,'SELECT') OR has_table_privilege('authenticated',v.oid,'SELECT'))
  ) THEN
    RAISE EXCEPTION 'Unexpected accessible view over legacy data: review before cutover';
  END IF;

  FOR rel IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(tables) ORDER BY c.relname LOOP
    -- RESTRICT is intentional. An unexpected dependent grant must abort atomically.
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC,anon,authenticated',rel.relname);
    SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO cols
      FROM pg_catalog.pg_attribute WHERE attrelid=rel.oid AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC,anon,authenticated',cols,rel.relname);
    FOR pol IN SELECT polname FROM pg_catalog.pg_policy WHERE polrelid=rel.oid LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',pol.polname,rel.relname);
    END LOOP;
    FOR seq IN SELECT DISTINCT s.oid,ns.nspname,s.relname FROM pg_catalog.pg_depend d
        JOIN pg_catalog.pg_class s ON s.oid=d.objid AND d.classid='pg_class'::regclass
        JOIN pg_catalog.pg_namespace ns ON ns.oid=s.relnamespace
        WHERE s.relkind='S' AND d.refclassid='pg_class'::regclass
          AND d.refobjid=rel.oid AND d.deptype IN ('a','i') LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC,anon,authenticated',seq.nspname,seq.relname);
      FOREACH app IN ARRAY ARRAY['anon','authenticated'] LOOP
        FOREACH priv IN ARRAY ARRAY['SELECT','UPDATE','USAGE'] LOOP
          IF has_sequence_privilege(app,seq.oid,priv) THEN
            RAISE EXCEPTION 'Inherited sequence privilege remains: %.% % %',seq.nspname,seq.relname,app,priv;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    FOREACH app IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(app,rel.oid,priv) THEN
          RAISE EXCEPTION 'Inherited table privilege remains: % % %',rel.relname,app,priv;
        END IF;
      END LOOP;
      FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_any_column_privilege(app,rel.oid,priv) THEN
          RAISE EXCEPTION 'Inherited column privilege remains: % % %',rel.relname,app,priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$retire$;
