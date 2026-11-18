-- Ten Lanterns phone rooms: phones answer, buzz, choose and claim on their own screens.
-- The TV host remains the trusted question author and scorekeeper; the server holds each
-- question's correct option privately until it closes, orders presses by receipt, lets
-- only the named players act, enforces windows, and records every act exactly once.
-- Apply atomically. Rollback: supabase/rollback/secure_lantern_rooms.sql
SET LOCAL lock_timeout='3s';
DO $preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='lantern_private') OR
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'lantern\_%' ESCAPE '\') THEN
  RAISE EXCEPTION 'Lantern objects already exist; review migration history';
 END IF;
END $preflight$;
CREATE SCHEMA lantern_private;
REVOKE ALL ON SCHEMA lantern_private FROM PUBLIC,anon,authenticated;

CREATE TABLE lantern_private.rooms(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 code text UNIQUE NOT NULL CHECK(code ~ '^[A-Z2-9]{5}$'),
 host_user_id uuid NOT NULL,
 phase text NOT NULL DEFAULT 'lobby' CHECK(phase IN ('lobby','play','final')),
 game_id uuid,current_prompt_id uuid,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT(pg_catalog.clock_timestamp()+interval '12 hours')
);
CREATE INDEX rooms_owner_expiry ON lantern_private.rooms(host_user_id,expires_at);
CREATE TABLE lantern_private.members(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES lantern_private.rooms(id),user_id uuid NOT NULL,
 name text NOT NULL CHECK(pg_catalog.char_length(name) BETWEEN 1 AND 14),
 joined_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 last_seen timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),left_at timestamptz
);
CREATE UNIQUE INDEX members_one_identity ON lantern_private.members(room_id,user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX members_one_name ON lantern_private.members(room_id,pg_catalog.lower(name)) WHERE left_at IS NULL;
CREATE INDEX members_roster ON lantern_private.members(room_id,joined_at,id);
CREATE TABLE lantern_private.games(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES lantern_private.rooms(id),
 roster uuid[] NOT NULL CHECK(pg_catalog.cardinality(roster) BETWEEN 2 AND 10),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),finished_at timestamptz
);
CREATE INDEX games_room ON lantern_private.games(room_id,created_at,id);
ALTER TABLE lantern_private.rooms ADD CONSTRAINT rooms_game_fk FOREIGN KEY(game_id) REFERENCES lantern_private.games(id);
-- kind: answer (the named players may answer once; the first answer closes it),
--       buzz (the first press wins the turn; a wrong answer locks that player out),
--       choose (a decision among options; no right answer), claim (the first press closes it).
CREATE TABLE lantern_private.prompts(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES lantern_private.rooms(id),game_id uuid NOT NULL REFERENCES lantern_private.games(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 2000),
 kind text NOT NULL CHECK(kind IN ('answer','buzz','choose','claim')),
 eligible uuid[] NOT NULL CHECK(pg_catalog.cardinality(eligible) BETWEEN 1 AND 10),
 q_text text NOT NULL CHECK(pg_catalog.char_length(q_text) BETWEEN 1 AND 1000),opts jsonb NOT NULL,
 disabled integer[] NOT NULL DEFAULT '{}',correct_idx integer CHECK(correct_idx BETWEEN 0 AND 5),
 open_at timestamptz NOT NULL,deadline timestamptz,
 chooser_id uuid REFERENCES lantern_private.members(id),chosen_at timestamptz,choose_deadline timestamptz,
 locked uuid[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),closed_at timestamptz,
 winner_id uuid REFERENCES lantern_private.members(id),choice integer CHECK(choice BETWEEN 0 AND 5),
 reason text CHECK(reason IN ('correct','wrong','all','time','host','chosen','claimed')),
 CHECK((kind IN ('answer','buzz'))=(correct_idx IS NOT NULL)),
 CHECK((closed_at IS NULL)=(reason IS NULL)),
 UNIQUE(game_id,ordinal)
);
CREATE INDEX prompts_room ON lantern_private.prompts(room_id,game_id,ordinal);
ALTER TABLE lantern_private.rooms ADD CONSTRAINT rooms_prompt_fk FOREIGN KEY(current_prompt_id) REFERENCES lantern_private.prompts(id);
CREATE TABLE lantern_private.presses(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),prompt_id uuid NOT NULL REFERENCES lantern_private.prompts(id),
 member_id uuid NOT NULL REFERENCES lantern_private.members(id),created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(prompt_id,member_id)
);
CREATE TABLE lantern_private.answers(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),prompt_id uuid NOT NULL REFERENCES lantern_private.prompts(id),
 member_id uuid NOT NULL REFERENCES lantern_private.members(id),choice integer NOT NULL CHECK(choice BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),UNIQUE(prompt_id,member_id)
);
CREATE TABLE lantern_private.requests(
 user_id uuid NOT NULL,request_id uuid NOT NULL,operation text NOT NULL,
 room_id uuid NOT NULL REFERENCES lantern_private.rooms(id),payload_hash bytea NOT NULL CHECK(pg_catalog.octet_length(payload_hash)=32),
 response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),PRIMARY KEY(user_id,request_id)
);
CREATE INDEX requests_budget ON lantern_private.requests(room_id);
DO $private$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['rooms','members','games','prompts','presses','answers','requests'] LOOP
  EXECUTE pg_catalog.format('ALTER TABLE lantern_private.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $private$;
REVOKE ALL ON ALL TABLES IN SCHEMA lantern_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA lantern_private FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA lantern_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA lantern_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------- helpers ----------
CREATE FUNCTION lantern_private.uid() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN IF u IS NULL THEN RAISE EXCEPTION 'Verified guest session required' USING ERRCODE='42501'; END IF; RETURN u; END $$;
CREATE FUNCTION lantern_private.ms(t timestamptz) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN t IS NULL THEN NULL ELSE pg_catalog.floor(pg_catalog.date_part('epoch',t)*1000)::bigint END $$;
CREATE FUNCTION lantern_private.room_for(p_code text,p_host boolean,p_lock boolean DEFAULT false)
RETURNS lantern_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r lantern_private.rooms;u uuid:=lantern_private.uid();
BEGIN
 IF p_lock THEN SELECT * INTO r FROM lantern_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) FOR UPDATE;
 ELSE SELECT * INTO r FROM lantern_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)); END IF;
 IF r.id IS NULL OR r.expires_at<=pg_catalog.clock_timestamp() OR (p_host AND r.host_user_id<>u) THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE='42501'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION lantern_private.member_for(p_room_id uuid) RETURNS lantern_private.members LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m lantern_private.members;
