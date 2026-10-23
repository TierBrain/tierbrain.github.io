-- Synthetic disposable PostgreSQL only. Run after show_auth_baseline.sql.
-- Reproduce the exact reviewed policy names/scopes, with deliberately broad
-- table, column, owned-sequence and PUBLIC privileges to challenge the cutover.
DO $policies$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['rooms','players','answers','buzzes','legends'] LOOP
  EXECUTE format('DROP POLICY synthetic_legacy_access ON public.%I',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO PUBLIC USING(true)',t||'_sel',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO PUBLIC WITH CHECK(true)',t||'_ins',t);
  EXECUTE format('GRANT ALL ON TABLE public.%I TO anon,authenticated,service_role',t);
 END LOOP;
END
$policies$;
CREATE POLICY players_del ON public.players FOR DELETE TO PUBLIC USING(true);
CREATE POLICY players_upd ON public.players FOR UPDATE TO PUBLIC USING(true) WITH CHECK(true);
CREATE POLICY rooms_upd ON public.rooms FOR UPDATE TO PUBLIC USING(true) WITH CHECK(true);
GRANT SELECT ON TABLE public.rooms TO PUBLIC;
GRANT SELECT(id),UPDATE(payload),REFERENCES(id) ON TABLE public.rooms TO PUBLIC,anon,authenticated;
CREATE SEQUENCE public.retirement_owned_rooms_seq OWNED BY public.rooms.id;
GRANT ALL ON SEQUENCE public.retirement_owned_rooms_seq TO PUBLIC,anon,authenticated,service_role;
CREATE SEQUENCE public.retirement_owned_legends_seq OWNED BY public.legends.id;
GRANT ALL ON SEQUENCE public.retirement_owned_legends_seq TO PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.legends ADD COLUMN game text;
ALTER TABLE public.legends ADD COLUMN name text;
ALTER TABLE public.legends ADD COLUMN streak integer;
ALTER TABLE public.legends ADD COLUMN flawless boolean;
UPDATE public.legends SET game='throne:GROUP_A',name='Historical General',streak=7,flawless=false WHERE id=101;
UPDATE public.legends SET game='throne-bible:GROUP_A',name='Historical Bible',streak=4,flawless=true WHERE id=102;

-- Unrelated objects must retain their exact original access, metadata and rows.
CREATE TABLE public.host_leads(id bigint PRIMARY KEY,payload text);
INSERT INTO public.host_leads VALUES(1,'Synthetic unrelated feature');
GRANT SELECT,INSERT ON public.host_leads TO anon;
CREATE SEQUENCE public.retirement_unrelated_seq;
GRANT USAGE ON SEQUENCE public.retirement_unrelated_seq TO PUBLIC,anon,authenticated;
