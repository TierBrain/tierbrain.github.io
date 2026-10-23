#!/usr/bin/env python3
"""Final legacy ACL cutover acceptance in disposable PostgreSQL only.

Uses synthetic auth.uid claims and rows. Never contacts hosted Supabase, Auth or
HTTP. Separate real JWT/browser acceptance must already pass for every family.
"""
from __future__ import annotations
import argparse
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

ROOT=Path(__file__).resolve().parents[1]
IMAGE='postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
DOCKER=['docker','--host=unix:///var/run/docker.sock']
TARGETS=('rooms','players','answers','buzzes','legends')

def literal(value):return "'"+str(value).replace("'","''")+"'"
def migration(root,suffix):
 paths=list((root/'supabase/migrations').glob('*_'+suffix+'.sql'))
 if len(paths)!=1:raise AssertionError('Expected one '+suffix+' migration in '+str(root))
 return paths[0]

def run_checks(report_path):
 env={k:v for k,v in os.environ.items() if k not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
 name='tierbrain-legacy-retirement-'+secrets.token_hex(6);container=None
 report={'format':'tierbrain-legacy-retirement-v1','passed':False,'tests':[],
  'started_at':datetime.now(timezone.utc).isoformat(),'image':IMAGE,'cleanup_completed':False,
  'limits':['Synthetic driver-set auth.uid; not real JWT/HTTP/browser acceptance','Passive cron fixture; does not call cleanup']}
 def docker(args,data=None):
  p=subprocess.run(DOCKER+args,input=data,text=True,capture_output=True,env=env,timeout=60)
  if p.returncode:raise AssertionError(p.stderr or p.stdout)
  return p.stdout.strip()
 def sql(query):return docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],query)
 def record(label,condition=True):
  report['last_case']=label
  if not condition:raise AssertionError(label)
  report['tests'].append({'name':label,'passed':True});print(label+': passed',flush=True)
 def context(query,role='authenticated',actor=None):
  if role not in ('anon','authenticated','service_role'):raise ValueError('Unexpected role')
  return sql('BEGIN;SET LOCAL ROLE '+role+';SET LOCAL request.jwt.claim.sub='+literal(actor or str(uuid4()))+';'+query+';COMMIT;')
 def rows():
  tables=json.loads(sql("SELECT json_agg(format('%I.%I',n.nspname,c.relname) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','show_private','bigquiz_private','throne_private','party_private','cron');"))
  return json.loads(sql('SELECT jsonb_build_object('+','.join(literal(t)+",(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM "+t+' x)' for t in tables)+');'))
 def metadata():
  # ACL/policies of five retired tables and their owned sequences may change;
  # every other relation, column, API, schema and default remains byte-for-byte.
  return json.loads(sql("""SELECT jsonb_build_object(
   'relations',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
     'owner',c.relowner,'acl',CASE WHEN n.nspname='public' AND c.relname=ANY(ARRAY['rooms','players','answers','buzzes','legends','retirement_owned_rooms_seq','retirement_owned_legends_seq']) THEN NULL ELSE c.relacl::text END,
     'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,
     'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',a.atttypid,'mod',a.atttypmod,'notnull',a.attnotnull,
       'acl',CASE WHEN n.nspname='public' AND c.relname=ANY(ARRAY['rooms','players','answers','buzzes','legends']) THEN NULL ELSE a.attacl::text END,
       'default',pg_get_expr(ad.adbin,ad.adrelid)) ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
     'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
     'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid) FROM pg_index WHERE indrelid=c.oid),
     'policies',CASE WHEN n.nspname='public' AND c.relname=ANY(ARRAY['rooms','players','answers','buzzes','legends']) THEN NULL ELSE
       (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'roles',p.polroles::text,'permissive',p.polpermissive,'command',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) END)
     ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','show_private','bigquiz_private','throne_private','party_private','cron')),
   'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'owner',p.proowner,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','show_private','bigquiz_private','throne_private','party_private')),
   'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',nspowner,'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','show_private','bigquiz_private','throne_private','party_private','cron')),
   'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY defaclrole,defaclnamespace,defaclobjtype) FROM pg_default_acl d),
   'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member),'[]') FROM pg_auth_members m),
   'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'bypass',rolbypassrls) ORDER BY rolname) FROM pg_roles));"""))
 def acl_snapshot():return sql("SELECT jsonb_build_object('relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl::text) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl::text) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p));")
 def denies(query,role='authenticated'):
  before=rows();observed=None
  try:context(query,role)
  except AssertionError as error:observed=str(error)
  record(role+' denied '+query,observed is not None and 'permission denied' in observed and rows()==before)
 def failed_migration(label,setup,undo):
  sql(setup);before=(rows(),metadata(),acl_snapshot())
  try:sql('BEGIN;'+cutover.read_text()+'COMMIT;')
  except AssertionError:pass
  else:raise AssertionError(label+' must reject drift')
  record(label,(rows(),metadata(),acl_snapshot())==before);sql(undo)

 try:
  throne_root=Path(os.environ.get('TIERBRAIN_THRONE_SOURCE',ROOT)).resolve()
  party_root=Path(os.environ.get('TIERBRAIN_PARTY_SOURCE',ROOT)).resolve()
  cutover=migration(ROOT,'retire_legacy_multiplayer');rollback=ROOT/'supabase/rollback/retire_legacy_multiplayer.sql'
  inputs=[ROOT/'tests/fixtures/show_auth_baseline.sql',ROOT/'tests/fixtures/legacy_retirement_baseline.sql',ROOT/'tests/fixtures/scores_baseline.sql',migration(ROOT,'score_game_contracts'),migration(ROOT,'secure_show_rooms'),migration(ROOT,'secure_big_quiz_rooms'),migration(throne_root,'secure_throne_rooms'),migration(party_root,'secure_party_rooms'),cutover,rollback]
  report['input_sha256']={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
  docker(['info','--format','{{.ServerVersion}}']);docker(['image','inspect',IMAGE])
  with tempfile.TemporaryDirectory(prefix='tierbrain-retirement-') as temp:
   pw=Path(temp)/'local.env';pw.write_text('POSTGRES_PASSWORD='+secrets.token_urlsafe(36)+'\n');pw.chmod(0o600)
   container=docker(['run','--detach','--name',name,'--network','none','--memory','512m','--label','codex.task=tierbrain-legacy-retirement-tests','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=256m','--env-file',str(pw),IMAGE,'postgres','-c','listen_addresses=','-c','shared_buffers=32MB','-c','max_connections=20'])
   deadline=time.monotonic()+30
   while True:
    try:
     if docker(['exec',name,'cat','/proc/1/comm'])=='postgres' and sql('SELECT 1;')=='1':break
    except AssertionError:pass
    if time.monotonic()>deadline:raise AssertionError('Disposable PostgreSQL readiness failed')
    time.sleep(.2)
   info=json.loads(docker(['inspect',name]))[0]
   record('disposable PostgreSQL has no network/listener/host ports',info['Id']==container and info['HostConfig']['NetworkMode']=='none' and not info['HostConfig']['PortBindings'] and sql('SHOW listen_addresses;')=='')
   sql('BEGIN;'+inputs[0].read_text()+inputs[1].read_text()+'DROP TABLE public.scores;'+('CREATE TABLE public.scores'+inputs[2].read_text().split('CREATE TABLE public.scores',1)[1])+inputs[3].read_text()+'COMMIT;')
   # Only fixture construction above drops/rebuilds its synthetic score table.
   # The reviewed production cutover contains no data DDL or DML.
   sql("INSERT INTO public.scores(quiz_id,group_code,name,correct,level,time_left) VALUES('qc_jigsaw','global','Historical score',12,1,4);")
   for p in inputs[4:8]:sql('BEGIN;'+p.read_text()+'COMMIT;')
   host=str(uuid4());player=str(uuid4())
   show=json.loads(context('SELECT public.show_create_room('+literal(uuid4())+'::uuid)',actor=host))
   context('SELECT public.show_join('+literal(show['code'])+",'Protected member','youth')",actor=player)
   big=json.loads(context('SELECT public.bigquiz_create_room('+literal(uuid4())+'::uuid)',actor=host))
   context('SELECT public.bigquiz_join('+literal(big['code'])+",'Protected member','youth')",actor=player)
   throne=json.loads(context("SELECT public.throne_create_room('general',"+literal(uuid4())+'::uuid)',actor=host))
   context('SELECT public.throne_join('+literal(throne['code'])+",'general','Protected')",actor=player)
   party=json.loads(context("SELECT public.party_create_room('creak','general',"+literal(uuid4())+'::uuid)',actor=host))
   context('SELECT public.party_join('+literal(party['code'])+",'creak','general','Protected')",actor=player)
   legends_before=json.loads(context("SELECT public.throne_legends('general','GROUP_A')"))
   record('fixture contains exact historical Hall scope',len(legends_before)==1 and legends_before[0]['name']=='Historical General')
   failed_migration('unexpected moves relation aborts atomically','CREATE TABLE public.moves(id bigint);','DROP TABLE public.moves;')
   failed_migration('unexpected policy aborts atomically','CREATE POLICY extra_access ON public.rooms FOR SELECT TO anon USING(true);','DROP POLICY extra_access ON public.rooms;')
   failed_migration('changed known policy predicate aborts atomically','ALTER POLICY rooms_sel ON public.rooms USING(false);','ALTER POLICY rooms_sel ON public.rooms USING(true);')
   failed_migration('missing secured family API aborts atomically','ALTER FUNCTION public.party_preview(text,text,text) RENAME TO absent_party_preview;','ALTER FUNCTION public.absent_party_preview(text,text,text) RENAME TO party_preview;')
   failed_migration('accessible view alias aborts atomically','CREATE VIEW public.legacy_view AS SELECT * FROM public.rooms;GRANT SELECT ON public.legacy_view TO anon;','DROP VIEW public.legacy_view;')
   failed_migration('unexpected callable definer API aborts atomically',"CREATE FUNCTION public.legacy_api_alias() RETURNS SETOF public.rooms LANGUAGE sql SECURITY DEFINER SET search_path='' AS 'SELECT * FROM public.rooms';GRANT EXECUTE ON FUNCTION public.legacy_api_alias() TO anon;",'DROP FUNCTION public.legacy_api_alias();')
   sql('CREATE ROLE retirement_inherited;GRANT retirement_inherited TO authenticated;')
   failed_migration('inherited table grants cause complete transaction rollback','GRANT SELECT ON public.answers TO retirement_inherited;','REVOKE SELECT ON public.answers FROM retirement_inherited;')
   failed_migration('inherited column grants cause complete transaction rollback','GRANT SELECT(id) ON public.answers TO retirement_inherited;','REVOKE SELECT(id) ON public.answers FROM retirement_inherited;')
   failed_migration('inherited owned-sequence grants cause complete transaction rollback','GRANT USAGE ON SEQUENCE public.retirement_owned_rooms_seq TO retirement_inherited;','REVOKE USAGE ON SEQUENCE public.retirement_owned_rooms_seq FROM retirement_inherited;')
   sql('REVOKE retirement_inherited FROM authenticated;DROP ROLE retirement_inherited;')
   before_rows=rows();before_meta=metadata()
   service_sql="SELECT jsonb_agg(jsonb_build_array(c.relname,priv,has_table_privilege('service_role',c.oid,priv),has_table_privilege('postgres',c.oid,priv)) ORDER BY c.relname,priv) FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS privileges(priv) WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('rooms','players','answers','buzzes','legends');"
   service_before=sql(service_sql)
   sql('BEGIN;'+cutover.read_text()+'COMMIT;')
   record('every legacy/score/private/cron row preserved',rows()==before_rows)
   record('every unintended relation/API/schema/default/role metadata preserved',metadata()==before_meta)
   record('postgres and service-role legacy privileges preserved',sql(service_sql)==service_before)
   record('legacy policies removed with RLS retained',sql("SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.rooms'::regclass,'public.players'::regclass,'public.answers'::regclass,'public.buzzes'::regclass,'public.legends'::regclass);")=='0' and sql("SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('rooms','players','answers','buzzes','legends');")=='t')
   for role in ('anon','authenticated'):
    for t in TARGETS:
     for query in ('SELECT * FROM public.'+t,'INSERT INTO public.'+t+' DEFAULT VALUES','UPDATE public.'+t+' SET id=id','DELETE FROM public.'+t,'TRUNCATE public.'+t):denies(query,role)
    for seq in ('retirement_owned_rooms_seq','retirement_owned_legends_seq'):
     denies('SELECT last_value FROM public.'+seq,role)
     denies('SELECT nextval('+literal('public.'+seq)+')',role)
   record('narrow historical Hall bridge still works',json.loads(context("SELECT public.throne_legends('general','GROUP_A')"))==legends_before)
   record('Hall bridge remains edition and group scoped',json.loads(context("SELECT public.throne_legends('general','OTHER')"))==[] and json.loads(context("SELECT public.throne_legends('bible','GROUP_A')"))[0]['name']=='Historical Bible')
   for fn,args in (('show_host_resume',literal(show['code'])),('bigquiz_host_resume',literal(big['code'])),('throne_host_resume',literal(throne['code'])+",'general'"),('party_host_resume',literal(party['code'])+",'creak','general'")):
    result=json.loads(context('SELECT public.'+fn+'('+args+')',actor=host))
    record('secured '+fn+' still resumes owned room',isinstance(result,dict) and result.get('code'))
   context("INSERT INTO public.scores(quiz_id,group_code,name,correct,level,time_left) VALUES('qc_jigsaw','global','New safe score',12,1,7)",role='anon')
   record('repaired anonymous score insert and public read remain functional',len(json.loads(context('SELECT json_agg(s) FROM public.scores s',role='anon')))==2)
   try:context("INSERT INTO public.scores(quiz_id,group_code,name,correct,level,time_left) VALUES('qc_jigsaw','global','Bad score',13,1,7)",role='anon')
   except AssertionError:record('score validation still rejects invalid tier/piece contract')
   else:raise AssertionError('Invalid score unexpectedly accepted')
   after=(rows(),metadata(),acl_snapshot());sql('BEGIN;'+rollback.read_text()+'COMMIT;')
   record('safe rollback preserves every row and closed access',(rows(),metadata(),acl_snapshot())==after)
   report['passed']=True
 except Exception as error:
  report['error']=str(error);raise
 finally:
  try:
   if container:
    info=json.loads(docker(['inspect',name]))[0]
    if info['Id']!=container or info['Config']['Labels'].get('codex.task')!='tierbrain-legacy-retirement-tests':raise AssertionError('Refusing cleanup of unknown container')
    docker(['rm','--force',name])
   report['cleanup_completed']=True
  finally:
   report['finished_at']=datetime.now(timezone.utc).isoformat()
   report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n');report_path.chmod(0o600)
 if report['passed']:print(json.dumps({'passed':True,'checks':len(report['tests']),'cleanup_completed':report['cleanup_completed']}))

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--report',type=Path,default=Path(tempfile.gettempdir())/'tierbrain-legacy-retirement.json')
 run_checks(parser.parse_args().report)
