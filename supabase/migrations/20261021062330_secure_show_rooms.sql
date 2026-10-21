-- Isolated Bible Show ownership protocol. Apply as one transaction.
-- Host-trusted grading: bounds and ownership do not verify correct answers.
SET LOCAL lock_timeout = '3s';

DO $preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('show_create_room','show_host_resume','show_begin_run','show_host_publish','show_host_members','show_host_answers','show_host_buzzes','show_close_submissions','show_award','show_preview','show_join','show_my_membership','show_heartbeat','show_leave','show_player_state','show_answer','show_buzz')) THEN
  RAISE EXCEPTION 'Show API name already exists; review target before applying';
 END IF;
END; $preflight$;

CREATE SCHEMA show_private;
REVOKE ALL ON SCHEMA show_private FROM PUBLIC, anon, authenticated;

CREATE TABLE show_private.rooms (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  code text UNIQUE NOT NULL CHECK (code ~ '^[A-Z2-9]{5}$'),
  host_user_id uuid NOT NULL,
  seed integer NOT NULL CHECK (seed >= 0),
  phase text NOT NULL DEFAULT 'lobby' CHECK (phase IN ('lobby','round_intro','question','reveal','buzzer','fiveclues','round_scores','final','closing')),
  run_id uuid,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  round_type text CHECK (round_type IN ('rapidfire','verse','buzzer','fiveclues')),
  round_index integer CHECK (round_index BETWEEN 0 AND 3),
  q_index integer CHECK (q_index BETWEEN 0 AND 11),
  q_id text NOT NULL DEFAULT '',
  current_question_id uuid,
  deadline timestamptz,
  state jsonb NOT NULL DEFAULT '{"teams":{"youth":"Team A","adult":"Team B"},"bible":"KJV"}',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (pg_catalog.clock_timestamp() + interval '12 hours')
);
CREATE INDEX rooms_host_active ON show_private.rooms(host_user_id, expires_at);

CREATE TABLE show_private.members (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES show_private.rooms(id),
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (pg_catalog.char_length(name) BETWEEN 1 AND 16),
  tag text NOT NULL CHECK (tag IN ('youth','adult')),
  score bigint NOT NULL DEFAULT 0 CHECK (score >= 0),
  joined_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_seen timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  left_at timestamptz
);
CREATE UNIQUE INDEX members_one_active_identity ON show_private.members(room_id,user_id) WHERE left_at IS NULL;
CREATE INDEX members_roster ON show_private.members(room_id,joined_at,id) WHERE left_at IS NULL;
CREATE INDEX members_history ON show_private.members(room_id,joined_at,id);

CREATE TABLE show_private.questions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES show_private.rooms(id),
  run_id uuid NOT NULL,
  question_key text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('rapidfire','verse','buzzer','fiveclues')),
  accepting boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  closed_at timestamptz,
  closed_answers jsonb,
  UNIQUE(room_id,question_key)
);
ALTER TABLE show_private.rooms ADD CONSTRAINT rooms_current_question_fk
  FOREIGN KEY(current_question_id) REFERENCES show_private.questions(id);

CREATE TABLE show_private.answers (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES show_private.questions(id),
  member_id uuid NOT NULL REFERENCES show_private.members(id),
  choice integer NOT NULL CHECK (choice BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(question_id,member_id)
);
CREATE INDEX answers_question_order ON show_private.answers(question_id,created_at,id);
CREATE TABLE show_private.buzzes (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES show_private.questions(id),
  member_id uuid NOT NULL REFERENCES show_private.members(id),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE(question_id,member_id)
);
CREATE INDEX buzzes_question_order ON show_private.buzzes(question_id,created_at,id);
CREATE TABLE show_private.awards (
  question_id uuid NOT NULL REFERENCES show_private.questions(id),
  member_id uuid NOT NULL REFERENCES show_private.members(id),
  tag text NOT NULL CHECK (tag IN ('youth','adult')),
  mode text NOT NULL CHECK (mode IN ('rapidfire','verse','buzzer','fiveclues')),
  points integer NOT NULL CHECK (points BETWEEN 1 AND 15),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY(question_id,member_id)
);
CREATE UNIQUE INDEX awards_one_buzzer_winner_per_team ON show_private.awards(question_id,tag) WHERE mode='buzzer';
CREATE TABLE show_private.requests (
  user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  operation text NOT NULL,
  room_id uuid NOT NULL REFERENCES show_private.rooms(id),
  payload_hash bytea NOT NULL CHECK (pg_catalog.octet_length(payload_hash)=32),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY(user_id,request_id)
);
CREATE INDEX requests_room_budget ON show_private.requests(room_id);

ALTER TABLE show_private.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_private.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_private.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_private.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_private.buzzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_private.awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA show_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA show_private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA show_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA show_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION show_private.uid() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Verified guest session required' USING ERRCODE='42501'; END IF;
  RETURN u;
END; $$;

CREATE FUNCTION show_private.room_for(p_code text,p_host boolean,p_lock boolean DEFAULT false)
RETURNS show_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r show_private.rooms; u uuid := show_private.uid();
BEGIN
  IF p_lock THEN
    SELECT * INTO r FROM show_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) FOR UPDATE;
  ELSE
    SELECT * INTO r FROM show_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code));
  END IF;
  IF r.id IS NULL OR r.expires_at <= pg_catalog.clock_timestamp() OR (p_host AND r.host_user_id<>u) THEN
    RAISE EXCEPTION 'Show room unavailable' USING ERRCODE='42501';
  END IF;
  RETURN r;
