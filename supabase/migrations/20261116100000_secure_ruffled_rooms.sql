-- Ruffled Feathers phone rooms: an isolated round-robin duel protocol.
-- The TV host remains the trusted question author; the server holds the correct
-- option privately, orders pecks by receipt, enforces windows and keeps points.
-- Apply atomically. Rollback: supabase/rollback/secure_ruffled_rooms.sql
SET LOCAL lock_timeout='3s';
DO $preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='ruffled_private') OR
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'ruffled\_%' ESCAPE '\') THEN
  RAISE EXCEPTION 'Ruffled objects already exist; review migration history';
 END IF;
END $preflight$;
CREATE SCHEMA ruffled_private;
REVOKE ALL ON SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;

CREATE TABLE ruffled_private.rooms(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 code text UNIQUE NOT NULL CHECK(code ~ '^[A-Z2-9]{5}$'),
 host_user_id uuid NOT NULL,
 phase text NOT NULL DEFAULT 'lobby' CHECK(phase IN ('lobby','table','live','final')),
 run_id uuid,current_bout_id uuid,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT(pg_catalog.clock_timestamp()+interval '12 hours')
);
CREATE INDEX rooms_owner_expiry ON ruffled_private.rooms(host_user_id,expires_at);
CREATE TABLE ruffled_private.members(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES ruffled_private.rooms(id),user_id uuid NOT NULL,
 name text NOT NULL CHECK(pg_catalog.char_length(name) BETWEEN 1 AND 14),
 joined_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 last_seen timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),left_at timestamptz
);
CREATE UNIQUE INDEX members_one_identity ON ruffled_private.members(room_id,user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX members_one_name ON ruffled_private.members(room_id,pg_catalog.lower(name)) WHERE left_at IS NULL;
CREATE INDEX members_roster ON ruffled_private.members(room_id,joined_at,id);
CREATE TABLE ruffled_private.runs(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES ruffled_private.rooms(id),
 roster uuid[] NOT NULL CHECK(pg_catalog.cardinality(roster) BETWEEN 3 AND 10),
 peck_ms integer CHECK(peck_ms IS NULL OR peck_ms BETWEEN 5000 AND 60000),
 topic text NOT NULL CHECK(pg_catalog.char_length(topic) BETWEEN 1 AND 40),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),finished_at timestamptz
);
CREATE INDEX runs_room ON ruffled_private.runs(room_id,created_at,id);
ALTER TABLE ruffled_private.rooms ADD CONSTRAINT rooms_run_fk FOREIGN KEY(run_id) REFERENCES ruffled_private.runs(id);
CREATE TABLE ruffled_private.bouts(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES ruffled_private.rooms(id),run_id uuid NOT NULL REFERENCES ruffled_private.runs(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 45),
 a_id uuid NOT NULL REFERENCES ruffled_private.members(id),b_id uuid NOT NULL REFERENCES ruffled_private.members(id),
 q_text text NOT NULL CHECK(pg_catalog.char_length(q_text) BETWEEN 1 AND 1000),opts jsonb NOT NULL,
 correct_idx integer NOT NULL CHECK(correct_idx BETWEEN 0 AND 3),
 open_at timestamptz NOT NULL,peck_deadline timestamptz,
 chooser_id uuid REFERENCES ruffled_private.members(id),chosen_at timestamptz,choose_deadline timestamptz,
 locked uuid[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),closed_at timestamptz,
 CHECK(a_id<>b_id),UNIQUE(run_id,ordinal)
);
CREATE UNIQUE INDEX bouts_one_per_pair ON ruffled_private.bouts(run_id,LEAST(a_id,b_id),GREATEST(a_id,b_id));
CREATE INDEX bouts_room ON ruffled_private.bouts(room_id,run_id,ordinal);
ALTER TABLE ruffled_private.rooms ADD CONSTRAINT rooms_bout_fk FOREIGN KEY(current_bout_id) REFERENCES ruffled_private.bouts(id);
CREATE TABLE ruffled_private.pecks(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),bout_id uuid NOT NULL REFERENCES ruffled_private.bouts(id),
 member_id uuid NOT NULL REFERENCES ruffled_private.members(id),created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(bout_id,member_id)
);
CREATE TABLE ruffled_private.answers(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),bout_id uuid NOT NULL REFERENCES ruffled_private.bouts(id),
 member_id uuid NOT NULL REFERENCES ruffled_private.members(id),choice integer NOT NULL CHECK(choice BETWEEN 0 AND 3),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),UNIQUE(bout_id,member_id)
);
CREATE TABLE ruffled_private.resolutions(
 bout_id uuid PRIMARY KEY REFERENCES ruffled_private.bouts(id),run_id uuid NOT NULL REFERENCES ruffled_private.runs(id),
 winner_id uuid REFERENCES ruffled_private.members(id),outcome text NOT NULL CHECK(outcome IN ('win','nil')),
 reason text NOT NULL CHECK(reason IN ('correct','both','time','host')),
 peck_ms integer CHECK(peck_ms IS NULL OR peck_ms BETWEEN 0 AND 3600000),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 CHECK((outcome='win')=(winner_id IS NOT NULL)),CHECK((outcome='win')=(reason='correct'))
);
CREATE INDEX resolutions_run ON ruffled_private.resolutions(run_id,created_at);
CREATE TABLE ruffled_private.requests(
 user_id uuid NOT NULL,request_id uuid NOT NULL,operation text NOT NULL,
 room_id uuid NOT NULL REFERENCES ruffled_private.rooms(id),payload_hash bytea NOT NULL CHECK(pg_catalog.octet_length(payload_hash)=32),
 response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),PRIMARY KEY(user_id,request_id)
);
CREATE INDEX requests_budget ON ruffled_private.requests(room_id);
DO $private$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['rooms','members','runs','bouts','pecks','answers','resolutions','requests'] LOOP
  EXECUTE pg_catalog.format('ALTER TABLE ruffled_private.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $private$;
REVOKE ALL ON ALL TABLES IN SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ruffled_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ruffled_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------- helpers ----------
CREATE FUNCTION ruffled_private.uid() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN IF u IS NULL THEN RAISE EXCEPTION 'Verified guest session required' USING ERRCODE='42501'; END IF; RETURN u; END $$;
CREATE FUNCTION ruffled_private.ms(t timestamptz) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN t IS NULL THEN NULL ELSE pg_catalog.floor(pg_catalog.date_part('epoch',t)*1000)::bigint END $$;
CREATE FUNCTION ruffled_private.room_for(p_code text,p_host boolean,p_lock boolean DEFAULT false)
RETURNS ruffled_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r ruffled_private.rooms;u uuid:=ruffled_private.uid();
BEGIN
 IF p_lock THEN SELECT * INTO r FROM ruffled_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) FOR UPDATE;
 ELSE SELECT * INTO r FROM ruffled_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)); END IF;
 IF r.id IS NULL OR r.expires_at<=pg_catalog.clock_timestamp() OR (p_host AND r.host_user_id<>u) THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE='42501'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION ruffled_private.member_for(p_room_id uuid) RETURNS ruffled_private.members LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m ruffled_private.members;
