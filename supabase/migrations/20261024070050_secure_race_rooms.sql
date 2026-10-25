-- Authenticated, actor-bound race rooms. This does not alter scores, legacy
-- tables, the four existing multiplayer protocols, Auth settings or their jobs.
-- Public question banks and a participant's own claimed answer/progress remain
-- trusted gameplay input; identities, starts, runs, receipts and endings do not.
SET LOCAL lock_timeout='3s';
DO $guard$ BEGIN
 IF pg_catalog.to_regnamespace('race_private') IS NOT NULL OR EXISTS(
  SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'race\_%' ESCAPE '\') THEN
  RAISE EXCEPTION 'Race protocol already exists; review before applying';
 END IF;
END $guard$;

CREATE SCHEMA race_private;
REVOKE ALL ON SCHEMA race_private FROM PUBLIC,anon,authenticated;
CREATE TABLE race_private.rooms(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9]{4,12}$'),
 family text NOT NULL CHECK(family IN('finish','tug','firstfinger','castle','core','labyrinth')),
 edition text NOT NULL CHECK(edition IN('general','bible')),
 host_user_id uuid NOT NULL,run_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
 phase text NOT NULL DEFAULT 'lobby' CHECK(phase IN('lobby','playing','finished')),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 seed integer NOT NULL DEFAULT floor(random()*2147483647)::integer,
 options jsonb NOT NULL DEFAULT '{}',roster jsonb NOT NULL DEFAULT '[]',
 started_at timestamptz,play_at timestamptz,deadline timestamptz,ended_at timestamptz,result jsonb,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT(pg_catalog.clock_timestamp()+interval '4 hours'),
 UNIQUE(family,edition,code),CHECK(edition='general' OR family='firstfinger')
);
CREATE INDEX rooms_host_expiry ON race_private.rooms(host_user_id,expires_at);
CREATE TABLE race_private.members(
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),room_id uuid NOT NULL REFERENCES race_private.rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 14),
 side integer NOT NULL DEFAULT 0 CHECK(side BETWEEN 0 AND 2),
 joined_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),last_seen timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),left_at timestamptz,
 last_correct integer NOT NULL DEFAULT 0,last_level integer NOT NULL DEFAULT 0,last_time integer NOT NULL DEFAULT 0,
 last_wrong integer NOT NULL DEFAULT 0 CHECK(last_wrong BETWEEN 0 AND 200),last_mishaps integer NOT NULL DEFAULT 0 CHECK(last_mishaps BETWEEN 0 AND 2),progress_at timestamptz
);
CREATE UNIQUE INDEX members_active_actor ON race_private.members(room_id,user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX members_active_name ON race_private.members(room_id,lower(name)) WHERE left_at IS NULL;
CREATE INDEX members_actor_active ON race_private.members(user_id,room_id) WHERE left_at IS NULL;
CREATE INDEX members_roster ON race_private.members(room_id,joined_at,id);
CREATE TABLE race_private.events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,room_id uuid NOT NULL REFERENCES race_private.rooms(id) ON DELETE CASCADE,
 run_id uuid NOT NULL,member_id uuid NOT NULL REFERENCES race_private.members(id),
 kind text NOT NULL CHECK(kind IN('progress','draw','answer','end')),round_index integer,
 correct integer NOT NULL,level integer NOT NULL,time_left integer NOT NULL,
 wrong integer NOT NULL DEFAULT 0 CHECK(wrong BETWEEN 0 AND 200),mishaps integer NOT NULL DEFAULT 0 CHECK(mishaps BETWEEN 0 AND 2),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX events_room_run_order ON race_private.events(room_id,run_id,id);
CREATE INDEX events_member_created ON race_private.events(member_id,created_at);
CREATE INDEX events_latest_progress ON race_private.events(room_id,run_id,member_id,id DESC) WHERE kind='progress';
CREATE UNIQUE INDEX events_one_draw ON race_private.events(room_id,run_id,member_id,round_index) WHERE kind='draw';
CREATE UNIQUE INDEX events_one_answer ON race_private.events(room_id,run_id,member_id,round_index) WHERE kind='answer';
CREATE UNIQUE INDEX events_one_end ON race_private.events(room_id,run_id) WHERE kind='end';
CREATE TABLE race_private.requests(
 user_id uuid NOT NULL,request_id uuid NOT NULL,room_id uuid NOT NULL REFERENCES race_private.rooms(id) ON DELETE CASCADE,
 operation text NOT NULL,payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),PRIMARY KEY(user_id,request_id)
);
CREATE INDEX requests_actor_time ON race_private.requests(user_id,created_at);
CREATE INDEX requests_room_budget ON race_private.requests(room_id);
ALTER TABLE race_private.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_private.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_private.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_private.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA race_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA race_private FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA race_private REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA race_private REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA race_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;

CREATE FUNCTION race_private.uid() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Verified guest session required' USING ERRCODE='42501';END IF;RETURN u;
END $$;
CREATE FUNCTION race_private.scope(p_family text,p_edition text) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF p_family IS NULL OR p_family NOT IN('finish','tug','firstfinger','castle','core','labyrinth') OR p_edition IS NULL OR p_edition NOT IN('general','bible') OR(p_edition='bible' AND p_family<>'firstfinger') THEN
  RAISE EXCEPTION 'Unknown race edition' USING ERRCODE='22023';END IF;