END; $$;

CREATE FUNCTION show_private.member_for(p_room_id uuid) RETURNS show_private.members LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m show_private.members; u uuid := show_private.uid();
BEGIN
  SELECT * INTO m FROM show_private.members WHERE room_id=p_room_id AND user_id=u AND left_at IS NULL;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Active room membership required' USING ERRCODE='42501'; END IF;
  RETURN m;
END; $$;

CREATE FUNCTION show_private.room_json(r show_private.rooms) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',r.id,'code',r.code,'seed',r.seed,'phase',r.phase,'run_id',r.run_id,'version',r.version,
  'round_type',r.round_type,'round_index',r.round_index,'q_index',r.q_index,'q_id',r.q_id,'deadline',r.deadline,'state',r.state,'expires_at',r.expires_at)
$$;
CREATE FUNCTION show_private.member_json(m show_private.members) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',m.id,'name',m.name,'tag',m.tag,'score',m.score,'joined_at',m.joined_at,'last_seen',m.last_seen)
$$;
CREATE FUNCTION show_private.answer_rows(p_question_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('player_id',m.id,'tag',m.tag,'choice',a.choice,'created_at',a.created_at,'q_id',q.question_key)
  ORDER BY a.created_at,a.id),'[]'::jsonb)
 FROM show_private.answers a JOIN show_private.members m ON m.id=a.member_id JOIN show_private.questions q ON q.id=a.question_id WHERE a.question_id=p_question_id
$$;