BEGIN
 SELECT * INTO m FROM ruffled_private.members WHERE room_id=p_room_id AND user_id=ruffled_private.uid() AND left_at IS NULL;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Active room membership required' USING ERRCODE='42501'; END IF;RETURN m;
END $$;
CREATE FUNCTION ruffled_private.live(p_id uuid,p_room_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM ruffled_private.members WHERE id=p_id AND room_id=p_room_id AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '40 seconds') $$;
CREATE FUNCTION ruffled_private.member_json(m ruffled_private.members) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',m.id,'name',m.name,'active',m.left_at IS NULL,
  'seen',m.left_at IS NULL AND m.last_seen>pg_catalog.clock_timestamp()-interval '40 seconds') $$;
CREATE FUNCTION ruffled_private.resolve(b ruffled_private.bouts,p_winner uuid,p_reason text,p_ms integer) RETURNS ruffled_private.bouts LANGUAGE plpgsql SET search_path='' AS $$
DECLARE out ruffled_private.bouts;
BEGIN
 INSERT INTO ruffled_private.resolutions(bout_id,run_id,winner_id,outcome,reason,peck_ms)
 VALUES(b.id,b.run_id,p_winner,CASE WHEN p_winner IS NULL THEN 'nil' ELSE 'win' END,p_reason,p_ms);
 UPDATE ruffled_private.bouts SET closed_at=pg_catalog.clock_timestamp(),chooser_id=NULL,chosen_at=NULL,choose_deadline=NULL WHERE id=b.id RETURNING * INTO out;
 RETURN out;
