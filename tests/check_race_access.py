#!/usr/bin/env python3
"""Synthetic, isolated SQL acceptance for race ownership and replay rules.

The default driver uses a cached digest-pinned PostgreSQL container with no
network or host ports. --pglite-module runs the same sequential SQL cases in an
existing local PostgreSQL/WASM package for fast feedback; this does not replace
the real PostgreSQL concurrency checks or GoTrue/PostgREST/browser acceptance.
No production credentials, requests, application rows or Auth users are used.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
MIGRATION = ROOT/'supabase/migrations/20261024070050_secure_race_rooms.sql'
ROLLBACK = ROOT/'supabase/rollback/secure_race_rooms.sql'
NAMES = ('enter','state','start','submit','heartbeat','leave','reset')
TABLES = ('rooms','members','events','requests')
BASELINE = """
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.race_unrelated_fixture(id integer PRIMARY KEY,note text);
INSERT INTO public.race_unrelated_fixture VALUES(1,'Synthetic pre-existing application sentinel');
"""
BRIDGE = r"""
import {createInterface} from 'node:readline';
const {PGlite}=await import(process.argv[2]);const db=new PGlite();await db.waitReady;
for await(const line of createInterface({input:process.stdin,terminal:false})){
 try{const result=await db.exec(JSON.parse(line).sql);const rows=[...result].reverse().find(item=>item.rows?.length)?.rows||[];
  const output=rows.map(row=>Object.values(row).map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join('|')).join('\n');
  process.stdout.write(JSON.stringify({output})+'\n');
 }catch(e){process.stdout.write(JSON.stringify({error:e.message,code:e.code})+'\n');}
}
await db.close();
"""


def lit(value):return "'"+str(value).replace("'","''")+"'"
def val(value):
 if value is None:return 'NULL'
 if isinstance(value,bool):return str(value).lower()
 if isinstance(value,(int,float)):return str(value)
 if isinstance(value,(dict,list)):return lit(json.dumps(value,separators=(',',':')))+'::jsonb'
 return lit(value)
def call(name,args):
 assert name in NAMES
 return 'public.race_'+name+'('+','.join(k+'=>'+val(v) for k,v in args.items())+')'


def suite(sql, report, concurrent=False):
 actors={};checks=report['tests']
 def actor(key):return actors.setdefault(key,str(uuid4()))
 def record(label,condition=True):
  report['last_case']=label
  if not condition:raise AssertionError(label)
  checks.append({'name':label,'passed':True})
 def context(who,statement,role='authenticated'):
  uid=actor(who) if who else ''
  return sql('BEGIN;SET LOCAL ROLE '+role+';SET LOCAL request.jwt.claim.sub='+lit(uid)+';'+statement+';COMMIT;')
 def rpc(who,name,**args):
  report['last_case']=who+' '+name
  return json.loads(context(who,'SELECT '+call(name,args)))
 def snapshot():
  return sql('SELECT jsonb_build_object('+','.join(lit(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM race_private."+t+' x)' for t in TABLES)+');')
 def deny(label,who,name,state='42501',role='authenticated',**args):
  before=snapshot();statement='SELECT '+call(name,args)
  block='DO $deny$ DECLARE observed text;BEGIN BEGIN EXECUTE '+lit(statement)+';EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;END;IF observed IS DISTINCT FROM '+lit(state)+" THEN RAISE EXCEPTION 'Expected "+state+", observed %',observed;END IF;END $deny$"
  context(who,block,role);record(label,snapshot()==before)
 def denied_sql(label,statement,state='42501',role='authenticated'):
  block='DO $deny$ DECLARE observed text;BEGIN BEGIN EXECUTE '+lit(statement)+';EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;END;IF observed IS DISTINCT FROM '+lit(state)+" THEN RAISE EXCEPTION 'Expected "+state+", observed %',observed;END IF;END $deny$"
  context('outsider',block,role);record(label)
 def scope(packet):
  r=packet['room'];return {'p_code':r['code'],'p_family':r['family'],'p_edition':r['edition']}
 def submit(who,packet,kind,payload,request=None):return rpc(who,'submit',**scope(packet),p_run_id=packet['room']['run_id'],p_kind=kind,p_payload=payload,p_request_id=request or str(uuid4()))
 def heartbeat(who,packet,payload=None):return rpc(who,'heartbeat',**scope(packet),p_payload=payload or {},p_request_id=str(uuid4()))
 def start(who,packet,options):return rpc(who,'start',**scope(packet),p_run_id=packet['room']['run_id'],p_expected_version=packet['room']['version'],p_options=options,p_request_id=str(uuid4()))
 def set_play(packet,elapsed=1):
  sql('UPDATE race_private.rooms SET play_at=clock_timestamp()-'+lit(str(elapsed)+' seconds')+'::interval,deadline=clock_timestamp()+interval \'1 hour\' WHERE id='+lit(packet['room']['id'])+'::uuid;')
 def enter(who,code,family,edition='general',name=None,request=None):return rpc(who,'enter',p_code=code,p_family=family,p_edition=edition,p_name=name or who[-12:],p_request_id=request or str(uuid4()))

 before_unrelated=sql('SELECT to_jsonb(x) FROM public.race_unrelated_fixture x;')
 sql('BEGIN;'+MIGRATION.read_text()+'COMMIT;')
 record('migration preserves unrelated existing application sentinel',sql('SELECT to_jsonb(x) FROM public.race_unrelated_fixture x;')==before_unrelated)
 acl=json.loads(sql("SELECT jsonb_build_object('rls',(SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='race_private' AND c.relkind='r'),'schema',has_schema_privilege('authenticated','race_private','USAGE'),'tables',(SELECT bool_or(has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='race_private' AND c.relkind='r'),'api',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('race_enter','race_state','race_start','race_submit','race_heartbeat','race_leave','race_reset') AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND p.prosecdef AND p.proconfig @> ARRAY['search_path=\"\"']))"))
 record('private schema/RLS/no direct grants and seven restricted definers',acl=={'rls':True,'schema':False,'tables':False,'api':7})
 for role in ('anon','authenticated'):
  for table in TABLES:denied_sql(role+' cannot directly read '+table,'SELECT * FROM race_private.'+table,role=role)
 denied_sql('anonymous cannot invoke cleanup','SELECT public.cleanup_race_rooms()',role='anon')
 denied_sql('authenticated cannot invoke cleanup','SELECT public.cleanup_race_rooms()')
 deny('missing guest JWT rejected','','enter',p_code='AUTH0001',p_family='finish',p_edition='general',p_name='Missing',p_request_id=str(uuid4()))
 deny('anon role cannot enter','anon','enter',role='anon',p_code='AUTH0001',p_family='finish',p_edition='general',p_name='Anon',p_request_id=str(uuid4()))
 for code,name in [('ABC','Valid'),('X'*13,'Valid'),('A-B-C','Valid'),('VALID1','__GO__'),('VALID1','__END__'),('VALID1','N'*15),('VALID1','\n')]:
  deny('invalid code/name '+repr((code,name)),'invalid','enter',state='22023',p_code=code,p_family='finish',p_edition='general',p_name=name,p_request_id=str(uuid4()))
 deny('Bible scope is limited to First Finger','invalid','enter',state='22023',p_code='INVALID1',p_family='finish',p_edition='bible',p_name='Name',p_request_id=str(uuid4()))

 for family,edition in [('finish','general'),('tug','general'),('firstfinger','general'),('firstfinger','bible'),('castle','general'),('core','general'),('labyrinth','general')]:
  tag=family+edition;h=tag+'H';p=tag+'P';q=tag+'Q';o=tag+'O';code=tag.upper()[:10]+'1'
  request=str(uuid4());packet=enter(h,code,family,edition,'Host',request)
  record(tag+' first entrant owns room',packet['host'] and packet['member']['name']=='Host')
  record(tag+' enter exact receipt replay',enter(h,code,family,edition,'Host',request)==packet)
  deny(tag+' receipt UUID payload mismatch',h,'enter',state='22023',p_code=code,p_family=family,p_edition=edition,p_name='Changed',p_request_id=request)
  one=enter(p,code,family,edition,'Player');two=enter(q,code,family,edition,'Third')
  deny(tag+' duplicate nickname cannot impersonate member',o,'enter',state='22023',p_code=code,p_family=family,p_edition=edition,p_name='player',p_request_id=str(uuid4()))
  deny(tag+' outsider cannot poll',o,'state',**scope(packet))
  deny(tag+' member cannot start',p,'start',**scope(packet),p_run_id=packet['room']['run_id'],p_expected_version=packet['room']['version'],p_options={},p_request_id=str(uuid4()))
  deny(tag+' stale start version',h,'start',state='PT409',**scope(packet),p_run_id=packet['room']['run_id'],p_expected_version=packet['room']['version']+1,p_options={},p_request_id=str(uuid4()))
  options={'speed':450,'rounds':[{'words':10,'noon':i==8} for i in range(9)]} if family=='firstfinger' else {'tier':0} if family in ('castle','core','labyrinth') else {}
  if family=='tug':heartbeat(h,packet,{'side':1});heartbeat(p,packet,{'side':2});heartbeat(q,packet,{'side':1})
  started=start(h,packet,options);record(tag+' start retains server seed and returns canonical packet',started['room']['seed']==packet['room']['seed'] and len(started['room']['roster'])==3 and len(started['members'])==3 and any(x['kind']=='start' for x in started['rows']))
  deny(tag+' late join is denied',o,'enter',state='PT409',p_code=code,p_family=family,p_edition=edition,p_name='Late',p_request_id=str(uuid4()))
  deny(tag+' wrong run is denied',p,'submit',state='PT409',**scope(started),p_run_id=str(uuid4()),p_kind='progress',p_payload={},p_request_id=str(uuid4()))
  deny(tag+' member cannot reset',p,'reset',**scope(started),p_run_id=started['room']['run_id'],p_expected_version=started['room']['version'],p_request_id=str(uuid4()))
  if family=='firstfinger':
   record(tag+' nine canonical server round windows',len(started['round_windows'])==9 and started['round_windows'][-1]['noon'])
   deny(tag+' draw before study is denied',p,'submit',**scope(started),p_run_id=started['room']['run_id'],p_kind='draw',p_payload={'round':0,'words':1},p_request_id=str(uuid4()))
   set_play(started,3)
   req=str(uuid4());draw=submit(p,started,'draw',{'round':0,'words':1},req)
   record(tag+' own canonical draw receipt',draw['member_id']==one['member']['id'] and draw['run_id']==started['room']['run_id'] and draw['level']==1000)
   record(tag+' lost acknowledgement replay does not duplicate draw',submit(p,started,'draw',{'round':0,'words':1},req)==draw)
   deny(tag+' cannot change recorded draw',p,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='draw',p_payload={'round':0,'words':2},p_request_id=str(uuid4()))
   deny(tag+' points must match canonical draw',p,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='answer',p_payload={'round':0,'points':1600,'flags':1},p_request_id=str(uuid4()))
   points=max(50,math.floor((50+350*(1-draw['correct']/10))/10+.5)*10)
   answer=submit(p,started,'answer',{'round':0,'points':points,'flags':1});record(tag+' source-derived draw score accepted',answer['correct']==points)
   deny(tag+' cannot change recorded answer',p,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='answer',p_payload={'round':0,'points':-100,'flags':4},p_request_id=str(uuid4()))
   deny(tag+' premature no-draw timeout rejected',q,'submit',**scope(started),p_run_id=started['room']['run_id'],p_kind='answer',p_payload={'round':0,'points':0,'flags':8},p_request_id=str(uuid4()))
   set_play(started,4)
   clamped=submit(h,started,'draw',{'round':0,'words':1});record(tag+' late draw cannot claim earlier valuable word',clamped['correct']>=4)
   set_play(started,10)
   submit(q,started,'answer',{'round':0,'points':0,'flags':8});submit(h,started,'answer',{'round':0,'points':-100,'flags':4})
   state=rpc(h,'state',**scope(started));record(tag+' all acknowledged answers shorten server reveal',state['round_windows'][0]['reveal_at']<state['round_windows'][0]['answer_until'])
   record(tag+' First Finger has one draw/answer per actor/round',sql('SELECT count(*) FROM race_private.events WHERE room_id='+lit(started['room']['id'])+'::uuid;')=='5')
  else:
   payload={'correct':1,'level':1,'wrong':0,'mishaps':0} if family=='tug' else {'correct':1,'level':0 if family=='finish' else 3,'time_left':0}
   deny(tag+' progress before start deadline rejected',h,'submit',**scope(started),p_run_id=started['room']['run_id'],p_kind='progress',p_payload=payload,p_request_id=str(uuid4()))
   set_play(started)
   req=str(uuid4());event=submit(h,started,'progress',payload,req)
   record(tag+' event bound to authenticated actor',event['member_id']==packet['member']['id'] and event['run_id']==started['room']['run_id'])
   record(tag+' lost acknowledgement replay exact',submit(h,started,'progress',payload,req)==event)
   changed=dict(payload);changed['correct']=2
   deny(tag+' reused request UUID cannot mutate input',h,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='progress',p_payload=changed,p_request_id=req)
   forged=dict(payload);forged['name']='Player'
   deny(tag+' supplied nickname cannot redirect event',h,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='progress',p_payload=forged,p_request_id=str(uuid4()))
   jump=dict(payload);jump['correct']=12
   deny(tag+' impossible progress jump rejected',h,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='progress',p_payload=jump,p_request_id=str(uuid4()))
   own=rpc(h,'state',**scope(started))['member'];record(tag+' reload exposes canonical member progress',own['last_correct']==1 and own['last_level']==payload['level'] and own['progress_at']==event['created_at'])
   if family=='tug':
    deny(tag+' teams cannot be switched midrun',p,'heartbeat',**scope(started),p_payload={'side':1},p_request_id=str(uuid4()))
    deny(tag+' cannot claim premature ending',h,'submit',**scope(started),p_run_id=started['room']['run_id'],p_kind='end',p_payload={},p_request_id=str(uuid4()))
    for n in range(2,11):submit(h,started,'progress',{'correct':n,'level':1,'wrong':0,'mishaps':0})
    ending=submit(p,started,'end',{});record(tag+' ending winner computed from canonical team progress',ending['level']==1)
    state=rpc(h,'state',**scope(started));record(tag+' server winner visible to everyone',state['room']['phase']=='finished' and state['room']['result']['winner']==1)
    deny(tag+' completed tug cannot be changed',h,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='progress',p_payload={'correct':11,'level':1,'wrong':0,'mishaps':0},p_request_id=str(uuid4()))
   else:
    goal=12 if family=='finish' else 6
    for n in range(2,goal+1):submit(h,started,'progress',{'correct':n,'level':1 if family=='finish' and n==goal else 0 if family=='finish' else 3,'time_left':1 if family!='finish' and n==goal else 0})
    state=rpc(h,'state',**scope(started));record(tag+' first finish produces canonical winner',state['room']['result']['winner_id']==packet['member']['id'])
    second=submit(p,started,'progress',{'correct':1,'level':0 if family=='finish' else 3,'time_left':0});record(tag+' other participant may continue after first finish',second['member_id']==one['member']['id'])
    deny(tag+' terminal progress cannot be replaced',h,'submit',state='22023',**scope(started),p_run_id=started['room']['run_id'],p_kind='progress',p_payload={'correct':goal,'level':0,'time_left':0},p_request_id=str(uuid4()))
  latest=rpc(h,'state',**scope(started));old_run=latest['room']['run_id']
  reset=rpc(h,'reset',**scope(latest),p_run_id=old_run,p_expected_version=latest['room']['version'],p_request_id=str(uuid4()))
  record(tag+' reset rotates run and clears canonical progress',reset['room']['run_id']!=old_run and reset['room']['phase']=='lobby' and reset['member']['last_correct']==0 and not any(x['kind']=='start' for x in reset['rows']))
  deny(tag+' old run cannot leak into new lobby',p,'submit',state='PT409',**scope(reset),p_run_id=old_run,p_kind='progress',p_payload={},p_request_id=str(uuid4()))
  req=str(uuid4());left=rpc(p,'leave',**scope(reset),p_request_id=req);record(tag+' leave receipt replay remains exact',rpc(p,'leave',**scope(reset),p_request_id=req)==left)
  deny(tag+' former member cannot poll',p,'state',**scope(reset))
  rpc(h,'leave',**scope(reset),p_request_id=str(uuid4()));record(tag+' host leave transfers host to remaining verified member',rpc(q,'state',**scope(reset))['host'])

 # Explicit progress fields prevent the legacy wrong-count encoding wrapping at100.
 packet=enter('wrapH','TUGWRAP1','tug',name='Wrap host');enter('wrapP','TUGWRAP1','tug',name='Wrap player');heartbeat('wrapH',packet,{'side':1});heartbeat('wrapP',packet,{'side':2});packet=start('wrapH',packet,{})
 set_play(packet)
 for n in range(1,102):event=submit('wrapH',packet,'progress',{'correct':0,'level':1,'wrong':n,'mishaps':0})
 record('Tug wrong counts above99 do not become mishaps',event['wrong']==101 and event['mishaps']==0 and rpc('wrapH','state',**scope(packet))['member']['last_wrong']==101)
 record('progress view bounded to latest event per member',len([x for x in rpc('wrapH','state',**scope(packet))['rows'] if x['kind']=='progress'])==1)


 # Finish Line only emits two mishaps and two boost-assisted double answers.
 packet=enter('effectsH','FLEFFECT1','finish',name='Effects host');enter('effectsP','FLEFFECT1','finish',name='Effects player');packet=start('effectsH',packet,{})
 set_play(packet)
 def finish_effect(correct,encoded):return submit('effectsH',packet,'progress',{'correct':correct,'level':int(correct==12),'time_left':encoded})
 def deny_effect(label,correct,encoded):
  deny(label,'effectsH','submit',state='22023',**scope(packet),p_run_id=packet['room']['run_id'],p_kind='progress',p_payload={'correct':correct,'level':int(correct==12),'time_left':encoded},p_request_id=str(uuid4()))
 deny_effect('Finish Line cannot invent a boost before progress two',2,100)
 finish_effect(1,0);finish_effect(2,0)
 for encoded in (3,99,199,203,699):deny_effect('Finish Line rejects impossible encoded counters '+str(encoded),2,encoded)
 deny_effect('Finish Line double progress requires recorded boost',4,0)
 deny_effect('Finish Line boost cannot increment without double answer',3,100)
 deny_effect('Finish Line mishap cannot advance correct count',3,1)
 deny_effect('Finish Line cannot increment both effect counters at once',4,101)
 event=finish_effect(2,1);record('Finish Line first mishap accepted without progress',event['time_left']==1 and event['correct']==2)
 event=finish_effect(2,2);record('Finish Line second mishap accepted',event['time_left']==2)
 deny_effect('Finish Line effect counters cannot decrease',2,1)
 event=finish_effect(4,102);record('Finish Line first boost doubles answer',event['time_left']==102 and event['correct']==4)
 event=finish_effect(6,202);record('Finish Line second boost doubles answer',event['time_left']==202 and event['correct']==6)
 deny_effect('Finish Line third boost rejected',8,302)
 for correct in range(7,12):event=finish_effect(correct,202)
 deny('Finish Line final progress must carry finish flag','effectsH','submit',state='22023',**scope(packet),p_run_id=packet['room']['run_id'],p_kind='progress',p_payload={'correct':12,'level':0,'time_left':202},p_request_id=str(uuid4()))
 event=finish_effect(12,202)
 record('Finish Line can finish after both effect caps',event['level']==1 and event['correct']==12 and event['time_left']==202)

 # Global per-actor cap covers different room codes, not only same-room locking.
 for i in range(4):enter('budgetH','BUDGET'+str(i),'finish',name='Budget')
 deny('fifth active host room rejected across codes','budgetH','enter',state='54000',p_code='BUDGET4',p_family='finish',p_edition='general',p_name='Budget',p_request_id=str(uuid4()))
 if concurrent:
  enter('parallelH','PARALLEL1','finish',name='Parallel host');enter('parallelP','PARALLEL1','finish',name='Parallel player')
  packet=rpc('parallelH','state',p_code='PARALLEL1',p_family='finish',p_edition='general')
  args={**scope(packet),'p_run_id':packet['room']['run_id'],'p_expected_version':packet['room']['version'],'p_options':{},'p_request_id':str(uuid4())}
  with ThreadPoolExecutor(max_workers=2) as pool:receipts=list(pool.map(lambda _:rpc('parallelH','start',**args),range(2)))
  record('concurrent identical starts produce one exact receipt',receipts[0]==receipts[1])
  # Different request UUIDs and room codes must not race past the global cap.
  for i in range(3):enter('parallelBudget','PCBUDGET'+str(i),'finish',name='Parallel budget')
  def concurrent_enter(i):
   try:return enter('parallelBudget','PCBUDGET'+str(i),'finish',name='Parallel budget')
   except AssertionError as error:
    if 'Active race room limit reached' not in str(error):raise
    return None
  with ThreadPoolExecutor(max_workers=2) as pool:receipts=list(pool.map(concurrent_enter,(3,4)))
  record('concurrent different-code creates enforce actor-global room cap',sum(item is not None for item in receipts)==1)
  # Concurrent first entrants become one owner plus one member of one room.
  with ThreadPoolExecutor(max_workers=2) as pool:receipts=list(pool.map(lambda i:enter('parallelJoin'+str(i),'PCJOIN01','finish',name='Join '+str(i)),(1,2)))
  record('concurrent first entrants have one room and one canonical host',receipts[0]['room']['id']==receipts[1]['room']['id'] and sum(item['host'] for item in receipts)==1)
 else:report['limits'].append('Sequential PostgreSQL/WASM driver does not establish concurrent transaction behavior')

 packet=enter('expireH','EXPIRE01','finish',name='Expired host');enter('expireP','EXPIRE01','finish',name='Expired player')
 sql('UPDATE race_private.rooms SET expires_at=clock_timestamp()-interval \'1 second\' WHERE id='+lit(packet['room']['id'])+'::uuid;')
 deny('expired membership state is denied','expireP','state',**scope(packet))
 # Role-scoped maintenance deletes only rooms beyond the documented one-day grace.
 before=snapshot();context('service','SELECT public.cleanup_race_rooms()',role='service_role');record('cleanup preserves newly expired data during grace',snapshot()==before)
 sql('UPDATE race_private.rooms SET expires_at=clock_timestamp()-interval \'2 days\' WHERE id='+lit(packet['room']['id'])+'::uuid;')
 record('service-only cleanup removes old expired room',context('service','SELECT public.cleanup_race_rooms()',role='service_role')=='1')
 before=snapshot();sql('BEGIN;'+ROLLBACK.read_text()+'COMMIT;');record('rollback preserves every remaining private row',snapshot()==before)
 denied_sql('rollback disables authenticated race API',"SELECT public.race_state('TUGWRAP1','tug','general')")
 record('all scenarios preserve unrelated application sentinel',sql('SELECT to_jsonb(x) FROM public.race_unrelated_fixture x;')==before_unrelated)


def run(report_path,pglite_module=None):
 report={'format':'tierbrain-race-access-v1','passed':False,'cleanup_completed':False,'started_at':datetime.now(timezone.utc).isoformat(),'tests':[],
         'limits':['Synthetic driver-controlled auth.uid claims; not real JWT or HTTP/browser acceptance'],
         'input_sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (MIGRATION,ROLLBACK,Path(__file__))}}
 env={k:v for k,v in os.environ.items() if k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
 container=None;bridge=None;name='tierbrain-race-'+secrets.token_hex(6)
 def docker(args,data=None):
  result=subprocess.run(DOCKER+args,input=data,text=True,capture_output=True,env=env,timeout=60)
  if result.returncode:raise AssertionError(result.stderr[-5000:])
  return result.stdout.strip()
 try:
  with tempfile.TemporaryDirectory(prefix=name+'-') as td:
   if pglite_module:
    script=Path(td)/'pglite-bridge.mjs';script.write_text(BRIDGE)
    bridge=subprocess.Popen(['node',str(script),str(Path(pglite_module).resolve())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    def sql(statement):
     bridge.stdin.write(json.dumps({'sql':statement})+'\n');bridge.stdin.flush();line=bridge.stdout.readline()
     if not line:raise AssertionError('Local PostgreSQL/WASM bridge stopped: '+bridge.stderr.read()[-2000:])
     result=json.loads(line)
     if result.get('error'):raise AssertionError(result['error']+' SQLSTATE='+str(result.get('code')))
     return result['output']
    report['engine']='local PostgreSQL/WASM'
   else:
    docker(['info','--format','{{.ServerVersion}}']);docker(['image','inspect',IMAGE])
    password=Path(td)/'db.env';password.write_text('POSTGRES_PASSWORD='+secrets.token_urlsafe(36)+'\n');password.chmod(0o600)
    container=docker(['run','--detach','--name',name,'--network','none','--memory','512m','--label','codex.task=tierbrain-race-access-tests','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=256m','--env-file',str(password),IMAGE,'postgres','-c','listen_addresses=','-c','shared_buffers=32MB','-c','max_connections=20'])
    def sql(statement):return docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],statement)
    deadline=time.monotonic()+30
    while True:
     # initdb's temporary PostgreSQL server can answer SELECT 1 immediately
     # before shutting down. Require PID 1 to exec the final server first;
     # probing the temporary socket does not establish fixture readiness.
     process=subprocess.run(DOCKER+['exec',name,'cat','/proc/1/comm'],
                            text=True,capture_output=True,env=env,timeout=5)
     ready=None
     if process.returncode==0 and process.stdout.strip()=='postgres':
      ready=subprocess.run(DOCKER+['exec',name,'psql','-X','-qAt','-v',
                                  'ON_ERROR_STOP=1','-U','postgres','-d','postgres',
                                  '-c','SELECT 1'],
                           text=True,capture_output=True,env=env,timeout=5)
     if ready is not None and ready.returncode==0 and ready.stdout.strip()=='1':break
     if time.monotonic()>=deadline:raise AssertionError('Isolated PostgreSQL final server did not become ready')
     time.sleep(.2)
    info=json.loads(docker(['inspect',name]))[0]
    assert info['Id']==container and info['Config']['Labels'].get('codex.task')=='tierbrain-race-access-tests'
    assert info['HostConfig']['NetworkMode']=='none' and not info['HostConfig']['PortBindings'] and sql('SHOW listen_addresses;')==''
    report['engine']=IMAGE
    report['readiness']='PID 1 is final postgres server and SELECT 1 succeeded'
   sql(BASELINE);report['postgres_version']=sql('SELECT version();')
   suite(sql,report,concurrent=not pglite_module)
   report['passed']=True
 except Exception as error:report['error']=str(error);print('Race acceptance failed: '+str(error),flush=True)
 finally:
  if bridge:
   bridge.stdin.close()
   try:bridge.wait(timeout=5)
   except subprocess.TimeoutExpired:bridge.kill();bridge.wait(timeout=5)
   report['cleanup_completed']=bridge.returncode==0
  if container:
   try:docker(['rm','--force',name]);report['cleanup_completed']=True
   except Exception as error:report['cleanup_error']=str(error);report['passed']=False
  report['finished_at']=datetime.now(timezone.utc).isoformat();report_path.parent.mkdir(parents=True,exist_ok=True)
  report_path.write_text(json.dumps(report,indent=2)+'\n');report_path.chmod(0o600)
 print(str(len(report['tests']))+' race SQL checks; passed='+str(report['passed']),flush=True)
 return report


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--report',required=True,type=Path);parser.add_argument('--pglite-module',type=Path)
 args=parser.parse_args();result=run(args.report,args.pglite_module);raise SystemExit(0 if result['passed'] and result['cleanup_completed'] else 1)