CREATE FUNCTION show_private.replay(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v show_private.requests; u uuid := show_private.uid();
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
  SELECT * INTO v FROM show_private.requests WHERE user_id=u AND request_id=p_request_id;
  IF v.request_id IS NULL THEN RETURN NULL; END IF;
  IF v.operation<>p_operation OR v.payload_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')) THEN RAISE EXCEPTION 'Request UUID reused with different input' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM show_private.rooms WHERE id=v.room_id AND host_user_id=u AND expires_at>pg_catalog.clock_timestamp()) THEN
    RAISE EXCEPTION 'Show room unavailable' USING ERRCODE='42501';
  END IF;
  RETURN v.response;
END; $$;
CREATE FUNCTION show_private.remember(p_request_id uuid,p_operation text,p_room_id uuid,p_payload jsonb,p_response jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (SELECT pg_catalog.count(*) FROM show_private.requests WHERE room_id=p_room_id)>=20000 THEN
  RAISE EXCEPTION 'Room host-operation budget reached' USING ERRCODE='54000';
 END IF;
 INSERT INTO show_private.requests(user_id,request_id,operation,room_id,payload_hash,response)
 VALUES(show_private.uid(),p_request_id,p_operation,p_room_id,pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),p_response);
END;
$$;

CREATE FUNCTION show_private.txt(o jsonb,k text,n integer,required boolean DEFAULT true) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;
BEGIN
  IF o->k IS NULL OR o->k='null'::jsonb THEN
    IF required THEN RAISE EXCEPTION 'Missing field %',k USING ERRCODE='22023'; END IF;
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_typeof(o->k)<>'string' THEN RAISE EXCEPTION 'Invalid text field %',k USING ERRCODE='22023'; END IF;
  v:=o->>k;
  IF pg_catalog.char_length(v)>n OR (required AND pg_catalog.char_length(v)=0) THEN RAISE EXCEPTION 'Invalid length for %',k USING ERRCODE='22023'; END IF;
  RETURN v;
END; $$;
CREATE FUNCTION show_private.num(o jsonb,k text,lo integer,hi integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v integer;
BEGIN
  IF pg_catalog.jsonb_typeof(o->k) IS DISTINCT FROM 'number' OR (o->>k) !~ '^[0-9]+$' OR pg_catalog.char_length(o->>k)>9 THEN
    RAISE EXCEPTION 'Invalid integer field %',k USING ERRCODE='22023';
  END IF;
  v:=(o->>k)::integer;
  IF v<lo OR v>hi THEN RAISE EXCEPTION 'Out of range field %',k USING ERRCODE='22023'; END IF;
  RETURN v;
END; $$;
CREATE FUNCTION show_private.flag(o jsonb,k text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF pg_catalog.jsonb_typeof(o->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid boolean field %',k USING ERRCODE='22023'; END IF;
 RETURN (o->>k)::boolean;
END; $$;
CREATE FUNCTION show_private.options(o jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v jsonb;
BEGIN
 IF pg_catalog.jsonb_typeof(o->'opts') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(o->'opts')<>4 THEN
   RAISE EXCEPTION 'Exactly four options required' USING ERRCODE='22023';
 END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(o->'opts') LOOP
  IF pg_catalog.jsonb_typeof(v)<>'string' OR pg_catalog.char_length(v#>>'{}') NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION 'Invalid option' USING ERRCODE='22023';
  END IF;
 END LOOP;
 RETURN o->'opts';
END; $$;

CREATE FUNCTION show_private.lane(p_lane jsonb,p_room_id uuid,p_question_id uuid,p_tag text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE st text; bid uuid; m show_private.members; outs jsonb; x jsonb; dl timestamptz; win text;
BEGIN
 IF pg_catalog.jsonb_typeof(p_lane) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid buzzer lane' USING ERRCODE='22023'; END IF;
 st:=show_private.txt(p_lane,'st',12);
 IF st NOT IN ('open','answering','done') THEN RAISE EXCEPTION 'Invalid lane state' USING ERRCODE='22023'; END IF;
 IF p_lane->'bid' IS NOT NULL AND p_lane->'bid'<>'null'::jsonb THEN
  bid:=show_private.txt(p_lane,'bid',36)::uuid;
  SELECT * INTO m FROM show_private.members WHERE id=bid AND room_id=p_room_id AND tag=p_tag;
  IF m.id IS NULL OR NOT EXISTS(SELECT 1 FROM show_private.buzzes WHERE question_id=p_question_id AND member_id=bid) THEN
   RAISE EXCEPTION 'Lane player must have buzzed in this room/team' USING ERRCODE='22023';
  END IF;
 END IF;
 outs:=p_lane->'out';
 IF pg_catalog.jsonb_typeof(outs) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(outs)>200 THEN
  RAISE EXCEPTION 'Invalid lane exclusions' USING ERRCODE='22023';
 END IF;
 FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(outs) LOOP
  IF pg_catalog.jsonb_typeof(x)<>'string' OR NOT EXISTS(SELECT 1 FROM show_private.members WHERE id=(x#>>'{}')::uuid AND room_id=p_room_id AND tag=p_tag) THEN
   RAISE EXCEPTION 'Invalid excluded player' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF st='answering' AND (bid IS NULL OR outs ? bid::text) THEN RAISE EXCEPTION 'Invalid answering player' USING ERRCODE='22023'; END IF;
 IF p_lane->'adl' IS NOT NULL AND p_lane->'adl'<>'null'::jsonb THEN dl:=show_private.txt(p_lane,'adl',50)::timestamptz; END IF;
 win:=show_private.txt(p_lane,'win',16,false);
 IF win IS NOT NULL AND (st<>'done' OR bid IS NULL OR win<>m.name) THEN RAISE EXCEPTION 'Invalid lane winner' USING ERRCODE='22023'; END IF;
 RETURN pg_catalog.jsonb_build_object('st',st,'bid',bid,'bname',m.name,'adl',dl,'out',outs,'win',win);
END; $$;

CREATE FUNCTION show_private.finale(p_room_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH teams AS (SELECT t.tag,
   COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',s.name,'score',s.score) ORDER BY s.score DESC,s.joined_at,s.id)
    FROM (SELECT m.* FROM show_private.members m WHERE m.room_id=p_room_id AND m.tag=t.tag AND m.left_at IS NULL ORDER BY m.score DESC,m.joined_at,m.id LIMIT 3) s),'[]'::jsonb) top,
   (SELECT COALESCE(pg_catalog.sum(m.score),0) FROM show_private.members m WHERE m.room_id=p_room_id AND m.tag=t.tag AND m.left_at IS NULL) total,
   (SELECT pg_catalog.count(*) FROM show_private.members m WHERE m.room_id=p_room_id AND m.tag=t.tag AND m.left_at IS NULL) count
  FROM (VALUES('youth'),('adult')) t(tag)),
 y AS (SELECT * FROM teams WHERE tag='youth'), a AS (SELECT * FROM teams WHERE tag='adult')
 SELECT pg_catalog.jsonb_build_object('youth',pg_catalog.jsonb_build_object('top',y.top,'total',y.total,'count',y.count),
  'adult',pg_catalog.jsonb_build_object('top',a.top,'total',a.total,'count',a.count),
  'teamWin',CASE WHEN y.count+a.count=0 THEN NULL WHEN y.total>a.total THEN 'youth' WHEN a.total>y.total THEN 'adult' ELSE 'tie' END) FROM y,a
$$;

CREATE FUNCTION show_private.clean_state(p_phase text,s jsonb,p_room_id uuid,p_question_id uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE o jsonb; b jsonb; f jsonb; t jsonb; bp text; fp text; k text; n integer; x jsonb;
BEGIN
 IF pg_catalog.jsonb_typeof(s) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'State object required' USING ERRCODE='22023'; END IF;
 t:=s->'teams';
 o:=pg_catalog.jsonb_build_object('teams',pg_catalog.jsonb_build_object('youth',show_private.txt(t,'youth',16),'adult',show_private.txt(t,'adult',16)),
  'bible',show_private.txt(s,'bible',3));
 IF s->>'bible' NOT IN ('KJV','NIV') THEN RAISE EXCEPTION 'Invalid Bible version' USING ERRCODE='22023'; END IF;
 IF p_phase='lobby' THEN RETURN o; END IF;
 o:=o||pg_catalog.jsonb_build_object('round',show_private.txt(s,'round',120));
 IF p_phase='round_intro' THEN RETURN o||pg_catalog.jsonb_build_object('rules',show_private.txt(s,'rules',1500)); END IF;
 IF p_phase='round_scores' THEN RETURN o; END IF;
 IF p_phase='final' THEN RETURN o||pg_catalog.jsonb_build_object('fin',show_private.finale(p_room_id)); END IF;
 IF p_phase='closing' THEN RETURN o||pg_catalog.jsonb_build_object('close',pg_catalog.jsonb_build_object('ref',show_private.txt(s->'close','ref',100),'text',show_private.txt(s->'close','text',2000))); END IF;
 o:=o||pg_catalog.jsonb_build_object('qnum',show_private.num(s,'qnum',1,12),'qtotal',show_private.num(s,'qtotal',1,12));
 IF (s->>'qnum')::integer>(s->>'qtotal')::integer THEN RAISE EXCEPTION 'Question count mismatch' USING ERRCODE='22023'; END IF;
 IF p_phase IN ('question','reveal') THEN
  k:=show_private.txt(s,'qkind',16);
  IF k NOT IN ('mc','verse-blank','verse-ref') THEN RAISE EXCEPTION 'Invalid question kind' USING ERRCODE='22023'; END IF;
  o:=o||pg_catalog.jsonb_build_object('opts',show_private.options(s),'live',show_private.flag(s,'live'),'qkind',k,'qtext',show_private.txt(s,'qtext',2000));
  IF s ? 'prompt' THEN o:=o||pg_catalog.jsonb_build_object('prompt',show_private.txt(s,'prompt',200,false)); END IF;
  IF p_phase='reveal' THEN o:=o||pg_catalog.jsonb_build_object('correct',show_private.num(s,'correct',0,3)); END IF;
  RETURN o;
 ELSIF p_phase='buzzer' THEN
  b:=s->'bz'; bp:=show_private.txt(b,'phase',10);
  IF bp NOT IN ('arm','open','reveal') THEN RAISE EXCEPTION 'Invalid buzzer phase' USING ERRCODE='22023'; END IF;
  b:=pg_catalog.jsonb_build_object('phase',bp,'opts',show_private.options(b),'correct',CASE WHEN bp='reveal' THEN show_private.num(b,'correct',0,3) END,
   'live',show_private.flag(b,'live'),'qtext',show_private.txt(b,'qtext',2000),'lanes',pg_catalog.jsonb_build_object(
    'youth',show_private.lane(b->'lanes'->'youth',p_room_id,p_question_id,'youth'),
    'adult',show_private.lane(b->'lanes'->'adult',p_room_id,p_question_id,'adult')));
  RETURN o||pg_catalog.jsonb_build_object('bz',b);
 ELSIF p_phase='fiveclues' THEN
  f:=s->'fc'; fp:=show_private.txt(f,'phase',10); n:=show_private.num(f,'clueIdx',0,4);
  IF fp NOT IN ('clue','reveal') OR pg_catalog.jsonb_typeof(f->'clues') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(f->'clues')<>n+1 THEN
   RAISE EXCEPTION 'Invalid clue state' USING ERRCODE='22023';
  END IF;
  FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(f->'clues') LOOP
   IF pg_catalog.jsonb_typeof(x)<>'string' OR pg_catalog.char_length(x#>>'{}') NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Invalid clue' USING ERRCODE='22023'; END IF;
  END LOOP;
  RETURN o||pg_catalog.jsonb_build_object('fc',pg_catalog.jsonb_build_object('phase',fp,'opts',show_private.options(f),'clueIdx',n,'pointsNow',5-n,
   'correct',CASE WHEN fp='reveal' THEN show_private.num(f,'correct',0,3) END,'live',show_private.flag(f,'live'),'cat',show_private.txt(f,'cat',60),'clues',f->'clues'));
 END IF;
 RAISE EXCEPTION 'Unsupported phase' USING ERRCODE='22023';
END; $$;

CREATE FUNCTION public.show_create_room(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms; u uuid:=show_private.uid(); old jsonb; c text; alpha constant text:='ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i integer; attempt integer;
BEGIN
 old:=show_private.replay(p_request_id,'create','{}'); IF old IS NOT NULL THEN RETURN old; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('show-create:'||u::text,0));
 IF (SELECT pg_catalog.count(*) FROM show_private.rooms WHERE host_user_id=u AND expires_at>pg_catalog.clock_timestamp())>=5 THEN
  RAISE EXCEPTION 'Active room limit reached' USING ERRCODE='54000';
 END IF;
 FOR attempt IN 1..20 LOOP
  c:=''; FOR i IN 0..4 LOOP c:=c||pg_catalog.substr(alpha,1+(pg_catalog.get_byte(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()),i)%pg_catalog.char_length(alpha)),1); END LOOP;
  INSERT INTO show_private.rooms(code,host_user_id,seed) VALUES(c,u,pg_catalog.floor(pg_catalog.random()*1000000000)::integer) ON CONFLICT(code) DO NOTHING RETURNING * INTO r;
  EXIT WHEN r.id IS NOT NULL;
 END LOOP;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Could not allocate room' USING ERRCODE='54000'; END IF;
 old:=show_private.room_json(r); PERFORM show_private.remember(p_request_id,'create',r.id,'{}',old); RETURN old;
END; $$;

CREATE FUNCTION public.show_host_resume(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN show_private.room_json(show_private.room_for(p_code,true)); END; $$;

CREATE FUNCTION public.show_begin_run(p_code text,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms; old jsonb; payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'version',p_expected_version);
BEGIN
 old:=show_private.replay(p_request_id,'begin_run',payload); IF old IS NOT NULL THEN RETURN old; END IF;
 r:=show_private.room_for(p_code,true,true);
 IF p_expected_version IS NULL OR r.version<>p_expected_version THEN RAISE EXCEPTION 'Stale host version' USING ERRCODE='PT409'; END IF;
 UPDATE show_private.questions SET accepting=false,closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()) WHERE room_id=r.id AND closed_at IS NULL;
 UPDATE show_private.rooms SET run_id=pg_catalog.gen_random_uuid(),phase='lobby',round_type=NULL,round_index=NULL,q_index=NULL,q_id='',current_question_id=NULL,deadline=NULL,
  state=pg_catalog.jsonb_build_object('teams',r.state->'teams','bible',r.state->'bible'),version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=show_private.room_json(r); PERFORM show_private.remember(p_request_id,'begin_run',r.id,payload,old); RETURN old;
END; $$;

CREATE FUNCTION public.show_host_publish(p_code text,p_run_id uuid,p_patch jsonb,p_expected_version bigint,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms; q show_private.questions; old jsonb; payload jsonb; ph text; typ text; ri integer; qi integer; key text; qs uuid; st jsonb; v_accepting boolean; dl timestamptz;
BEGIN
 IF pg_catalog.jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(p_patch::text)>32768 OR EXISTS(
   SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) k WHERE k NOT IN ('phase','round_type','round_index','q_index','q_id','deadline','state','updated_at')) THEN
  RAISE EXCEPTION 'Invalid room patch' USING ERRCODE='22023';
 END IF;
 payload:=pg_catalog.jsonb_build_object('code',p_code,'run_id',p_run_id,'patch',p_patch,'version',p_expected_version);
 old:=show_private.replay(p_request_id,'publish',payload); IF old IS NOT NULL THEN RETURN old; END IF;
 r:=show_private.room_for(p_code,true,true);
 IF p_expected_version IS NULL OR r.version<>p_expected_version THEN RAISE EXCEPTION 'Stale host version' USING ERRCODE='PT409'; END IF;
 IF r.run_id IS DISTINCT FROM p_run_id THEN RAISE EXCEPTION 'Stale show run' USING ERRCODE='22023'; END IF;
 ph:=COALESCE(show_private.txt(p_patch,'phase',20,false),r.phase);
 IF ph NOT IN ('lobby','round_intro','question','reveal','buzzer','fiveclues','round_scores','final','closing') THEN RAISE EXCEPTION 'Invalid room phase' USING ERRCODE='22023'; END IF;
 typ:=COALESCE(show_private.txt(p_patch,'round_type',12,false),r.round_type);
 IF typ IS NOT NULL AND typ NOT IN ('rapidfire','verse','buzzer','fiveclues') THEN RAISE EXCEPTION 'Invalid round type' USING ERRCODE='22023'; END IF;
 ri:=CASE WHEN p_patch ? 'round_index' THEN show_private.num(p_patch,'round_index',0,3) ELSE r.round_index END;
 qi:=CASE WHEN p_patch ? 'q_index' THEN show_private.num(p_patch,'q_index',0,11) ELSE r.q_index END;
 key:=CASE WHEN p_patch ? 'q_id' THEN show_private.txt(p_patch,'q_id',60,false) ELSE r.q_id END; key:=COALESCE(key,'');
 dl:=r.deadline; IF p_patch ? 'deadline' THEN dl:=show_private.txt(p_patch,'deadline',50,false)::timestamptz; END IF;
 IF ph IN ('question','reveal','buzzer','fiveclues') THEN
  IF r.run_id IS NULL OR ri IS NULL OR qi IS NULL OR key<>r.run_id::text||':p'||ri::text||'q'||qi::text THEN RAISE EXCEPTION 'Invalid current question key' USING ERRCODE='22023'; END IF;
  IF typ IS NULL OR (ph IN ('question','reveal') AND typ NOT IN ('rapidfire','verse')) OR (ph='buzzer' AND typ IS DISTINCT FROM 'buzzer') OR (ph='fiveclues' AND typ IS DISTINCT FROM 'fiveclues') THEN
   RAISE EXCEPTION 'Question mode mismatch' USING ERRCODE='22023';
  END IF;
  SELECT * INTO q FROM show_private.questions WHERE room_id=r.id AND question_key=key;
  IF q.id IS NULL THEN
   IF ph='reveal' OR (ph='buzzer' AND p_patch->'state'->'bz'->>'phase'='reveal') OR (ph='fiveclues' AND p_patch->'state'->'fc'->>'phase'='reveal') THEN
    RAISE EXCEPTION 'Cannot reveal an unopened question' USING ERRCODE='22023';
   END IF;
   INSERT INTO show_private.questions(room_id,run_id,question_key,mode) VALUES(r.id,r.run_id,key,typ) RETURNING * INTO q;
  ELSIF r.current_question_id IS DISTINCT FROM q.id THEN RAISE EXCEPTION 'Cannot reopen an old question' USING ERRCODE='22023';
  END IF;
  IF q.run_id<>r.run_id OR q.mode<>typ THEN RAISE EXCEPTION 'Question scope mismatch' USING ERRCODE='22023'; END IF;
  qs:=q.id;
 ELSE
  IF key<>'' THEN RAISE EXCEPTION 'Nonquestion phase requires empty question key' USING ERRCODE='22023'; END IF;
  qs:=NULL;
 END IF;
 st:=show_private.clean_state(ph,p_patch->'state',r.id,qs);
 v_accepting:=ph='question' OR (ph='fiveclues' AND st->'fc'->>'phase'='clue') OR (ph='buzzer' AND st->'bz'->>'phase'='open');
 IF qs IS NOT NULL AND q.closed_at IS NOT NULL AND (ph='question' OR (ph='fiveclues' AND st->'fc'->>'phase'='clue') OR (ph='buzzer' AND st->'bz'->>'phase' IN ('arm','open'))) THEN
  RAISE EXCEPTION 'Cannot reopen a closed question' USING ERRCODE='22023';
 END IF;
 IF r.current_question_id IS NOT NULL AND r.current_question_id IS DISTINCT FROM qs THEN
  UPDATE show_private.questions SET accepting=false,closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()) WHERE id=r.current_question_id;
 END IF;
 IF qs IS NOT NULL THEN
  UPDATE show_private.questions SET accepting=v_accepting AND closed_at IS NULL,
   closed_at=CASE WHEN ph='reveal' OR (ph='buzzer' AND st->'bz'->>'phase'='reveal') OR (ph='fiveclues' AND st->'fc'->>'phase'='reveal') THEN COALESCE(closed_at,pg_catalog.clock_timestamp()) ELSE closed_at END WHERE id=qs;
 END IF;
 UPDATE show_private.rooms SET phase=ph,round_type=typ,round_index=ri,q_index=qi,q_id=key,current_question_id=qs,deadline=dl,state=st,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=show_private.room_json(r); PERFORM show_private.remember(p_request_id,'publish',r.id,payload,old); RETURN old;
END; $$;

CREATE FUNCTION public.show_host_members(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,true); result jsonb;
BEGIN
 SELECT COALESCE(pg_catalog.jsonb_agg(show_private.member_json(m) ORDER BY m.joined_at,m.id),'[]'::jsonb) INTO result FROM show_private.members m WHERE room_id=r.id AND left_at IS NULL;
 RETURN result;
END; $$;
CREATE FUNCTION public.show_host_answers(p_code text,p_run_id uuid,p_question_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,true); q show_private.questions;
BEGIN
 SELECT * INTO q FROM show_private.questions WHERE room_id=r.id AND run_id=p_run_id AND question_key=p_question_key;
 IF q.id IS NULL OR r.run_id IS DISTINCT FROM p_run_id THEN RAISE EXCEPTION 'Question unavailable' USING ERRCODE='42501'; END IF;
 RETURN show_private.answer_rows(q.id);
END; $$;
CREATE FUNCTION public.show_host_buzzes(p_code text,p_run_id uuid,p_question_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,true); q show_private.questions; result jsonb;
BEGIN
 SELECT * INTO q FROM show_private.questions WHERE room_id=r.id AND run_id=p_run_id AND question_key=p_question_key;
 IF q.id IS NULL OR r.run_id IS DISTINCT FROM p_run_id THEN RAISE EXCEPTION 'Question unavailable' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('player_id',m.id,'name',m.name,'tag',m.tag,'created_at',b.created_at,'q_id',q.question_key) ORDER BY b.created_at,b.id),'[]'::jsonb)
 INTO result FROM show_private.buzzes b JOIN show_private.members m ON m.id=b.member_id WHERE b.question_id=q.id;
 RETURN result;
END; $$;

CREATE FUNCTION public.show_close_submissions(p_code text,p_run_id uuid,p_question_key text,p_expected_version bigint,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms; q show_private.questions; old jsonb; payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'run_id',p_run_id,'question',p_question_key,'version',p_expected_version);
BEGIN
 old:=show_private.replay(p_request_id,'close',payload); IF old IS NOT NULL THEN RETURN old; END IF;
 r:=show_private.room_for(p_code,true,true);
 IF p_expected_version IS NULL OR r.version<>p_expected_version THEN RAISE EXCEPTION 'Stale host version' USING ERRCODE='PT409'; END IF;
 SELECT * INTO q FROM show_private.questions WHERE id=r.current_question_id AND run_id=p_run_id AND question_key=p_question_key;
 IF q.id IS NULL OR r.run_id IS DISTINCT FROM p_run_id THEN RAISE EXCEPTION 'Question unavailable' USING ERRCODE='42501'; END IF;
 UPDATE show_private.questions SET accepting=false,closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()),closed_answers=COALESCE(closed_answers,show_private.answer_rows(q.id)) WHERE id=q.id RETURNING * INTO q;
 UPDATE show_private.rooms SET version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 old:=pg_catalog.jsonb_build_object('room',show_private.room_json(r),'answers',q.closed_answers);
 PERFORM show_private.remember(p_request_id,'close',r.id,payload,old); RETURN old;
END; $$;

CREATE FUNCTION public.show_award(p_code text,p_run_id uuid,p_question_key text,p_member_id uuid,p_points integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,true,true); q show_private.questions; m show_private.members; a show_private.awards;
BEGIN
 SELECT * INTO q FROM show_private.questions WHERE room_id=r.id AND run_id=p_run_id AND question_key=p_question_key;
 SELECT * INTO m FROM show_private.members WHERE id=p_member_id AND room_id=r.id;
 IF q.id IS NULL OR m.id IS NULL THEN RAISE EXCEPTION 'Award target unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM show_private.awards WHERE question_id=q.id AND member_id=m.id;
 IF a.question_id IS NOT NULL THEN
  IF a.points IS DISTINCT FROM p_points THEN RAISE EXCEPTION 'Conflicting repeated award' USING ERRCODE='23505'; END IF;
  RETURN pg_catalog.jsonb_build_object('member_id',m.id,'score',m.score,'points',a.points,'already_awarded',true);
 END IF;
 IF r.run_id IS DISTINCT FROM p_run_id OR r.current_question_id IS DISTINCT FROM q.id OR NOT EXISTS(SELECT 1 FROM show_private.answers WHERE question_id=q.id AND member_id=m.id) THEN
  RAISE EXCEPTION 'Current answered membership required' USING ERRCODE='42501';
 END IF;
 IF p_points IS NULL OR (q.mode IN ('rapidfire','verse') AND p_points NOT BETWEEN 10 AND 15) OR (q.mode='buzzer' AND p_points<>10) OR (q.mode='fiveclues' AND p_points NOT BETWEEN 1 AND 5) THEN
  RAISE EXCEPTION 'Invalid award points' USING ERRCODE='22023';
 END IF;
 IF m.left_at IS NOT NULL THEN
  RETURN pg_catalog.jsonb_build_object('member_id',m.id,'score',m.score,'points',0,'already_awarded',false,'skipped_member_left',true);
 END IF;
 INSERT INTO show_private.awards(question_id,member_id,tag,mode,points) VALUES(q.id,m.id,m.tag,q.mode,p_points);
 UPDATE show_private.members SET score=score+p_points WHERE id=m.id RETURNING * INTO m;
 RETURN pg_catalog.jsonb_build_object('member_id',m.id,'score',m.score,'points',p_points,'already_awarded',false);
END; $$;

CREATE FUNCTION public.show_preview(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms;
BEGIN
 PERFORM show_private.uid(); SELECT * INTO r FROM show_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) AND expires_at>pg_catalog.clock_timestamp();
 IF r.id IS NULL THEN RETURN NULL; END IF;
 RETURN pg_catalog.jsonb_build_object('code',r.code,'phase',r.phase,'state',pg_catalog.jsonb_build_object('teams',r.state->'teams','bible',r.state->'bible'));
END; $$;
CREATE FUNCTION public.show_join(p_code text,p_name text,p_tag text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,false,true); m show_private.members; u uuid:=show_private.uid(); nm text:=pg_catalog.btrim(p_name);
BEGIN
 IF nm IS NULL OR pg_catalog.char_length(nm) NOT BETWEEN 1 AND 16 OR p_tag IS NULL OR p_tag NOT IN ('youth','adult') THEN RAISE EXCEPTION 'Invalid name or team' USING ERRCODE='22023'; END IF;
 SELECT * INTO m FROM show_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;
 IF m.id IS NULL THEN
  IF (SELECT pg_catalog.count(*) FROM show_private.members WHERE room_id=r.id AND left_at IS NULL)>=200 THEN RAISE EXCEPTION 'Room is full' USING ERRCODE='54000'; END IF;
  IF (SELECT pg_catalog.count(*) FROM show_private.members WHERE room_id=r.id)>=2000 THEN RAISE EXCEPTION 'Room membership budget reached' USING ERRCODE='54000'; END IF;
  INSERT INTO show_private.members(room_id,user_id,name,tag) VALUES(r.id,u,nm,p_tag) RETURNING * INTO m;
 END IF;
 RETURN show_private.member_json(m);
END; $$;
CREATE FUNCTION public.show_my_membership(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,false); m show_private.members; u uuid:=show_private.uid();
BEGIN
 SELECT * INTO m FROM show_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;
 IF m.id IS NULL THEN RETURN NULL; END IF; RETURN show_private.member_json(m);
END; $$;
CREATE FUNCTION public.show_heartbeat(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,false); m show_private.members:=show_private.member_for(r.id);
BEGIN
 UPDATE show_private.members SET last_seen=pg_catalog.clock_timestamp() WHERE id=m.id AND left_at IS NULL RETURNING * INTO m;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Active membership required' USING ERRCODE='42501'; END IF;
 RETURN show_private.member_json(m);
END; $$;
CREATE FUNCTION public.show_leave(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,false,true); u uuid:=show_private.uid();
BEGIN
 UPDATE show_private.members SET left_at=pg_catalog.clock_timestamp() WHERE room_id=r.id AND user_id=u AND left_at IS NULL;
 RETURN '{"left":true}'::jsonb;
END; $$;
CREATE FUNCTION public.show_player_state(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,false);
BEGIN PERFORM show_private.member_for(r.id); RETURN show_private.room_json(r); END; $$;

CREATE FUNCTION public.show_answer(p_code text,p_question_key text,p_choice integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,false,true); m show_private.members:=show_private.member_for(r.id); q show_private.questions; a show_private.answers; lane jsonb;
BEGIN
 IF p_choice IS NULL OR p_choice NOT BETWEEN 0 AND 3 THEN RAISE EXCEPTION 'Invalid answer choice' USING ERRCODE='22023'; END IF;
 SELECT * INTO q FROM show_private.questions WHERE room_id=r.id AND question_key=p_question_key;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Question unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM show_private.answers WHERE question_id=q.id AND member_id=m.id;
 IF a.id IS NOT NULL THEN
  IF a.choice<>p_choice THEN RAISE EXCEPTION 'Answer already recorded' USING ERRCODE='23505'; END IF;
 ELSE
  IF q.id IS DISTINCT FROM r.current_question_id OR q.run_id IS DISTINCT FROM r.run_id OR NOT q.accepting OR q.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Question is closed' USING ERRCODE='42501'; END IF;
  IF q.mode IN ('rapidfire','verse') THEN
   IF r.phase<>'question' THEN RAISE EXCEPTION 'Question is not accepting answers' USING ERRCODE='42501'; END IF;
  ELSIF q.mode='fiveclues' THEN
   IF r.phase<>'fiveclues' OR r.state->'fc'->>'phase' IS DISTINCT FROM 'clue' THEN RAISE EXCEPTION 'Clue question is closed' USING ERRCODE='42501'; END IF;
  ELSE
   lane:=r.state->'bz'->'lanes'->m.tag;
   IF r.phase<>'buzzer' OR r.state->'bz'->>'phase' IS DISTINCT FROM 'open' OR lane->>'st' IS DISTINCT FROM 'answering' OR lane->>'bid' IS DISTINCT FROM m.id::text OR (lane->'out') ? m.id::text THEN
    RAISE EXCEPTION 'Only the selected buzzer player may answer' USING ERRCODE='42501';
   END IF;
  END IF;
  INSERT INTO show_private.answers(question_id,member_id,choice) VALUES(q.id,m.id,p_choice) RETURNING * INTO a;
 END IF;
 RETURN pg_catalog.jsonb_build_object('player_id',m.id,'tag',m.tag,'choice',a.choice,'created_at',a.created_at,'q_id',q.question_key);
END; $$;
CREATE FUNCTION public.show_buzz(p_code text,p_question_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r show_private.rooms:=show_private.room_for(p_code,false,true); m show_private.members:=show_private.member_for(r.id); q show_private.questions; b show_private.buzzes; lane jsonb;
BEGIN
 SELECT * INTO q FROM show_private.questions WHERE room_id=r.id AND question_key=p_question_key;
 IF q.id IS NULL THEN RAISE EXCEPTION 'Question unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM show_private.buzzes WHERE question_id=q.id AND member_id=m.id;
 IF b.id IS NULL THEN
  lane:=r.state->'bz'->'lanes'->m.tag;
  IF q.id IS DISTINCT FROM r.current_question_id OR q.run_id IS DISTINCT FROM r.run_id OR q.mode<>'buzzer' OR NOT q.accepting OR q.closed_at IS NOT NULL OR r.phase<>'buzzer' OR r.state->'bz'->>'phase' IS DISTINCT FROM 'open' OR lane->>'st' IS DISTINCT FROM 'open' OR (lane->'out') ? m.id::text THEN
   RAISE EXCEPTION 'Buzzer is not open for this player' USING ERRCODE='42501';
  END IF;
  INSERT INTO show_private.buzzes(question_id,member_id) VALUES(q.id,m.id) RETURNING * INTO b;
 END IF;
 RETURN pg_catalog.jsonb_build_object('player_id',m.id,'name',m.name,'tag',m.tag,'created_at',b.created_at,'q_id',q.question_key);
END; $$;

-- New functions inherit PUBLIC EXECUTE unless it is explicitly removed.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA show_private FROM PUBLIC, anon, authenticated;
DO $grants$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('show_create_room','show_host_resume','show_begin_run','show_host_publish','show_host_members','show_host_answers','show_host_buzzes','show_close_submissions','show_award','show_preview','show_join','show_my_membership','show_heartbeat','show_leave','show_player_state','show_answer','show_buzz') LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END; $grants$;