END $$;
-- Apply any window that has expired since the last call. Deterministic from the
-- server clock, so any caller may trigger it without gaining an advantage.
CREATE FUNCTION ruffled_private.settle(p_bout_id uuid) RETURNS ruffled_private.bouts LANGUAGE plpgsql SET search_path='' AS $$
DECLARE b ruffled_private.bouts;stamp timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF p_bout_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO b FROM ruffled_private.bouts WHERE id=p_bout_id FOR UPDATE;
 IF b.id IS NULL OR b.closed_at IS NOT NULL THEN RETURN b;END IF;
 IF b.chooser_id IS NOT NULL AND stamp>=b.choose_deadline THEN
  UPDATE ruffled_private.bouts SET locked=pg_catalog.array_append(locked,chooser_id),
   peck_deadline=CASE WHEN peck_deadline IS NULL THEN NULL ELSE peck_deadline+(choose_deadline-chosen_at) END,
   chooser_id=NULL,chosen_at=NULL,choose_deadline=NULL WHERE id=b.id RETURNING * INTO b;
 END IF;
 IF pg_catalog.cardinality(b.locked)>=2 THEN RETURN ruffled_private.resolve(b,NULL,'both',NULL);END IF;
 IF b.chooser_id IS NULL AND b.peck_deadline IS NOT NULL AND stamp>=b.peck_deadline THEN RETURN ruffled_private.resolve(b,NULL,'time',NULL);END IF;
 RETURN b;
END $$;
CREATE FUNCTION ruffled_private.bout_json(b ruffled_private.bouts) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE x ruffled_private.resolutions;
BEGIN
 IF b.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO x FROM ruffled_private.resolutions WHERE bout_id=b.id;
 RETURN pg_catalog.jsonb_build_object('id',b.id,'ordinal',b.ordinal,'a',b.a_id,'b',b.b_id,'q',b.q_text,'opts',b.opts,
  'open_at',ruffled_private.ms(b.open_at),'peck_deadline',ruffled_private.ms(b.peck_deadline),
  'chooser',b.chooser_id,'choose_deadline',ruffled_private.ms(b.choose_deadline),'locked',pg_catalog.to_jsonb(b.locked),
  'wrong',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('member',a.member_id,'choice',a.choice) ORDER BY a.created_at),'[]')
           FROM ruffled_private.answers a WHERE a.bout_id=b.id AND a.choice<>b.correct_idx),
  'closed',b.closed_at IS NOT NULL,
  'outcome',x.outcome,'reason',x.reason,'winner',x.winner_id,'peck_ms',x.peck_ms,
  -- The correct option is disclosed only once the bout is over.
  'correct',CASE WHEN b.closed_at IS NOT NULL THEN b.correct_idx END);
END $$;
CREATE FUNCTION ruffled_private.run_json(p_run_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE n ruffled_private.runs;
BEGIN
 SELECT * INTO n FROM ruffled_private.runs WHERE id=p_run_id;IF n.id IS NULL THEN RETURN NULL;END IF;
 RETURN pg_catalog.jsonb_build_object('id',n.id,'topic',n.topic,'peck_ms',n.peck_ms,'finished',n.finished_at IS NOT NULL,
  'roster',(SELECT pg_catalog.jsonb_agg(ruffled_private.member_json(m) ORDER BY o.ord) FROM pg_catalog.unnest(n.roster) WITH ORDINALITY AS o(id,ord) JOIN ruffled_private.members m ON m.id=o.id),
  'results',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ordinal',b.ordinal,'a',b.a_id,'b',b.b_id,'winner',x.winner_id,'peck_ms',x.peck_ms) ORDER BY b.ordinal),'[]')
             FROM ruffled_private.bouts b JOIN ruffled_private.resolutions x ON x.bout_id=b.id WHERE b.run_id=n.id),
  'points',(SELECT COALESCE(pg_catalog.jsonb_object_agg(o.id,(SELECT 2*pg_catalog.count(*) FROM ruffled_private.resolutions x WHERE x.run_id=n.id AND x.winner_id=o.id)),'{}')
            FROM pg_catalog.unnest(n.roster) AS o(id)));
END $$;
CREATE FUNCTION ruffled_private.room_json(r ruffled_private.rooms) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE b ruffled_private.bouts;
BEGIN
 b:=ruffled_private.settle(r.current_bout_id);
 RETURN pg_catalog.jsonb_build_object('id',r.id,'code',r.code,'phase',r.phase,'run_id',r.run_id,'version',r.version,
  'server_now',ruffled_private.ms(pg_catalog.clock_timestamp()),'expires_at',r.expires_at,
  'run',ruffled_private.run_json(r.run_id),'bout',ruffled_private.bout_json(b));
