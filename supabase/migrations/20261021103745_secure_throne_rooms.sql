-- Isolated Hold The Throne ownership protocol, General and Bible editions.
-- Host remains the trusted question author/correctness grader. Apply atomically.
SET LOCAL lock_timeout='3s';
DO $preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='throne_private') OR
 EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'throne\_%' ESCAPE '\') THEN
  RAISE EXCEPTION 'Throne objects already exist; review migration history';
 END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute
 WHERE attrelid=pg_catalog.to_regclass('public.legends') AND NOT attisdropped
 AND attname IN ('game','name','streak','flawless','created_at'))<>5 THEN
  RAISE EXCEPTION 'Historical legends shape differs; review before applying';
 END IF;
END $preflight$;
CREATE SCHEMA throne_private;
REVOKE ALL ON SCHEMA throne_private FROM PUBLIC,anon,authenticated;
CREATE TABLE throne_private.rooms(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 code text UNIQUE NOT NULL CHECK(code ~ '^[A-Z2-9]{5}$'),
 edition text NOT NULL CHECK(edition IN ('general','bible')),
 host_user_id uuid NOT NULL,
 phase text NOT NULL DEFAULT 'lobby' CHECK(phase IN ('lobby','live','reveal','between','finintro','gameover')),
 run_id uuid,current_question_id uuid,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 state jsonb NOT NULL DEFAULT '{"live":true,"champ":null,"chal":null,"queue":[]}',
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT(pg_catalog.clock_timestamp()+interval '12 hours')
);
CREATE INDEX rooms_owner_expiry ON throne_private.rooms(host_user_id,expires_at);
CREATE TABLE throne_private.members(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES throne_private.rooms(id),user_id uuid NOT NULL,
 name text NOT NULL CHECK(pg_catalog.char_length(name) BETWEEN 1 AND 14),
 joined_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 last_seen timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),left_at timestamptz
);
CREATE UNIQUE INDEX members_one_identity ON throne_private.members(room_id,user_id) WHERE left_at IS NULL;
CREATE INDEX members_roster ON throne_private.members(room_id,joined_at,id) WHERE left_at IS NULL;
CREATE INDEX members_history ON throne_private.members(room_id,joined_at,id);
CREATE TABLE throne_private.runs(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES throne_private.rooms(id),q_total integer NOT NULL CHECK(q_total BETWEEN 3 AND 50),
 answer_ms integer NOT NULL CHECK(answer_ms BETWEEN 3000 AND 15000),
 current_champ uuid REFERENCES throne_private.members(id),streak integer NOT NULL DEFAULT 0 CHECK(streak BETWEEN 0 AND 2000),
 best_streak jsonb NOT NULL DEFAULT '{}',total_correct jsonb NOT NULL DEFAULT '{}',
 streak_king_id uuid REFERENCES throne_private.members(id),
 blemished uuid[] NOT NULL DEFAULT '{}',last_winner uuid REFERENCES throne_private.members(id),
 closer_id uuid REFERENCES throne_private.members(id),king_id uuid REFERENCES throne_private.members(id),
 finale_score jsonb NOT NULL DEFAULT '{}',finale_winner uuid REFERENCES throne_private.members(id),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),finished_at timestamptz
);
CREATE INDEX runs_room ON throne_private.runs(room_id,created_at,id);
ALTER TABLE throne_private.rooms ADD CONSTRAINT rooms_run_fk FOREIGN KEY(run_id) REFERENCES throne_private.runs(id);
CREATE TABLE throne_private.questions(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES throne_private.rooms(id),run_id uuid NOT NULL REFERENCES throne_private.runs(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 2000),q_index integer NOT NULL CHECK(q_index BETWEEN 1 AND 10000),
 mode text NOT NULL CHECK(mode IN ('spine','finale')),
 champ_id uuid NOT NULL REFERENCES throne_private.members(id),chal_id uuid NOT NULL REFERENCES throne_private.members(id),
 q_text text NOT NULL CHECK(pg_catalog.char_length(q_text) BETWEEN 1 AND 4000),opts jsonb NOT NULL,
 answerer_id uuid REFERENCES throne_private.members(id),first_missed_id uuid REFERENCES throne_private.members(id),
 buzz_open_at timestamptz NOT NULL,buzz_deadline timestamptz NOT NULL,answer_deadline timestamptz,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),closed_at timestamptz,
 CHECK(champ_id<>chal_id),UNIQUE(run_id,ordinal)
);
CREATE INDEX questions_room ON throne_private.questions(room_id,run_id,id);
ALTER TABLE throne_private.rooms ADD CONSTRAINT rooms_question_fk FOREIGN KEY(current_question_id) REFERENCES throne_private.questions(id);
CREATE TABLE throne_private.buzzes(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),question_id uuid NOT NULL REFERENCES throne_private.questions(id),
 member_id uuid NOT NULL REFERENCES throne_private.members(id),created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(question_id,member_id)
);
CREATE INDEX buzzes_order ON throne_private.buzzes(question_id,created_at,id);
CREATE TABLE throne_private.answers(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),question_id uuid NOT NULL REFERENCES throne_private.questions(id),
 member_id uuid NOT NULL REFERENCES throne_private.members(id),choice integer NOT NULL CHECK(choice BETWEEN 0 AND 3),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),UNIQUE(question_id,member_id)
);
CREATE INDEX answers_order ON throne_private.answers(question_id,created_at,id);
CREATE TABLE throne_private.resolutions(
 question_id uuid PRIMARY KEY REFERENCES throne_private.questions(id),
 run_id uuid NOT NULL REFERENCES throne_private.runs(id),winner_id uuid REFERENCES throne_private.members(id),
 outcome text NOT NULL CHECK(outcome IN ('win','bothmiss')),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 CHECK((outcome='win')=(winner_id IS NOT NULL))
);
CREATE INDEX resolutions_run ON throne_private.resolutions(run_id,created_at,question_id);
CREATE TABLE throne_private.results(
 run_id uuid PRIMARY KEY REFERENCES throne_private.runs(id),room_id uuid NOT NULL REFERENCES throne_private.rooms(id),
 edition text NOT NULL CHECK(edition IN ('general','bible')),winner_id uuid NOT NULL REFERENCES throne_private.members(id),
 group_code text CHECK(group_code ~ '^[A-Z0-9_-]{1,24}$'),name text NOT NULL,
 streak integer NOT NULL CHECK(streak BETWEEN 1 AND 2000),flawless boolean NOT NULL,
 questions integer NOT NULL CHECK(questions BETWEEN 3 AND 50),players integer NOT NULL CHECK(players BETWEEN 2 AND 2000),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX results_scope ON throne_private.results(edition,group_code,streak DESC,created_at DESC) WHERE group_code IS NOT NULL;
CREATE TABLE throne_private.requests(
 user_id uuid NOT NULL,request_id uuid NOT NULL,operation text NOT NULL,
 room_id uuid NOT NULL REFERENCES throne_private.rooms(id),payload_hash bytea NOT NULL CHECK(pg_catalog.octet_length(payload_hash)=32),
 response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),PRIMARY KEY(user_id,request_id)
);
CREATE INDEX requests_budget ON throne_private.requests(room_id);
DO $private$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['rooms','members','runs','questions','buzzes','answers','resolutions','results','requests'] LOOP
  EXECUTE pg_catalog.format('ALTER TABLE throne_private.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END $private$;
REVOKE ALL ON ALL TABLES IN SCHEMA throne_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA throne_private FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA throne_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA throne_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION throne_private.uid() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN IF u IS NULL THEN RAISE EXCEPTION 'Verified guest session required' USING ERRCODE='42501'; END IF; RETURN u; END $$;
CREATE FUNCTION throne_private.edition(p_edition text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN IF p_edition IS NULL OR p_edition NOT IN ('general','bible') THEN RAISE EXCEPTION 'Invalid edition' USING ERRCODE='22023'; END IF; RETURN p_edition; END $$;
CREATE FUNCTION throne_private.room_for(p_code text,p_edition text,p_host boolean,p_lock boolean DEFAULT false)
RETURNS throne_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r throne_private.rooms;u uuid:=throne_private.uid();e text:=throne_private.edition(p_edition);
BEGIN
 IF p_lock THEN SELECT * INTO r FROM throne_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) AND edition=e FOR UPDATE;
 ELSE SELECT * INTO r FROM throne_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) AND edition=e; END IF;
 IF r.id IS NULL OR r.expires_at<=pg_catalog.clock_timestamp() OR (p_host AND r.host_user_id<>u) THEN RAISE EXCEPTION 'Throne room unavailable' USING ERRCODE='42501'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION throne_private.member_for(p_room_id uuid) RETURNS throne_private.members LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m throne_private.members;u uuid:=throne_private.uid();
