-- Isolated move-family ownership protocol. Host/selected-phone gameplay remains trusted.
-- Explicitly excludes public legacy tables, cleanup, scores, Auth configuration and retention.
SET LOCAL lock_timeout='3s';
DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'party\_%' ESCAPE '\') THEN
  RAISE EXCEPTION 'Party API already exists; review before applying';
 END IF;
END $preflight$;
CREATE SCHEMA party_private;
REVOKE ALL ON SCHEMA party_private FROM PUBLIC,anon,authenticated;
CREATE TABLE party_private.rooms(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),code text UNIQUE NOT NULL CHECK(code ~ '^[A-Z2-9]{5}$'),
 family text NOT NULL CHECK(family IN('creak','standing','circuit','spines')),
 edition text NOT NULL CHECK(edition IN('general','bible')),
 host_user_id uuid NOT NULL,phase text NOT NULL DEFAULT 'lobby',run_id uuid,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 state jsonb NOT NULL DEFAULT '{}',current_window_id uuid,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT(pg_catalog.clock_timestamp()+interval '12 hours'),
 CHECK(edition='general' OR family IN('circuit','spines'))
);
CREATE INDEX rooms_host_active ON party_private.rooms(host_user_id,expires_at);
CREATE TABLE party_private.members(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),room_id uuid NOT NULL REFERENCES party_private.rooms(id),user_id uuid NOT NULL,
 name text NOT NULL CHECK(pg_catalog.char_length(name) BETWEEN 1 AND 14),look jsonb,
 joined_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),last_seen timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),left_at timestamptz
);
CREATE UNIQUE INDEX members_one_active_identity ON party_private.members(room_id,user_id) WHERE left_at IS NULL;
CREATE INDEX members_roster ON party_private.members(room_id,joined_at,id) WHERE left_at IS NULL;
CREATE INDEX members_history ON party_private.members(room_id,joined_at,id);
CREATE TABLE party_private.windows(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),room_id uuid NOT NULL REFERENCES party_private.rooms(id),run_id uuid NOT NULL,
 local_key text NOT NULL CHECK(pg_catalog.char_length(local_key) BETWEEN 1 AND 100),
 kind text NOT NULL CHECK(kind IN('roll','answer','step','pick','stream','finale')),
 member_id uuid NOT NULL REFERENCES party_private.members(id),choices jsonb NOT NULL DEFAULT '[]',signature jsonb NOT NULL,
 accepting boolean NOT NULL DEFAULT true,activity_id uuid,next_event integer NOT NULL DEFAULT 0 CHECK(next_event BETWEEN 0 AND 1000),
 completed_action_id bigint,created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),closed_at timestamptz,closed_actions jsonb,
 UNIQUE(room_id,run_id,local_key)
);
ALTER TABLE party_private.rooms ADD CONSTRAINT rooms_current_window_fk FOREIGN KEY(current_window_id) REFERENCES party_private.windows(id);
CREATE TABLE party_private.actions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,window_id uuid NOT NULL REFERENCES party_private.windows(id),member_id uuid NOT NULL REFERENCES party_private.members(id),
 kind text NOT NULL,choice text,event jsonb,activity_id uuid,event_seq integer,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 CHECK((kind='stream' AND event IS NOT NULL AND activity_id IS NOT NULL AND event_seq BETWEEN 0 AND 999) OR(kind<>'stream' AND choice IS NOT NULL AND event IS NULL AND activity_id IS NULL AND event_seq IS NULL))
);
CREATE UNIQUE INDEX actions_one_choice ON party_private.actions(window_id) WHERE kind<>'stream';
CREATE UNIQUE INDEX actions_one_event ON party_private.actions(window_id,activity_id,event_seq) WHERE kind='stream';
CREATE INDEX actions_window_order ON party_private.actions(window_id,id);
ALTER TABLE party_private.windows ADD CONSTRAINT windows_completed_action_fk FOREIGN KEY(completed_action_id) REFERENCES party_private.actions(id);
CREATE TABLE party_private.requests(
 user_id uuid NOT NULL,request_id uuid NOT NULL,operation text NOT NULL,room_id uuid NOT NULL REFERENCES party_private.rooms(id),
 payload_hash bytea NOT NULL CHECK(pg_catalog.octet_length(payload_hash)=32),response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),PRIMARY KEY(user_id,request_id)
);
CREATE INDEX requests_room_budget ON party_private.requests(room_id);
ALTER TABLE party_private.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_private.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_private.windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_private.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA party_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA party_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;

CREATE FUNCTION party_private.uid() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); BEGIN IF u IS NULL THEN RAISE EXCEPTION 'Verified guest session required' USING ERRCODE='42501'; END IF; RETURN u; END $$;
CREATE FUNCTION party_private.room_for(p_code text,p_family text,p_edition text,p_host boolean,p_lock boolean DEFAULT false)
RETURNS party_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r party_private.rooms;u uuid:=party_private.uid(); BEGIN
 IF p_lock THEN SELECT * INTO r FROM party_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)) FOR UPDATE;
 ELSE SELECT * INTO r FROM party_private.rooms WHERE code=pg_catalog.upper(pg_catalog.btrim(p_code)); END IF;
 IF r.id IS NULL OR r.expires_at<=pg_catalog.clock_timestamp() OR r.family IS DISTINCT FROM p_family OR r.edition IS DISTINCT FROM p_edition OR(p_host AND r.host_user_id<>u) THEN
  RAISE EXCEPTION 'Game room unavailable' USING ERRCODE='42501'; END IF;RETURN r;
END $$;
CREATE FUNCTION party_private.member_for(p_room uuid) RETURNS party_private.members LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m party_private.members;u uuid:=party_private.uid();BEGIN
 SELECT * INTO m FROM party_private.members WHERE room_id=p_room AND user_id=u AND left_at IS NULL;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Active room membership required' USING ERRCODE='42501';END IF;RETURN m;
END $$;
CREATE FUNCTION party_private.member_json(m party_private.members) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',m.id,'name',m.name,'look',m.look,'joined_at',m.joined_at,'last_seen',m.last_seen)
$$;
CREATE FUNCTION party_private.roster(p_room uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(pg_catalog.jsonb_agg(party_private.member_json(m) ORDER BY m.joined_at,m.id),'[]'::jsonb) FROM party_private.members m WHERE room_id=p_room AND left_at IS NULL
$$;
CREATE FUNCTION party_private.action_json(a party_private.actions) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',a.id,'player_id',a.member_id,'kind',a.kind,'choice',COALESCE(a.choice,a.event::text),'event',a.event,'window_id',a.window_id,'activity_id',a.activity_id,'event_seq',a.event_seq,'created_at',a.created_at,
  'q_id',CASE WHEN a.kind='stream' AND a.event->>'t'='done' THEN 'done' WHEN a.kind='stream' THEN 'e'||pg_catalog.lpad(a.event_seq::text,4,'0') ELSE w.local_key END)
 FROM party_private.windows w WHERE w.id=a.window_id