END $$;
CREATE FUNCTION ruffled_private.replay(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v ruffled_private.requests;u uuid:=ruffled_private.uid();
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
 SELECT * INTO v FROM ruffled_private.requests WHERE user_id=u AND request_id=p_request_id;
 IF v.request_id IS NULL THEN RETURN NULL;END IF;
 IF v.operation<>p_operation OR v.payload_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')) THEN RAISE EXCEPTION 'Request UUID reused with different input' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM ruffled_private.rooms WHERE id=v.room_id AND host_user_id=u AND expires_at>pg_catalog.clock_timestamp()) THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE='42501';END IF;
 RETURN v.response;
END $$;
CREATE FUNCTION ruffled_private.remember(p_request_id uuid,p_operation text,p_room_id uuid,p_payload jsonb,p_response jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (SELECT pg_catalog.count(*) FROM ruffled_private.requests WHERE room_id=p_room_id)>=20000 THEN RAISE EXCEPTION 'Room operation budget reached' USING ERRCODE='54000';END IF;
 INSERT INTO ruffled_private.requests(user_id,request_id,operation,room_id,payload_hash,response) VALUES(ruffled_private.uid(),p_request_id,p_operation,p_room_id,pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),p_response);
END $$;
CREATE FUNCTION ruffled_private.version(r ruffled_private.rooms,p_version bigint) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF p_version IS NULL OR p_version<>r.version THEN RAISE EXCEPTION 'Stale host version' USING ERRCODE='PT409';END IF;END $$;
CREATE FUNCTION ruffled_private.bump(p_room_id uuid,p_phase text,p_bout_id uuid,p_run_id uuid) RETURNS ruffled_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r ruffled_private.rooms;
BEGIN UPDATE ruffled_private.rooms SET phase=p_phase,current_bout_id=p_bout_id,run_id=p_run_id,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=p_room_id RETURNING * INTO r;RETURN r;END $$;
CREATE FUNCTION ruffled_private.open_bout_check(r ruffled_private.rooms) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF r.current_bout_id IS NOT NULL AND (ruffled_private.settle(r.current_bout_id)).closed_at IS NULL THEN RAISE EXCEPTION 'Finish the current bout first' USING ERRCODE='42501';END IF;
END $$;

-- ---------- host API ----------
CREATE FUNCTION public.ruffled_create_room(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;u uuid:=ruffled_private.uid();old jsonb;payload jsonb:='{}'::jsonb;c text;i integer;attempt integer;alpha constant text:='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
 old:=ruffled_private.replay(p_request_id,'create',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ruffled-create:'||u::text,0));
 IF (SELECT pg_catalog.count(*) FROM ruffled_private.rooms WHERE host_user_id=u AND expires_at>pg_catalog.clock_timestamp())>=5 THEN RAISE EXCEPTION 'Active room limit reached' USING ERRCODE='54000';END IF;
 FOR attempt IN 1..20 LOOP
  c:='';FOR i IN 0..4 LOOP c:=c||pg_catalog.substr(alpha,1+(pg_catalog.get_byte(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()),i)%pg_catalog.char_length(alpha)),1);END LOOP;
  INSERT INTO ruffled_private.rooms(code,host_user_id) VALUES(c,u) ON CONFLICT(code) DO NOTHING RETURNING * INTO r;EXIT WHEN r.id IS NOT NULL;
 END LOOP;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Could not allocate room' USING ERRCODE='54000';END IF;
 old:=ruffled_private.room_json(r);PERFORM ruffled_private.remember(p_request_id,'create',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.ruffled_host_state(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;
BEGIN
 r:=ruffled_private.room_for(p_code,true);
 RETURN ruffled_private.room_json(r)||pg_catalog.jsonb_build_object('members',
  (SELECT COALESCE(pg_catalog.jsonb_agg(ruffled_private.member_json(m) ORDER BY m.joined_at,m.id),'[]') FROM ruffled_private.members m WHERE m.room_id=r.id AND m.left_at IS NULL));
END $$;
CREATE FUNCTION public.ruffled_begin_run(p_code text,p_config jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;n ruffled_private.runs;old jsonb;ids uuid[]:='{}';v jsonb;mid uuid;pm integer;tp text;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'config',p_config,'version',p_expected_version);
BEGIN
 old:=ruffled_private.replay(p_request_id,'begin',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=ruffled_private.room_for(p_code,true,true);PERFORM ruffled_private.version(r,p_expected_version);PERFORM ruffled_private.open_bout_check(r);
 IF pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_config->'roster') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_config->'roster') NOT BETWEEN 3 AND 10 THEN RAISE EXCEPTION 'Choose 3 to 10 players' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(p_config->'roster') LOOP
  IF pg_catalog.jsonb_typeof(v)<>'string' OR (v#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid player' USING ERRCODE='22023';END IF;
  mid:=(v#>>'{}')::uuid;
  IF mid=ANY(ids) THEN RAISE EXCEPTION 'Duplicate player' USING ERRCODE='22023';END IF;
  IF NOT ruffled_private.live(mid,r.id) THEN RAISE EXCEPTION 'Players changed; refresh the list' USING ERRCODE='PT412';END IF;
  ids:=pg_catalog.array_append(ids,mid);
 END LOOP;
 IF pg_catalog.jsonb_typeof(p_config->'timed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid clock' USING ERRCODE='22023';END IF;
 pm:=CASE WHEN (p_config->>'timed')::boolean THEN 15000 ELSE NULL END;
 IF pg_catalog.jsonb_typeof(p_config->'topic') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid topic' USING ERRCODE='22023';END IF;
 tp:=pg_catalog.btrim(p_config->>'topic');IF pg_catalog.char_length(tp) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Invalid topic' USING ERRCODE='22023';END IF;
 IF (SELECT pg_catalog.count(*) FROM ruffled_private.runs WHERE room_id=r.id)>=50 THEN RAISE EXCEPTION 'Room game limit reached' USING ERRCODE='54000';END IF;
 UPDATE ruffled_private.runs SET finished_at=COALESCE(finished_at,pg_catalog.clock_timestamp()) WHERE id=r.run_id;
 INSERT INTO ruffled_private.runs(room_id,roster,peck_ms,topic) VALUES(r.id,ids,pm,tp) RETURNING * INTO n;
 r:=ruffled_private.bump(r.id,'table',NULL,n.id);
 old:=ruffled_private.room_json(r);PERFORM ruffled_private.remember(p_request_id,'begin',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.ruffled_open_bout(p_code text,p_run_id uuid,p_bout jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;n ruffled_private.runs;b ruffled_private.bouts;old jsonb;a uuid;z uuid;op jsonb;v jsonb;ci integer;ord integer;stamp timestamptz;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'run',p_run_id,'bout',p_bout,'version',p_expected_version);
BEGIN
 old:=ruffled_private.replay(p_request_id,'open',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=ruffled_private.room_for(p_code,true,true);PERFORM ruffled_private.version(r,p_expected_version);
 IF p_run_id IS NULL OR p_run_id IS DISTINCT FROM r.run_id THEN RAISE EXCEPTION 'Current game required' USING ERRCODE='42501';END IF;
 SELECT * INTO n FROM ruffled_private.runs WHERE id=r.run_id;
 IF n.finished_at IS NOT NULL OR r.phase NOT IN ('table','live') THEN RAISE EXCEPTION 'Game not ready for a bout' USING ERRCODE='42501';END IF;
 PERFORM ruffled_private.open_bout_check(r);
 IF pg_catalog.jsonb_typeof(p_bout) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_bout->'a') IS DISTINCT FROM 'string' OR pg_catalog.jsonb_typeof(p_bout->'b') IS DISTINCT FROM 'string'
  OR (p_bout->>'a')!~'^[0-9a-f-]{36}$' OR (p_bout->>'b')!~'^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Invalid pairing' USING ERRCODE='22023';END IF;
 a:=(p_bout->>'a')::uuid;z:=(p_bout->>'b')::uuid;
 IF a=z OR NOT(a=ANY(n.roster)) OR NOT(z=ANY(n.roster)) THEN RAISE EXCEPTION 'Invalid pairing' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM ruffled_private.bouts WHERE run_id=n.id AND LEAST(a_id,b_id)=LEAST(a,z) AND GREATEST(a_id,b_id)=GREATEST(a,z)) THEN RAISE EXCEPTION 'These two have already met' USING ERRCODE='22023';END IF;
 IF NOT ruffled_private.live(a,r.id) OR NOT ruffled_private.live(z,r.id) THEN RAISE EXCEPTION 'Players changed; refresh the list' USING ERRCODE='PT412';END IF;
 IF pg_catalog.jsonb_typeof(p_bout->'q') IS DISTINCT FROM 'string' OR pg_catalog.char_length(p_bout->>'q') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid question' USING ERRCODE='22023';END IF;
 op:=p_bout->'opts';IF pg_catalog.jsonb_typeof(op) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(op)<>4 THEN RAISE EXCEPTION 'Four options required' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(op) LOOP IF pg_catalog.jsonb_typeof(v)<>'string' OR pg_catalog.char_length(v#>>'{}') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid option' USING ERRCODE='22023';END IF;END LOOP;
 IF pg_catalog.jsonb_typeof(p_bout->'correct') IS DISTINCT FROM 'number' OR (p_bout->>'correct')!~'^[0-3]$' THEN RAISE EXCEPTION 'Invalid correct option' USING ERRCODE='22023';END IF;
 ci:=(p_bout->>'correct')::integer;
 SELECT COALESCE(pg_catalog.max(ordinal),0)+1 INTO ord FROM ruffled_private.bouts WHERE run_id=n.id;
 IF ord>45 THEN RAISE EXCEPTION 'Every pair has met' USING ERRCODE='54000';END IF;
 stamp:=pg_catalog.clock_timestamp();
 INSERT INTO ruffled_private.bouts(room_id,run_id,ordinal,a_id,b_id,q_text,opts,correct_idx,open_at,peck_deadline)
 VALUES(r.id,n.id,ord,a,z,p_bout->>'q',op,ci,stamp+interval '2400 milliseconds',
  CASE WHEN n.peck_ms IS NULL THEN NULL ELSE stamp+interval '2400 milliseconds'+pg_catalog.make_interval(secs=>n.peck_ms/1000.0) END) RETURNING * INTO b;
 r:=ruffled_private.bump(r.id,'live',b.id,n.id);
 old:=ruffled_private.room_json(r);PERFORM ruffled_private.remember(p_request_id,'open',r.id,payload,old);RETURN old;
END $$;
-- The host may end an unfinished bout with no points: "Nobody knows" in a
-- relaxed game, or a player has gone. It cannot award points.
CREATE FUNCTION public.ruffled_end_bout(p_code text,p_bout_id uuid,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;b ruffled_private.bouts;old jsonb;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'bout',p_bout_id,'version',p_expected_version);
BEGIN
 old:=ruffled_private.replay(p_request_id,'end',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=ruffled_private.room_for(p_code,true,true);PERFORM ruffled_private.version(r,p_expected_version);
 IF p_bout_id IS NULL OR p_bout_id IS DISTINCT FROM r.current_bout_id THEN RAISE EXCEPTION 'Current bout required' USING ERRCODE='42501';END IF;
 b:=ruffled_private.settle(p_bout_id);
 IF b.closed_at IS NULL THEN b:=ruffled_private.resolve(b,NULL,'host',NULL);END IF;
 r:=ruffled_private.bump(r.id,r.phase,r.current_bout_id,r.run_id);
 old:=ruffled_private.room_json(r);PERFORM ruffled_private.remember(p_request_id,'end',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.ruffled_set_phase(p_code text,p_phase text,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;n ruffled_private.runs;old jsonb;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'phase',p_phase,'version',p_expected_version);
BEGIN
 old:=ruffled_private.replay(p_request_id,'phase',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=ruffled_private.room_for(p_code,true,true);PERFORM ruffled_private.version(r,p_expected_version);PERFORM ruffled_private.open_bout_check(r);
 SELECT * INTO n FROM ruffled_private.runs WHERE id=r.run_id;
 IF p_phase='lobby' THEN
  UPDATE ruffled_private.runs SET finished_at=COALESCE(finished_at,pg_catalog.clock_timestamp()) WHERE id=n.id;
 ELSIF p_phase='table' THEN
  IF n.id IS NULL OR n.finished_at IS NOT NULL THEN RAISE EXCEPTION 'No game in progress' USING ERRCODE='42501';END IF;
 ELSIF p_phase='final' THEN
  IF n.id IS NULL THEN RAISE EXCEPTION 'No game in progress' USING ERRCODE='42501';END IF;
  -- Every pair has met, or one of them has left the room.
  IF EXISTS(SELECT 1 FROM pg_catalog.unnest(n.roster) WITH ORDINALITY AS x(id,i) JOIN pg_catalog.unnest(n.roster) WITH ORDINALITY AS y(id,j) ON x.i<y.j
   WHERE NOT EXISTS(SELECT 1 FROM ruffled_private.bouts b JOIN ruffled_private.resolutions z ON z.bout_id=b.id WHERE b.run_id=n.id AND LEAST(b.a_id,b.b_id)=LEAST(x.id,y.id) AND GREATEST(b.a_id,b.b_id)=GREATEST(x.id,y.id))
   AND ruffled_private.live(x.id,r.id) AND ruffled_private.live(y.id,r.id)) THEN RAISE EXCEPTION 'Some pairs have not met yet' USING ERRCODE='42501';END IF;
  UPDATE ruffled_private.runs SET finished_at=COALESCE(finished_at,pg_catalog.clock_timestamp()) WHERE id=n.id;
 ELSE RAISE EXCEPTION 'Invalid phase' USING ERRCODE='22023';END IF;
 r:=ruffled_private.bump(r.id,p_phase,r.current_bout_id,r.run_id);
 old:=ruffled_private.room_json(r);PERFORM ruffled_private.remember(p_request_id,'phase',r.id,payload,old);RETURN old;
END $$;

-- ---------- player API ----------
CREATE FUNCTION public.ruffled_preview(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;u uuid:=ruffled_private.uid();
BEGIN
 SELECT * INTO r FROM ruffled_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) AND expires_at>pg_catalog.clock_timestamp();
 IF r.id IS NULL THEN RETURN NULL;END IF;RETURN pg_catalog.jsonb_build_object('code',r.code,'phase',r.phase);
END $$;
CREATE FUNCTION public.ruffled_join(p_code text,p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;m ruffled_private.members;u uuid:=ruffled_private.uid();nm text:=pg_catalog.regexp_replace(pg_catalog.btrim(p_name),'\s+',' ','g');
BEGIN
 r:=ruffled_private.room_for(p_code,false,true);
 IF nm IS NULL OR pg_catalog.char_length(nm) NOT BETWEEN 1 AND 14 OR nm ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Name must have 1 to 14 characters' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM ruffled_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;
 IF m.id IS NOT NULL THEN RETURN ruffled_private.member_json(m);END IF;
 IF EXISTS(SELECT 1 FROM ruffled_private.members WHERE room_id=r.id AND left_at IS NULL AND pg_catalog.lower(name)=pg_catalog.lower(nm)) THEN RAISE EXCEPTION 'That name is taken in this room' USING ERRCODE='23505';END IF;
 IF (SELECT pg_catalog.count(*) FROM ruffled_private.members WHERE room_id=r.id AND left_at IS NULL)>=30 OR (SELECT pg_catalog.count(*) FROM ruffled_private.members WHERE room_id=r.id)>=300 THEN RAISE EXCEPTION 'Room player limit reached' USING ERRCODE='54000';END IF;
 INSERT INTO ruffled_private.members(room_id,user_id,name) VALUES(r.id,u,nm) RETURNING * INTO m;RETURN ruffled_private.member_json(m);
END $$;
CREATE FUNCTION public.ruffled_my_membership(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;m ruffled_private.members;
BEGIN r:=ruffled_private.room_for(p_code,false);SELECT * INTO m FROM ruffled_private.members WHERE room_id=r.id AND user_id=ruffled_private.uid() AND left_at IS NULL;IF m.id IS NULL THEN RETURN NULL;END IF;RETURN ruffled_private.member_json(m);END $$;
CREATE FUNCTION public.ruffled_leave(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;
BEGIN r:=ruffled_private.room_for(p_code,false,true);UPDATE ruffled_private.members SET left_at=pg_catalog.clock_timestamp() WHERE room_id=r.id AND user_id=ruffled_private.uid() AND left_at IS NULL;RETURN pg_catalog.jsonb_build_object('left',true);END $$;
-- A player's poll also records that they are still here.
CREATE FUNCTION public.ruffled_player_state(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;m ruffled_private.members;
BEGIN
 r:=ruffled_private.room_for(p_code,false);m:=ruffled_private.member_for(r.id);
 UPDATE ruffled_private.members SET last_seen=pg_catalog.clock_timestamp() WHERE id=m.id RETURNING * INTO m;
 RETURN ruffled_private.room_json(r)||pg_catalog.jsonb_build_object('me',ruffled_private.member_json(m));
END $$;
CREATE FUNCTION public.ruffled_peck(p_code text,p_bout_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;m ruffled_private.members;b ruffled_private.bouts;stamp timestamptz;
BEGIN
 r:=ruffled_private.room_for(p_code,false);m:=ruffled_private.member_for(r.id);
 IF p_bout_id IS NULL OR p_bout_id IS DISTINCT FROM r.current_bout_id THEN RAISE EXCEPTION 'This bout has closed' USING ERRCODE='42501';END IF;
 b:=ruffled_private.settle(p_bout_id);stamp:=pg_catalog.clock_timestamp();
 IF b.chooser_id=m.id THEN RETURN ruffled_private.room_json(r)||pg_catalog.jsonb_build_object('me',ruffled_private.member_json(m));END IF;
 IF m.id NOT IN (b.a_id,b.b_id) THEN RAISE EXCEPTION 'You are not in this bout' USING ERRCODE='42501';END IF;
 IF b.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This bout has closed' USING ERRCODE='42501';END IF;
 IF stamp<b.open_at THEN RAISE EXCEPTION 'Not yet: the peck opens in a moment' USING ERRCODE='42501';END IF;
 IF m.id=ANY(b.locked) THEN RAISE EXCEPTION 'You are locked out of this bout' USING ERRCODE='42501';END IF;
 IF b.chooser_id IS NOT NULL THEN RAISE EXCEPTION 'Beaten to it' USING ERRCODE='42501';END IF;
 INSERT INTO ruffled_private.pecks(bout_id,member_id,created_at) VALUES(b.id,m.id,stamp);
 UPDATE ruffled_private.bouts SET chooser_id=m.id,chosen_at=stamp,choose_deadline=stamp+interval '6 seconds' WHERE id=b.id;
 RETURN ruffled_private.room_json(r)||pg_catalog.jsonb_build_object('me',ruffled_private.member_json(m));
END $$;
CREATE FUNCTION public.ruffled_answer(p_code text,p_bout_id uuid,p_choice integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r ruffled_private.rooms;m ruffled_private.members;b ruffled_private.bouts;a ruffled_private.answers;stamp timestamptz;pk ruffled_private.pecks;
BEGIN
 r:=ruffled_private.room_for(p_code,false);m:=ruffled_private.member_for(r.id);
 IF p_choice IS NULL OR p_choice NOT BETWEEN 0 AND 3 THEN RAISE EXCEPTION 'Invalid choice' USING ERRCODE='22023';END IF;
 IF p_bout_id IS NULL OR p_bout_id IS DISTINCT FROM r.current_bout_id THEN RAISE EXCEPTION 'This bout has closed' USING ERRCODE='42501';END IF;
 b:=ruffled_private.settle(p_bout_id);
 SELECT * INTO a FROM ruffled_private.answers WHERE bout_id=b.id AND member_id=m.id;
 IF a.id IS NOT NULL THEN
  IF a.choice<>p_choice THEN RAISE EXCEPTION 'Answer already recorded with another choice' USING ERRCODE='22023';END IF;
  RETURN ruffled_private.room_json(r)||pg_catalog.jsonb_build_object('me',ruffled_private.member_json(m));
 END IF;
 stamp:=pg_catalog.clock_timestamp();
 IF b.closed_at IS NOT NULL OR b.chooser_id IS DISTINCT FROM m.id OR stamp>=b.choose_deadline THEN RAISE EXCEPTION 'It is not your turn to answer' USING ERRCODE='42501';END IF;
 INSERT INTO ruffled_private.answers(bout_id,member_id,choice,created_at) VALUES(b.id,m.id,p_choice,stamp);
 IF p_choice=b.correct_idx THEN
  SELECT * INTO pk FROM ruffled_private.pecks WHERE bout_id=b.id AND member_id=m.id;
  -- Reaction time runs from the moment pecking opened, less any time the opponent spent choosing.
  PERFORM ruffled_private.resolve(b,m.id,'correct',GREATEST(0,LEAST(3600000,(pg_catalog.date_part('epoch',pk.created_at-b.open_at)*1000)::integer
   -COALESCE((SELECT (pg_catalog.date_part('epoch',COALESCE(a2.created_at,p2.created_at+interval '6 seconds')-p2.created_at)*1000)::integer
              FROM ruffled_private.pecks p2 LEFT JOIN ruffled_private.answers a2 ON a2.bout_id=p2.bout_id AND a2.member_id=p2.member_id
              WHERE p2.bout_id=b.id AND p2.member_id<>m.id),0))));
 ELSE
  UPDATE ruffled_private.bouts SET locked=pg_catalog.array_append(locked,m.id),
   peck_deadline=CASE WHEN peck_deadline IS NULL THEN NULL ELSE peck_deadline+(stamp-chosen_at) END,
   chooser_id=NULL,chosen_at=NULL,choose_deadline=NULL WHERE id=b.id RETURNING * INTO b;
  IF pg_catalog.cardinality(b.locked)>=2 THEN PERFORM ruffled_private.resolve(b,NULL,'both',NULL);END IF;
 END IF;
 RETURN ruffled_private.room_json(r)||pg_catalog.jsonb_build_object('me',ruffled_private.member_json(m));
END $$;

-- Explicit object revocations defeat global default grants as well as PUBLIC's
-- default function EXECUTE. Future private objects must repeat these revocations.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ruffled_private FROM PUBLIC,anon,authenticated;
DO $api_grants$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ruffled\_%' ESCAPE '\' LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $api_grants$;
