#!/usr/bin/env python3
"""Bounded isolated SQL acceptance for Party ownership; no remote requests.

Uses the cached digest-pinned PostgreSQL image and a driver-controlled auth.uid
shim. This does not establish real GoTrue JWT, HTTP schema exposure or browser
acceptance; run the separate Auth/HTTP/mobile checks before deployment.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from uuid import uuid4
from check_show_access import LEGACY_AUDIT_SQL, table_rows_sql

ROOT=Path(__file__).resolve().parents[1]
IMAGE='postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
DOCKER=['docker','--host=unix:///var/run/docker.sock']
NAMES=('create_room','host_resume','begin_run','host_publish','host_members','host_actions','host_close','preview','join','my_membership','heartbeat','leave','player_state','submit','activity_start','event')
TABLES=('rooms','members','windows','actions','requests')
def literal(v):return "'"+str(v).replace("'","''")+"'"
def value(v):
 if v is None:return 'NULL'
 if isinstance(v,bool):return str(v).lower()
 if isinstance(v,(int,float)):return str(v)
 if isinstance(v,(dict,list)):return literal(json.dumps(v,separators=(',',':')))+'::jsonb'
 return literal(v)
def call(name,args):
 assert name in NAMES
 return 'public.party_'+name+'('+','.join(k+'=>'+value(v) for k,v in args.items())+')'
def run_checks(report_path):
 report={'format':'tierbrain-party-access-v1','passed':False,'started_at':datetime.now(timezone.utc).isoformat(),'tests':[],'cleanup_completed':False,'limits':['Synthetic driver claims, not real JWT','No HTTP or browser validation'],'image':IMAGE}
 env={k:v for k,v in os.environ.items() if k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
 name='tierbrain-party-'+secrets.token_hex(6);container=None
 actors={a:str(uuid4()) for a in ['H','H2','P1','P2','O']}
 def docker(args,data=None):
  result=subprocess.run(DOCKER+args,input=data,text=True,capture_output=True,env=env,timeout=60)
  if result.returncode:raise AssertionError(result.stderr)
  return result.stdout.strip()
 def sql(s):return docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],s)
 def context(actor,s,role='authenticated'):
  return sql('BEGIN;SET LOCAL ROLE '+role+';SET LOCAL request.jwt.claim.sub='+literal(actors.get(actor,''))+';'+s+';COMMIT;')
 def rpc(actor,n,**a):
  report['last_case']=actor+' '+n
  return json.loads(context(actor,'SELECT '+call(n,a)) or 'null')
 def record(label,condition=True):
  report['last_case']=label
  if not condition:raise AssertionError(label)
  report['tests'].append({'name':label,'passed':True});print(label+': passed',flush=True)
 def snapshot():
  return sql('SELECT jsonb_build_object('+','.join(literal(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM party_private."+t+' x)' for t in TABLES)+');')
 def secured_snapshot():
  families={'show_private':('rooms','members','questions','answers','buzzes','awards','requests'),
            'bigquiz_private':('rooms','members','questions','answers','buzzes','awards','requests'),
            'throne_private':('rooms','members','runs','questions','buzzes','answers','resolutions','results','requests')}
  data=','.join(literal(s)+','+table_rows_sql(s,t) for s,t in families.items())
  return sql("SELECT jsonb_build_object('rows',jsonb_build_object("+data+"),'functions',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('show_private','bigquiz_private','throne_private') OR(n.nspname='public' AND (left(p.proname,5)='show_' OR left(p.proname,8)='bigquiz_' OR left(p.proname,7)='throne_'))),'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'acl',c.relacl::text,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('show_private','bigquiz_private','throne_private')));")
 def deny(label,actor,n,state='42501',role='authenticated',**a):
  before=snapshot();query='SELECT '+call(n,a)
  block='DO $deny$ DECLARE observed text;BEGIN BEGIN EXECUTE '+literal(query)+';EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;END;IF observed IS DISTINCT FROM '+literal(state)+" THEN RAISE EXCEPTION 'Expected "+state+", observed %',observed;END IF;END $deny$"
  context(actor,block,role);record(label,snapshot()==before)
 def scope(room):return {'p_code':room['code'],'p_family':room['family'],'p_edition':room['edition']}
 def create(actor,family,edition='general'):
  return rpc(actor,'create_room',p_family=family,p_edition=edition,p_request_id=str(uuid4()))
 def begin(room):return rpc('H','begin_run',**scope(room),p_expected_version=room['version'],p_request_id=str(uuid4()))
 def publish(room,state):return rpc('H','host_publish',**scope(room),p_run_id=room['run_id'],p_patch={'phase':state['phase'],'state':state},p_expected_version=room['version'],p_request_id=str(uuid4()))
 def submit(room,actor,choice,req=None):return rpc(actor,'submit',**scope(room),p_run_id=room['run_id'],p_window_id=room['action']['id'],p_choice=choice,p_request_id=req or str(uuid4()))
 def close(room):return rpc('H','host_close',**scope(room),p_run_id=room['run_id'],p_window_id=room['action']['id'],p_expected_version=room['version'],p_request_id=str(uuid4()))
 def checks(room,m1,m2):
  common={**scope(room),'p_run_id':room['run_id'],'p_window_id':room['action']['id'],'p_choice':'forged','p_request_id':str(uuid4())}
  deny(room['family']+' outsider cannot submit','O','submit',**common)
  deny(room['family']+' other player cannot submit','P2','submit',**common)
  deny(room['family']+' invalid choice rejected','P1','submit',state='22023',**common)
  deny(room['family']+' outsider cannot host','O','host_resume',**scope(room))
  deny(room['family']+' member cannot publish','P1','host_publish',**scope(room),p_run_id=room['run_id'],p_patch={'phase':'lobby','state':{}},p_expected_version=room['version'],p_request_id=str(uuid4()))
 try:
  paths=list((ROOT/'supabase/migrations').glob('*_secure_party_rooms.sql'));assert len(paths)==1;migration=paths[0]
  throne,=list((ROOT/'supabase/migrations').glob('*_secure_throne_rooms.sql'))
  inputs=[ROOT/'tests/fixtures/show_auth_baseline.sql',migration,ROOT/'supabase/rollback/secure_party_rooms.sql',
          ROOT/'tests/fixtures/throne_access_baseline.sql',
          ROOT/'supabase/migrations/20261021160821_secure_big_quiz_rooms.sql',throne]
  report['input_sha256']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
  docker(['info','--format','{{.ServerVersion}}']);docker(['image','inspect',IMAGE])
  with tempfile.TemporaryDirectory(prefix='tierbrain-party-') as td:
   pw=Path(td)/'db.env';pw.write_text('POSTGRES_PASSWORD='+secrets.token_urlsafe(36)+'\n');pw.chmod(0o600)
   container=docker(['run','--detach','--name',name,'--network','none','--memory','512m','--label','codex.task=tierbrain-party-access-tests','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=256m','--env-file',str(pw),IMAGE,'postgres','-c','listen_addresses=','-c','shared_buffers=32MB','-c','max_connections=20'])
   deadline=time.monotonic()+30
   while True:
    try:
     if docker(['exec',name,'cat','/proc/1/comm'])=='postgres' and sql('SELECT 1;')=='1':break
    except AssertionError:pass
    if time.monotonic()>deadline:raise AssertionError('Isolated PostgreSQL did not start')
    time.sleep(.2)
   info=json.loads(docker(['inspect',name]))[0]
   record('isolated PostgreSQL network/ports/label',info['Id']==container and info['HostConfig']['NetworkMode']=='none' and not info['HostConfig']['PortBindings'] and sql('SHOW listen_addresses;')=='')
   sql('BEGIN;'+inputs[0].read_text()+inputs[3].read_text()+'COMMIT;')
   legacy=sql(LEGACY_AUDIT_SQL)
   show_paths=list((ROOT/'supabase/migrations').glob('*_secure_show_rooms.sql'));assert len(show_paths)==1
   sql('BEGIN;'+show_paths[0].read_text()+'COMMIT;')
   record('existing Show migration preserves legacy',sql(LEGACY_AUDIT_SQL)==legacy)
   show_created=json.loads(context('H',"SELECT public.show_create_room("+literal(str(uuid4()))+'::uuid)'))
   context('P1',"SELECT public.show_join("+literal(show_created['code'])+",'Protected member','youth')")
   show_baseline=sql('SELECT '+table_rows_sql('show_private',('rooms','members','questions','answers','buzzes','awards','requests'))+';')
   show_functions=sql("SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='show_private' OR(n.nspname='public' AND pg_catalog.left(proname,5)='show_');")
   sql('BEGIN;'+inputs[4].read_text()+inputs[5].read_text()+'COMMIT;')
   context('H',"SELECT public.bigquiz_create_room("+literal(str(uuid4()))+'::uuid)')
   context('H',"SELECT public.throne_create_room('general',"+literal(str(uuid4()))+'::uuid)')
   secured=secured_snapshot()
   sql('BEGIN;'+migration.read_text()+'COMMIT;')
   record('legacy rows, policies, grants, relations, function and cron unchanged',legacy==sql(LEGACY_AUDIT_SQL))
   record('existing protected Show rooms/members unchanged',show_baseline==sql('SELECT '+table_rows_sql('show_private',('rooms','members','questions','answers','buzzes','awards','requests'))+';'))
   record('existing Show, Big Quiz and Throne rows/APIs/privileges unchanged',secured_snapshot()==secured)
   grants=json.loads(sql("SELECT jsonb_agg(jsonb_build_object('name',proname,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'),'definer',prosecdef,'config',proconfig) ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_catalog.left(proname,6)='party_';"))
   record('16 APIs authenticated only, definer, empty search path',len(grants)==16 and all(not g['anon'] and g['auth'] and g['definer'] and g['config']==['search_path=""'] for g in grants))
   record('private schema denied',sql("SELECT has_schema_privilege('authenticated','party_private','USAGE') OR has_schema_privilege('anon','party_private','USAGE');")=='f')
   record('private tables denied despite global defaults',sql("SELECT bool_and(relrowsecurity AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='party_private' AND relkind='r';")=='t')
   deny('anon cannot create',None,'create_room',role='anon',p_family='creak',p_edition='general',p_request_id=str(uuid4()))
   deny('missing UID cannot create',None,'create_room',p_family='creak',p_edition='general',p_request_id=str(uuid4()))
   deny('Bible Creak rejected','H','create_room',state='22023',p_family='creak',p_edition='bible',p_request_id=str(uuid4()))
   request=str(uuid4());extra=rpc('H2','create_room',p_family='creak',p_edition='general',p_request_id=request)
   record('create retry preserves original room',extra==rpc('H2','create_room',p_family='creak',p_edition='general',p_request_id=request))
   deny('same request cannot change game input','H2','create_room',state='22023',p_family='standing',p_edition='general',p_request_id=request)
   rooms=[]
   for family in ['creak','standing','spines','circuit']:
    room=create('H',family);rooms.append(room)
    record(family+' create owned room',room['family']==family and room['phase']=='lobby' and room['action'] is None)
    deny(family+' wrong edition hidden','P1','preview',p_code=room['code'],p_family=family,p_edition='bible')
    deny(family+' wrong family hidden','P1','preview',p_code=room['code'],p_family='standing' if family!='standing' else 'creak',p_edition='general')
    deny(family+' other host cannot resume','H2','host_resume',**scope(room))
    m1=rpc('P1','join',**scope(room),p_name='Same name');m2=rpc('P2','join',**scope(room),p_name='Same name')
    record(family+' duplicate names remain distinct canonical members',m1['id']!=m2['id'])
    record(family+' verified rejoin stable',rpc('P1','join',**scope(room),p_name='Changed')['id']==m1['id'])
    record(family+' own heartbeat',rpc('P1','heartbeat',**scope(room))['id']==m1['id'])
    if family=='creak':
     look={'c':7,'s':4,'h':'helmet'}
     saved=rpc('P1','heartbeat',**scope(room),p_look=look)
     record('Creak authenticated own appearance saved',saved['id']==m1['id'] and saved['look']==look)
     record('Creak another member appearance unchanged',rpc('P2','my_membership',**scope(room))['look'] is None)
     deny('Creak outsider cannot set appearance','O','heartbeat',**scope(room),p_look=look)
     for bad in [None,{'c':8,'s':0,'h':'cap'},{'c':0,'s':5,'h':'cap'},{'c':0,'s':0,'h':'<img>'},{'c':'0','s':0,'h':'cap'}]:
      if bad is None:bad=[]
      deny('Creak invalid appearance rejected '+json.dumps(bad),'P1','heartbeat',state='22023',**scope(room),p_look=bad)
    else:
     deny(family+' appearance update rejected','P1','heartbeat',**scope(room),p_look={'c':0,'s':0,'h':'cap'})
    if family in ['spines','circuit']:
     for i in range(6):
      actors['capacity'+str(i)]=str(uuid4());rpc('capacity'+str(i),'join',**scope(room),p_name='Extra '+str(i))
     deny(family+' ninth simultaneous member rejected','O','join',state='54000',**scope(room),p_name='Ninth')
     for i in range(6):rpc('capacity'+str(i),'leave',**scope(room))
    denied={**scope(room),'p_run_id':room['run_id'],'p_patch':{'phase':'lobby','state':{}},'p_expected_version':room['version']+1,'p_request_id':str(uuid4())}
    deny(family+' stale host version is PT409','H','host_publish',state='PT409',**denied)
    room=begin(room);rid=room['run_id'];one=m1['id'];two=m2['id']
    opts=['Alpha','Beta','Gamma','Delta']
    if family=='creak':
     state={'phase':'live','order':[one,two],'turnIdx':0,'turnSeq':0,'positions':{one:1,two:1},'board':{'ladders':[],'snakes':[],'craters':[]},'winner':None,'pendingQ':None}
     state.update(scene='roc',looks={one:{'col':'#e6b655','skin':'#f3cfae','hat':'helmet'}})
     room=publish(room,state);record('Creak opens own roll',room['action']['kind']=='roll');checks(room,m1,m2)
     deny('Creak active-run appearance cannot change','P1','heartbeat',**scope(room),p_look={'c':1,'s':1,'h':'cap'})
     record('Creak validated mountain scene and appearance preserved',room['state']['scene']=='roc' and room['state']['looks']==state['looks'])
     invalid=deepcopy(state);invalid['scene']='<img>'
     deny('Creak unknown scene rejected','H','host_publish',state='22023',**scope(room),p_run_id=room['run_id'],p_patch={'phase':'live','state':invalid},p_expected_version=room['version'],p_request_id=str(uuid4()))
     invalid=deepcopy(state);invalid['looks'][one]['col']='url(x)'
     deny('Creak unsafe appearance rejected','H','host_publish',state='22023',**scope(room),p_run_id=room['run_id'],p_patch={'phase':'live','state':invalid},p_expected_version=room['version'],p_request_id=str(uuid4()))
     receipt=submit(room,'P1','roll');record('roll receipt confirmed',receipt['choice']=='roll')
     identical=submit(room,'P1','roll');record('roll replay canonical',identical==receipt)
     deny('roll differing replay cannot replace receipt','P1','submit',state='22023',**scope(room),p_run_id=rid,p_window_id=room['action']['id'],p_choice='Alpha',p_request_id=str(uuid4()))
     closed=close(room);room=closed['room'];record('roll close snapshot',closed['actions']==[receipt])
     room=publish(room,state);record('same roll remains closed',not room['action']['accepting'])
     state['pendingQ']={'forPlayer':one,'qId':'q1','kind':'ladder','q':'Synthetic?','opts':opts,'deadline':1893456010000,'dur':10000,'correct':'MUST_NOT_ESCAPE'}
     room=publish(room,state);record('Creak question strips correct answer','MUST_NOT_ESCAPE' not in json.dumps(room))
     submit(room,'P1','Alpha');room=close(room)['room']
     for index,kind in enumerate(['snake','rock','storm'],2):
      state['pendingQ'].update(qId='q'+str(index),kind=kind);room=publish(room,state)
      if kind=='storm':
       with ThreadPoolExecutor(max_workers=2) as pool:receipts=list(pool.map(lambda _:submit(room,'P1','Beta'),range(2)))
       record('Creak concurrent identical answers return one receipt',receipts[0]==receipts[1])
      elif kind=='rock':
       late_room=deepcopy(room);room=close(room)['room']
       deny('Creak timeout rejects late answer','P1','submit',**scope(room),p_run_id=rid,p_window_id=late_room['action']['id'],p_choice='Alpha',p_request_id=str(uuid4()))
       record('Creak rock question timeout snapshot empty',rpc('H','host_actions',**scope(room),p_run_id=rid,p_window_id=late_room['action']['id'],p_cursor=0)==[])
       continue
      else:submit(room,'P1','Alpha')
      room=close(room)['room'];record('Creak '+kind+' independent answer window',not room['action']['accepting'])
     state['pendingQ']=None;room=publish(room,state)
     record('question clear retains closed roll',not room['action']['accepting'])
     state['turnSeq']=1;state['turnIdx']=1;room=publish(room,state);record('new turn opens new member roll',room['action']['member_id']==two)
    elif family=='standing':
     state={'phase':'live','N':6,'solid':[True]*36,'pos':{one:0,two:35},'outOf':{},'order':[one,two],'turn':0,'seq':1,'qId':'q1','q':{'q':'Synthetic?','opts':opts,'correct':'MUST_NOT_ESCAPE'}}
     room=publish(room,state);checks(room,m1,m2);record('Standing question strips answer','MUST_NOT_ESCAPE' not in json.dumps(room))
     receipt=submit(room,'P1','Alpha');room=close(room)['room'];state['qId']='q1:step';room=publish(room,state)
     deny('Standing invalid nonadjacent tile','P1','submit',state='22023',**scope(room),p_run_id=rid,p_window_id=room['action']['id'],p_choice='30',p_request_id=str(uuid4()))
     receipt=submit(room,'P1','7');record('Standing valid adjacent diagonal',receipt['choice']=='7');room=close(room)['room']
     state['pos'][one]=7;state['solid'][0]=False;room=publish(room,state);record('Standing resolved-board publication retains frozen closed step',not room['action']['accepting'])
    elif family=='spines':
     state={'phase':'choose','turn':one,'seq':1,'lean':0,'books':[{'i':i,'subj':'Synthetic','t':'1','top':i==14,'col':'#abcdef'} for i in range(15)],'q':None,'aliveIds':[one,two],'outIds':[],'winnerId':None,'msg':''}
     room=publish(room,state);checks(room,m1,m2)
     deny('Spines top book denied','P1','submit',state='22023',**scope(room),p_run_id=rid,p_window_id=room['action']['id'],p_choice='14',p_request_id=str(uuid4()))
     submit(room,'P1','0');room=close(room)['room'];state['phase']='question';state['q']={'q':'Synthetic?','opts':opts,'subj':'Synthetic','t':'3'};room=publish(room,state)
     receipt=submit(room,'P1','Gamma');record('Spines answer accepted',receipt['choice']=='Gamma');room=close(room)['room'];state.update(phase='over',winnerId=two,outIds=[one],aliveIds=[two]);room=publish(room,state)
     record('Spines duplicate-name winner keyed by ID',room['state']['winnerId']==two and room['state']['outIds']==[one])
    else:
     state={'phase':'room','room':'switchboard','player':one,'roomSeq':1,'depth':0,'items':[],'fuse':False,'keyUsed':False,'spark':None,'fq':None,'awake':None}
     room=publish(room,state);record('Circuit opens selected stream',room['action']['kind']=='stream')
     start=rpc('P1','activity_start',**scope(room),p_run_id=rid,p_window_id=room['action']['id'],p_request_id=str(uuid4()));activity=start['activity_id']
     args={**scope(room),'p_run_id':rid,'p_window_id':room['action']['id'],'p_activity_id':activity,'p_event_seq':0,'p_event':{'t':'q','q':'Synthetic?'},'p_request_id':str(uuid4())}
     deny('Circuit stream other player denied','P2','event',**args)
     deny('Circuit out-of-order event denied','P1','event',state='22023',**{**args,'p_event_seq':1})
     first=rpc('P1','event',**args);record('Circuit question stream confirmed',first['event']['t']=='q')
     record('Circuit same event request retry canonical',rpc('P1','event',**args)==first)
     deny('Circuit conflicting accepted event rejected','P1','event',state='22023',**{**args,'p_event':{'t':'q','q':'Changed?'},'p_request_id':str(uuid4())})
     restarted=rpc('P1','activity_start',**scope(room),p_run_id=rid,p_window_id=room['action']['id'],p_request_id=str(uuid4()));record('Circuit reload gets fresh activity',restarted['activity_id']!=activity)
     deny('Circuit stale instance denied','P1','event',**{**args,'p_request_id':str(uuid4()),'p_event_seq':1})
     done={'t':'done','won':True,'stats':'Synthetic complete','fuse':False}
     finishargs={**args,'p_activity_id':restarted['activity_id'],'p_event':done,'p_request_id':str(uuid4())}
     receipt=rpc('P1','event',**finishargs);record('Circuit done confirmed',receipt['event']['t']=='done')
     resumed=rpc('P1','activity_start',**scope(room),p_run_id=rid,p_window_id=room['action']['id'],p_request_id=str(uuid4()));record('Circuit completed activity never restarts',resumed['completed']==receipt)
     deny('Circuit event after done denied','P1','event',**{**finishargs,'p_event_seq':1,'p_event':{'t':'q','q':'Late?'},'p_request_id':str(uuid4())})
     actions=rpc('H','host_actions',**scope(room),p_run_id=rid,p_window_id=room['action']['id'],p_cursor=0);record('Circuit restarted stream excludes old events',actions==[receipt])
     room=close(room)['room'];state.update(phase='finale',spark=one,fq={'id':1,'q':'Final?','opts':opts,'burn':-1});room=publish(room,state);oldwindow=room['action']['id']
     state['fq']['burn']=1;room=publish(room,state);record('Lens keeps same window',room['action']['id']==oldwindow)
     deny('Lens burned choice denied','P1','submit',state='22023',**scope(room),p_run_id=rid,p_window_id=oldwindow,p_choice='Beta',p_request_id=str(uuid4()))
     receipt=submit(room,'P1','Alpha');room=close(room)['room'];record('Circuit finale accepted',receipt['choice']=='Alpha')
    # Every family rejects stale run and outsiders from read-state; own receipts are canonical.
    deny(family+' outsider state denied','O','player_state',**scope(room))
    oldrun=room['run_id'];oldwindow=room['action']['id'] if room['action'] else None;room=begin(room);record(family+' Play Again unique run',room['run_id']!=oldrun)
    if oldwindow:
     deny(family+' stale run cannot publish','H','host_publish',state='22023',**scope(room),p_run_id=oldrun,p_patch={'phase':'lobby','state':{}},p_expected_version=room['version'],p_request_id=str(uuid4()))
     deny(family+' stale run cannot create a new answer','P1','submit',**scope(room),p_run_id=oldrun,p_window_id=str(uuid4()),p_choice='Alpha',p_request_id=str(uuid4()))
    rpc('P1','leave',**scope(room));record(family+' leave idempotent',rpc('P1','leave',**scope(room))=={'left':True})
    deny(family+' departed member state denied','P1','player_state',**scope(room))
    newmember=rpc('P1','join',**scope(room),p_name='Same name');record(family+' rejoin new membership',newmember['id']!=one)
    sql('UPDATE party_private.rooms SET expires_at=clock_timestamp()-interval \'1 second\' WHERE code='+literal(room['code'])+';')
    deny(family+' expiry denies host','H','host_resume',**scope(room))
   # Two Bible editions use immutable routing and independent rooms.
   for family in ['spines','circuit']:
    room=create('H',family,'bible');record(family+' Bible creation',room['edition']=='bible')
    deny(family+' general route hides Bible room','P1','preview',p_code=room['code'],p_family=family,p_edition='general')
   record('all gameplay preserves legacy rows/policies/grants',legacy==sql(LEGACY_AUDIT_SQL))
   record('all gameplay preserves existing protected Show rows',show_baseline==sql('SELECT '+table_rows_sql('show_private',('rooms','members','questions','answers','buzzes','awards','requests'))+';'))
   record('existing protected Show function definitions/grants unchanged',show_functions==sql("SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='show_private' OR(n.nspname='public' AND pg_catalog.left(proname,5)='show_');"))
   report['api_state']=json.loads(sql("""SELECT jsonb_build_object(
    'api',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definition_md5',md5(pg_get_functiondef(p.oid)),'security_definer',p.prosecdef,'config',p.proconfig,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'auth_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,6)='party_'),
    'private_tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'anon_privileges',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),'auth_privileges',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='party_private' AND c.relkind='r'),
    'private_schema',jsonb_build_object('anon_usage',has_schema_privilege('anon','party_private','USAGE'),'auth_usage',has_schema_privilege('authenticated','party_private','USAGE')),
    'private_helpers',(SELECT jsonb_build_object('functions',count(*),'anon_executable',count(*) FILTER(WHERE has_function_privilege('anon',p.oid,'EXECUTE')),'auth_executable',count(*) FILTER(WHERE has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='party_private'));
   """))
   before=snapshot();sql('BEGIN;'+inputs[2].read_text()+'COMMIT;');record('rollback retains all private records',snapshot()==before)
   record('rollback preserves every existing secured family and legacy data',secured_snapshot()==secured and legacy==sql(LEGACY_AUDIT_SQL))
   record('rollback removes all client API grants',sql("SELECT bool_and(NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_catalog.left(proname,6)='party_';")=='t')
   report['passed']=True
 except Exception as error:
  report['error']=type(error).__name__+': '+str(error)
  raise
 finally:
  try:
   if container:docker(['rm','--force','--volumes',container])
   report['cleanup_completed']=True
  except Exception as cleanup_error:
   report['cleanup_error']=str(cleanup_error);report['passed']=False
  finally:
   report['finished_at']=datetime.now(timezone.utc).isoformat();report['count']=len(report['tests']);report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n');report_path.chmod(0o600)
 if not report['passed']:raise AssertionError(report.get('cleanup_error','Party verification failed'))
 return report
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--report',type=Path,required=True);args=parser.parse_args();run_checks(args.report)