BEGIN
 SELECT * INTO m FROM lantern_private.members WHERE room_id=p_room_id AND user_id=lantern_private.uid() AND left_at IS NULL;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Active room membership required' USING ERRCODE='42501'; END IF;RETURN m;
END $$;
CREATE FUNCTION lantern_private.live(p_id uuid,p_room_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM lantern_private.members WHERE id=p_id AND room_id=p_room_id AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '40 seconds') $$;
CREATE FUNCTION lantern_private.member_json(m lantern_private.members) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',m.id,'name',m.name,'active',m.left_at IS NULL,
  'seen',m.left_at IS NULL AND m.last_seen>pg_catalog.clock_timestamp()-interval '40 seconds') $$;
CREATE FUNCTION lantern_private.close(p lantern_private.prompts,p_winner uuid,p_choice integer,p_reason text) RETURNS lantern_private.prompts LANGUAGE plpgsql SET search_path='' AS $$
DECLARE out lantern_private.prompts;
BEGIN
 UPDATE lantern_private.prompts SET closed_at=pg_catalog.clock_timestamp(),winner_id=p_winner,choice=p_choice,reason=p_reason,
  chooser_id=NULL,chosen_at=NULL,choose_deadline=NULL WHERE id=p.id RETURNING * INTO out;
 RETURN out;
END $$;
-- Apply any window that has expired since the last call. Deterministic from the
-- server clock, so any caller may trigger it without gaining an advantage.
CREATE FUNCTION lantern_private.settle(p_prompt_id uuid) RETURNS lantern_private.prompts LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p lantern_private.prompts;stamp timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF p_prompt_id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO p FROM lantern_private.prompts WHERE id=p_prompt_id FOR UPDATE;
 IF p.id IS NULL OR p.closed_at IS NOT NULL THEN RETURN p;END IF;
 IF p.chooser_id IS NOT NULL AND stamp>=p.choose_deadline THEN
  UPDATE lantern_private.prompts SET locked=pg_catalog.array_append(locked,chooser_id),
   deadline=CASE WHEN deadline IS NULL THEN NULL ELSE deadline+(choose_deadline-chosen_at) END,
   chooser_id=NULL,chosen_at=NULL,choose_deadline=NULL WHERE id=p.id RETURNING * INTO p;
 END IF;
 IF p.kind='buzz' AND pg_catalog.cardinality(p.locked)>=pg_catalog.cardinality(p.eligible) THEN RETURN lantern_private.close(p,NULL,NULL,'all');END IF;
 IF p.chooser_id IS NULL AND p.deadline IS NOT NULL AND stamp>=p.deadline THEN RETURN lantern_private.close(p,NULL,NULL,'time');END IF;
 RETURN p;