$$;
CREATE FUNCTION party_private.action_rows(p_window uuid,p_cursor bigint DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(pg_catalog.jsonb_agg(party_private.action_json(a) ORDER BY a.id),'[]'::jsonb)
 FROM party_private.actions a JOIN party_private.windows w ON w.id=a.window_id WHERE a.window_id=p_window AND a.id>p_cursor AND(a.activity_id IS NULL OR a.activity_id=w.activity_id)
$$;
CREATE FUNCTION party_private.window_json(p_window uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',w.id,'key',w.local_key,'kind',w.kind,'member_id',w.member_id,'accepting',w.accepting,'activity_id',w.activity_id,'next_event',w.next_event,'completed',CASE WHEN w.completed_action_id IS NULL THEN NULL ELSE(SELECT party_private.action_json(a) FROM party_private.actions a WHERE a.id=w.completed_action_id) END) FROM party_private.windows w WHERE w.id=p_window
$$;
CREATE FUNCTION party_private.room_json(r party_private.rooms) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('id',r.id,'code',r.code,'family',r.family,'edition',r.edition,'phase',r.phase,'state',r.state,'run_id',r.run_id,'version',r.version,'expires_at',r.expires_at,'action',party_private.window_json(r.current_window_id))
$$;
CREATE FUNCTION party_private.replay(p_request uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v party_private.requests;u uuid:=party_private.uid();r party_private.rooms;BEGIN
 IF p_request IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request::text,0));
 SELECT * INTO v FROM party_private.requests WHERE user_id=u AND request_id=p_request;
 IF v.request_id IS NULL THEN RETURN NULL;END IF;
 IF v.operation<>p_operation OR v.payload_hash<>pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')) THEN RAISE EXCEPTION 'Request UUID reused with different input' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM party_private.rooms WHERE id=v.room_id;
 IF r.id IS NULL OR r.expires_at<=pg_catalog.clock_timestamp() OR(r.host_user_id<>u AND NOT EXISTS(SELECT 1 FROM party_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL)) THEN RAISE EXCEPTION 'Game room unavailable' USING ERRCODE='42501';END IF;
 RETURN v.response;
END $$;
CREATE FUNCTION party_private.remember(p_request uuid,p_operation text,p_room uuid,p_payload jsonb,p_response jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF(SELECT pg_catalog.count(*) FROM party_private.requests WHERE room_id=p_room)>=30000 THEN RAISE EXCEPTION 'Room operation budget reached' USING ERRCODE='54000';END IF;
 INSERT INTO party_private.requests(user_id,request_id,operation,room_id,payload_hash,response) VALUES(party_private.uid(),p_request,p_operation,p_room,pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),p_response);
END $$;
CREATE FUNCTION party_private.txt(o jsonb,k text,n integer,required boolean DEFAULT true) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;BEGIN
 IF o->k IS NULL OR o->k='null'::jsonb THEN IF required THEN RAISE EXCEPTION 'Missing field %',k USING ERRCODE='22023';END IF;RETURN NULL;END IF;
 IF pg_catalog.jsonb_typeof(o->k)<>'string' THEN RAISE EXCEPTION 'Invalid text field %',k USING ERRCODE='22023';END IF;
 v:=o->>k;IF pg_catalog.char_length(v)>n OR(required AND v='') THEN RAISE EXCEPTION 'Invalid length for %',k USING ERRCODE='22023';END IF;RETURN v;
END $$;
CREATE FUNCTION party_private.num(o jsonb,k text,lo integer,hi integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v integer;BEGIN
 IF pg_catalog.jsonb_typeof(o->k) IS DISTINCT FROM 'number' OR(o->>k)!~'^-?[0-9]+$' OR pg_catalog.char_length(o->>k)>9 THEN RAISE EXCEPTION 'Invalid integer field %',k USING ERRCODE='22023';END IF;
 v:=(o->>k)::integer;IF v<lo OR v>hi THEN RAISE EXCEPTION 'Out of range field %',k USING ERRCODE='22023';END IF;RETURN v;
END $$;
CREATE FUNCTION party_private.epoch(o jsonb,k text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v bigint;BEGIN
 IF pg_catalog.jsonb_typeof(o->k) IS DISTINCT FROM 'number' OR(o->>k)!~'^[0-9]{1,15}$' THEN RAISE EXCEPTION 'Invalid timestamp field %',k USING ERRCODE='22023';END IF;
 v:=(o->>k)::bigint;IF v>253402300799999 THEN RAISE EXCEPTION 'Invalid timestamp field %',k USING ERRCODE='22023';END IF;RETURN v;END $$;
CREATE FUNCTION party_private.flag(o jsonb,k text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF pg_catalog.jsonb_typeof(o->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid boolean field %',k USING ERRCODE='22023';END IF;RETURN(o->>k)::boolean;END $$;
CREATE FUNCTION party_private.arr(o jsonb,k text,n integer) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN IF pg_catalog.jsonb_typeof(o->k) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(o->k)>n THEN RAISE EXCEPTION 'Invalid array %',k USING ERRCODE='22023';END IF;RETURN o->k;END $$;
CREATE FUNCTION party_private.opts(o jsonb,k text DEFAULT 'opts') RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE a jsonb:=party_private.arr(o,k,4);v jsonb;BEGIN
 IF pg_catalog.jsonb_array_length(a)<>4 THEN RAISE EXCEPTION 'Four options required' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(a) LOOP IF pg_catalog.jsonb_typeof(v)<>'string' OR pg_catalog.char_length(v#>>'{}') NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'Invalid option' USING ERRCODE='22023';END IF;END LOOP;RETURN a;
END $$;
CREATE FUNCTION party_private.member_id(v text,p_room uuid,required boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE idv uuid;BEGIN
 IF v IS NULL OR v='' THEN IF required THEN RAISE EXCEPTION 'Room member required' USING ERRCODE='22023';END IF;RETURN NULL;END IF;
 BEGIN idv:=v::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid room member' USING ERRCODE='22023';END;
 IF NOT EXISTS(SELECT 1 FROM party_private.members WHERE id=idv AND room_id=p_room) THEN RAISE EXCEPTION 'Member belongs to another room' USING ERRCODE='22023';END IF;RETURN idv;
END $$;
CREATE FUNCTION party_private.member_ids(a jsonb,p_room uuid,n integer DEFAULT 200) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE v jsonb;outv jsonb:='[]';idv uuid;BEGIN
 IF pg_catalog.jsonb_typeof(a) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(a)>n THEN RAISE EXCEPTION 'Invalid member list' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(a) LOOP
  IF pg_catalog.jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Invalid room member' USING ERRCODE='22023';END IF;idv:=party_private.member_id(v#>>'{}',p_room);
  IF outv @> pg_catalog.jsonb_build_array(idv::text) THEN RAISE EXCEPTION 'Duplicate room member' USING ERRCODE='22023';END IF;outv:=outv||pg_catalog.jsonb_build_array(idv::text);
 END LOOP;RETURN outv;
END $$;
CREATE FUNCTION party_private.names(p_room uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'name',name) ORDER BY joined_at,id),'[]') FROM party_private.members WHERE room_id=p_room
$$;
CREATE FUNCTION party_private.clean_look(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE hat text;BEGIN
 IF pg_catalog.jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid climber appearance' USING ERRCODE='22023';END IF;
 hat:=party_private.txt(v,'h',6);IF hat NOT IN('bobble','cap','helmet','band') THEN RAISE EXCEPTION 'Invalid climber hat' USING ERRCODE='22023';END IF;
 RETURN pg_catalog.jsonb_build_object('c',party_private.num(v,'c',0,7),'s',party_private.num(v,'s',0,4),'h',hat);
END $$;
CREATE FUNCTION party_private.clean_state(r party_private.rooms,p_phase text,s jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE o jsonb;v jsonb;x jsonb;ar jsonb;keyv text;idv uuid;n integer;i integer;posv integer;game text;
BEGIN
 IF pg_catalog.jsonb_typeof(s) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(s::text)>65536 THEN RAISE EXCEPTION 'Invalid game state' USING ERRCODE='22023';END IF;
 game:=CASE r.family WHEN 'creak' THEN 'creak-multi' WHEN 'standing' THEN 'standing-room' WHEN 'circuit' THEN 'full-circuit' ELSE 'spines' END;
 IF(s?'phase' AND s->>'phase' IS DISTINCT FROM p_phase) OR(s?'game' AND s->>'game' IS DISTINCT FROM game) THEN RAISE EXCEPTION 'Game state mismatch' USING ERRCODE='22023';END IF;
 o:=pg_catalog.jsonb_build_object('game',game,'phase',p_phase,'edition',r.edition,'names',party_private.names(r.id));
 IF r.family='creak' THEN
  keyv:=party_private.txt(s,'scene',16,false);IF keyv IS NOT NULL AND keyv NOT IN('basecamp','sight','roc','rumble','comeback','podium') THEN RAISE EXCEPTION 'Invalid mountain scene' USING ERRCODE='22023';END IF;
  o:=o||pg_catalog.jsonb_build_object('scene',keyv);x:='{}';
  IF s->'looks' IS NOT NULL AND s->'looks'<>'null'::jsonb THEN
   IF pg_catalog.jsonb_typeof(s->'looks') IS DISTINCT FROM 'object' OR(SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(s->'looks'))>200 THEN RAISE EXCEPTION 'Invalid climber appearances' USING ERRCODE='22023';END IF;
   FOR keyv,v IN SELECT * FROM pg_catalog.jsonb_each(s->'looks') LOOP
    idv:=party_private.member_id(keyv,r.id);
    IF party_private.txt(v,'col',7)!~'^#[0-9a-fA-F]{6}$' OR party_private.txt(v,'skin',7)!~'^#[0-9a-fA-F]{6}$' OR party_private.txt(v,'hat',6) NOT IN('bobble','cap','helmet','band') THEN RAISE EXCEPTION 'Invalid climber appearance' USING ERRCODE='22023';END IF;
    x:=x||pg_catalog.jsonb_build_object(idv::text,pg_catalog.jsonb_build_object('col',v->>'col','skin',v->>'skin','hat',v->>'hat'));
   END LOOP;
  END IF;o:=o||pg_catalog.jsonb_build_object('looks',x);
 END IF;
 IF p_phase='lobby' THEN RETURN o;END IF;
 IF r.family='creak' THEN
  IF p_phase NOT IN('live','gameover') THEN RAISE EXCEPTION 'Invalid Creak phase' USING ERRCODE='22023';END IF;
  ar:=party_private.member_ids(s->'order',r.id);n:=pg_catalog.jsonb_array_length(ar);
  o:=o||pg_catalog.jsonb_build_object('order',ar,'turnIdx',party_private.num(s,'turnIdx',0,GREATEST(0,n-1)),'turnSeq',party_private.num(s,'turnSeq',0,1000000),
   'seqBase',CASE WHEN s ? 'seqBase' THEN party_private.num(s,'seqBase',0,1000000) ELSE 0 END,
   'qCounter',CASE WHEN s ? 'qCounter' THEN party_private.num(s,'qCounter',0,1000000) ELSE 0 END);
  x:='{}';IF pg_catalog.jsonb_typeof(s->'positions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid positions' USING ERRCODE='22023';END IF;
  FOR keyv,v IN SELECT * FROM pg_catalog.jsonb_each(s->'positions') LOOP idv:=party_private.member_id(keyv,r.id);posv:=party_private.num(pg_catalog.jsonb_build_object('v',v),'v',1,100);x:=x||pg_catalog.jsonb_build_object(idv::text,posv);END LOOP;
  o:=o||pg_catalog.jsonb_build_object('positions',x);x:='{}';
  FOR keyv IN SELECT pg_catalog.unnest(ARRAY['ladders','snakes']) LOOP
   ar:=party_private.arr(s->'board',keyv,20);v:='[]';FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(ar) LOOP
    IF keyv='ladders' THEN v:=v||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('from',party_private.num(x,'from',1,100),'to',party_private.num(x,'to',1,100),'health',party_private.num(x,'health',-20,100),'maxHealth',party_private.num(x,'maxHealth',1,100),'alive',party_private.flag(x,'alive')));
    ELSE v:=v||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('from',party_private.num(x,'from',1,100),'to',party_private.num(x,'to',1,100),'stir',party_private.num(x,'stir',0,100),'threshold',party_private.num(x,'threshold',1,100),'alive',party_private.flag(x,'alive')));END IF;
   END LOOP;o:=pg_catalog.jsonb_set(o,ARRAY['board'],COALESCE(o->'board','{}')||pg_catalog.jsonb_build_object(keyv,v),true);
  END LOOP;
  ar:=party_private.arr(s->'board','craters',10);FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(ar) LOOP PERFORM party_private.num(pg_catalog.jsonb_build_object('v',v),'v',1,100);END LOOP;
  o:=pg_catalog.jsonb_set(o,ARRAY['board'],o->'board'||pg_catalog.jsonb_build_object('craters',ar));
  IF s->'winner' IS NOT NULL AND s->'winner'<>'null'::jsonb THEN idv:=party_private.member_id(s->'winner'->>'id',r.id);o:=o||pg_catalog.jsonb_build_object('winner',pg_catalog.jsonb_build_object('id',idv,'name',(SELECT name FROM party_private.members WHERE id=idv)));ELSE o:=o||'{"winner":null}';END IF;
  IF s->'pendingQ' IS NOT NULL AND s->'pendingQ'<>'null'::jsonb THEN
   x:=s->'pendingQ';keyv:=party_private.txt(x,'qId',32);IF keyv!~'^q[1-9][0-9]{0,6}$' OR x->>'kind' NOT IN('ladder','snake','rock','storm') THEN RAISE EXCEPTION 'Invalid Creak question' USING ERRCODE='22023';END IF;
   o:=o||pg_catalog.jsonb_build_object('pendingQ',pg_catalog.jsonb_build_object('forPlayer',party_private.member_id(x->>'forPlayer',r.id),'qId',keyv,'kind',x->>'kind','q',party_private.txt(x,'q',1000),'opts',party_private.opts(x),'deadline',party_private.epoch(x,'deadline'),'dur',party_private.num(x,'dur',1,60000)));
  ELSE o:=o||'{"pendingQ":null}';END IF;
 ELSIF r.family='standing' THEN
  IF p_phase NOT IN('live','over') THEN RAISE EXCEPTION 'Invalid Standing Room phase' USING ERRCODE='22023';END IF;
  n:=party_private.num(s,'N',6,9);ar:=party_private.arr(s,'solid',81);IF pg_catalog.jsonb_array_length(ar)<>n*n THEN RAISE EXCEPTION 'Invalid floor dimensions' USING ERRCODE='22023';END IF;
  FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(ar) LOOP IF pg_catalog.jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid floor cell' USING ERRCODE='22023';END IF;END LOOP;
  o:=o||pg_catalog.jsonb_build_object('N',n,'solid',ar,'order',party_private.member_ids(s->'order',r.id),'turn',party_private.num(s,'turn',0,GREATEST(0,pg_catalog.jsonb_array_length(s->'order')-1)),'seq',party_private.num(s,'seq',0,1000000),'qId',party_private.txt(s,'qId',40,false));
  FOR keyv IN SELECT pg_catalog.unnest(ARRAY['pos','outOf']) LOOP
   IF pg_catalog.jsonb_typeof(s->keyv) IS DISTINCT FROM 'object' OR(SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(s->keyv))>200 THEN RAISE EXCEPTION 'Invalid floor membership state' USING ERRCODE='22023';END IF;x:='{}';
  END LOOP;
  x:='{}';FOR keyv,v IN SELECT * FROM pg_catalog.jsonb_each(s->'pos') LOOP idv:=party_private.member_id(keyv,r.id);x:=x||pg_catalog.jsonb_build_object(idv::text,party_private.num(pg_catalog.jsonb_build_object('v',v),'v',0,n*n-1));END LOOP;o:=o||pg_catalog.jsonb_build_object('pos',x);
  x:='{}';FOR keyv,v IN SELECT * FROM pg_catalog.jsonb_each(s->'outOf') LOOP idv:=party_private.member_id(keyv,r.id);IF pg_catalog.jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid elimination state' USING ERRCODE='22023';END IF;x:=x||pg_catalog.jsonb_build_object(idv::text,v);END LOOP;o:=o||pg_catalog.jsonb_build_object('outOf',x);
  IF s->'q' IS NOT NULL AND s->'q'<>'null'::jsonb THEN o:=o||pg_catalog.jsonb_build_object('q',pg_catalog.jsonb_build_object('q',party_private.txt(s->'q','q',1000),'opts',party_private.opts(s->'q')));ELSE o:=o||'{"q":null}';END IF;
 ELSIF r.family='spines' THEN
  IF p_phase NOT IN('choose','question','result','over') THEN RAISE EXCEPTION 'Invalid Spines phase' USING ERRCODE='22023';END IF;
  ar:=party_private.arr(s,'books',20);x:='[]';i:=0;FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(ar) LOOP
   keyv:=party_private.txt(v,'col',7);IF keyv!~'^#[0-9a-fA-F]{6}$' THEN RAISE EXCEPTION 'Invalid book colour' USING ERRCODE='22023';END IF;
   IF party_private.txt(v,'t',1) NOT IN('1','2','3') OR party_private.flag(v,'top') IS DISTINCT FROM(i=pg_catalog.jsonb_array_length(ar)-1) THEN RAISE EXCEPTION 'Invalid book tier/top state' USING ERRCODE='22023';END IF;
   IF party_private.num(v,'i',0,19)<>i THEN RAISE EXCEPTION 'Invalid book index' USING ERRCODE='22023';END IF;
   x:=x||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('i',i,'subj',party_private.txt(v,'subj',100),'t',party_private.txt(v,'t',1),'top',party_private.flag(v,'top'),'col',keyv));i:=i+1;
  END LOOP;
  o:=o||pg_catalog.jsonb_build_object('books',x,'turn',party_private.member_id(s->>'turn',r.id,false),'seq',party_private.num(s,'seq',0,1000000),'lean',party_private.num(s,'lean',0,100),'msg',COALESCE(party_private.txt(s,'msg',1000,false),''));
  -- New clients publish IDs; legacy names are display-only and are rebuilt from these IDs.
  ar:=party_private.member_ids(s->'aliveIds',r.id,8);o:=o||pg_catalog.jsonb_build_object('aliveIds',ar,'alive',(SELECT COALESCE(pg_catalog.jsonb_agg(m.name ORDER BY a.ord),'[]') FROM pg_catalog.jsonb_array_elements_text(ar) WITH ORDINALITY a(id,ord) JOIN party_private.members m ON m.id=a.id::uuid));
  ar:=party_private.member_ids(s->'outIds',r.id,8);o:=o||pg_catalog.jsonb_build_object('outIds',ar,'out',(SELECT COALESCE(pg_catalog.jsonb_agg(m.name ORDER BY a.ord),'[]') FROM pg_catalog.jsonb_array_elements_text(ar) WITH ORDINALITY a(id,ord) JOIN party_private.members m ON m.id=a.id::uuid));
  idv:=party_private.member_id(s->>'winnerId',r.id,false);o:=o||pg_catalog.jsonb_build_object('winnerId',idv,'winner',(SELECT name FROM party_private.members WHERE id=idv),'turnName',(SELECT name FROM party_private.members WHERE id=(o->>'turn')::uuid));
  IF s->'q' IS NOT NULL AND s->'q'<>'null'::jsonb THEN x:=s->'q';o:=o||pg_catalog.jsonb_build_object('q',pg_catalog.jsonb_build_object('q',party_private.txt(x,'q',1000),'opts',party_private.opts(x),'subj',party_private.txt(x,'subj',100),'t',party_private.txt(x,'t',1)));IF x->>'t' NOT IN('1','2','3') THEN RAISE EXCEPTION 'Invalid question tier' USING ERRCODE='22023';END IF;ELSE o:=o||'{"q":null}';END IF;
 ELSE
  IF p_phase NOT IN('hall','room','after','machine','finale','over') THEN RAISE EXCEPTION 'Invalid Circuit phase' USING ERRCODE='22023';END IF;
  keyv:=party_private.txt(s,'room',20,false);IF keyv IS NOT NULL AND keyv NOT IN('switchboard','glasshouse','orrery','strongroom','darkroom') THEN RAISE EXCEPTION 'Invalid Circuit room' USING ERRCODE='22023';END IF;
  ar:=party_private.arr(s,'items',5);FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(ar) LOOP IF pg_catalog.jsonb_typeof(v)<>'string' OR(v#>>'{}') NOT IN('Wire','Spring','Lens','Key','Fuse') THEN RAISE EXCEPTION 'Invalid Circuit item' USING ERRCODE='22023';END IF;END LOOP;
  o:=o||pg_catalog.jsonb_build_object('room',keyv,'player',party_private.member_id(s->>'player',r.id,false),'roomSeq',party_private.num(s,'roomSeq',0,1000000),'depth',party_private.num(s,'depth',0,5),'items',ar,'fuse',party_private.flag(s,'fuse'),'keyUsed',party_private.flag(s,'keyUsed'),'spark',party_private.member_id(s->>'spark',r.id,false),'awake',CASE WHEN s->'awake' IS NULL OR s->'awake'='null'::jsonb THEN NULL ELSE party_private.flag(s,'awake') END);
  IF s->'fq' IS NOT NULL AND s->'fq'<>'null'::jsonb THEN x:=s->'fq';o:=o||pg_catalog.jsonb_build_object('fq',pg_catalog.jsonb_build_object('id',party_private.num(x,'id',1,1000000),'q',party_private.txt(x,'q',1000),'opts',party_private.opts(x),'burn',party_private.num(x,'burn',-1,3)));ELSE o:=o||'{"fq":null}';END IF;
 END IF;RETURN o;
END $$;

CREATE FUNCTION party_private.window_spec(r party_private.rooms,s jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor uuid;kindv text;keyv text;choices jsonb:='[]';sig jsonb;v jsonb;i integer;n integer;tile integer;fromv integer;rowv integer;colv integer;rr integer;cc integer;blocked boolean;pid text;
BEGIN
 IF r.phase='lobby' THEN RETURN NULL;END IF;
 IF r.family='creak' AND r.phase='live' THEN
  actor:=(s->'order'->>(s->>'turnIdx')::integer)::uuid;
  IF s->'pendingQ'<>'null'::jsonb AND s->'pendingQ' IS NOT NULL THEN
   IF actor IS DISTINCT FROM(s->'pendingQ'->>'forPlayer')::uuid THEN RAISE EXCEPTION 'Question must belong to active climber' USING ERRCODE='22023';END IF;
   kindv:='answer';keyv:='question:'||(s->'pendingQ'->>'qId');choices:=s->'pendingQ'->'opts';sig:=(s->'pendingQ')-'deadline'-'dur';
  ELSE kindv:='roll';keyv:='roll:'||(s->>'turnSeq');choices:='["roll"]';sig:=pg_catalog.jsonb_build_object('turn',s->'turnSeq');END IF;
 ELSIF r.family='standing' AND r.phase='live' THEN
  actor:=(s->'order'->>(s->>'turn')::integer)::uuid;keyv:=s->>'qId';
  IF keyv IS NULL OR keyv!~'^q[1-9][0-9]{0,6}(:step)?$' OR pg_catalog.split_part(keyv,':',1)<>'q'||(s->>'seq') THEN RAISE EXCEPTION 'Invalid current floor question' USING ERRCODE='22023';END IF;
  IF pg_catalog.right(keyv,5)=':step' THEN
   kindv:='step';n:=(s->>'N')::integer;fromv:=(s->'pos'->>actor::text)::integer;rowv:=fromv/n;colv:=fromv%n;
   FOR rr IN rowv-1..rowv+1 LOOP FOR cc IN colv-1..colv+1 LOOP
    IF rr>=0 AND rr<n AND cc>=0 AND cc<n AND(rr<>rowv OR cc<>colv) THEN
     tile:=rr*n+cc;blocked:=false;
     FOR pid IN SELECT value FROM pg_catalog.jsonb_array_elements_text(s->'order') LOOP IF pid<>actor::text AND NOT COALESCE((s->'outOf'->>pid)::boolean,false) AND(s->'pos'->>pid)::integer=tile THEN blocked:=true;END IF;END LOOP;
     IF(s->'solid'->>tile)::boolean AND NOT blocked THEN choices:=choices||pg_catalog.jsonb_build_array(tile::text);END IF;
    END IF;
   END LOOP;END LOOP;sig:=pg_catalog.jsonb_build_object('N',n,'from',fromv,'choices',choices);
  ELSE kindv:='answer';choices:=s->'q'->'opts';sig:=s->'q';END IF;
  IF COALESCE((s->'outOf'->>actor::text)::boolean,false) THEN RAISE EXCEPTION 'Eliminated floor player cannot act' USING ERRCODE='22023';END IF;
 ELSIF r.family='spines' AND r.phase IN('choose','question') THEN
  actor:=(s->>'turn')::uuid;IF NOT(s->'aliveIds' @> pg_catalog.jsonb_build_array(actor::text)) OR(s->'outIds' @> pg_catalog.jsonb_build_array(actor::text)) THEN RAISE EXCEPTION 'Active Spines player required' USING ERRCODE='22023';END IF;
  keyv:='s'||(s->>'seq')||CASE r.phase WHEN 'choose' THEN ':pick' ELSE ':answer' END;
  IF r.phase='choose' THEN kindv:='pick';FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(s->'books') LOOP IF NOT(v->>'top')::boolean THEN choices:=choices||pg_catalog.jsonb_build_array(v->>'i');END IF;END LOOP;sig:=s->'books';
  ELSE kindv:='answer';choices:=s->'q'->'opts';sig:=s->'q';END IF;
 ELSIF r.family='circuit' AND r.phase='room' THEN
  actor:=(s->>'player')::uuid;kindv:='stream';keyv:='room:'||(s->>'roomSeq')||':'||(s->>'room');sig:=pg_catalog.jsonb_build_object('room',s->'room','seq',s->'roomSeq');
 ELSIF r.family='circuit' AND r.phase='finale' AND s->'fq'<>'null'::jsonb AND s->'fq' IS NOT NULL THEN
  actor:=(s->>'spark')::uuid;kindv:='finale';keyv:='finale:'||(s->'fq'->>'id');sig:=(s->'fq')-'burn';
  FOR v,i IN SELECT value,(ordinality-1)::integer FROM pg_catalog.jsonb_array_elements(s->'fq'->'opts') WITH ORDINALITY LOOP IF i<>(s->'fq'->>'burn')::integer THEN choices:=choices||pg_catalog.jsonb_build_array(v);END IF;END LOOP;
 ELSE RETURN NULL;END IF;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM party_private.members WHERE id=actor AND room_id=r.id AND left_at IS NULL) THEN RETURN NULL;END IF;
 IF kindv<>'stream' AND(pg_catalog.jsonb_typeof(choices) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(choices)=0) THEN RAISE EXCEPTION 'No valid choices for active action' USING ERRCODE='22023';END IF;
 RETURN pg_catalog.jsonb_build_object('member_id',actor,'kind',kindv,'key',keyv,'choices',choices,'signature',sig);
END $$;
CREATE FUNCTION party_private.sync_window(r party_private.rooms) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE spec jsonb;w party_private.windows;nextid uuid;BEGIN
 -- Standing publishes the resolved board before its delayed next-turn animation.
 -- Retain the frozen receipt/window while that same action key is closed: the
 -- post-step legal neighbours naturally differ, and none can be submitted.
 IF r.family='standing' AND r.phase='live' AND r.current_window_id IS NOT NULL THEN
  SELECT * INTO w FROM party_private.windows WHERE id=r.current_window_id AND room_id=r.id AND run_id=r.run_id;
  IF w.id IS NOT NULL AND NOT w.accepting AND w.local_key=r.state->>'qId' THEN RETURN w.id;END IF;
 END IF;
 spec:=party_private.window_spec(r,r.state);
 IF spec IS NOT NULL THEN
  IF r.run_id IS NULL THEN RAISE EXCEPTION 'Start a run before opening an action' USING ERRCODE='22023';END IF;
  SELECT * INTO w FROM party_private.windows WHERE room_id=r.id AND run_id=r.run_id AND local_key=spec->>'key' FOR UPDATE;
  IF w.id IS NOT NULL THEN
   IF w.kind<>spec->>'kind' OR w.member_id<>(spec->>'member_id')::uuid OR w.signature IS DISTINCT FROM spec->'signature' THEN RAISE EXCEPTION 'Action identity cannot be changed or reused' USING ERRCODE='22023';END IF;
   IF w.kind='finale' THEN
    IF NOT(w.choices @> (spec->'choices')) THEN RAISE EXCEPTION 'Burned option cannot be restored' USING ERRCODE='22023';END IF;
    UPDATE party_private.windows SET choices=spec->'choices' WHERE id=w.id;
   ELSIF w.choices IS DISTINCT FROM spec->'choices' THEN RAISE EXCEPTION 'Action choices cannot change' USING ERRCODE='22023';END IF;
   nextid:=w.id;
  ELSE
   IF(SELECT pg_catalog.count(*) FROM party_private.windows WHERE room_id=r.id)>=10000 THEN RAISE EXCEPTION 'Room action-window budget reached' USING ERRCODE='54000';END IF;
   INSERT INTO party_private.windows(room_id,run_id,local_key,kind,member_id,choices,signature) VALUES(r.id,r.run_id,spec->>'key',spec->>'kind',(spec->>'member_id')::uuid,spec->'choices',spec->'signature') RETURNING id INTO nextid;
  END IF;
 END IF;
 IF r.current_window_id IS DISTINCT FROM nextid THEN UPDATE party_private.windows SET accepting=false,closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()),closed_actions=COALESCE(closed_actions,party_private.action_rows(id)) WHERE id=r.current_window_id;END IF;
 RETURN nextid;
END $$;

CREATE FUNCTION public.party_create_room(p_family text,p_edition text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=party_private.uid();r party_private.rooms;v jsonb;payload jsonb:=pg_catalog.jsonb_build_object('family',p_family,'edition',p_edition);a text:='ABCDEFGHJKMNPQRSTUVWXYZ23456789';codev text;i integer;j integer;BEGIN
 v:=party_private.replay(p_request_id,'create',payload);IF v IS NOT NULL THEN RETURN v;END IF;
 IF p_family NOT IN('creak','standing','circuit','spines') OR p_edition NOT IN('general','bible') OR(p_edition='bible' AND p_family NOT IN('circuit','spines')) OR p_family IS NULL OR p_edition IS NULL THEN RAISE EXCEPTION 'Invalid game edition' USING ERRCODE='22023';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':party-host',0));
 IF(SELECT pg_catalog.count(*) FROM party_private.rooms WHERE host_user_id=u AND expires_at>pg_catalog.clock_timestamp())>=5 THEN RAISE EXCEPTION 'Too many active hosted rooms' USING ERRCODE='54000';END IF;
 FOR j IN 1..10 LOOP
  codev:='';FOR i IN 1..5 LOOP codev:=codev||pg_catalog.substr(a,1+pg_catalog.floor(pg_catalog.random()*pg_catalog.char_length(a))::integer,1);END LOOP;
  BEGIN INSERT INTO party_private.rooms(code,family,edition,host_user_id) VALUES(codev,p_family,p_edition,u) RETURNING * INTO r;EXIT;EXCEPTION WHEN unique_violation THEN NULL;END;
 END LOOP;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Could not allocate room' USING ERRCODE='54000';END IF;
 UPDATE party_private.rooms SET state=party_private.clean_state(r,'lobby','{}') WHERE id=r.id RETURNING * INTO r;
 v:=party_private.room_json(r);PERFORM party_private.remember(p_request_id,'create',r.id,payload,v);RETURN v;
END $$;
CREATE FUNCTION public.party_host_resume(p_code text,p_family text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,true);BEGIN RETURN party_private.room_json(r);END $$;
CREATE FUNCTION public.party_begin_run(p_code text,p_family text,p_edition text,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms;v jsonb;payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'version',p_expected_version);BEGIN
 v:=party_private.replay(p_request_id,'begin',payload);IF v IS NOT NULL THEN RETURN v;END IF;r:=party_private.room_for(p_code,p_family,p_edition,true,true);
 IF r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Concurrent host change' USING ERRCODE='PT409';END IF;
 UPDATE party_private.windows SET accepting=false,closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()),closed_actions=COALESCE(closed_actions,party_private.action_rows(id)) WHERE room_id=r.id AND accepting;
 UPDATE party_private.rooms SET run_id=pg_catalog.gen_random_uuid(),phase='lobby',state=party_private.clean_state(r,'lobby','{}'),current_window_id=NULL,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 v:=party_private.room_json(r);PERFORM party_private.remember(p_request_id,'begin',r.id,payload,v);RETURN v;
END $$;
CREATE FUNCTION public.party_host_publish(p_code text,p_family text,p_edition text,p_run_id uuid,p_patch jsonb,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms;v jsonb;phasev text;payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'patch',p_patch,'version',p_expected_version);BEGIN
 v:=party_private.replay(p_request_id,'publish',payload);IF v IS NOT NULL THEN RETURN v;END IF;r:=party_private.room_for(p_code,p_family,p_edition,true,true);
 IF r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Concurrent host change' USING ERRCODE='PT409';END IF;
 IF r.run_id IS DISTINCT FROM p_run_id OR(pg_catalog.jsonb_typeof(p_patch) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'Current run and patch required' USING ERRCODE='22023';END IF;
 phasev:=party_private.txt(p_patch,'phase',20);IF phasev<>'lobby' AND r.run_id IS NULL THEN RAISE EXCEPTION 'Start a run first' USING ERRCODE='22023';END IF;
 r.phase:=phasev;r.state:=party_private.clean_state(r,phasev,p_patch->'state');r.current_window_id:=party_private.sync_window(r);
 UPDATE party_private.rooms SET phase=r.phase,state=r.state,current_window_id=r.current_window_id,version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 v:=party_private.room_json(r);PERFORM party_private.remember(p_request_id,'publish',r.id,payload,v);RETURN v;
END $$;
CREATE FUNCTION public.party_host_members(p_code text,p_family text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,true);BEGIN RETURN party_private.roster(r.id);END $$;
CREATE FUNCTION public.party_host_actions(p_code text,p_family text,p_edition text,p_run_id uuid,p_window_id uuid,p_cursor bigint DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,true);BEGIN
 IF p_cursor IS NULL OR p_cursor<0 OR NOT EXISTS(SELECT 1 FROM party_private.windows WHERE id=p_window_id AND room_id=r.id AND run_id=p_run_id) THEN RAISE EXCEPTION 'Action window unavailable' USING ERRCODE='42501';END IF;RETURN party_private.action_rows(p_window_id,p_cursor);
END $$;
CREATE FUNCTION public.party_host_close(p_code text,p_family text,p_edition text,p_run_id uuid,p_window_id uuid,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms;w party_private.windows;v jsonb;payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'window',p_window_id,'version',p_expected_version);BEGIN
 v:=party_private.replay(p_request_id,'close',payload);IF v IS NOT NULL THEN RETURN v;END IF;r:=party_private.room_for(p_code,p_family,p_edition,true,true);
 IF r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Concurrent host change' USING ERRCODE='PT409';END IF;
 SELECT * INTO w FROM party_private.windows WHERE id=p_window_id AND room_id=r.id AND run_id=p_run_id FOR UPDATE;
 IF w.id IS NULL OR r.run_id IS DISTINCT FROM p_run_id OR r.current_window_id IS DISTINCT FROM w.id THEN RAISE EXCEPTION 'Current action window unavailable' USING ERRCODE='42501';END IF;
 UPDATE party_private.windows SET accepting=false,closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()),closed_actions=COALESCE(closed_actions,party_private.action_rows(id)) WHERE id=w.id RETURNING * INTO w;
 UPDATE party_private.rooms SET version=version+1,updated_at=pg_catalog.clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 v:=pg_catalog.jsonb_build_object('room',party_private.room_json(r),'actions',w.closed_actions);PERFORM party_private.remember(p_request_id,'close',r.id,payload,v);RETURN v;
END $$;
CREATE FUNCTION public.party_preview(p_code text,p_family text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,false);BEGIN
 RETURN pg_catalog.jsonb_build_object('code',r.code,'family',r.family,'edition',r.edition,'phase',r.phase,'expires_at',r.expires_at);
END $$;
CREATE FUNCTION public.party_join(p_code text,p_family text,p_edition text,p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,false,true);m party_private.members;u uuid:=party_private.uid();BEGIN
 SELECT * INTO m FROM party_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;IF m.id IS NOT NULL THEN RETURN party_private.member_json(m);END IF;
 IF p_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_name)) NOT BETWEEN 1 AND 14 THEN RAISE EXCEPTION 'Name must contain 1 to 14 characters' USING ERRCODE='22023';END IF;
 IF(SELECT pg_catalog.count(*) FROM party_private.members WHERE room_id=r.id AND left_at IS NULL)>=(CASE WHEN r.family IN('circuit','spines') THEN 8 ELSE 200 END) OR(SELECT pg_catalog.count(*) FROM party_private.members WHERE room_id=r.id)>=2000 THEN RAISE EXCEPTION 'This game room is full' USING ERRCODE='54000';END IF;
 INSERT INTO party_private.members(room_id,user_id,name) VALUES(r.id,u,pg_catalog.btrim(p_name)) RETURNING * INTO m;RETURN party_private.member_json(m);
END $$;
CREATE FUNCTION public.party_my_membership(p_code text,p_family text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,false);m party_private.members;BEGIN
 SELECT * INTO m FROM party_private.members WHERE room_id=r.id AND user_id=party_private.uid() AND left_at IS NULL;IF m.id IS NULL THEN RETURN NULL;END IF;RETURN party_private.member_json(m);
END $$;
CREATE FUNCTION public.party_heartbeat(p_code text,p_family text,p_edition text,p_look jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,false,true);m party_private.members:=party_private.member_for(r.id);BEGIN
 IF p_look IS NOT NULL THEN
  IF r.family<>'creak' OR r.phase<>'lobby' THEN RAISE EXCEPTION 'Climbers can be changed only in the mountain lobby' USING ERRCODE='42501';END IF;
  m.look:=party_private.clean_look(p_look);
 END IF;
 UPDATE party_private.members SET last_seen=pg_catalog.clock_timestamp(),look=m.look WHERE id=m.id RETURNING * INTO m;RETURN party_private.member_json(m);
END $$;
CREATE FUNCTION public.party_leave(p_code text,p_family text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,false,true);m party_private.members;BEGIN
 SELECT * INTO m FROM party_private.members WHERE room_id=r.id AND user_id=party_private.uid() AND left_at IS NULL;
 IF m.id IS NULL THEN RETURN pg_catalog.jsonb_build_object('left',true);END IF;
 UPDATE party_private.members SET left_at=pg_catalog.clock_timestamp() WHERE id=m.id;
 UPDATE party_private.windows SET accepting=false,closed_at=COALESCE(closed_at,pg_catalog.clock_timestamp()),closed_actions=COALESCE(closed_actions,party_private.action_rows(id)) WHERE room_id=r.id AND member_id=m.id AND accepting;
 RETURN pg_catalog.jsonb_build_object('left',true);
END $$;
CREATE FUNCTION public.party_player_state(p_code text,p_family text,p_edition text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms:=party_private.room_for(p_code,p_family,p_edition,false);m party_private.members:=party_private.member_for(r.id);receipts jsonb;BEGIN
 SELECT COALESCE(pg_catalog.jsonb_agg(party_private.action_json(a) ORDER BY a.id),'[]') INTO receipts FROM party_private.actions a JOIN party_private.windows w ON w.id=a.window_id WHERE a.window_id=r.current_window_id AND a.member_id=m.id AND(a.activity_id IS NULL OR a.activity_id=w.activity_id);
 RETURN pg_catalog.jsonb_build_object('room',party_private.room_json(r),'member',party_private.member_json(m),'members',party_private.roster(r.id),'receipts',receipts);
END $$;
CREATE FUNCTION public.party_submit(p_code text,p_family text,p_edition text,p_run_id uuid,p_window_id uuid,p_choice text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms;w party_private.windows;m party_private.members;a party_private.actions;v jsonb;payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'window',p_window_id,'choice',p_choice);BEGIN
 v:=party_private.replay(p_request_id,'submit',payload);IF v IS NOT NULL THEN RETURN v;END IF;r:=party_private.room_for(p_code,p_family,p_edition,false,true);m:=party_private.member_for(r.id);
 SELECT * INTO w FROM party_private.windows WHERE id=p_window_id AND room_id=r.id AND run_id=p_run_id FOR UPDATE;
 IF w.id IS NULL OR w.member_id<>m.id OR w.kind='stream' THEN RAISE EXCEPTION 'It is not your active turn' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM party_private.actions WHERE window_id=w.id AND kind<>'stream';
 IF a.id IS NOT NULL THEN
  IF a.choice IS DISTINCT FROM p_choice THEN RAISE EXCEPTION 'A different choice is already recorded' USING ERRCODE='22023';END IF;
  v:=party_private.action_json(a);PERFORM party_private.remember(p_request_id,'submit',r.id,payload,v);RETURN v;
 END IF;
 IF r.run_id IS DISTINCT FROM p_run_id OR r.current_window_id IS DISTINCT FROM w.id OR NOT w.accepting THEN RAISE EXCEPTION 'This action has closed' USING ERRCODE='42501';END IF;
 IF p_choice IS NULL OR pg_catalog.char_length(p_choice)>250 OR NOT(w.choices @> pg_catalog.jsonb_build_array(p_choice)) THEN RAISE EXCEPTION 'Choice is not available' USING ERRCODE='22023';END IF;
 INSERT INTO party_private.actions(window_id,member_id,kind,choice) VALUES(w.id,m.id,w.kind,p_choice) RETURNING * INTO a;
 v:=party_private.action_json(a);UPDATE party_private.windows SET accepting=false,closed_at=pg_catalog.clock_timestamp(),closed_actions=pg_catalog.jsonb_build_array(v) WHERE id=w.id;
 PERFORM party_private.remember(p_request_id,'submit',r.id,payload,v);RETURN v;
END $$;
CREATE FUNCTION public.party_activity_start(p_code text,p_family text,p_edition text,p_run_id uuid,p_window_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms;w party_private.windows;m party_private.members;v jsonb;payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'window',p_window_id);BEGIN
 v:=party_private.replay(p_request_id,'activity_start',payload);IF v IS NOT NULL THEN RETURN v;END IF;r:=party_private.room_for(p_code,p_family,p_edition,false,true);m:=party_private.member_for(r.id);
 SELECT * INTO w FROM party_private.windows WHERE id=p_window_id AND room_id=r.id AND run_id=p_run_id FOR UPDATE;
 IF w.id IS NULL OR w.member_id<>m.id OR w.kind<>'stream' OR r.family<>'circuit' OR r.run_id IS DISTINCT FROM p_run_id OR r.current_window_id IS DISTINCT FROM w.id THEN RAISE EXCEPTION 'Selected room activity unavailable' USING ERRCODE='42501';END IF;
 IF w.completed_action_id IS NOT NULL THEN v:=pg_catalog.jsonb_build_object('activity_id',w.activity_id,'next_event',w.next_event,'completed',(SELECT party_private.action_json(a) FROM party_private.actions a WHERE id=w.completed_action_id));
 ELSE
  IF NOT w.accepting THEN RAISE EXCEPTION 'Room activity closed' USING ERRCODE='42501';END IF;
  UPDATE party_private.windows SET activity_id=pg_catalog.gen_random_uuid(),next_event=0 WHERE id=w.id RETURNING * INTO w;
  v:=pg_catalog.jsonb_build_object('activity_id',w.activity_id,'next_event',0,'completed',NULL);
 END IF;
 PERFORM party_private.remember(p_request_id,'activity_start',r.id,payload,v);RETURN v;
END $$;
CREATE FUNCTION party_private.clean_event(p_event jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE t text:=party_private.txt(p_event,'t',10);o jsonb;penalty integer;BEGIN
 IF pg_catalog.jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(p_event::text)>5000 THEN RAISE EXCEPTION 'Invalid room event' USING ERRCODE='22023';END IF;
 IF t IN('q','stairs') THEN RETURN pg_catalog.jsonb_build_object('t',t,'q',party_private.txt(p_event,'q',1000));
 ELSIF t='a' THEN RETURN pg_catalog.jsonb_build_object('t',t,'ok',party_private.flag(p_event,'ok'),'r',party_private.num(p_event,'r',0,5),'w',party_private.num(p_event,'w',0,3),'q',party_private.txt(p_event,'q',1000),'c',party_private.txt(p_event,'c',250),'fuse',COALESCE(CASE WHEN p_event?'fuse' THEN party_private.flag(p_event,'fuse') END,false));
 ELSIF t='done' THEN
  penalty:=CASE WHEN p_event?'penalty' THEN party_private.num(p_event,'penalty',0,9) ELSE 0 END;IF penalty%3<>0 THEN RAISE EXCEPTION 'Invalid back-stairs penalty' USING ERRCODE='22023';END IF;
  RETURN pg_catalog.jsonb_build_object('t',t,'won',party_private.flag(p_event,'won'),'stats',party_private.txt(p_event,'stats',1000),'fuse',party_private.flag(p_event,'fuse'),'keyUsed',COALESCE(CASE WHEN p_event?'keyUsed' THEN party_private.flag(p_event,'keyUsed') END,false),'penalty',penalty);
 END IF;RAISE EXCEPTION 'Invalid event kind' USING ERRCODE='22023';
END $$;
CREATE FUNCTION public.party_event(p_code text,p_family text,p_edition text,p_run_id uuid,p_window_id uuid,p_activity_id uuid,p_event_seq integer,p_event jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r party_private.rooms;w party_private.windows;m party_private.members;a party_private.actions;clean jsonb;v jsonb;payload jsonb:=pg_catalog.jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'window',p_window_id,'activity',p_activity_id,'seq',p_event_seq,'event',p_event);BEGIN
 v:=party_private.replay(p_request_id,'event',payload);IF v IS NOT NULL THEN RETURN v;END IF;r:=party_private.room_for(p_code,p_family,p_edition,false,true);m:=party_private.member_for(r.id);
 SELECT * INTO w FROM party_private.windows WHERE id=p_window_id AND room_id=r.id AND run_id=p_run_id FOR UPDATE;
 IF w.id IS NULL OR w.kind<>'stream' OR w.member_id<>m.id OR w.activity_id IS DISTINCT FROM p_activity_id OR p_activity_id IS NULL THEN RAISE EXCEPTION 'Selected room instance unavailable' USING ERRCODE='42501';END IF;
 clean:=party_private.clean_event(p_event);
 SELECT * INTO a FROM party_private.actions WHERE window_id=w.id AND activity_id=p_activity_id AND event_seq=p_event_seq;
 IF a.id IS NOT NULL THEN
  IF a.event IS DISTINCT FROM clean THEN RAISE EXCEPTION 'Different event already recorded' USING ERRCODE='22023';END IF;
  v:=party_private.action_json(a);PERFORM party_private.remember(p_request_id,'event',r.id,payload,v);RETURN v;
 END IF;
 IF r.run_id IS DISTINCT FROM p_run_id OR r.current_window_id IS DISTINCT FROM w.id OR NOT w.accepting OR w.completed_action_id IS NOT NULL THEN RAISE EXCEPTION 'Room activity closed' USING ERRCODE='42501';END IF;
 IF p_event_seq IS DISTINCT FROM w.next_event OR p_event_seq>=1000 THEN RAISE EXCEPTION 'Events must arrive in sequence' USING ERRCODE='22023';END IF;
 IF(SELECT pg_catalog.count(*) FROM party_private.actions WHERE window_id=w.id)>=3000 THEN RAISE EXCEPTION 'Room activity event budget reached' USING ERRCODE='54000';END IF;
 INSERT INTO party_private.actions(window_id,member_id,kind,event,activity_id,event_seq) VALUES(w.id,m.id,'stream',clean,p_activity_id,p_event_seq) RETURNING * INTO a;
 UPDATE party_private.windows SET next_event=next_event+1,completed_action_id=CASE WHEN clean->>'t'='done' THEN a.id ELSE NULL END,accepting=CASE WHEN clean->>'t'='done' THEN false ELSE accepting END,closed_at=CASE WHEN clean->>'t'='done' THEN pg_catalog.clock_timestamp() ELSE closed_at END WHERE id=w.id;
 v:=party_private.action_json(a);PERFORM party_private.remember(p_request_id,'event',r.id,payload,v);RETURN v;
END $$;

-- An explicit final revocation defeats broad global defaults as well as PUBLIC defaults.
REVOKE ALL ON ALL TABLES IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA party_private FROM PUBLIC,anon,authenticated;
DO $api_grants$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('party_create_room','party_host_resume','party_begin_run','party_host_publish','party_host_members','party_host_actions','party_host_close','party_preview','party_join','party_my_membership','party_heartbeat','party_leave','party_player_state','party_submit','party_activity_start','party_event') LOOP
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $api_grants$;
NOTIFY pgrst,'reload schema';