BEGIN
 SELECT * INTO m FROM throne_private.members WHERE room_id=p_room_id AND user_id=u AND left_at IS NULL;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Active room membership required' USING ERRCODE='42501'; END IF;RETURN m;
END $$;
CREATE FUNCTION throne_private.member_ref(p_id uuid,p_room_id uuid,p_active boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE m throne_private.members;
BEGIN
 IF p_id IS NULL THEN RETURN 'null'::jsonb;END IF;
 SELECT * INTO m FROM throne_private.members WHERE id=p_id AND room_id=p_room_id AND (NOT p_active OR left_at IS NULL);
 IF m.id IS NULL THEN RAISE EXCEPTION 'Invalid room member reference' USING ERRCODE='22023';END IF;
 RETURN pg_catalog.jsonb_build_object('id',m.id,'name',m.name);
END $$;
CREATE FUNCTION throne_private.member_json(m throne_private.members) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',m.id,'name',m.name,'score',0,'joined_at',m.joined_at,'last_seen',m.last_seen)
$$;
CREATE FUNCTION throne_private.txt(s jsonb,k text,n integer,required boolean DEFAULT true) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF s->k IS NULL OR s->k='null'::jsonb THEN IF required THEN RAISE EXCEPTION 'Missing field %',k USING ERRCODE='22023';END IF;RETURN NULL;END IF;
 IF pg_catalog.jsonb_typeof(s->k)<>'string' THEN RAISE EXCEPTION 'Invalid text %',k USING ERRCODE='22023';END IF;
 v:=s->>k;IF pg_catalog.char_length(v)>n OR (required AND pg_catalog.char_length(v)=0) THEN RAISE EXCEPTION 'Invalid length %',k USING ERRCODE='22023';END IF;RETURN v;
END $$;
CREATE FUNCTION throne_private.num(s jsonb,k text,lo integer,hi integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v integer;
BEGIN
 IF pg_catalog.jsonb_typeof(s->k) IS DISTINCT FROM 'number' OR (s->>k)!~'^[0-9]+$' OR pg_catalog.char_length(s->>k)>9 THEN RAISE EXCEPTION 'Invalid number %',k USING ERRCODE='22023';END IF;
 v:=(s->>k)::integer;IF v<lo OR v>hi THEN RAISE EXCEPTION 'Number out of bounds %',k USING ERRCODE='22023';END IF;RETURN v;
END $$;
CREATE FUNCTION throne_private.flag(s jsonb,k text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN IF pg_catalog.jsonb_typeof(s->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid boolean %',k USING ERRCODE='22023';END IF;RETURN (s->>k)::boolean;END $$;
CREATE FUNCTION throne_private.ref(s jsonb,k text,p_room_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF s->k IS NULL OR s->k='null'::jsonb THEN RETURN 'null'::jsonb;END IF;
 IF pg_catalog.jsonb_typeof(s->k)<>'object' THEN RAISE EXCEPTION 'Invalid member %',k USING ERRCODE='22023';END IF;
 RETURN throne_private.member_ref(throne_private.txt(s->k,'id',36)::uuid,p_room_id);
END $$;
CREATE FUNCTION throne_private.queue(s jsonb,p_room_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE out jsonb:='[]';entry jsonb;mid uuid;seen uuid[]:='{}';
BEGIN
 IF s IS NULL THEN RETURN out;END IF;
 IF pg_catalog.jsonb_typeof(s)<>'array' OR pg_catalog.jsonb_array_length(s)>200 THEN RAISE EXCEPTION 'Invalid queue' USING ERRCODE='22023';END IF;
 FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(s) LOOP
  mid:=throne_private.txt(entry,'id',36)::uuid;
  IF mid=ANY(seen) THEN RAISE EXCEPTION 'Duplicate queue member' USING ERRCODE='22023';END IF;
  seen:=pg_catalog.array_append(seen,mid);out:=out||pg_catalog.jsonb_build_array(throne_private.member_ref(mid,p_room_id));
 END LOOP;RETURN out;
END $$;
CREATE FUNCTION throne_private.stats(n throne_private.runs) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('streak',CASE WHEN n.closer_id IS NOT NULL THEN 0 ELSE COALESCE(n.streak,0) END,'bestStreak',COALESCE(n.best_streak,'{}'),
 'totalCorrect',COALESCE(n.total_correct,'{}'),'blemished',COALESCE(pg_catalog.to_jsonb(n.blemished),'[]'),
 'lastWinner',throne_private.member_ref(n.last_winner,n.room_id),'finaleScore',COALESCE(n.finale_score,'{}'),
 'finaleWinner',throne_private.member_ref(n.finale_winner,n.room_id))
$$;
CREATE FUNCTION throne_private.streak_king(p_run_id uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT z.id FROM (
 SELECT m.id,(n.best_streak->>m.id::text)::integer AS best,(n.total_correct->>m.id::text)::integer AS total,
 MIN(q.ordinal) AS first_win FROM throne_private.runs n JOIN throne_private.members m ON m.room_id=n.room_id
 JOIN throne_private.resolutions x ON x.run_id=n.id AND x.winner_id=m.id
 JOIN throne_private.questions q ON q.id=x.question_id AND q.mode='spine'
 WHERE n.id=p_run_id GROUP BY m.id,n.best_streak,n.total_correct
 ) z ORDER BY z.best DESC,z.total DESC,z.first_win,z.id LIMIT 1
$$;
CREATE FUNCTION throne_private.clean_state(r throne_private.rooms,s jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE n throne_private.runs;q throne_private.questions;out jsonb;v jsonb;result throne_private.results;winner uuid;
BEGIN
 IF pg_catalog.jsonb_typeof(s) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(s::text)>64000 THEN RAISE EXCEPTION 'Invalid room state' USING ERRCODE='22023';END IF;
 SELECT * INTO n FROM throne_private.runs WHERE id=r.run_id;
 SELECT * INTO q FROM throne_private.questions WHERE id=r.current_question_id;
 out:=throne_private.stats(n)||pg_catalog.jsonb_build_object('game',CASE WHEN r.edition='bible' THEN 'throne-bible' ELSE 'throne' END,
 'phase',r.phase,'live',CASE WHEN s ? 'live' THEN throne_private.flag(s,'live') ELSE true END,
 'champ',throne_private.ref(s,'champ',r.id),'chal',throne_private.ref(s,'chal',r.id),'queue',throne_private.queue(s->'queue',r.id),
 'qTotal',COALESCE(n.q_total,20),'qIndex',COALESCE(q.q_index,0),'mode',CASE WHEN n.closer_id IS NOT NULL THEN 'finale' ELSE COALESCE(q.mode,'spine') END,
 'qId',q.id,'q',CASE WHEN q.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('q',q.q_text,'opts',q.opts) END,
 'buzzOpenAt',CASE WHEN r.phase='live' THEN pg_catalog.floor(pg_catalog.date_part('epoch',q.buzz_open_at)*1000) ELSE 0 END,
 'buzzWin',CASE WHEN r.phase='live' AND q.answerer_id IS NULL THEN pg_catalog.floor(pg_catalog.date_part('epoch',q.buzz_deadline)*1000) ELSE 0 END,
 'ansWin',CASE WHEN r.phase='live' AND q.answerer_id IS NOT NULL THEN pg_catalog.floor(pg_catalog.date_part('epoch',q.answer_deadline)*1000) ELSE 0 END,
 'answerer',throne_private.member_ref(q.answerer_id,r.id),
 'lockedOut',CASE WHEN q.first_missed_id IS NULL THEN '[]'::jsonb ELSE pg_catalog.jsonb_build_array(q.first_missed_id) END,
 'reveal',NULL,'between',NULL,'finintro',NULL,'finalists',NULL,'winner',NULL,'summary',NULL,
 'streakKing',CASE WHEN n.streak_king_id IS NULL THEN NULL ELSE throne_private.member_ref(n.streak_king_id,r.id)||pg_catalog.jsonb_build_object('s',(n.best_streak->>n.streak_king_id::text)::integer) END);
 IF n.closer_id IS NOT NULL THEN out:=out||pg_catalog.jsonb_build_object('finalists',pg_catalog.jsonb_build_object('closer',throne_private.member_ref(n.closer_id,r.id),'king',throne_private.member_ref(n.king_id,r.id)));END IF;
 IF r.phase='reveal' THEN
  IF q.closed_at IS NULL OR NOT EXISTS(SELECT 1 FROM throne_private.resolutions WHERE question_id=q.id) THEN RAISE EXCEPTION 'Question is not resolved' USING ERRCODE='22023';END IF;
  v:=s->'reveal';out:=out||pg_catalog.jsonb_build_object('reveal',pg_catalog.jsonb_build_object('ok',throne_private.flag(v,'ok'),'msg',throne_private.txt(v,'msg',1000),'sub',COALESCE(throne_private.txt(v,'sub',1000,false),''),'correctIdx',throne_private.num(v,'correctIdx',0,3)));
 END IF;
 IF r.phase='between' THEN out:=out||pg_catalog.jsonb_build_object('between',pg_catalog.jsonb_build_object('msg',throne_private.txt(s->'between','msg',1000)));END IF;
 IF r.phase='finintro' THEN out:=out||pg_catalog.jsonb_build_object('finintro',pg_catalog.jsonb_build_object('msg',throne_private.txt(s->'finintro','msg',1000)));END IF;
 IF r.phase='gameover' THEN
  SELECT * INTO result FROM throne_private.results WHERE run_id=r.run_id;
  winner:=result.winner_id;
  out:=out||pg_catalog.jsonb_build_object('winner',throne_private.member_ref(winner,r.id),'summary',
   pg_catalog.jsonb_build_object('champ',throne_private.member_ref(winner,r.id),'closer',throne_private.member_ref(n.last_winner,r.id),
   'streakKing',out->'streakKing',
   'flawless',COALESCE(result.flawless,false),'finaleScore',COALESCE(n.finale_score,'{}'),
   'finalists',out->'finalists','recorded',result.run_id IS NOT NULL));
 END IF;RETURN out;
END $$;
CREATE FUNCTION throne_private.room_json(r throne_private.rooms) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',r.id,'code',r.code,'edition',r.edition,'phase',r.phase,'run_id',r.run_id,
 'q_id',r.current_question_id,'version',r.version,'server_now',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp())*1000),'state',throne_private.clean_state(r,r.state),'expires_at',r.expires_at)
$$;
CREATE FUNCTION throne_private.replay(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v throne_private.requests;u uuid:=throne_private.uid();
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
 SELECT * INTO v FROM throne_private.requests WHERE user_id=u AND request_id=p_request_id;
 IF v.request_id IS NULL THEN RETURN NULL;END IF;
 IF v.operation<>p_operation OR v.payload_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')) THEN RAISE EXCEPTION 'Request UUID reused with different input' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM throne_private.rooms WHERE id=v.room_id AND host_user_id=u AND expires_at>pg_catalog.clock_timestamp()) THEN RAISE EXCEPTION 'Throne room unavailable' USING ERRCODE='42501';END IF;
 RETURN v.response;
END $$;
CREATE FUNCTION throne_private.remember(p_request_id uuid,p_operation text,p_room_id uuid,p_payload jsonb,p_response jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (SELECT pg_catalog.count(*) FROM throne_private.requests WHERE room_id=p_room_id)>=20000 THEN RAISE EXCEPTION 'Room operation budget reached' USING ERRCODE='54000';END IF;
 INSERT INTO throne_private.requests(user_id,request_id,operation,room_id,payload_hash,response) VALUES(throne_private.uid(),p_request_id,p_operation,p_room_id,pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),p_response);
END $$;
CREATE FUNCTION throne_private.version(r throne_private.rooms,p_run_id uuid,p_version bigint) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_version IS NULL OR p_version<>r.version THEN RAISE EXCEPTION 'Stale host version' USING ERRCODE='PT409';END IF;
 IF r.run_id IS DISTINCT FROM p_run_id THEN RAISE EXCEPTION 'Current run required' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION throne_private.question_for(r throne_private.rooms,p_run_id uuid,p_question_id uuid) RETURNS throne_private.questions LANGUAGE plpgsql SET search_path='' AS $$
DECLARE q throne_private.questions;
BEGIN
 IF p_run_id IS NULL OR p_run_id IS DISTINCT FROM r.run_id OR p_question_id IS NULL OR p_question_id IS DISTINCT FROM r.current_question_id THEN RAISE EXCEPTION 'Current question required' USING ERRCODE='42501';END IF;
 SELECT * INTO q FROM throne_private.questions WHERE id=p_question_id AND room_id=r.id AND run_id=p_run_id;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Question unavailable' USING ERRCODE='42501';END IF;RETURN q;
END $$;

CREATE FUNCTION public.throne_create_room(p_edition text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;u uuid:=throne_private.uid();e text:=throne_private.edition(p_edition);old jsonb;
 payload jsonb:=pg_catalog.jsonb_build_object('edition',p_edition);c text;i integer;attempt integer;alpha constant text:='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
 old:=throne_private.replay(p_request_id,'create',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('throne-create:'||u::text,0));
 IF (SELECT pg_catalog.count(*) FROM throne_private.rooms WHERE host_user_id=u AND expires_at>pg_catalog.clock_timestamp())>=5 THEN RAISE EXCEPTION 'Active room limit reached' USING ERRCODE='54000';END IF;
 FOR attempt IN 1..20 LOOP
  c:='';FOR i IN 0..4 LOOP c:=c||pg_catalog.substr(alpha,1+(pg_catalog.get_byte(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()),i)%pg_catalog.char_length(alpha)),1);END LOOP;
  INSERT INTO throne_private.rooms(code,edition,host_user_id) VALUES(c,e,u) ON CONFLICT(code) DO NOTHING RETURNING * INTO r;EXIT WHEN r.id IS NOT NULL;
 END LOOP;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Could not allocate room' USING ERRCODE='54000';END IF;
 old:=throne_private.room_json(r);PERFORM throne_private.remember(p_request_id,'create',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.throne_host_resume(p_code text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN throne_private.room_json(throne_private.room_for(p_code,p_edition,true));END $$;
CREATE FUNCTION public.throne_begin_run(p_code text,p_edition text,p_config jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;n throne_private.runs;old jsonb;payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'edition',p_edition,'config',p_config,'version',p_expected_version);
BEGIN
 old:=throne_private.replay(p_request_id,'begin',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=throne_private.room_for(p_code,p_edition,true,true);PERFORM throne_private.version(r,r.run_id,p_expected_version);
 UPDATE throne_private.questions SET closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()) WHERE room_id=r.id AND closed_at IS NULL;
 IF (SELECT pg_catalog.count(*) FROM throne_private.runs WHERE room_id=r.id)>=20 THEN RAISE EXCEPTION 'Room run limit reached' USING ERRCODE='54000';END IF;
 INSERT INTO throne_private.runs(room_id,q_total,answer_ms) VALUES(r.id,throne_private.num(p_config,'qTotal',3,50),throne_private.num(p_config,'answerMs',3000,15000)) RETURNING * INTO n;
 UPDATE throne_private.rooms SET run_id=n.id,current_question_id=NULL,phase='lobby',state=pg_catalog.jsonb_build_object('live',throne_private.flag(p_config,'live'),'champ',NULL,'chal',NULL,'queue','[]'::jsonb),version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=throne_private.room_json(r);PERFORM throne_private.remember(p_request_id,'begin',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.throne_host_publish(p_code text,p_edition text,p_run_id uuid,p_patch jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;n throne_private.runs;q throne_private.questions;next_phase text;s jsonb;old jsonb;king uuid;closer uuid;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'edition',p_edition,'run',p_run_id,'patch',p_patch,'version',p_expected_version);
BEGIN
 old:=throne_private.replay(p_request_id,'publish',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=throne_private.room_for(p_code,p_edition,true,true);PERFORM throne_private.version(r,p_run_id,p_expected_version);
 next_phase:=throne_private.txt(p_patch,'phase',16);s:=p_patch->'state';
 SELECT * INTO n FROM throne_private.runs WHERE id=r.run_id;SELECT * INTO q FROM throne_private.questions WHERE id=r.current_question_id;
 IF next_phase='lobby' THEN UPDATE throne_private.questions SET closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()) WHERE id=q.id;r.current_question_id:=NULL;
 ELSIF next_phase='live' THEN IF q.id IS NULL OR q.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Question has closed' USING ERRCODE='42501';END IF;
 ELSIF next_phase IN ('reveal','between','finintro') THEN
  IF q.closed_at IS NULL OR NOT EXISTS(SELECT 1 FROM throne_private.resolutions WHERE question_id=q.id) THEN RAISE EXCEPTION 'Resolve question first' USING ERRCODE='42501';END IF;
  IF next_phase='finintro' THEN
   king:=n.streak_king_id;closer:=n.last_winner;
   IF q.mode<>'spine' OR q.q_index<n.q_total OR closer IS NULL OR king IS NULL OR king=closer THEN RAISE EXCEPTION 'Finale unavailable' USING ERRCODE='22023';END IF;
   IF throne_private.txt(s->'finalists'->'closer','id',36)::uuid<>closer OR throne_private.txt(s->'finalists'->'king','id',36)::uuid<>king THEN RAISE EXCEPTION 'Invalid finalists' USING ERRCODE='22023';END IF;
   -- Keep the ledger-derived finalists stable if one leaves during the intro.
   -- Opening the duel rechecks liveness; its host then ends without a crown.
   PERFORM throne_private.member_ref(closer,r.id);PERFORM throne_private.member_ref(king,r.id);
   UPDATE throne_private.runs SET closer_id=closer,king_id=king WHERE id=n.id;
  END IF;
 ELSIF next_phase='gameover' THEN
  IF NOT EXISTS(SELECT 1 FROM throne_private.results WHERE run_id=n.id) AND
    (SELECT pg_catalog.count(*) FROM throne_private.members WHERE room_id=r.id AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '32 seconds')>=2 AND
    (n.closer_id IS NULL OR (SELECT pg_catalog.count(*) FROM throne_private.members WHERE id IN (n.closer_id,n.king_id) AND room_id=r.id AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '32 seconds')=2) THEN
   RAISE EXCEPTION 'Finalize completed run first' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'Invalid room phase' USING ERRCODE='22023';END IF;
 r.phase:=next_phase;r.state:=s;s:=throne_private.clean_state(r,s);
 UPDATE throne_private.rooms SET phase=next_phase,current_question_id=r.current_question_id,state=s,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=throne_private.room_json(r);PERFORM throne_private.remember(p_request_id,'publish',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.throne_host_open_question(p_code text,p_edition text,p_run_id uuid,p_question jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;n throne_private.runs;q throne_private.questions;old jsonb;op jsonb;v jsonb;mode text;champ uuid;chal uuid;idx integer;ordinal integer;stamp timestamptz;waiting jsonb;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'edition',p_edition,'run',p_run_id,'question',p_question,'version',p_expected_version);
BEGIN
 old:=throne_private.replay(p_request_id,'open',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=throne_private.room_for(p_code,p_edition,true,true);PERFORM throne_private.version(r,p_run_id,p_expected_version);
 SELECT * INTO n FROM throne_private.runs WHERE id=r.run_id;
 IF n.id IS NULL OR n.finished_at IS NOT NULL OR (r.current_question_id IS NOT NULL AND EXISTS(SELECT 1 FROM throne_private.questions WHERE id=r.current_question_id AND closed_at IS NULL)) THEN RAISE EXCEPTION 'Run not ready for another question' USING ERRCODE='42501';END IF;
 mode:=throne_private.txt(p_question,'mode',8);IF mode NOT IN ('spine','finale') THEN RAISE EXCEPTION 'Invalid mode' USING ERRCODE='22023';END IF;
 champ:=throne_private.txt(p_question,'champ_id',36)::uuid;chal:=throne_private.txt(p_question,'chal_id',36)::uuid;
 IF champ=chal THEN RAISE EXCEPTION 'Two distinct seated players required' USING ERRCODE='22023';END IF;
 PERFORM throne_private.member_ref(champ,r.id);PERFORM throne_private.member_ref(chal,r.id);
 IF (SELECT pg_catalog.count(*) FROM throne_private.members WHERE id IN (champ,chal) AND room_id=r.id AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '32 seconds')<>2 THEN RAISE EXCEPTION 'Seated players changed; refresh roster' USING ERRCODE='PT412';END IF;
 IF mode='finale' AND (n.closer_id IS NULL OR champ<>n.closer_id OR chal<>n.king_id OR n.finale_winner IS NOT NULL) THEN RAISE EXCEPTION 'Invalid finale seats' USING ERRCODE='22023';END IF;
 IF mode='spine' THEN
  IF n.closer_id IS NOT NULL THEN RAISE EXCEPTION 'Main game has closed' USING ERRCODE='22023';END IF;
  IF n.current_champ IS NOT NULL AND champ<>n.current_champ THEN
   IF EXISTS(SELECT 1 FROM throne_private.members WHERE id=n.current_champ AND room_id=r.id AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '32 seconds') THEN RAISE EXCEPTION 'Current champion returned; refresh roster' USING ERRCODE='PT412';END IF;
   -- A vacated seat starts a fresh streak, without awarding a duel or erasing history.
   UPDATE throne_private.runs SET current_champ=NULL,streak=0 WHERE id=n.id RETURNING * INTO n;
  END IF;
 END IF;
 waiting:=throne_private.queue(CASE WHEN p_question ? 'queue' THEN p_question->'queue' ELSE r.state->'queue' END,r.id);
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(waiting) v WHERE (v->>'id')::uuid IN (champ,chal)) THEN RAISE EXCEPTION 'Seated players cannot also be queued' USING ERRCODE='22023';END IF;
 idx:=throne_private.num(p_question,'qIndex',1,10000);
 SELECT COALESCE(pg_catalog.max(q1.ordinal),0)+1 INTO ordinal FROM throne_private.questions q1 WHERE run_id=n.id;
 IF ordinal>2000 THEN RAISE EXCEPTION 'Run question limit reached' USING ERRCODE='54000';END IF;
 IF mode='spine' AND idx<>COALESCE((SELECT pg_catalog.max(q_index)+1 FROM throne_private.questions WHERE throne_private.questions.run_id=n.id AND throne_private.questions.mode='spine'),1) THEN RAISE EXCEPTION 'Main question index must advance' USING ERRCODE='22023';END IF;
 IF mode='finale' AND idx<>(SELECT pg_catalog.max(q_index) FROM throne_private.questions WHERE throne_private.questions.run_id=n.id AND throne_private.questions.mode='spine') THEN RAISE EXCEPTION 'Invalid finale question index' USING ERRCODE='22023';END IF;
 op:=p_question->'opts';IF pg_catalog.jsonb_typeof(op) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(op)<>4 THEN RAISE EXCEPTION 'Four options required' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(op) LOOP IF pg_catalog.jsonb_typeof(v)<>'string' OR pg_catalog.char_length(v#>>'{}') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid option' USING ERRCODE='22023';END IF;END LOOP;
 stamp:=pg_catalog.clock_timestamp();
 INSERT INTO throne_private.questions(room_id,run_id,ordinal,q_index,mode,champ_id,chal_id,q_text,opts,buzz_open_at,buzz_deadline)
 VALUES(r.id,n.id,ordinal,idx,mode,champ,chal,throne_private.txt(p_question,'q',4000),op,stamp+interval '3 seconds',stamp+interval '9 seconds') RETURNING * INTO q;
 UPDATE throne_private.rooms SET phase='live',current_question_id=q.id,state=state||pg_catalog.jsonb_build_object('champ',throne_private.member_ref(champ,r.id),'chal',throne_private.member_ref(chal,r.id),'queue',waiting),version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=throne_private.room_json(r);PERFORM throne_private.remember(p_request_id,'open',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.throne_host_select_buzz(p_code text,p_edition text,p_run_id uuid,p_question_id uuid,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;q throne_private.questions;n throne_private.runs;b throne_private.buzzes;old jsonb;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'edition',p_edition,'run',p_run_id,'question',p_question_id,'version',p_expected_version);
BEGIN
 old:=throne_private.replay(p_request_id,'select',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=throne_private.room_for(p_code,p_edition,true,true);PERFORM throne_private.version(r,p_run_id,p_expected_version);q:=throne_private.question_for(r,p_run_id,p_question_id);
 IF r.phase<>'live' OR q.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Question has closed' USING ERRCODE='42501';END IF;
 IF q.answerer_id IS NULL THEN
  SELECT b1.* INTO b FROM throne_private.buzzes b1 JOIN throne_private.members m ON m.id=b1.member_id
   WHERE b1.question_id=q.id AND m.left_at IS NULL AND b1.member_id IN (q.champ_id,q.chal_id) ORDER BY b1.created_at,b1.id LIMIT 1;
  IF b.id IS NOT NULL THEN
   SELECT * INTO n FROM throne_private.runs WHERE id=r.run_id;
   UPDATE throne_private.questions SET answerer_id=b.member_id,answer_deadline=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>n.answer_ms/1000.0) WHERE id=q.id;
   UPDATE throne_private.rooms SET version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  END IF;
 END IF;
 old:=throne_private.room_json(r);
 -- Empty polling is read-equivalent; it must not exhaust the room request log.
 IF b.id IS NOT NULL OR q.answerer_id IS NOT NULL THEN PERFORM throne_private.remember(p_request_id,'select',r.id,payload,old);END IF;RETURN old;
END $$;
CREATE FUNCTION public.throne_host_grade(p_code text,p_edition text,p_run_id uuid,p_question_id uuid,p_answerer_id uuid,p_correct boolean,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;q throne_private.questions;n throne_private.runs;a throne_private.answers;x throne_private.resolutions;old jsonb;outcome text;winner uuid;loser uuid;newstreak integer;points integer;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'edition',p_edition,'run',p_run_id,'question',p_question_id,'answerer',p_answerer_id,'correct',p_correct,'version',p_expected_version);
BEGIN
 old:=throne_private.replay(p_request_id,'grade',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=throne_private.room_for(p_code,p_edition,true,true);PERFORM throne_private.version(r,p_run_id,p_expected_version);q:=throne_private.question_for(r,p_run_id,p_question_id);SELECT * INTO n FROM throne_private.runs WHERE id=r.run_id;
 IF p_correct IS NULL OR q.answerer_id IS DISTINCT FROM p_answerer_id THEN RAISE EXCEPTION 'Current answerer required' USING ERRCODE='22023';END IF;
 SELECT * INTO x FROM throne_private.resolutions WHERE question_id=q.id;
 IF x.question_id IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('room',throne_private.room_json(r),'outcome',x.outcome,'winner',throne_private.member_ref(x.winner_id,r.id),'stats',throne_private.stats(n));END IF;
 IF r.phase<>'live' OR q.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Question has closed' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM throne_private.answers WHERE question_id=q.id AND member_id=q.answerer_id;
 IF q.answerer_id IS NULL THEN
  IF p_correct THEN RAISE EXCEPTION 'Cannot award without an answer' USING ERRCODE='22023';END IF;
  IF pg_catalog.clock_timestamp()<q.buzz_deadline OR EXISTS(SELECT 1 FROM throne_private.buzzes b JOIN throne_private.members m ON m.id=b.member_id WHERE b.question_id=q.id AND m.left_at IS NULL) THEN outcome:='waiting';ELSE outcome:='bothmiss';END IF;
 ELSIF a.id IS NULL THEN
  IF p_correct THEN RAISE EXCEPTION 'Cannot award without an answer' USING ERRCODE='22023';END IF;
  IF pg_catalog.clock_timestamp()<q.answer_deadline THEN outcome:='waiting';END IF;
 END IF;
 IF outcome='waiting' THEN RETURN pg_catalog.jsonb_build_object('room',throne_private.room_json(r),'outcome','waiting','winner',NULL,'stats',throne_private.stats(n));END IF;
 IF outcome IS NULL THEN
  IF p_correct THEN outcome:='win';winner:=q.answerer_id;
  ELSIF q.first_missed_id IS NULL THEN
   loser:=q.answerer_id;
   UPDATE throne_private.questions SET first_missed_id=loser,answerer_id=CASE WHEN loser=champ_id THEN chal_id ELSE champ_id END,
    answer_deadline=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>n.answer_ms/1000.0) WHERE id=q.id;
   UPDATE throne_private.rooms SET version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
   old:=pg_catalog.jsonb_build_object('room',throne_private.room_json(r),'outcome','handoff','winner',NULL,'stats',throne_private.stats(n));PERFORM throne_private.remember(p_request_id,'grade',r.id,payload,old);RETURN old;
  ELSE outcome:='bothmiss';END IF;
 END IF;
 INSERT INTO throne_private.resolutions(question_id,run_id,winner_id,outcome) VALUES(q.id,n.id,winner,outcome);
 UPDATE throne_private.questions SET closed_at=pg_catalog.clock_timestamp() WHERE id=q.id;
 IF q.mode='spine' THEN
  IF winner IS NOT NULL THEN
   newstreak:=CASE WHEN q.champ_id=winner THEN n.streak+1 ELSE 1 END;loser:=CASE WHEN q.champ_id=winner THEN q.chal_id ELSE q.champ_id END;
   UPDATE throne_private.runs SET current_champ=winner,streak=newstreak,last_winner=winner,
    best_streak=pg_catalog.jsonb_set(best_streak,ARRAY[winner::text],pg_catalog.to_jsonb(GREATEST(COALESCE((best_streak->>winner::text)::integer,0),newstreak))),
    total_correct=pg_catalog.jsonb_set(total_correct,ARRAY[winner::text],pg_catalog.to_jsonb(COALESCE((total_correct->>winner::text)::integer,0)+1)),
    blemished=CASE WHEN loser=ANY(blemished) THEN blemished ELSE pg_catalog.array_append(blemished,loser) END WHERE id=n.id RETURNING * INTO n;
  ELSE
   UPDATE throne_private.runs SET current_champ=NULL,streak=0,
    blemished=ARRAY(SELECT DISTINCT v FROM pg_catalog.unnest(blemished||ARRAY[q.champ_id,q.chal_id]) v) WHERE id=n.id RETURNING * INTO n;
  END IF;
  UPDATE throne_private.runs SET streak_king_id=throne_private.streak_king(n.id) WHERE id=n.id RETURNING * INTO n;
 ELSIF winner IS NOT NULL THEN
  points:=COALESCE((n.finale_score->>winner::text)::integer,0)+1;
  UPDATE throne_private.runs SET finale_score=pg_catalog.jsonb_set(finale_score,ARRAY[winner::text],pg_catalog.to_jsonb(points)),finale_winner=CASE WHEN points>=2 THEN winner ELSE NULL END WHERE id=n.id RETURNING * INTO n;
 END IF;
 UPDATE throne_private.rooms SET state=CASE WHEN q.mode='spine' AND winner IS NOT NULL THEN state||pg_catalog.jsonb_build_object('champ',throne_private.member_ref(winner,r.id)) ELSE state END,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=pg_catalog.jsonb_build_object('room',throne_private.room_json(r),'outcome',outcome,'winner',throne_private.member_ref(winner,r.id),'stats',throne_private.stats(n));PERFORM throne_private.remember(p_request_id,'grade',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.throne_host_members(p_code text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;
BEGIN r:=throne_private.room_for(p_code,p_edition,true);RETURN(SELECT COALESCE(pg_catalog.jsonb_agg(throne_private.member_json(m) ORDER BY m.joined_at,m.id),'[]') FROM throne_private.members m WHERE m.room_id=r.id AND m.left_at IS NULL);END $$;
CREATE FUNCTION public.throne_host_answers(p_code text,p_edition text,p_run_id uuid,p_question_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;q throne_private.questions;
BEGIN
 r:=throne_private.room_for(p_code,p_edition,true);q:=throne_private.question_for(r,p_run_id,p_question_id);
 RETURN(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('player_id',a.member_id,'choice',a.choice,'created_at',a.created_at) ORDER BY a.created_at,a.id),'[]') FROM throne_private.answers a WHERE a.question_id=q.id);
END $$;
CREATE FUNCTION public.throne_finalize(p_code text,p_edition text,p_run_id uuid,p_winner_id uuid,p_group_code text,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;n throne_private.runs;q throne_private.questions;z throne_private.results;old jsonb;king uuid;eligible uuid;g text;cnt integer;
 payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'edition',p_edition,'run',p_run_id,'winner',p_winner_id,'group',p_group_code,'version',p_expected_version);
BEGIN
 old:=throne_private.replay(p_request_id,'finalize',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=throne_private.room_for(p_code,p_edition,true,true);PERFORM throne_private.version(r,p_run_id,p_expected_version);
 SELECT * INTO n FROM throne_private.runs WHERE id=r.run_id;SELECT * INTO q FROM throne_private.questions WHERE id=r.current_question_id;
 g:=NULLIF(pg_catalog.upper(pg_catalog.btrim(p_group_code)),'');IF g IS NOT NULL AND g!~'^[A-Z0-9_-]{1,24}$' THEN RAISE EXCEPTION 'Invalid group code' USING ERRCODE='22023';END IF;
 SELECT * INTO z FROM throne_private.results WHERE run_id=n.id;
 IF z.run_id IS NOT NULL THEN
  IF z.winner_id IS DISTINCT FROM p_winner_id OR z.group_code IS DISTINCT FROM g THEN RAISE EXCEPTION 'Run result already recorded' USING ERRCODE='22023';END IF;
 ELSE
  IF n.id IS NULL OR q.closed_at IS NULL OR q.q_index<n.q_total OR NOT EXISTS(SELECT 1 FROM throne_private.resolutions WHERE question_id=q.id AND outcome='win') THEN RAISE EXCEPTION 'Completed run required' USING ERRCODE='42501';END IF;
  king:=n.streak_king_id;
  IF n.closer_id IS NOT NULL THEN eligible:=n.finale_winner;
  ELSE
   IF n.last_winner IS NULL OR king IS NULL THEN RAISE EXCEPTION 'Run has no champion' USING ERRCODE='42501';END IF;
   IF king=n.last_winner OR NOT EXISTS(SELECT 1 FROM throne_private.members WHERE id=king AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '32 seconds') THEN eligible:=n.last_winner;
   ELSIF NOT EXISTS(SELECT 1 FROM throne_private.members WHERE id=n.last_winner AND left_at IS NULL AND last_seen>pg_catalog.clock_timestamp()-interval '32 seconds') THEN eligible:=king;
   ELSE RAISE EXCEPTION 'Finale required' USING ERRCODE='42501';END IF;
  END IF;
  IF eligible IS NULL OR p_winner_id IS DISTINCT FROM eligible THEN RAISE EXCEPTION 'Invalid run winner' USING ERRCODE='22023';END IF;
  PERFORM throne_private.member_ref(eligible,r.id);
  SELECT pg_catalog.count(*) INTO cnt FROM throne_private.members WHERE room_id=r.id AND (left_at IS NULL OR left_at>=n.created_at);
  INSERT INTO throne_private.results(run_id,room_id,edition,winner_id,group_code,name,streak,flawless,questions,players)
   SELECT n.id,r.id,r.edition,eligible,g,m.name,COALESCE((n.best_streak->>eligible::text)::integer,1),NOT(eligible=ANY(n.blemished)),n.q_total,cnt FROM throne_private.members m WHERE m.id=eligible RETURNING * INTO z;
  UPDATE throne_private.runs SET finished_at=pg_catalog.clock_timestamp() WHERE id=n.id;
 END IF;
 UPDATE throne_private.rooms SET phase='gameover',version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=pg_catalog.jsonb_build_object('room',throne_private.room_json(r),'result',pg_catalog.jsonb_build_object('name',z.name,'streak',z.streak,'flawless',z.flawless,'questions',z.questions,'players',z.players,'created_at',z.created_at));
 PERFORM throne_private.remember(p_request_id,'finalize',r.id,payload,old);RETURN old;
END $$;
CREATE FUNCTION public.throne_preview(p_code text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;u uuid:=throne_private.uid();e text:=throne_private.edition(p_edition);
BEGIN
 SELECT * INTO r FROM throne_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) AND edition=e AND expires_at>pg_catalog.clock_timestamp();
 IF r.id IS NULL THEN RETURN NULL;END IF;RETURN pg_catalog.jsonb_build_object('code',r.code,'phase',r.phase,'edition',r.edition);
END $$;
CREATE FUNCTION public.throne_join(p_code text,p_edition text,p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;m throne_private.members;u uuid:=throne_private.uid();nm text:=pg_catalog.btrim(p_name);
BEGIN
 r:=throne_private.room_for(p_code,p_edition,false,true);
 IF nm IS NULL OR pg_catalog.char_length(nm) NOT BETWEEN 1 AND 14 THEN RAISE EXCEPTION 'Name must have 1 to 14 characters' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM throne_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;
 IF m.id IS NOT NULL THEN RETURN throne_private.member_json(m);END IF;
 IF (SELECT pg_catalog.count(*) FROM throne_private.members WHERE room_id=r.id AND left_at IS NULL)>=200 OR (SELECT pg_catalog.count(*) FROM throne_private.members WHERE room_id=r.id)>=2000 THEN RAISE EXCEPTION 'Room player limit reached' USING ERRCODE='54000';END IF;
 INSERT INTO throne_private.members(room_id,user_id,name) VALUES(r.id,u,nm) RETURNING * INTO m;RETURN throne_private.member_json(m);
END $$;
CREATE FUNCTION public.throne_my_membership(p_code text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;m throne_private.members;u uuid:=throne_private.uid();
BEGIN r:=throne_private.room_for(p_code,p_edition,false);SELECT * INTO m FROM throne_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;IF m.id IS NULL THEN RETURN NULL;END IF;RETURN throne_private.member_json(m);END $$;
CREATE FUNCTION public.throne_heartbeat(p_code text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;m throne_private.members;
BEGIN r:=throne_private.room_for(p_code,p_edition,false,true);m:=throne_private.member_for(r.id);UPDATE throne_private.members SET last_seen=pg_catalog.clock_timestamp() WHERE id=m.id RETURNING * INTO m;RETURN throne_private.member_json(m);END $$;
CREATE FUNCTION public.throne_leave(p_code text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;m throne_private.members;u uuid:=throne_private.uid();
BEGIN r:=throne_private.room_for(p_code,p_edition,false,true);SELECT * INTO m FROM throne_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;IF m.id IS NOT NULL THEN UPDATE throne_private.members SET left_at=pg_catalog.clock_timestamp() WHERE id=m.id;END IF;RETURN pg_catalog.jsonb_build_object('left',true);END $$;
CREATE FUNCTION public.throne_player_state(p_code text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;m throne_private.members;b throne_private.buzzes;a throne_private.answers;
BEGIN r:=throne_private.room_for(p_code,p_edition,false);m:=throne_private.member_for(r.id);SELECT * INTO b FROM throne_private.buzzes WHERE question_id=r.current_question_id AND member_id=m.id;SELECT * INTO a FROM throne_private.answers WHERE question_id=r.current_question_id AND member_id=m.id;
 RETURN throne_private.room_json(r)||pg_catalog.jsonb_build_object('receipts',pg_catalog.jsonb_build_object('question_id',r.current_question_id,
 'buzz',CASE WHEN b.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('id',b.id,'question_id',b.question_id,'created_at',b.created_at) END,
 'answer',CASE WHEN a.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('id',a.id,'question_id',a.question_id,'choice',a.choice,'created_at',a.created_at) END));END $$;
CREATE FUNCTION public.throne_buzz(p_code text,p_edition text,p_question_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;m throne_private.members;q throne_private.questions;b throne_private.buzzes;stamp timestamptz;
BEGIN
 r:=throne_private.room_for(p_code,p_edition,false,true);m:=throne_private.member_for(r.id);q:=throne_private.question_for(r,r.run_id,p_question_id);
 SELECT * INTO b FROM throne_private.buzzes WHERE question_id=q.id AND member_id=m.id;
 IF b.id IS NULL THEN
  stamp:=pg_catalog.clock_timestamp();IF r.phase<>'live' OR q.closed_at IS NOT NULL OR q.answerer_id IS NOT NULL OR stamp<q.buzz_open_at OR stamp>=q.buzz_deadline OR m.id NOT IN (q.champ_id,q.chal_id) OR m.id=q.first_missed_id THEN RAISE EXCEPTION 'Buzzer is not open for this player' USING ERRCODE='42501';END IF;
  INSERT INTO throne_private.buzzes(question_id,member_id,created_at) VALUES(q.id,m.id,stamp) RETURNING * INTO b;
 END IF;RETURN pg_catalog.jsonb_build_object('id',b.id,'question_id',b.question_id,'created_at',b.created_at);
END $$;
CREATE FUNCTION public.throne_answer(p_code text,p_edition text,p_question_id uuid,p_choice integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r throne_private.rooms;m throne_private.members;q throne_private.questions;a throne_private.answers;stamp timestamptz;
BEGIN
 r:=throne_private.room_for(p_code,p_edition,false,true);m:=throne_private.member_for(r.id);q:=throne_private.question_for(r,r.run_id,p_question_id);
 IF p_choice IS NULL OR p_choice NOT BETWEEN 0 AND 3 THEN RAISE EXCEPTION 'Invalid choice' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM throne_private.answers WHERE question_id=q.id AND member_id=m.id;
 IF a.id IS NOT NULL THEN IF a.choice<>p_choice THEN RAISE EXCEPTION 'Answer already recorded with another choice' USING ERRCODE='22023';END IF;
 ELSE
  stamp:=pg_catalog.clock_timestamp();IF r.phase<>'live' OR q.closed_at IS NOT NULL OR q.answerer_id IS DISTINCT FROM m.id OR q.answer_deadline IS NULL OR stamp>=q.answer_deadline THEN RAISE EXCEPTION 'This question is not accepting your answer' USING ERRCODE='42501';END IF;
  INSERT INTO throne_private.answers(question_id,member_id,choice,created_at) VALUES(q.id,m.id,p_choice,stamp) RETURNING * INTO a;
 END IF;RETURN pg_catalog.jsonb_build_object('id',a.id,'question_id',a.question_id,'choice',a.choice,'created_at',a.created_at);
END $$;
CREATE FUNCTION public.throne_legends(p_edition text,p_group_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=throne_private.uid();e text:=throne_private.edition(p_edition);g text:=pg_catalog.upper(pg_catalog.btrim(p_group_code));scope text;
BEGIN
 IF g IS NULL OR g!~'^[A-Z0-9_-]{1,24}$' THEN RAISE EXCEPTION 'Group code required' USING ERRCODE='22023';END IF;
 scope:=(CASE WHEN e='bible' THEN 'throne-bible:' ELSE 'throne:' END)||g;
 RETURN(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',z.name,'streak',z.streak,'flawless',z.flawless,'created_at',z.created_at) ORDER BY z.streak DESC,z.created_at DESC),'[]') FROM(
  SELECT name,streak,flawless,created_at FROM public.legends WHERE game=scope
  UNION ALL SELECT name,streak,flawless,created_at FROM throne_private.results WHERE edition=e AND group_code=g
  ORDER BY streak DESC,created_at DESC LIMIT 60)z);
END $$;
-- Explicit object revocations defeat global default grants as well as PUBLIC's
-- default function EXECUTE. Future private objects must repeat these revocations.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA throne_private FROM PUBLIC,anon,authenticated;
DO $api_grants$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'throne\_%' ESCAPE '\' LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $api_grants$;