END $$;
CREATE FUNCTION lantern_private.prompt_json(p lantern_private.prompts) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF p.id IS NULL THEN RETURN NULL;END IF;
 RETURN pg_catalog.jsonb_build_object('id',p.id,'ordinal',p.ordinal,'kind',p.kind,'eligible',pg_catalog.to_jsonb(p.eligible),'q',p.q_text,'opts',p.opts,
  'disabled',pg_catalog.to_jsonb(p.disabled),'open_at',lantern_private.ms(p.open_at),'deadline',lantern_private.ms(p.deadline),
  'chooser',p.chooser_id,'choose_deadline',lantern_private.ms(p.choose_deadline),'locked',pg_catalog.to_jsonb(p.locked),
  'wrong',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('member',a.member_id,'choice',a.choice) ORDER BY a.created_at),'[]')
           FROM lantern_private.answers a WHERE a.prompt_id=p.id AND p.kind='buzz' AND a.choice<>p.correct_idx),
  'closed',p.closed_at IS NOT NULL,'reason',p.reason,'winner',p.winner_id,'choice',p.choice,
  -- The correct option is disclosed only once the prompt has closed.
  'correct',CASE WHEN p.closed_at IS NOT NULL THEN p.correct_idx END);
END $$;
CREATE FUNCTION lantern_private.game_json(p_game_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE g lantern_private.games;
BEGIN
 SELECT * INTO g FROM lantern_private.games WHERE id=p_game_id;IF g.id IS NULL THEN RETURN NULL;END IF;
 RETURN pg_catalog.jsonb_build_object('id',g.id,'finished',g.finished_at IS NOT NULL,
  'roster',(SELECT pg_catalog.jsonb_agg(lantern_private.member_json(m) ORDER BY o.ord) FROM pg_catalog.unnest(g.roster) WITH ORDINALITY AS o(id,ord) JOIN lantern_private.members m ON m.id=o.id));
END $$;
CREATE FUNCTION lantern_private.room_json(r lantern_private.rooms) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p lantern_private.prompts;
BEGIN
 p:=lantern_private.settle(r.current_prompt_id);
 RETURN pg_catalog.jsonb_build_object('id',r.id,'code',r.code,'phase',r.phase,'game_id',r.game_id,'version',r.version,
  'server_now',lantern_private.ms(pg_catalog.clock_timestamp()),'expires_at',r.expires_at,
  'game',lantern_private.game_json(r.game_id),'prompt',lantern_private.prompt_json(p));
END $$;
CREATE FUNCTION lantern_private.replay(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v lantern_private.requests;u uuid:=lantern_private.uid();
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
 SELECT * INTO v FROM lantern_private.requests WHERE user_id=u AND request_id=p_request_id;
 IF v.request_id IS NULL THEN RETURN NULL;END IF;
 IF v.operation<>p_operation OR v.payload_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')) THEN RAISE EXCEPTION 'Request UUID reused with different input' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM lantern_private.rooms WHERE id=v.room_id AND host_user_id=u AND expires_at>pg_catalog.clock_timestamp()) THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE='42501';END IF;
 RETURN v.response;
END $$;
CREATE FUNCTION lantern_private.remember(p_request_id uuid,p_operation text,p_room_id uuid,p_payload jsonb,p_response jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (SELECT pg_catalog.count(*) FROM lantern_private.requests WHERE room_id=p_room_id)>=20000 THEN RAISE EXCEPTION 'Room operation budget reached' USING ERRCODE='54000';END IF;
 INSERT INTO lantern_private.requests(user_id,request_id,operation,room_id,payload_hash,response) VALUES(lantern_private.uid(),p_request_id,p_operation,p_room_id,pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),p_response);
END $$;
CREATE FUNCTION lantern_private.version(r lantern_private.rooms,p_version bigint) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF p_version IS NULL OR p_version<>r.version THEN RAISE EXCEPTION 'Stale host version' USING ERRCODE='PT409';END IF;END $$;
CREATE FUNCTION lantern_private.bump(p_room_id uuid,p_phase text,p_prompt_id uuid,p_game_id uuid) RETURNS lantern_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r lantern_private.rooms;
BEGIN UPDATE lantern_private.rooms SET phase=p_phase,current_prompt_id=p_prompt_id,game_id=p_game_id,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=p_room_id RETURNING * INTO r;RETURN r;END $$;
CREATE FUNCTION lantern_private.open_prompt_check(r lantern_private.rooms) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF r.current_prompt_id IS NOT NULL AND (lantern_private.settle(r.current_prompt_id)).closed_at IS NULL THEN RAISE EXCEPTION 'Finish the current prompt first' USING ERRCODE='42501';END IF;
END $$;

-- ---------- host API ----------
CREATE FUNCTION public.lantern_create_room(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;u uuid:=lantern_private.uid();old jsonb;payload jsonb:='{}'::jsonb;c text;i integer;attempt integer;alpha constant text:='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
 old:=lantern_private.replay(p_request_id,'create',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lantern-create:'||u::text,0));
 IF (SELECT pg_catalog.count(*) FROM lantern_private.rooms WHERE host_user_id=u AND expires_at>pg_catalog.clock_timestamp())>=5 THEN RAISE EXCEPTION 'Active room limit reached' USING ERRCODE='54000';END IF;
 FOR attempt IN 1..20 LOOP
  c:='';FOR i IN 0..4 LOOP c:=c||pg_catalog.substr(alpha,1+(pg_catalog.get_byte(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()),i)%pg_catalog.char_length(alpha)),1);END LOOP;
  INSERT INTO lantern_private.rooms(code,host_user_id) VALUES(c,u) ON CONFLICT(code) DO NOTHING RETURNING * INTO r;EXIT WHEN r.id IS NOT NULL;
 END LOOP;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Could not allocate room' USING ERRCODE='54000';END IF;
 old:=lantern_private.room_json(r);PERFORM lantern_private.remember(p_request_id,'create',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.lantern_host_state(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;
BEGIN
 r:=lantern_private.room_for(p_code,true);
 RETURN lantern_private.room_json(r)||pg_catalog.jsonb_build_object('members',
  (SELECT COALESCE(pg_catalog.jsonb_agg(lantern_private.member_json(m) ORDER BY m.joined_at,m.id),'[]') FROM lantern_private.members m WHERE m.room_id=r.id AND m.left_at IS NULL));
END $$;
CREATE FUNCTION public.lantern_begin_game(p_code text,p_config jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;g lantern_private.games;old jsonb;ids uuid[]:='{}';v jsonb;mid uuid;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'config',p_config,'version',p_expected_version);
BEGIN
 old:=lantern_private.replay(p_request_id,'begin',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=lantern_private.room_for(p_code,true,true);PERFORM lantern_private.version(r,p_expected_version);PERFORM lantern_private.open_prompt_check(r);
 IF pg_catalog.jsonb_typeof(p_config) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_config->'roster') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_config->'roster') NOT BETWEEN 2 AND 10 THEN RAISE EXCEPTION 'Choose 2 to 10 players' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(p_config->'roster') LOOP
  IF pg_catalog.jsonb_typeof(v)<>'string' OR (v#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid player' USING ERRCODE='22023';END IF;
  mid:=(v#>>'{}')::uuid;
  IF mid=ANY(ids) THEN RAISE EXCEPTION 'Duplicate player' USING ERRCODE='22023';END IF;
  IF NOT lantern_private.live(mid,r.id) THEN RAISE EXCEPTION 'Players changed; refresh the list' USING ERRCODE='PT412';END IF;
  ids:=pg_catalog.array_append(ids,mid);
 END LOOP;
 IF (SELECT pg_catalog.count(*) FROM lantern_private.games WHERE room_id=r.id)>=50 THEN RAISE EXCEPTION 'Room game limit reached' USING ERRCODE='54000';END IF;
 UPDATE lantern_private.games SET finished_at=COALESCE(finished_at,pg_catalog.clock_timestamp()) WHERE id=r.game_id;
 INSERT INTO lantern_private.games(room_id,roster) VALUES(r.id,ids) RETURNING * INTO g;
 r:=lantern_private.bump(r.id,'play',NULL,g.id);
 old:=lantern_private.room_json(r);PERFORM lantern_private.remember(p_request_id,'begin',r.id,payload,old);RETURN old;
END $$;
-- p_prompt: {kind, eligible:[member ids], q, opts:[strings], correct?, disabled?:[indexes], window_ms?}
CREATE FUNCTION public.lantern_open_prompt(p_code text,p_game_id uuid,p_prompt jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;g lantern_private.games;p lantern_private.prompts;old jsonb;k text;el uuid[]:='{}';v jsonb;mid uuid;op jsonb;n integer;ci integer;dis integer[]:='{}';ord integer;stamp timestamptz;win integer;delay interval;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'game',p_game_id,'prompt',p_prompt,'version',p_expected_version);
BEGIN
 old:=lantern_private.replay(p_request_id,'open',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=lantern_private.room_for(p_code,true,true);PERFORM lantern_private.version(r,p_expected_version);
 IF p_game_id IS NULL OR p_game_id IS DISTINCT FROM r.game_id THEN RAISE EXCEPTION 'Current game required' USING ERRCODE='42501';END IF;
 SELECT * INTO g FROM lantern_private.games WHERE id=r.game_id;
 IF g.finished_at IS NOT NULL OR r.phase<>'play' THEN RAISE EXCEPTION 'Game not in play' USING ERRCODE='42501';END IF;
 PERFORM lantern_private.open_prompt_check(r);
 IF pg_catalog.jsonb_typeof(p_prompt) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_prompt->'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid prompt' USING ERRCODE='22023';END IF;
 k:=p_prompt->>'kind';IF k NOT IN ('answer','buzz','choose','claim') THEN RAISE EXCEPTION 'Invalid prompt kind' USING ERRCODE='22023';END IF;
 IF pg_catalog.jsonb_typeof(p_prompt->'eligible') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_prompt->'eligible') NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid players' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(p_prompt->'eligible') LOOP
  IF pg_catalog.jsonb_typeof(v)<>'string' OR (v#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid players' USING ERRCODE='22023';END IF;
  mid:=(v#>>'{}')::uuid;
  IF mid=ANY(el) OR NOT(mid=ANY(g.roster)) THEN RAISE EXCEPTION 'Invalid players' USING ERRCODE='22023';END IF;
  IF NOT lantern_private.live(mid,r.id) THEN RAISE EXCEPTION 'Players changed; refresh the list' USING ERRCODE='PT412';END IF;
  el:=pg_catalog.array_append(el,mid);
 END LOOP;
 IF pg_catalog.jsonb_typeof(p_prompt->'q') IS DISTINCT FROM 'string' OR pg_catalog.char_length(p_prompt->>'q') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid question' USING ERRCODE='22023';END IF;
 op:=COALESCE(p_prompt->'opts','[]'::jsonb);
 IF pg_catalog.jsonb_typeof(op) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid options' USING ERRCODE='22023';END IF;
 n:=pg_catalog.jsonb_array_length(op);
 IF (k IN ('answer','buzz') AND n<>4) OR (k='choose' AND n NOT BETWEEN 2 AND 6) OR (k='claim' AND n<>0) THEN RAISE EXCEPTION 'Wrong number of options' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(op) LOOP IF pg_catalog.jsonb_typeof(v)<>'string' OR pg_catalog.char_length(v#>>'{}') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid option' USING ERRCODE='22023';END IF;END LOOP;
 IF k IN ('answer','buzz') THEN
  IF pg_catalog.jsonb_typeof(p_prompt->'correct') IS DISTINCT FROM 'number' OR (p_prompt->>'correct')!~'^[0-3]$' THEN RAISE EXCEPTION 'Invalid correct option' USING ERRCODE='22023';END IF;
  ci:=(p_prompt->>'correct')::integer;
 ELSIF p_prompt ? 'correct' THEN RAISE EXCEPTION 'Choices have no correct option' USING ERRCODE='22023';
 END IF;
 IF p_prompt ? 'disabled' THEN
  IF k<>'choose' OR pg_catalog.jsonb_typeof(p_prompt->'disabled')<>'array' THEN RAISE EXCEPTION 'Invalid disabled options' USING ERRCODE='22023';END IF;
  FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(p_prompt->'disabled') LOOP
   IF pg_catalog.jsonb_typeof(v)<>'number' OR (v#>>'{}')!~'^[0-5]$' OR (v#>>'{}')::integer>=n OR (v#>>'{}')::integer=ANY(dis) THEN RAISE EXCEPTION 'Invalid disabled options' USING ERRCODE='22023';END IF;
   dis:=pg_catalog.array_append(dis,(v#>>'{}')::integer);
  END LOOP;
  IF pg_catalog.cardinality(dis)>=n THEN RAISE EXCEPTION 'Leave at least one option open' USING ERRCODE='22023';END IF;
 END IF;
 IF p_prompt ? 'window_ms' THEN
  IF pg_catalog.jsonb_typeof(p_prompt->'window_ms')<>'number' OR (p_prompt->>'window_ms')!~'^[0-9]{4,6}$' OR (p_prompt->>'window_ms')::integer NOT BETWEEN 3000 AND 120000 THEN RAISE EXCEPTION 'Invalid window' USING ERRCODE='22023';END IF;
  win:=(p_prompt->>'window_ms')::integer;
 END IF;
 SELECT COALESCE(pg_catalog.max(ordinal),0)+1 INTO ord FROM lantern_private.prompts WHERE game_id=g.id;
 IF ord>2000 THEN RAISE EXCEPTION 'Game prompt limit reached' USING ERRCODE='54000';END IF;
 stamp:=pg_catalog.clock_timestamp();
 -- An open question gives everyone a moment to read before presses count.
 delay:=CASE WHEN k='buzz' THEN interval '1500 milliseconds' ELSE interval '0' END;
 INSERT INTO lantern_private.prompts(room_id,game_id,ordinal,kind,eligible,q_text,opts,disabled,correct_idx,open_at,deadline)
 VALUES(r.id,g.id,ord,k,el,p_prompt->>'q',op,dis,ci,stamp+delay,CASE WHEN win IS NULL THEN NULL ELSE stamp+delay+pg_catalog.make_interval(secs=>win/1000.0) END) RETURNING * INTO p;
 r:=lantern_private.bump(r.id,'play',p.id,g.id);
 old:=lantern_private.room_json(r);PERFORM lantern_private.remember(p_request_id,'open',r.id,payload,old);RETURN old;
END $$;
-- The host may close an unfinished prompt with no winner: "No steal", "Nobody",
-- or a player has gone. It cannot choose an answer for anyone.
CREATE FUNCTION public.lantern_end_prompt(p_code text,p_prompt_id uuid,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;p lantern_private.prompts;old jsonb;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'prompt',p_prompt_id,'version',p_expected_version);
BEGIN
 old:=lantern_private.replay(p_request_id,'end',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=lantern_private.room_for(p_code,true,true);PERFORM lantern_private.version(r,p_expected_version);
 IF p_prompt_id IS NULL OR p_prompt_id IS DISTINCT FROM r.current_prompt_id THEN RAISE EXCEPTION 'Current prompt required' USING ERRCODE='42501';END IF;
 p:=lantern_private.settle(p_prompt_id);
 IF p.closed_at IS NULL THEN p:=lantern_private.close(p,NULL,NULL,'host');END IF;
 r:=lantern_private.bump(r.id,r.phase,r.current_prompt_id,r.game_id);
 old:=lantern_private.room_json(r);PERFORM lantern_private.remember(p_request_id,'end',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.lantern_set_phase(p_code text,p_phase text,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;g lantern_private.games;old jsonb;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'phase',p_phase,'version',p_expected_version);
BEGIN
 old:=lantern_private.replay(p_request_id,'phase',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=lantern_private.room_for(p_code,true,true);PERFORM lantern_private.version(r,p_expected_version);PERFORM lantern_private.open_prompt_check(r);
 SELECT * INTO g FROM lantern_private.games WHERE id=r.game_id;
 IF p_phase IN ('lobby','final') THEN
  IF p_phase='final' AND g.id IS NULL THEN RAISE EXCEPTION 'No game in progress' USING ERRCODE='42501';END IF;
  UPDATE lantern_private.games SET finished_at=COALESCE(finished_at,pg_catalog.clock_timestamp()) WHERE id=g.id;
 ELSE RAISE EXCEPTION 'Invalid phase' USING ERRCODE='22023';END IF;
 r:=lantern_private.bump(r.id,p_phase,r.current_prompt_id,r.game_id);
 old:=lantern_private.room_json(r);PERFORM lantern_private.remember(p_request_id,'phase',r.id,payload,old);RETURN old;
END $$;

-- ---------- player API ----------
CREATE FUNCTION public.lantern_preview(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;u uuid:=lantern_private.uid();
BEGIN
 SELECT * INTO r FROM lantern_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) AND expires_at>pg_catalog.clock_timestamp();
 IF r.id IS NULL THEN RETURN NULL;END IF;RETURN pg_catalog.jsonb_build_object('code',r.code,'phase',r.phase);
END $$;
CREATE FUNCTION public.lantern_join(p_code text,p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;m lantern_private.members;u uuid:=lantern_private.uid();nm text:=pg_catalog.regexp_replace(pg_catalog.btrim(p_name),'\s+',' ','g');
BEGIN
 r:=lantern_private.room_for(p_code,false,true);
 IF nm IS NULL OR pg_catalog.char_length(nm) NOT BETWEEN 1 AND 14 OR nm ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Name must have 1 to 14 characters' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM lantern_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;
 IF m.id IS NOT NULL THEN RETURN lantern_private.member_json(m);END IF;
 IF EXISTS(SELECT 1 FROM lantern_private.members WHERE room_id=r.id AND left_at IS NULL AND pg_catalog.lower(name)=pg_catalog.lower(nm)) THEN RAISE EXCEPTION 'That name is taken in this room' USING ERRCODE='23505';END IF;
 IF (SELECT pg_catalog.count(*) FROM lantern_private.members WHERE room_id=r.id AND left_at IS NULL)>=30 OR (SELECT pg_catalog.count(*) FROM lantern_private.members WHERE room_id=r.id)>=300 THEN RAISE EXCEPTION 'Room player limit reached' USING ERRCODE='54000';END IF;
 INSERT INTO lantern_private.members(room_id,user_id,name) VALUES(r.id,u,nm) RETURNING * INTO m;RETURN lantern_private.member_json(m);
END $$;
CREATE FUNCTION public.lantern_my_membership(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;m lantern_private.members;
BEGIN r:=lantern_private.room_for(p_code,false);SELECT * INTO m FROM lantern_private.members WHERE room_id=r.id AND user_id=lantern_private.uid() AND left_at IS NULL;IF m.id IS NULL THEN RETURN NULL;END IF;RETURN lantern_private.member_json(m);END $$;
CREATE FUNCTION public.lantern_leave(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;
BEGIN r:=lantern_private.room_for(p_code,false,true);UPDATE lantern_private.members SET left_at=pg_catalog.clock_timestamp() WHERE room_id=r.id AND user_id=lantern_private.uid() AND left_at IS NULL;RETURN pg_catalog.jsonb_build_object('left',true);END $$;
-- A player's poll also records that they are still here.
CREATE FUNCTION public.lantern_player_state(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;m lantern_private.members;
BEGIN
 r:=lantern_private.room_for(p_code,false);m:=lantern_private.member_for(r.id);
 UPDATE lantern_private.members SET last_seen=pg_catalog.clock_timestamp() WHERE id=m.id RETURNING * INTO m;
 RETURN lantern_private.room_json(r)||pg_catalog.jsonb_build_object('me',lantern_private.member_json(m));
END $$;
-- Pressing: wins the turn in an open question, or claims a "tap your name" moment.
CREATE FUNCTION public.lantern_press(p_code text,p_prompt_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;m lantern_private.members;p lantern_private.prompts;stamp timestamptz;
BEGIN
 r:=lantern_private.room_for(p_code,false);m:=lantern_private.member_for(r.id);
 IF p_prompt_id IS NULL OR p_prompt_id IS DISTINCT FROM r.current_prompt_id THEN RAISE EXCEPTION 'This question has closed' USING ERRCODE='42501';END IF;
 p:=lantern_private.settle(p_prompt_id);stamp:=pg_catalog.clock_timestamp();
 IF p.kind NOT IN ('buzz','claim') THEN RAISE EXCEPTION 'Nothing to press here' USING ERRCODE='42501';END IF;
 IF (p.kind='buzz' AND p.chooser_id=m.id) OR (p.kind='claim' AND p.winner_id=m.id) THEN RETURN lantern_private.room_json(r)||pg_catalog.jsonb_build_object('me',lantern_private.member_json(m));END IF;
 IF NOT(m.id=ANY(p.eligible)) THEN RAISE EXCEPTION 'You are not in this one' USING ERRCODE='42501';END IF;
 IF p.closed_at IS NOT NULL AND p.kind='claim' THEN RAISE EXCEPTION 'Beaten to it' USING ERRCODE='42501';END IF;
 IF p.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This question has closed' USING ERRCODE='42501';END IF;
 IF stamp<p.open_at THEN RAISE EXCEPTION 'Not yet: read the question first' USING ERRCODE='42501';END IF;
 IF m.id=ANY(p.locked) THEN RAISE EXCEPTION 'You are locked out of this question' USING ERRCODE='42501';END IF;
 IF p.chooser_id IS NOT NULL THEN RAISE EXCEPTION 'Beaten to it' USING ERRCODE='42501';END IF;
 INSERT INTO lantern_private.presses(prompt_id,member_id,created_at) VALUES(p.id,m.id,stamp) ON CONFLICT(prompt_id,member_id) DO NOTHING;
 IF p.kind='claim' THEN PERFORM lantern_private.close(p,m.id,NULL,'claimed');
 ELSE UPDATE lantern_private.prompts SET chooser_id=m.id,chosen_at=stamp,choose_deadline=stamp+interval '10 seconds' WHERE id=p.id;END IF;
 RETURN lantern_private.room_json(r)||pg_catalog.jsonb_build_object('me',lantern_private.member_json(m));
END $$;
-- Answering a question, or making a choice. Each player acts at most once per prompt.
CREATE FUNCTION public.lantern_answer(p_code text,p_prompt_id uuid,p_choice integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r lantern_private.rooms;m lantern_private.members;p lantern_private.prompts;a lantern_private.answers;stamp timestamptz;n integer;
BEGIN
 r:=lantern_private.room_for(p_code,false);m:=lantern_private.member_for(r.id);
 IF p_prompt_id IS NULL OR p_prompt_id IS DISTINCT FROM r.current_prompt_id THEN RAISE EXCEPTION 'This question has closed' USING ERRCODE='42501';END IF;
 p:=lantern_private.settle(p_prompt_id);n:=pg_catalog.jsonb_array_length(p.opts);
 IF p.kind='claim' THEN RAISE EXCEPTION 'Nothing to answer here' USING ERRCODE='42501';END IF;
 IF p_choice IS NULL OR p_choice<0 OR p_choice>=n OR p_choice=ANY(p.disabled) THEN RAISE EXCEPTION 'Invalid choice' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM lantern_private.answers WHERE prompt_id=p.id AND member_id=m.id;
 IF a.id IS NOT NULL THEN
  IF a.choice<>p_choice THEN RAISE EXCEPTION 'Answer already recorded with another choice' USING ERRCODE='22023';END IF;
  RETURN lantern_private.room_json(r)||pg_catalog.jsonb_build_object('me',lantern_private.member_json(m));
 END IF;
 stamp:=pg_catalog.clock_timestamp();
 IF NOT(m.id=ANY(p.eligible)) THEN RAISE EXCEPTION 'It is not your turn to answer' USING ERRCODE='42501';END IF;
 IF p.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This question has closed' USING ERRCODE='42501';END IF;
 IF p.kind='buzz' AND (p.chooser_id IS DISTINCT FROM m.id OR stamp>=p.choose_deadline) THEN RAISE EXCEPTION 'It is not your turn to answer' USING ERRCODE='42501';END IF;
 INSERT INTO lantern_private.answers(prompt_id,member_id,choice,created_at) VALUES(p.id,m.id,p_choice,stamp);
 IF p.kind='choose' THEN PERFORM lantern_private.close(p,m.id,p_choice,'chosen');
 ELSIF p.kind='answer' THEN PERFORM lantern_private.close(p,CASE WHEN p_choice=p.correct_idx THEN m.id END,p_choice,CASE WHEN p_choice=p.correct_idx THEN 'correct' ELSE 'wrong' END);
 ELSIF p_choice=p.correct_idx THEN PERFORM lantern_private.close(p,m.id,p_choice,'correct');
 ELSE
  UPDATE lantern_private.prompts SET locked=pg_catalog.array_append(locked,m.id),
   deadline=CASE WHEN deadline IS NULL THEN NULL ELSE deadline+(stamp-chosen_at) END,
   chooser_id=NULL,chosen_at=NULL,choose_deadline=NULL WHERE id=p.id RETURNING * INTO p;
  IF pg_catalog.cardinality(p.locked)>=pg_catalog.cardinality(p.eligible) THEN PERFORM lantern_private.close(p,NULL,NULL,'all');END IF;
 END IF;
 RETURN lantern_private.room_json(r)||pg_catalog.jsonb_build_object('me',lantern_private.member_json(m));
END $$;

-- Explicit object revocations defeat global default grants as well as PUBLIC's
-- default function EXECUTE. Future private objects must repeat these revocations.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA lantern_private FROM PUBLIC,anon,authenticated;
DO $api_grants$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'lantern\_%' ESCAPE '\' LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $api_grants$;