END $$;
CREATE FUNCTION race_private.num(o jsonb,k text,lo integer,hi integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v integer;BEGIN
 IF jsonb_typeof(o->k) IS DISTINCT FROM 'number' OR(o->>k)!~'^-?[0-9]{1,9}$' THEN RAISE EXCEPTION 'Invalid integer %',k USING ERRCODE='22023';END IF;
 v:=(o->>k)::integer;IF v<lo OR v>hi THEN RAISE EXCEPTION 'Out of range %',k USING ERRCODE='22023';END IF;RETURN v;
END $$;
CREATE FUNCTION race_private.keys(o jsonb,allowed text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF jsonb_typeof(o) IS DISTINCT FROM 'object' OR octet_length(o::text)>4096 OR EXISTS(SELECT 1 FROM jsonb_object_keys(o) k WHERE NOT(k=ANY(allowed))) THEN
  RAISE EXCEPTION 'Invalid event fields' USING ERRCODE='22023';END IF;
END $$;
CREATE FUNCTION race_private.room_for(p_code text,p_family text,p_edition text,p_lock boolean DEFAULT false) RETURNS race_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r race_private.rooms;u uuid:=race_private.uid();BEGIN
 PERFORM race_private.scope(p_family,p_edition);
 IF p_lock THEN SELECT * INTO r FROM race_private.rooms WHERE code=upper(btrim(p_code)) AND family=p_family AND edition=p_edition FOR UPDATE;
 ELSE SELECT * INTO r FROM race_private.rooms WHERE code=upper(btrim(p_code)) AND family=p_family AND edition=p_edition;END IF;
 IF r.id IS NULL OR r.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Race room unavailable' USING ERRCODE='42501';END IF;RETURN r;
END $$;
CREATE FUNCTION race_private.member_for(p_room uuid) RETURNS race_private.members LANGUAGE plpgsql SET search_path='' AS $$
DECLARE m race_private.members;BEGIN
 SELECT * INTO m FROM race_private.members WHERE room_id=p_room AND user_id=race_private.uid() AND left_at IS NULL;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Active room membership required' USING ERRCODE='42501';END IF;RETURN m;
END $$;
CREATE FUNCTION race_private.replay(p_request uuid,p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u uuid:=race_private.uid();v race_private.requests;r race_private.rooms;BEGIN
 IF p_request IS NULL THEN RAISE EXCEPTION 'Request UUID required' USING ERRCODE='22023';END IF;
 -- Serialize an actor's mutations across rooms as well as receipt replays.
 -- This makes active-room/membership/rate budgets hold under concurrency.
 PERFORM pg_advisory_xact_lock(hashtextextended('race-actor:'||u::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':'||p_request::text,0));
 SELECT * INTO v FROM race_private.requests WHERE user_id=u AND request_id=p_request;
 IF v.request_id IS NULL THEN RETURN NULL;END IF;
 IF v.operation<>p_operation OR v.payload_hash<>sha256(convert_to(p_payload::text,'UTF8')) THEN RAISE EXCEPTION 'Request UUID reused with different input' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM race_private.rooms WHERE id=v.room_id;
 IF r.id IS NULL OR r.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM race_private.members WHERE room_id=r.id AND user_id=u AND(left_at IS NULL OR p_operation='leave')) THEN
  RAISE EXCEPTION 'Race room unavailable' USING ERRCODE='42501';END IF;
 RETURN v.response;
END $$;
CREATE FUNCTION race_private.remember(p_request uuid,p_operation text,p_room uuid,p_payload jsonb,p_response jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF(SELECT count(*) FROM race_private.requests WHERE room_id=p_room)>=60000 OR(SELECT count(*) FROM race_private.requests WHERE user_id=race_private.uid() AND created_at>clock_timestamp()-interval '1 minute')>=600 THEN
  RAISE EXCEPTION 'Race operation budget reached; wait before retrying' USING ERRCODE='54000';END IF;
 INSERT INTO race_private.requests(user_id,request_id,room_id,operation,payload_hash,response) VALUES(race_private.uid(),p_request,p_room,p_operation,sha256(convert_to(p_payload::text,'UTF8')),p_response);
END $$;
CREATE FUNCTION race_private.member_json(m race_private.members) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',m.id,'name',m.name,'side',m.side,'joined_at',m.joined_at,'last_seen',m.last_seen,'left_at',m.left_at,'last_correct',m.last_correct,'last_level',m.last_level,'last_time',m.last_time,'last_wrong',m.last_wrong,'last_mishaps',m.last_mishaps,'progress_at',m.progress_at)
$$;
CREATE FUNCTION race_private.room_json(r race_private.rooms,p_full boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'code',r.code,'family',r.family,'edition',r.edition,'phase',r.phase,'run_id',r.run_id,'version',r.version,
  'seed',r.seed,'options',r.options,'started_at',r.started_at,'play_at',r.play_at,'deadline',r.deadline,'ended_at',r.ended_at,'result',r.result,'expires_at',r.expires_at)
  ||CASE WHEN p_full THEN jsonb_build_object('roster',r.roster) ELSE '{}'::jsonb END
$$;
CREATE FUNCTION race_private.receipt(r race_private.rooms,m race_private.members) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('room',race_private.room_json(r),'member',race_private.member_json(m),'host',r.host_user_id=race_private.uid(),'server_time',clock_timestamp())
$$;
CREATE FUNCTION race_private.row_json(e race_private.events) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',e.id,'member_id',e.member_id,'run_id',e.run_id,'name',CASE WHEN e.kind='end' THEN '__END__' ELSE m.name END,
  'correct',e.correct,'level',e.level,'time_left',e.time_left,'wrong',e.wrong,'mishaps',e.mishaps,'created_at',e.created_at,'kind',e.kind)
 FROM race_private.members m WHERE m.id=e.member_id
$$;
CREATE FUNCTION race_private.rows(r race_private.rooms,p_after bigint DEFAULT 0) RETURNS jsonb LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(item ORDER BY at DESC,n DESC),'[]'::jsonb) FROM(
  SELECT race_private.row_json(e) item,e.created_at at,e.id n FROM race_private.events e WHERE e.room_id=r.id AND e.run_id=r.run_id AND e.id>p_after
    AND(e.kind<>'progress' OR e.id=(SELECT max(newest.id) FROM race_private.events newest WHERE newest.room_id=r.id AND newest.run_id=r.run_id AND newest.member_id=e.member_id AND newest.kind='progress'))
  UNION ALL
  SELECT jsonb_build_object('id',-1,'member_id',m.id,'run_id',r.run_id,'name',m.name,'correct',m.last_correct,'level',CASE WHEN r.family='tug' THEN m.side ELSE m.last_level END,
    'time_left',m.last_time,'wrong',m.last_wrong,'mishaps',m.last_mishaps,'created_at',m.last_seen,'kind','heartbeat'),m.last_seen,-1 FROM race_private.members m WHERE m.room_id=r.id AND m.left_at IS NULL
  UNION ALL
  SELECT jsonb_build_object('id',-2,'member_id',j->>'id','run_id',r.run_id,'name',j->>'name','correct',0,'level',CASE WHEN r.family='tug' THEN(j->>'side')::integer WHEN r.family IN('castle','core','labyrinth') THEN 3 ELSE 0 END,
    'time_left',0,'created_at',r.started_at-interval '1 millisecond','kind','roster'),r.started_at-interval '1 millisecond',-2
    FROM jsonb_array_elements(r.roster) j WHERE r.started_at IS NOT NULL
  UNION ALL
  SELECT jsonb_build_object('id',0,'member_id',NULL,'run_id',r.run_id,'name','__GO__','correct',CASE WHEN r.family='firstfinger' THEN r.seed ELSE 0 END,
    'level',CASE WHEN r.family='firstfinger' THEN(r.options->>'speed')::integer ELSE coalesce((r.options->>'tier')::integer,0) END,
    'time_left',0,'created_at',r.started_at,'kind','start'),r.started_at,0 WHERE r.started_at IS NOT NULL
 ) q
$$;
CREATE FUNCTION race_private.ff_window(r race_private.rooms,p_round integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE i integer;t timestamptz:=r.play_at;s timestamptz;lastword timestamptz;drawend timestamptz;answerend timestamptz;reveal timestamptz;ends timestamptz;done timestamptz;n integer;answered integer;
BEGIN
 IF r.family<>'firstfinger' OR p_round NOT BETWEEN 0 AND 8 OR r.play_at IS NULL THEN RAISE EXCEPTION 'First Finger round unavailable' USING ERRCODE='22023';END IF;
 FOR i IN 0..p_round LOOP
  n:=(r.options->'rounds'->i->>'words')::integer;s:=t+interval '2600 milliseconds';
  lastword:=s+((n-1)*(r.options->>'speed')::integer)*interval '1 millisecond';
  drawend:=lastword+CASE WHEN i=8 THEN interval '0' ELSE interval '3 seconds' END;answerend:=lastword+interval '11 seconds';reveal:=answerend;
  SELECT count(*),max(e.created_at) INTO answered,done FROM race_private.events e WHERE e.room_id=r.id AND e.run_id=r.run_id AND e.kind='answer' AND e.round_index=i;
  IF answered=jsonb_array_length(r.roster) AND answered>0 THEN reveal:=least(answerend,greatest(done,s));END IF;
  ends:=reveal+interval '6 seconds';
  IF i=p_round THEN RETURN jsonb_build_object('start_at',t,'study_at',s,'draw_until',drawend,'answer_until',answerend,'reveal_at',reveal,'end_at',ends,'words',n,'noon',i=8);END IF;
  t:=ends;
 END LOOP;RETURN NULL;
END $$;
CREATE FUNCTION race_private.tug_winner(r race_private.rooms,p_force boolean DEFAULT false) RETURNS integer LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE rope numeric;BEGIN
 SELECT coalesce(sum(CASE WHEN m.side=2 THEN 1 ELSE -1 END*(m.last_correct-0.4*m.last_wrong-m.last_mishaps)),0) INTO rope
 FROM race_private.members m WHERE m.room_id=r.id AND r.roster @> jsonb_build_array(jsonb_build_object('id',m.id));
 IF rope>=10 THEN RETURN 2;ELSIF rope<=-10 THEN RETURN 1;ELSIF p_force THEN RETURN CASE WHEN rope>0 THEN 2 WHEN rope<0 THEN 1 ELSE 3 END;END IF;RETURN 0;
END $$;
CREATE FUNCTION race_private.refresh(r race_private.rooms,m race_private.members) RETURNS race_private.rooms LANGUAGE plpgsql SET search_path='' AS $$
DECLARE final_at timestamptz;winner integer;ending race_private.events;BEGIN
 IF r.phase<>'playing' THEN RETURN r;END IF;
 IF r.family='firstfinger' THEN final_at:=(race_private.ff_window(r,8)->>'end_at')::timestamptz;
 ELSE final_at:=r.deadline;END IF;
 IF clock_timestamp()<final_at THEN RETURN r;END IF;
 IF r.family='tug' THEN
  winner:=race_private.tug_winner(r,true);
  INSERT INTO race_private.events(room_id,run_id,member_id,kind,correct,level,time_left) VALUES(r.id,r.run_id,m.id,'end',0,winner,0) ON CONFLICT DO NOTHING RETURNING * INTO ending;
  UPDATE race_private.rooms SET phase='finished',ended_at=final_at,result=jsonb_build_object('winner',winner),updated_at=clock_timestamp(),version=version+1 WHERE id=r.id RETURNING * INTO r;
 ELSE UPDATE race_private.rooms SET phase='finished',ended_at=final_at,result=coalesce(result,jsonb_build_object('reason','deadline')),updated_at=clock_timestamp(),version=version+1 WHERE id=r.id RETURNING * INTO r;END IF;
 RETURN r;
END $$;


-- A single canonical view is returned after starts/resets as well as on polls.
-- Timetables use acknowledged database timestamps, never another phone's clock.
CREATE FUNCTION race_private.packet(r race_private.rooms,m race_private.members,p_after bigint DEFAULT 0) RETURNS jsonb LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT jsonb_build_object('room',race_private.room_json(r,true),'member',race_private.member_json(m),'host',r.host_user_id=race_private.uid(),'server_time',clock_timestamp(),
  'members',(SELECT coalesce(jsonb_agg(race_private.member_json(x) ORDER BY x.joined_at,x.id),'[]') FROM race_private.members x WHERE x.room_id=r.id AND x.left_at IS NULL),
  'rows',race_private.rows(r,p_after),
  'round_windows',CASE WHEN r.family='firstfinger' AND r.started_at IS NOT NULL THEN(SELECT jsonb_agg(race_private.ff_window(r,i) ORDER BY i) FROM generate_series(0,8) i) ELSE '[]'::jsonb END)
$$;

CREATE FUNCTION public.race_enter(p_code text,p_family text,p_edition text,p_name text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=race_private.uid();c text:=upper(btrim(p_code));nm text:=btrim(p_name);r race_private.rooms;m race_private.members;outv jsonb;old jsonb;
 payload jsonb:=jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'name',p_name);
BEGIN
 old:=race_private.replay(p_request_id,'enter',payload);IF old IS NOT NULL THEN RETURN old;END IF;PERFORM race_private.scope(p_family,p_edition);
 IF c IS NULL OR c!~'^[A-Z0-9]{4,12}$' OR nm IS NULL OR char_length(nm) NOT BETWEEN 1 AND 14 OR nm~'[[:cntrl:]]' OR left(nm,2)='__' THEN RAISE EXCEPTION 'Use a 4-12 letter/number code and a 1-14 character nickname' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('race:'||p_family||':'||p_edition||':'||c,0));
 DELETE FROM race_private.rooms WHERE code=c AND family=p_family AND edition=p_edition AND expires_at<=clock_timestamp();
 SELECT * INTO r FROM race_private.rooms WHERE code=c AND family=p_family AND edition=p_edition FOR UPDATE;
 IF r.id IS NULL THEN
  IF(SELECT count(*) FROM race_private.rooms WHERE host_user_id=u AND expires_at>clock_timestamp())>=4 THEN RAISE EXCEPTION 'Active race room limit reached' USING ERRCODE='54000';END IF;
  INSERT INTO race_private.rooms(code,family,edition,host_user_id) VALUES(c,p_family,p_edition,u) RETURNING * INTO r;
 END IF;
 SELECT * INTO m FROM race_private.members WHERE room_id=r.id AND user_id=u AND left_at IS NULL;
 IF m.id IS NULL THEN
  IF r.phase<>'lobby' THEN RAISE EXCEPTION 'Race already started; ask the host for the next run' USING ERRCODE='PT409';END IF;
  IF(SELECT count(*) FROM race_private.members WHERE room_id=r.id AND left_at IS NULL)>=32 OR(SELECT count(*) FROM race_private.members active_member JOIN race_private.rooms x ON x.id=active_member.room_id WHERE active_member.user_id=u AND active_member.left_at IS NULL AND x.expires_at>clock_timestamp())>=20 THEN RAISE EXCEPTION 'Active membership limit reached' USING ERRCODE='54000';END IF;
  IF EXISTS(SELECT 1 FROM race_private.members WHERE room_id=r.id AND left_at IS NULL AND lower(name)=lower(nm)) THEN RAISE EXCEPTION 'That nickname is already in this room; choose another' USING ERRCODE='22023';END IF;
  INSERT INTO race_private.members(room_id,user_id,name) VALUES(r.id,u,nm) RETURNING * INTO m;
 ELSE UPDATE race_private.members SET last_seen=clock_timestamp() WHERE id=m.id RETURNING * INTO m;END IF;
 outv:=race_private.receipt(r,m);PERFORM race_private.remember(p_request_id,'enter',r.id,payload,outv);RETURN outv;
END $$;
CREATE FUNCTION public.race_state(p_code text,p_family text,p_edition text,p_after_id bigint DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r race_private.rooms:=race_private.room_for(p_code,p_family,p_edition,true);m race_private.members:=race_private.member_for(r.id);BEGIN
 IF p_after_id IS NULL OR p_after_id<0 THEN RAISE EXCEPTION 'Invalid event cursor' USING ERRCODE='22023';END IF;
 r:=race_private.refresh(r,m);
 RETURN race_private.packet(r,m,p_after_id);
END $$;
CREATE FUNCTION public.race_start(p_code text,p_family text,p_edition text,p_run_id uuid,p_expected_version bigint,p_options jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r race_private.rooms;m race_private.members;old jsonb;outv jsonb;o jsonb;v jsonb;v_roster jsonb;duration_ms bigint:=0;i integer:=0;n integer;speed integer;
 payload jsonb:=jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'version',p_expected_version,'options',p_options);
BEGIN
 old:=race_private.replay(p_request_id,'start',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=race_private.room_for(p_code,p_family,p_edition,true);m:=race_private.member_for(r.id);
 IF r.host_user_id<>race_private.uid() THEN RAISE EXCEPTION 'Only the host can start the race' USING ERRCODE='42501';END IF;
 IF r.phase<>'lobby' OR r.run_id IS DISTINCT FROM p_run_id OR r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Race changed; refresh before starting' USING ERRCODE='PT409';END IF;
 IF r.family='firstfinger' THEN
  PERFORM race_private.keys(p_options,ARRAY['speed','rounds']);speed:=race_private.num(p_options,'speed',450,900);
  IF speed NOT IN(450,650,900) OR jsonb_typeof(p_options->'rounds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_options->'rounds')<>9 THEN RAISE EXCEPTION 'Nine rounds and a valid pace required' USING ERRCODE='22023';END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p_options->'rounds') LOOP
   PERFORM race_private.keys(v,ARRAY['words','noon']);n:=race_private.num(v,'words',1,100);
   IF jsonb_typeof(v->'noon') IS DISTINCT FROM 'boolean' OR(v->>'noon')::boolean IS DISTINCT FROM(i=8) THEN RAISE EXCEPTION 'Invalid High Noon round' USING ERRCODE='22023';END IF;
   duration_ms:=duration_ms+2600+(n-1)*speed+11000+6000;i:=i+1;
  END LOOP;o:=p_options;
 ELSIF r.family IN('castle','core','labyrinth') THEN PERFORM race_private.keys(p_options,ARRAY['tier']);o:=jsonb_build_object('tier',race_private.num(p_options,'tier',0,3));duration_ms:=1200000;
 ELSE PERFORM race_private.keys(p_options,ARRAY[]::text[]);o:='{}';duration_ms:=CASE WHEN r.family='tug' THEN 120000 ELSE 1200000 END;END IF;
 UPDATE race_private.members SET last_seen=clock_timestamp() WHERE id=m.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'side',x.side) ORDER BY x.joined_at,x.id),'[]') INTO v_roster FROM race_private.members x WHERE x.room_id=r.id AND x.left_at IS NULL AND x.last_seen>clock_timestamp()-interval '30 seconds' AND(r.family<>'tug' OR x.side IN(1,2));
 IF jsonb_array_length(v_roster)<2 OR(r.family='tug' AND(NOT v_roster @> '[{"side":1}]' OR NOT v_roster @> '[{"side":2}]')) THEN RAISE EXCEPTION 'At least two ready players are required' USING ERRCODE='22023';END IF;
 UPDATE race_private.members SET last_correct=0,last_level=CASE WHEN r.family='tug' THEN side WHEN r.family IN('castle','core','labyrinth') THEN 3 ELSE 0 END,last_time=0,last_wrong=0,last_mishaps=0,progress_at=NULL WHERE room_id=r.id;
 UPDATE race_private.rooms SET phase='playing',options=o,roster=v_roster,started_at=clock_timestamp(),play_at=clock_timestamp()+CASE WHEN r.family IN('castle','core','labyrinth') THEN interval '3200 milliseconds' ELSE interval '4 seconds' END,
  deadline=clock_timestamp()+CASE WHEN r.family IN('castle','core','labyrinth') THEN interval '3200 milliseconds' ELSE interval '4 seconds' END+duration_ms*interval '1 millisecond',ended_at=NULL,result=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 SELECT * INTO m FROM race_private.members WHERE id=m.id;outv:=race_private.packet(r,m);PERFORM race_private.remember(p_request_id,'start',r.id,payload,outv);RETURN outv;
END $$;
CREATE FUNCTION public.race_submit(p_code text,p_family text,p_edition text,p_run_id uuid,p_kind text,p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r race_private.rooms;m race_private.members;e race_private.events;existing race_private.events;draw race_private.events;old jsonb;outv jsonb;w jsonb;ri integer;cv integer;lv integer;tv integer;winner integer;words integer;points integer;mult integer;wv integer:=0;mv integer:=0;atv timestamptz:=clock_timestamp();
 payload jsonb:=jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'kind',p_kind,'event',p_payload);
BEGIN
 old:=race_private.replay(p_request_id,'submit',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=race_private.room_for(p_code,p_family,p_edition,true);m:=race_private.member_for(r.id);atv:=clock_timestamp();
 IF r.run_id IS DISTINCT FROM p_run_id OR r.phase='lobby' THEN RAISE EXCEPTION 'This race run has closed' USING ERRCODE='PT409';END IF;
 IF NOT r.roster @> jsonb_build_array(jsonb_build_object('id',m.id)) THEN RAISE EXCEPTION 'Member is not in this race run' USING ERRCODE='42501';END IF;
 IF(SELECT count(*) FROM race_private.events WHERE room_id=r.id)>=12000 OR(SELECT count(*) FROM race_private.events WHERE member_id=m.id AND created_at>atv-interval '1 minute')>=300 THEN RAISE EXCEPTION 'Race event budget reached' USING ERRCODE='54000';END IF;
 IF r.family='firstfinger' THEN
  IF p_kind NOT IN('draw','answer') THEN RAISE EXCEPTION 'Invalid First Finger event' USING ERRCODE='22023';END IF;
  PERFORM race_private.keys(p_payload,CASE WHEN p_kind='draw' THEN ARRAY['round','words'] ELSE ARRAY['round','points','flags'] END);
  ri:=race_private.num(p_payload,'round',0,8);w:=race_private.ff_window(r,ri);words:=(w->>'words')::integer;
  SELECT * INTO existing FROM race_private.events WHERE room_id=r.id AND run_id=r.run_id AND member_id=m.id AND kind=p_kind AND round_index=ri;
  IF p_kind='draw' THEN
   cv:=race_private.num(p_payload,'words',1,words);lv:=1000+ri;tv:=0;
   -- The acknowledged draw cannot claim an earlier, more valuable word than
   -- the server has already shown. The client scores this canonical receipt.
   IF existing.id IS NULL THEN cv:=greatest(cv,least(words,greatest(1,floor(extract(epoch FROM(atv-(w->>'study_at')::timestamptz))*1000/(r.options->>'speed')::integer)::integer+1)));END IF;
   IF existing.id IS NULL AND(atv<(w->>'study_at')::timestamptz OR atv>=(w->>'draw_until')::timestamptz) THEN RAISE EXCEPTION 'Draw window is closed' USING ERRCODE='42501';END IF;
  ELSE
   cv:=race_private.num(p_payload,'points',-200,1600);tv:=race_private.num(p_payload,'flags',1,16);lv:=2000+ri;
   IF tv NOT IN(1,3,4,8,16) THEN RAISE EXCEPTION 'Invalid answer flags' USING ERRCODE='22023';END IF;
   SELECT * INTO draw FROM race_private.events WHERE room_id=r.id AND run_id=r.run_id AND member_id=m.id AND kind='draw' AND round_index=ri;
   mult:=CASE WHEN ri=8 THEN 2 ELSE 1 END;
   IF tv IN(1,3) THEN
    IF draw.id IS NULL THEN RAISE EXCEPTION 'Draw before answering' USING ERRCODE='42501';END IF;
    points:=greatest(50,round((50+350*(1-draw.correct::numeric/words))/10)::integer*10)*mult*CASE WHEN tv=3 THEN 2 ELSE 1 END;
    IF cv<>points THEN RAISE EXCEPTION 'Answer points do not match the recorded draw' USING ERRCODE='22023';END IF;
   ELSIF tv=4 THEN IF draw.id IS NULL OR cv<>-100*mult THEN RAISE EXCEPTION 'Invalid wrong answer' USING ERRCODE='22023';END IF;
   ELSIF cv<>0 OR(tv=8 AND draw.id IS NOT NULL) OR(tv=16 AND draw.id IS NULL) THEN RAISE EXCEPTION 'Invalid unanswered round' USING ERRCODE='22023';END IF;
   IF existing.id IS NULL AND(atv<(w->>'study_at')::timestamptz OR atv>(w->>'answer_until')::timestamptz+CASE WHEN tv IN(8,16) THEN interval '2 seconds' ELSE interval '0' END) THEN RAISE EXCEPTION 'Answer window is closed' USING ERRCODE='42501';END IF;
   IF existing.id IS NULL AND tv=8 AND atv<(w->>'draw_until')::timestamptz THEN RAISE EXCEPTION 'Draw window is still open' USING ERRCODE='42501';END IF;
   IF existing.id IS NULL AND tv=16 AND atv<least(draw.created_at+interval '10 seconds',(w->>'answer_until')::timestamptz)-interval '300 milliseconds' THEN RAISE EXCEPTION 'Answer window is still open' USING ERRCODE='42501';END IF;
  END IF;
 ELSIF p_kind='progress' THEN
  PERFORM race_private.keys(p_payload,CASE WHEN r.family='tug' THEN ARRAY['correct','level','wrong','mishaps'] ELSE ARRAY['correct','level','time_left'] END);
  cv:=race_private.num(p_payload,'correct',0,CASE WHEN r.family='finish' THEN 12 WHEN r.family='tug' THEN 1000 ELSE 6+(r.options->>'tier')::integer END);
  lv:=race_private.num(p_payload,'level',0,CASE WHEN r.family='finish' THEN 1 WHEN r.family='tug' THEN 2 ELSE 3 END);
  IF r.family='tug' THEN
   wv:=race_private.num(p_payload,'wrong',0,200);mv:=race_private.num(p_payload,'mishaps',0,2);tv:=wv+100*mv;
  ELSE tv:=race_private.num(p_payload,'time_left',0,CASE WHEN r.family='finish' THEN 202 ELSE 2 END);END IF;
  IF atv>r.deadline OR(atv<r.play_at AND(cv<>0 OR tv<>0 OR lv<>CASE WHEN r.family='tug' THEN m.side WHEN r.family='finish' THEN 0 ELSE 3 END)) THEN RAISE EXCEPTION 'Race progress window is closed' USING ERRCODE='42501';END IF;
  IF r.family='finish' THEN
   -- Finish Line encodes at most two mishaps and two slipstream boosts.
   -- Each acknowledged mutation is one answer, one boost-assisted answer or
   -- one mishap; an unreported two-place jump cannot invent a boost later.
   IF(lv=1 AND cv<>12) OR(cv=12 AND lv<>1) OR(m.last_level=1 AND(lv<>1 OR cv<>m.last_correct OR tv<>m.last_time))
    OR cv<m.last_correct OR tv%100>2 OR tv%100<m.last_time%100 OR tv%100-m.last_time%100>1
    OR floor(tv/100)<floor(m.last_time/100) OR floor(tv/100)-floor(m.last_time/100)>1
    OR(tv%100-m.last_time%100)+(floor(tv/100)-floor(m.last_time/100))>1
    OR cv-m.last_correct>1+(floor(tv/100)-floor(m.last_time/100))
    OR(floor(tv/100)>floor(m.last_time/100) AND(cv-m.last_correct<>2 OR m.last_correct NOT BETWEEN 2 AND 10))
    OR(tv%100>m.last_time%100 AND(cv<>m.last_correct OR m.last_correct NOT BETWEEN 2 AND 10))
    THEN RAISE EXCEPTION 'Invalid finish progress' USING ERRCODE='22023';END IF;
  END IF;
  IF r.family='tug' AND(r.phase='finished' OR lv<>m.side OR lv=0 OR cv<m.last_correct OR cv-m.last_correct>1 OR wv<m.last_wrong OR wv-m.last_wrong>1 OR mv<m.last_mishaps OR mv-m.last_mishaps>1 OR(cv-m.last_correct)+(wv-m.last_wrong)+(mv-m.last_mishaps)>1) THEN RAISE EXCEPTION 'Invalid team progress' USING ERRCODE='22023';END IF;
  IF r.family IN('castle','core','labyrinth') AND((tv=1 AND(lv=0 OR cv<>6+(r.options->>'tier')::integer)) OR(tv=2 AND lv<>0) OR cv<m.last_correct OR cv-m.last_correct>1 OR lv>m.last_level OR(m.last_time<>0 AND(tv<>m.last_time OR cv<>m.last_correct OR lv<>m.last_level))) THEN RAISE EXCEPTION 'Invalid adventure progress' USING ERRCODE='22023';END IF;
  SELECT * INTO existing FROM race_private.events WHERE member_id=m.id AND room_id=r.id AND run_id=r.run_id AND kind='progress' ORDER BY id DESC LIMIT 1;
  IF existing.id IS NOT NULL AND existing.correct=cv AND existing.level=lv AND existing.time_left=tv AND existing.wrong=wv AND existing.mishaps=mv THEN
   outv:=race_private.row_json(existing);PERFORM race_private.remember(p_request_id,'submit',r.id,payload,outv);RETURN outv;
  END IF;
 ELSIF p_kind='end' AND r.family='tug' THEN
  PERFORM race_private.keys(p_payload,ARRAY[]::text[]);SELECT * INTO existing FROM race_private.events WHERE room_id=r.id AND run_id=r.run_id AND kind='end';
  winner:=race_private.tug_winner(r,atv>=r.deadline);IF winner=0 THEN RAISE EXCEPTION 'The tug has not ended' USING ERRCODE='42501';END IF;cv:=0;lv:=winner;tv:=0;
 ELSE RAISE EXCEPTION 'Invalid race event kind' USING ERRCODE='22023';END IF;
 IF existing.id IS NOT NULL AND p_kind<>'progress' THEN
  IF existing.correct<>cv OR existing.level<>lv OR existing.time_left<>tv THEN RAISE EXCEPTION 'An answer is already recorded' USING ERRCODE='22023';END IF;
  outv:=race_private.row_json(existing);PERFORM race_private.remember(p_request_id,'submit',r.id,payload,outv);RETURN outv;
 END IF;
 INSERT INTO race_private.events(room_id,run_id,member_id,kind,round_index,correct,level,time_left,wrong,mishaps) VALUES(r.id,r.run_id,m.id,p_kind,ri,cv,lv,tv,wv,mv) RETURNING * INTO e;
 IF p_kind='progress' THEN
  UPDATE race_private.members SET last_correct=cv,last_level=lv,last_time=tv,last_wrong=wv,last_mishaps=mv,progress_at=e.created_at,last_seen=e.created_at WHERE id=m.id;
  IF(r.family='finish' AND lv=1) OR(r.family IN('castle','core','labyrinth') AND tv=1) THEN
   UPDATE race_private.rooms SET phase='finished',ended_at=coalesce(ended_at,e.created_at),result=coalesce(result,jsonb_build_object('winner_id',m.id)),updated_at=e.created_at,version=CASE WHEN phase='playing' THEN version+1 ELSE version END WHERE id=r.id;
  END IF;
 ELSIF p_kind='end' THEN UPDATE race_private.rooms SET phase='finished',ended_at=e.created_at,result=jsonb_build_object('winner',lv),version=version+1,updated_at=e.created_at WHERE id=r.id;
 ELSE UPDATE race_private.members SET last_seen=e.created_at WHERE id=m.id;END IF;
 outv:=race_private.row_json(e);PERFORM race_private.remember(p_request_id,'submit',r.id,payload,outv);RETURN outv;
END $$;
CREATE FUNCTION public.race_heartbeat(p_code text,p_family text,p_edition text,p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r race_private.rooms;m race_private.members;old jsonb;outv jsonb;s integer;
 payload jsonb:=jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'event',p_payload);
BEGIN
 old:=race_private.replay(p_request_id,'heartbeat',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=race_private.room_for(p_code,p_family,p_edition,true);m:=race_private.member_for(r.id);PERFORM race_private.keys(p_payload,ARRAY['side']);
 IF p_payload?'side' THEN
  s:=race_private.num(p_payload,'side',0,2);IF r.family<>'tug' OR(r.phase<>'lobby' AND s<>m.side) THEN RAISE EXCEPTION 'Teams are locked during a tug' USING ERRCODE='42501';END IF;
 ELSE s:=m.side;END IF;
 UPDATE race_private.members SET last_seen=clock_timestamp(),side=s WHERE id=m.id RETURNING * INTO m;
 outv:=race_private.receipt(r,m);PERFORM race_private.remember(p_request_id,'heartbeat',r.id,payload,outv);RETURN outv;
END $$;
CREATE FUNCTION public.race_leave(p_code text,p_family text,p_edition text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r race_private.rooms;m race_private.members;old jsonb;u uuid;outv jsonb:='{"left":true}';payload jsonb:=jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition);BEGIN
 old:=race_private.replay(p_request_id,'leave',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=race_private.room_for(p_code,p_family,p_edition,true);m:=race_private.member_for(r.id);
 UPDATE race_private.members SET left_at=clock_timestamp() WHERE id=m.id;
 IF r.host_user_id=race_private.uid() THEN
  SELECT user_id INTO u FROM race_private.members WHERE room_id=r.id AND left_at IS NULL ORDER BY joined_at,id LIMIT 1;
  IF u IS NULL THEN UPDATE race_private.rooms SET phase='finished',ended_at=clock_timestamp(),result=jsonb_build_object('reason','all_left'),version=version+1,updated_at=clock_timestamp() WHERE id=r.id;
  ELSE UPDATE race_private.rooms SET host_user_id=u,version=version+1,updated_at=clock_timestamp() WHERE id=r.id;END IF;
 END IF;PERFORM race_private.remember(p_request_id,'leave',r.id,payload,outv);RETURN outv;
END $$;
CREATE FUNCTION public.race_reset(p_code text,p_family text,p_edition text,p_run_id uuid,p_expected_version bigint,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r race_private.rooms;m race_private.members;old jsonb;outv jsonb;payload jsonb:=jsonb_build_object('code',p_code,'family',p_family,'edition',p_edition,'run',p_run_id,'version',p_expected_version);BEGIN
 old:=race_private.replay(p_request_id,'reset',payload);IF old IS NOT NULL THEN RETURN old;END IF;
 r:=race_private.room_for(p_code,p_family,p_edition,true);m:=race_private.member_for(r.id);
 IF r.host_user_id<>race_private.uid() THEN RAISE EXCEPTION 'Only the host can reset the race' USING ERRCODE='42501';END IF;
 IF r.run_id IS DISTINCT FROM p_run_id OR r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Race changed; refresh before resetting' USING ERRCODE='PT409';END IF;
 IF r.phase='lobby' THEN outv:=race_private.packet(r,m);ELSE
  UPDATE race_private.rooms SET phase='lobby',run_id=gen_random_uuid(),seed=floor(random()*2147483647)::integer,options='{}',roster='[]',started_at=NULL,play_at=NULL,deadline=NULL,ended_at=NULL,result=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  UPDATE race_private.members SET last_correct=0,last_level=CASE WHEN r.family='tug' THEN side ELSE 0 END,last_time=0,last_wrong=0,last_mishaps=0,progress_at=NULL WHERE room_id=r.id;
  SELECT * INTO m FROM race_private.members WHERE id=m.id;outv:=race_private.packet(r,m);
 END IF;PERFORM race_private.remember(p_request_id,'reset',r.id,payload,outv);RETURN outv;
END $$;

-- Service maintenance only. Scheduling this reviewed cleanup is a separate
-- operational step; no existing cron job or retention policy is modified here.
CREATE FUNCTION public.cleanup_race_rooms() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;BEGIN
 WITH expired AS(SELECT id FROM race_private.rooms WHERE expires_at<clock_timestamp()-interval '1 day' ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED),deleted AS(DELETE FROM race_private.rooms r USING expired x WHERE r.id=x.id RETURNING r.id) SELECT count(*) INTO n FROM deleted;
 RETURN n;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA race_private FROM PUBLIC,anon,authenticated;
DO $grants$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['race_enter','race_state','race_start','race_submit','race_heartbeat','race_leave','race_reset']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $grants$;
REVOKE ALL ON FUNCTION public.cleanup_race_rooms() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_race_rooms() TO service_role;

NOTIFY pgrst,'reload schema';
