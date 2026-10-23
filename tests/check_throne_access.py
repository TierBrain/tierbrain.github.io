#!/usr/bin/env python3
"""Explicit disposable PostgreSQL acceptance for both Throne editions.

No live project or HTTP is contacted. This harness uses driver-set synthetic
auth.uid() claims, and advances synthetic timestamps to test each window without
sleeping. Real JWT/PostgREST and visible browser tests remain separate checks.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
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

from check_show_access import IMAGE, DOCKER, LEGACY_AUDIT_SQL, literal, value_sql, table_rows_sql

ROOT = Path(__file__).resolve().parents[1]
TABLES = ('rooms','members','runs','questions','buzzes','answers','resolutions','results','requests')
RPCS = ('throne_create_room','throne_host_resume','throne_begin_run','throne_host_publish',
        'throne_host_open_question','throne_host_select_buzz','throne_host_grade',
        'throne_host_members','throne_host_answers','throne_finalize','throne_preview',
        'throne_join','throne_my_membership','throne_heartbeat','throne_leave',
        'throne_player_state','throne_buzz','throne_answer','throne_legends')


def run_checks(report_path):
    env = {k:v for k,v in os.environ.items() if k not in {
        'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
    name='tierbrain-throne-access-'+secrets.token_hex(6)
    label='tierbrain-throne-access-tests'
    container=None
    actors={actor:str(uuid4()) for actor in ['H','O','P1','P2','P3']}
    report={'format':'tierbrain-throne-access-v1','passed':False,'image':IMAGE,'tests':[],
            'started_at':datetime.now(timezone.utc).isoformat(),
            'limits':['Synthetic driver-set auth.uid(); not real Auth/JWT verification',
                      'Synthetic timestamp advancement; not HTTP/browser acceptance'],
            'cleanup_completed':False}

    def docker(args,data=None):
        p=subprocess.run(DOCKER+args,input=data,text=True,capture_output=True,env=env,timeout=60)
        if p.returncode:raise AssertionError(p.stderr or p.stdout)
        return p.stdout.strip()

    def sql(query):
        return docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],query)

    def context(actor,query,role='authenticated'):
        if role not in ('anon','authenticated','service_role'):raise ValueError('Unexpected role')
        return sql('BEGIN; SET LOCAL ROLE '+role+'; SET LOCAL request.jwt.claim.sub='+literal(actors[actor] if actor else '')+';\n'+query+'\nCOMMIT;')

    def call_sql(fn,args):
        if fn not in RPCS:raise ValueError('Unexpected RPC')
        return 'public.'+fn+'('+','.join(k+'=>'+value_sql(v) for k,v in args.items())+')'

    def rpc(actor,fn,**args):
        report['last_case']=actor+' '+fn
        return json.loads(context(actor,'SELECT '+call_sql(fn,args)+';') or 'null')

    def rows():return json.loads(sql('SELECT '+table_rows_sql('throne_private',TABLES)+';'))

    def record(title,condition=True,**details):
        report['last_case']=title
        if not condition:raise AssertionError(title)
        report['tests'].append({'name':title,'passed':True,**details})
        print(title+': passed',flush=True)

    def deny_raw(title,actor,query,state='42501',role='authenticated'):
        before=rows()
        block="""DO $test$ DECLARE observed text; BEGIN
        BEGIN EXECUTE %s; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
        IF observed IS DISTINCT FROM %s THEN RAISE EXCEPTION 'Expected %s got %%',observed; END IF;
        END $test$;"""%(literal(query),literal(state),state)
        context(actor,block,role)
        record(title,rows()==before,sqlstate=state,private_rows_unchanged=True)

    def deny(title,actor,fn,state='42501',role='authenticated',**args):
        deny_raw(title,actor,'SELECT '+call_sql(fn,args),state,role)

    def snapshot_family(schema='show_private',prefix='show_'):
        return json.loads(sql("""SELECT jsonb_build_object(
          'rows',%s,'relations',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity) ORDER BY c.relname)
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=%s),
          'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid)
           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=%s OR (n.nspname='public' AND left(p.proname,%s)=%s)));
        """%(table_rows_sql(schema,('rooms','members','questions','answers','buzzes','awards','requests')),literal(schema),literal(schema),len(prefix),literal(prefix))))

    try:
        matches=list((ROOT/'supabase/migrations').glob('*_secure_throne_rooms.sql'))
        if len(matches)!=1:raise AssertionError('Expected exactly one new Throne migration')
        migration=matches[0]
        files=[ROOT/'tests/fixtures/show_auth_baseline.sql',ROOT/'tests/fixtures/throne_access_baseline.sql',
               ROOT/'supabase/migrations/20261021062330_secure_show_rooms.sql',
               ROOT/'supabase/migrations/20261021160821_secure_big_quiz_rooms.sql',migration,
               ROOT/'supabase/rollback/secure_throne_rooms.sql']
        report['input_sha256']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        docker(['info','--format','{{.ServerVersion}}']);docker(['image','inspect',IMAGE])
        with tempfile.TemporaryDirectory(prefix='tierbrain-throne-access-') as temp:
            secret=Path(temp)/'local.env';secret.write_text('POSTGRES_PASSWORD='+secrets.token_urlsafe(36)+'\n');secret.chmod(0o600)
            container=docker(['run','--detach','--name',name,'--network','none','--memory','512m',
                '--label','codex.task='+label,'--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=256m',
                '--env-file',str(secret),IMAGE,'postgres','-c','listen_addresses=','-c','shared_buffers=32MB','-c','max_connections=20'])
            deadline=time.monotonic()+30
            while True:
                pid=subprocess.run(DOCKER+['exec',name,'cat','/proc/1/comm'],text=True,capture_output=True,env=env,timeout=5)
                if pid.returncode==0 and pid.stdout.strip()=='postgres':
                    try:
                        if sql('SELECT 1;')=='1':break
                    except AssertionError:pass
                if time.monotonic()>deadline:raise AssertionError('Disposable PostgreSQL readiness failed')
                time.sleep(.2)
            info=json.loads(docker(['inspect',name]))[0]
            record('disposable PostgreSQL has no network, TCP listener, host ports or persistent data',
                info['Id']==container and info['Config']['Labels']['codex.task']==label and
                info['HostConfig']['NetworkMode']=='none' and not info['HostConfig']['PortBindings'] and sql('SHOW listen_addresses;')=='')
            sql('BEGIN;\n'+''.join(p.read_text() for p in files[:4])+'\nCOMMIT;')
            # Existing secured Show data is distinct from both new Throne editions.
            context('H',"SELECT public.show_create_room('"+str(uuid4())+"');")
            context('H',"SELECT public.bigquiz_create_room('"+str(uuid4())+"');")
            legacy=json.loads(sql(LEGACY_AUDIT_SQL));show=snapshot_family();bigquiz=snapshot_family('bigquiz_private','bigquiz_')
            sql('BEGIN;\n'+migration.read_text()+'\nCOMMIT;')
            record('migration preserves every legacy row and schema/policy/grant/cron snapshot',json.loads(sql(LEGACY_AUDIT_SQL))==legacy)
            record('migration preserves existing secured Bible Show data/API/privileges',snapshot_family()==show)
            record('migration preserves existing secured Big Quiz data/API/privileges',snapshot_family('bigquiz_private','bigquiz_')==bigquiz)
            catalog=json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,'settings',p.proconfig,
              'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
              'args',p.proargnames) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'throne\\_%' ESCAPE '\\';"""))
            record('all 19 RPCs are authenticated-only with definer and empty search_path',len(catalog)==19 and {f['name'] for f in catalog}==set(RPCS) and all(f['definer'] and f['settings']==['search_path=""'] and not f['anon'] and f['authenticated'] for f in catalog))
            signatures={f['name']:f['args'] for f in catalog}
            record('player signatures cannot nominate a different member, owner, score or receipt time',signatures['throne_answer']==['p_code','p_edition','p_question_id','p_choice'] and signatures['throne_buzz']==['p_code','p_edition','p_question_id'] and signatures['throne_join']==['p_code','p_edition','p_name'])
            for role in ['anon','authenticated']:
                for table in TABLES:
                    column='user_id' if table=='requests' else 'question_id' if table=='resolutions' else 'run_id' if table=='results' else 'id'
                    for statement in ['SELECT * FROM throne_private.'+table,'INSERT INTO throne_private.'+table+' DEFAULT VALUES','UPDATE throne_private.'+table+' SET '+column+'='+column,'DELETE FROM throne_private.'+table]:
                        deny_raw(role+' cannot '+statement.split()[0]+' private '+table,'P1',statement,role=role)
                deny_raw(role+' cannot invoke private helper','P1','SELECT throne_private.uid()',role=role)
            closed=json.loads(sql("""SELECT jsonb_build_object('tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='throne_private' AND c.relkind='r' AND c.relrowsecurity),
            'policies',(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='throne_private'));"""))
            record('all nine private backing tables retain RLS and zero client policies',closed=={'tables':9,'policies':0})
            deny('anon with a claimed subject cannot create','H','throne_create_room',role='anon',p_edition='general',p_request_id=str(uuid4()))
            deny('authenticated without subject cannot create',None,'throne_create_room',p_edition='general',p_request_id=str(uuid4()))
            request=str(uuid4());room=rpc('H','throne_create_room',p_edition='general',p_request_id=request);code=room['code'];edition='general'
            record('create allocates private canonical identity and fixed expiry',room['phase']=='lobby' and room['run_id'] is None and room['q_id'] is None and room['version']==0 and len(code)==5 and not {'host_user_id','user_id'}.intersection(room))
            before=rows();record('create lost-ack retry returns same room',rpc('H','throne_create_room',p_edition=edition,p_request_id=request)==room and rows()==before)
            deny('request UUID cannot change edition','H','throne_create_room',state='22023',p_edition='bible',p_request_id=request)
            record('preview exposes code edition and phase only',rpc('O','throne_preview',p_code=code.lower(),p_edition=edition)=={'code':code,'edition':edition,'phase':'lobby'})
            record('wrong edition preview does not disclose a room',rpc('O','throne_preview',p_code=code,p_edition='bible') is None)
            for fn in ['throne_host_resume','throne_host_members','throne_player_state']:
                deny('knowing code alone cannot call '+fn,'O',fn,p_code=code,p_edition=edition)
            deny('host cannot resume own room through another edition','H','throne_host_resume',p_code=code,p_edition='bible')
            members={a:rpc(a,'throne_join',p_code=code,p_edition=edition,p_name='Player '+a) for a in ['P1','P2','P3']}
            p1,p2,p3=[members[a]['id'] for a in ['P1','P2','P3']]
            record('join and membership derive canonical identity',rpc('P1','throne_my_membership',p_code=code,p_edition=edition)==members['P1'] and rpc('P1','throne_join',p_code=code,p_edition=edition,p_name='Imposter')==members['P1'])
            deny('join enforces name bounds','O','throne_join',state='22023',p_code=code,p_edition=edition,p_name='x'*15)
            deny('wrong edition join denied','P1','throne_join',p_code=code,p_edition='bible',p_name='Player')
            other=rpc('O','throne_create_room',p_edition=edition,p_request_id=str(uuid4()))
            outsider=rpc('O','throne_join',p_code=other['code'],p_edition=edition,p_name='Other room')

            def host(fn,**args):
                nonlocal room
                request={'p_code':code,'p_edition':edition,'p_expected_version':room['version'],'p_request_id':str(uuid4()),**args}
                if fn!='throne_begin_run':request['p_run_id']=room['run_id']
                result=rpc('H',fn,**request)
                room=result.get('room',result)
                return result,request

            def publish(phase,**state):
                base={'live':True,'champ':room['state'].get('champ'),'chal':room['state'].get('chal'),'queue':room['state'].get('queue',[])}
                return host('throne_host_publish',p_patch={'phase':phase,'state':base|state})

            def opened(index,champ,chal,mode='spine'):
                # Keep selected fixture seats live while the wide SQL matrix runs.
                for actor,member in members.items():
                    if member['id'] in (champ,chal):rpc(actor,'throne_heartbeat',p_code=code,p_edition=edition)
                waiting=[member for member in room['state'].get('queue',[]) if member['id'] not in (champ,chal)]
                return host('throne_host_open_question',p_question={'q':'Synthetic question','opts':['A','B','C','D'],'qIndex':index,'champ_id':champ,'chal_id':chal,'queue':waiting,'mode':mode})[0]

            def unlock():sql('UPDATE throne_private.questions SET buzz_open_at=clock_timestamp()-interval \'1 second\',buzz_deadline=clock_timestamp()+interval \'1 minute\' WHERE id='+literal(room['q_id'])+';')

            def expire_buzz():sql('UPDATE throne_private.questions SET buzz_deadline=clock_timestamp()-interval \'1 second\' WHERE id='+literal(room['q_id'])+';')

            def answer_win(actor,choice=1):
                unlock();rpc(actor,'throne_buzz',p_code=code,p_edition=edition,p_question_id=room['q_id']);host('throne_host_select_buzz',p_question_id=room['q_id'])
                rpc(actor,'throne_answer',p_code=code,p_edition=edition,p_question_id=room['q_id'],p_choice=choice)
                return host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=members[actor]['id'],p_correct=True)

            def reveal():return publish('reveal',reveal={'ok':True,'msg':'Synthetic reveal','sub':'','correctIdx':1})

            _,begin_request=host('throne_begin_run',p_config={'qTotal':3,'answerMs':4000,'live':True})
            before=rows();record('begin request replays same server run',rpc('H','throne_begin_run',**begin_request)==room and rows()==before)
            deny('stale host version uses HTTP409 custom SQLSTATE','H','throne_begin_run',state='PT409',p_code=code,p_edition=edition,p_config={'qTotal':3,'answerMs':4000,'live':True},p_expected_version=0,p_request_id=str(uuid4()))
            publish('lobby',champ=members['P1'],chal=members['P2'],queue=[members['P3']])
            badq={'q':'Synthetic','opts':['A','B','C','D'],'qIndex':1,'champ_id':p1,'chal_id':outsider['id'],'mode':'spine'}
            deny('seats cannot reference another room','H','throne_host_open_question',state='22023',p_code=code,p_edition=edition,p_run_id=room['run_id'],p_question=badq,p_expected_version=room['version'],p_request_id=str(uuid4()))
            opened(1,p1,p2);qid1=room['q_id']
            record('server issues question UUID and windows independent of browser identities',room['state']['qId']==qid1 and room['state']['buzzWin']-room['state']['buzzOpenAt']==6000 and 2900<=room['state']['buzzOpenAt']-room['server_now']<=3100 and len(room['state']['queue'])==1 and room['state']['reveal'] is None)
            deny('server countdown blocks early buzz','P1','throne_buzz',p_code=code,p_edition=edition,p_question_id=qid1)
            unlock()
            deny('queued member cannot buzz','P3','throne_buzz',p_code=code,p_edition=edition,p_question_id=qid1)
            buzz=rpc('P1','throne_buzz',p_code=code,p_edition=edition,p_question_id=qid1)
            before=rows();record('buzz retry is idempotent',rpc('P1','throne_buzz',p_code=code,p_edition=edition,p_question_id=qid1)==buzz and rows()==before)
            host('throne_host_select_buzz',p_question_id=qid1)
            record('host selection chooses canonical server-received seated buzzer',room['state']['answerer']['id']==p1)
            deny('opponent cannot answer before handoff','P2','throne_answer',p_code=code,p_edition=edition,p_question_id=qid1,p_choice=1)
            a=rpc('P1','throne_answer',p_code=code,p_edition=edition,p_question_id=qid1,p_choice=0)
            deny('member cannot replace recorded choice','P1','throne_answer',state='22023',p_code=code,p_edition=edition,p_question_id=qid1,p_choice=1)
            handoff,_=host('throne_host_grade',p_question_id=qid1,p_answerer_id=p1,p_correct=False)
            record('first miss hands answer to opponent without their own buzz',handoff['outcome']=='handoff' and room['state']['answerer']['id']==p2 and room['state']['lockedOut']==[p1] and sql('SELECT count(*) FROM throne_private.buzzes WHERE member_id='+literal(p2)+';')=='0')
            rpc('P2','throne_answer',p_code=code,p_edition=edition,p_question_id=qid1,p_choice=1)
            won,grade_request=host('throne_host_grade',p_question_id=qid1,p_answerer_id=p2,p_correct=True)
            record('confirmed win derives streak, total and loser blemish once',won['outcome']=='win' and won['winner']['id']==p2 and won['stats']['streak']==1 and won['stats']['bestStreak'][p2]==1 and won['stats']['totalCorrect'][p2]==1 and p1 in won['stats']['blemished'] and room['state']['champ']['id']==p2)
            before=rows();record('lost grade acknowledgement cannot double score',rpc('H','throne_host_grade',**grade_request)==won and rows()==before)
            deny('grade UUID cannot change correctness','H','throne_host_grade',state='22023',**(grade_request|{'p_correct':False}))
            before=rows();record('same answer retries after closure preserve canonical receipt',rpc('P1','throne_answer',p_code=code,p_edition=edition,p_question_id=qid1,p_choice=0)==a and rows()==before)
            deny('closed question rejects new answer','P3','throne_answer',p_code=code,p_edition=edition,p_question_id=qid1,p_choice=1)
            reveal();record('correct index is confined to resolved reveal',room['state']['reveal']['correctIdx']==1 and 'correctIdx' not in room['state']['q'])
            publish('between',champ=members['P2'],chal=members['P3'],queue=[members['P1']],between={'msg':'Next'})
            record('next phase removes old reveal correctness',room['state']['reveal'] is None and 'correctIdx' not in room['state']['q'])
            opened(2,p2,p3)
            waiting,_=host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=None,p_correct=False)
            record('early timeout is read-equivalent and does not consume scoring request budget',waiting['outcome']=='waiting' and len(rows()['resolutions'])==1)
            expire_buzz();missed,_=host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=None,p_correct=False)
            record('expired empty question resolves both miss and resets streak',missed['outcome']=='bothmiss' and missed['stats']['streak']==0 and {p1,p2,p3}.issubset(missed['stats']['blemished']))
            reveal();publish('between',champ=members['P1'],chal=members['P2'],queue=[members['P3']],between={'msg':'Next'})
            opened(3,p1,p2);answer_win('P1');reveal()
            deny('distinct closer and longest streak require finale','H','throne_finalize',p_code=code,p_edition=edition,p_run_id=room['run_id'],p_winner_id=p1,p_group_code='GROUP_A',p_expected_version=room['version'],p_request_id=str(uuid4()))
            publish('finintro',champ=members['P1'],chal=members['P2'],queue=[],finintro={'msg':'Finale'},finalists={'closer':members['P1'],'king':members['P2']})
            record('canonical finintro preserves finale mode after host sync',room['state']['mode']=='finale' and room['state']['streak']==0)
            opened(3,p1,p2,'finale');finale1=room['q_id'];answer_win('P1');reveal();publish('between',between={'msg':'Finale next'})
            opened(3,p1,p2,'finale');finale2=room['q_id'];expire_buzz();host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=None,p_correct=False);reveal();publish('between',between={'msg':'Finale draw'})
            opened(3,p1,p2,'finale');finale3=room['q_id'];answer_win('P1');reveal()
            record('repeated finale indices get unique questions and draw does not add points',len({finale1,finale2,finale3})==3 and room['state']['finaleScore']=={p1:2} and room['state']['finaleWinner']['id']==p1)
            result,finalize_request=host('throne_finalize',p_winner_id=p1,p_group_code='GROUP_A')
            before=rows();record('completed run result is derived and finalize replay is safe',result['result']['name']=='Player P1' and result['result']['streak']==1 and result['result']['flawless'] is False and room['state']['summary']['recorded'] and rpc('H','throne_finalize',**finalize_request)==result and rows()==before)
            deny('one run cannot be published to another group','H','throne_finalize',state='22023',p_code=code,p_edition=edition,p_run_id=room['run_id'],p_winner_id=p1,p_group_code='GROUP_B',p_expected_version=room['version'],p_request_id=str(uuid4()))
            legend_a=rpc('O','throne_legends',p_edition=edition,p_group_code='GROUP_A')
            record('historical and new legends share exact edition/group scope',len(legend_a)==2 and {v['name'] for v in legend_a}=={'Historical General','Player P1'} and rpc('O','throne_legends',p_edition=edition,p_group_code='GROUP_B')==[] and len(rpc('O','throne_legends',p_edition='bible',p_group_code='GROUP_A'))==1)
            deny('empty group cannot enumerate Hall of Fame','O','throne_legends',state='22023',p_edition=edition,p_group_code='')
            record('player state exposes own receipts without Auth subjects',not {'user_id','host_user_id'}.intersection(rpc('P1','throne_player_state',p_code=code,p_edition=edition)))

            # Bible edition: three consecutive main wins permit direct champion;
            # a local-default result must not become a shared group entry.
            room=rpc('H','throne_create_room',p_edition='bible',p_request_id=str(uuid4()));code=room['code'];edition='bible'
            members={a:rpc(a,'throne_join',p_code=code,p_edition=edition,p_name='Bible '+a) for a in ['P1','P2']}
            p1,p2=[members[a]['id'] for a in ['P1','P2']]
            host('throne_begin_run',p_config={'qTotal':3,'answerMs':4000,'live':True})
            for index in range(1,4):
                if index>1:publish('between',champ=members['P1'],chal=members['P2'],queue=[],between={'msg':'Next'})
                opened(index,p1,p2)
                if index==1:
                    unlock()
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        buzzes=list(pool.map(lambda actor:rpc(actor,'throne_buzz',p_code=code,p_edition=edition,p_question_id=room['q_id']),['P1','P2']))
                    earliest=sql('SELECT member_id FROM throne_private.buzzes WHERE question_id='+literal(room['q_id'])+' ORDER BY created_at,id LIMIT 1;')
                    host('throne_host_select_buzz',p_question_id=room['q_id'])
                    record('concurrent buzz ordering uses actual stored receipt order',room['state']['answerer']['id']==earliest)
                    if earliest==p2:
                        rpc('P2','throne_answer',p_code=code,p_edition=edition,p_question_id=room['q_id'],p_choice=0)
                        host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=p2,p_correct=False)
                    rpc('P1','throne_answer',p_code=code,p_edition=edition,p_question_id=room['q_id'],p_choice=1)
                    host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=p1,p_correct=True)
                else:answer_win('P1')
                reveal()
            result,_=host('throne_finalize',p_winner_id=p1,p_group_code=None)
            record('Bible local-default result derives three-win streak and stays unshared',result['result']['streak']==3 and result['result']['flawless'] and room['state']['winner']['id']==p1 and len(rpc('O','throne_legends',p_edition=edition,p_group_code='GROUP_A'))==1)
            old_member=members['P1'];rpc('P1','throne_leave',p_code=code,p_edition=edition)
            deny('left membership cannot read or retry old receipts','P1','throne_player_state',p_code=code,p_edition=edition)
            fresh=rpc('P1','throne_join',p_code=code,p_edition=edition,p_name='Rejoined')
            record('explicit leave/rejoin creates fresh member and preserves historical result',fresh['id']!=old_member['id'] and len(rows()['results'])==2 and len(rows()['members'])==7)
            old=room.copy();host('throne_begin_run',p_config={'qTotal':3,'answerMs':4000,'live':True})
            deny('old run cannot grade into fresh run','H','throne_host_grade',p_code=code,p_edition=edition,p_run_id=old['run_id'],p_question_id=old['q_id'],p_answerer_id=p1,p_correct=True,p_expected_version=room['version'],p_request_id=str(uuid4()))
            p1=fresh['id'];members['P1']=fresh
            opened(1,p1,p2);unlock();rpc('P1','throne_buzz',p_code=code,p_edition=edition,p_question_id=room['q_id'])
            host('throne_host_select_buzz',p_question_id=room['q_id'])
            pending,_=host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=p1,p_correct=False)
            record('a missing answer cannot be timed out before its server deadline',pending['outcome']=='waiting')
            sql('UPDATE throne_private.questions SET answer_deadline=clock_timestamp()-interval \'1 second\' WHERE id='+literal(room['q_id'])+';')
            deny('late answer is rejected by server receipt time','P1','throne_answer',p_code=code,p_edition=edition,p_question_id=room['q_id'],p_choice=1)
            timed_out,_=host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=p1,p_correct=False)
            record('expired first answer window hands off without inventing an answer',timed_out['outcome']=='handoff' and room['state']['answerer']['id']==p2)
            sql('UPDATE throne_private.questions SET answer_deadline=clock_timestamp()-interval \'1 second\' WHERE id='+literal(room['q_id'])+';')
            timed_out,_=host('throne_host_grade',p_question_id=room['q_id'],p_answerer_id=p2,p_correct=False)
            record('two expired answer windows resolve once without adding a win',timed_out['outcome']=='bothmiss' and timed_out['stats']['totalCorrect']=={} and len(rows()['results'])==2)
            sql('UPDATE throne_private.rooms SET expires_at=clock_timestamp()-interval \'1 second\' WHERE id='+literal(room['id'])+';')
            for actor,fn in [('H','throne_host_resume'),('P1','throne_player_state'),('P1','throne_heartbeat'),('P1','throne_leave')]:
                deny('expiry blocks '+fn,actor,fn,p_code=code,p_edition=edition)
            # A vacated main-game seat must not freeze a three-player run or
            # award a phantom win. Preserve the run and all earlier receipts.
            room=rpc('H','throne_create_room',p_edition='general',p_request_id=str(uuid4()));code=room['code'];edition='general'
            members={a:rpc(a,'throne_join',p_code=code,p_edition=edition,p_name='Seats '+a) for a in ['P1','P2','P3']}
            p1,p2,p3=[members[a]['id'] for a in ['P1','P2','P3']]
            host('throne_begin_run',p_config={'qTotal':3,'answerMs':4000,'live':True});seat_run=room['run_id']
            publish('lobby',champ=members['P1'],chal=members['P2'],queue=[members['P3']])
            opened(1,p1,p2);departed_question=room['q_id'];answer_win('P1');reveal()
            publish('between',champ=members['P1'],chal=members['P2'],queue=[members['P3']],between={'msg':'Next'})
            replacement={'q':'Replacement duel','opts':['A','B','C','D'],'qIndex':2,'champ_id':p2,'chal_id':p3,'queue':[],'mode':'spine'}
            deny('a live champion cannot be replaced to reset the streak','H','throne_host_open_question',state='PT412',p_code=code,p_edition=edition,p_run_id=room['run_id'],p_question=replacement,p_expected_version=room['version'],p_request_id=str(uuid4()))
            rpc('P1','throne_leave',p_code=code,p_edition=edition);opened(2,p2,p3)
            record('departed champion seat recovers within the same run without awarding points',room['run_id']==seat_run and room['state']['champ']['id']==p2 and room['state']['chal']['id']==p3 and room['state']['streak']==0 and room['state']['bestStreak']=={p1:1} and room['state']['totalCorrect']=={p1:1} and sql('SELECT count(*) FROM throne_private.resolutions WHERE run_id='+literal(seat_run)+';')=='1' and room['state']['queue']==[])
            deny('departed membership cannot reuse its earlier accepted answer','P1','throne_answer',p_code=code,p_edition=edition,p_question_id=departed_question,p_choice=1)
            deny('replacement seat cannot act through a prior question receipt','P2','throne_buzz',p_code=code,p_edition=edition,p_question_id=departed_question)
            answer_win('P2');reveal()
            members['P1']=rpc('P1','throne_join',p_code=code,p_edition=edition,p_name='Returned');p1=members['P1']['id']
            publish('between',champ=members['P2'],chal=members['P3'],queue=[members['P1']],between={'msg':'Next'})
            sql('UPDATE throne_private.members SET last_seen=clock_timestamp()-interval \'33 seconds\' WHERE id='+literal(p2)+';')
            before_stats=room['state']['totalCorrect'];opened(3,p3,p1)
            record('a 32-second stale champion can be replaced without deleting membership or history',room['run_id']==seat_run and room['state']['streak']==0 and room['state']['totalCorrect']==before_stats and room['state']['bestStreak'][p2]==1 and sql('SELECT left_at IS NULL FROM throne_private.members WHERE id='+literal(p2)+';')=='t')
            stale_question=room['q_id'];rpc('P2','throne_heartbeat',p_code=code,p_edition=edition)
            deny('a returning displaced champion cannot answer the new seats question','P2','throne_buzz',p_code=code,p_edition=edition,p_question_id=stale_question)
            # A finale's identities cannot be replaced. Withdrawing one finalist
            # ends without a fabricated crown even when spectators remain live.
            host('throne_begin_run',p_config={'qTotal':3,'answerMs':4000,'live':True})
            for index,champ,chal,winner in [(1,p1,p2,'P1'),(2,p1,p3,'P1'),(3,p1,p2,'P2')]:
                publish('lobby' if index==1 else 'between',champ=next(m for m in members.values() if m['id']==champ),chal=next(m for m in members.values() if m['id']==chal),queue=[],**({} if index==1 else {'between':{'msg':'Next'}}))
                opened(index,champ,chal);answer_win(winner);reveal()
            rpc('P1','throne_leave',p_code=code,p_edition=edition)
            publish('finintro',champ=members['P2'],chal=members['P1'],queue=[members['P3']],finintro={'msg':'Finale'},finalists={'closer':members['P2'],'king':members['P1']})
            deny('a finalist leaving during intro cannot open a replacement finale','H','throne_host_open_question',state='PT412',p_code=code,p_edition=edition,p_run_id=room['run_id'],p_question={'q':'Finale','opts':['A','B','C','D'],'qIndex':3,'champ_id':p2,'chal_id':p1,'queue':[],'mode':'finale'},p_expected_version=room['version'],p_request_id=str(uuid4()))
            publish('gameover',winner=members['P3'])
            record('departed finalist ends without inventing a champion despite two live spectators',room['state']['winner'] is None and room['state']['summary']['recorded'] is False and len(rows()['results'])==2)
            report['api_state']=json.loads(sql("""SELECT jsonb_build_object(
              'api',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definition_md5',md5(pg_get_functiondef(p.oid)),'security_definer',p.prosecdef,'config',p.proconfig,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'auth_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,7)='throne_'),
              'private_tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'anon_privileges',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),'auth_privileges',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='throne_private' AND c.relkind='r'),
              'private_schema',jsonb_build_object('anon_usage',has_schema_privilege('anon','throne_private','USAGE'),'auth_usage',has_schema_privilege('authenticated','throne_private','USAGE')),
              'private_helpers',(SELECT jsonb_build_object('functions',count(*),'anon_executable',count(*) FILTER(WHERE has_function_privilege('anon',p.oid,'EXECUTE')),'auth_executable',count(*) FILTER(WHERE has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='throne_private'));
            """))
            retained=rows();sql('BEGIN;\n'+files[-1].read_text()+'\nCOMMIT;')
            record('rollback preserves every private row/result/receipt',rows()==retained)
            disabled=json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'throne\\_%' ESCAPE '\\';"""))
            record('rollback disables all 19 client RPCs',len(disabled)==19 and all(not f['anon'] and not f['authenticated'] for f in disabled))
            record('all legacy rows/metadata and existing Show state survive complete scenario and rollback',json.loads(sql(LEGACY_AUDIT_SQL))==legacy and snapshot_family()==show)
            record('secured Big Quiz data/API/privileges survive complete scenario and rollback',snapshot_family('bigquiz_private','bigquiz_')==bigquiz)
            report['passed']=True
    except Exception as error:report['error']=str(error)
    finally:
        if container:
            try:
                info=json.loads(docker(['inspect',name]))[0]
                if info['Id']!=container or info['Config']['Labels'].get('codex.task')!=label:raise AssertionError('Container identity changed; refusing cleanup')
                docker(['rm','--force','--volumes',container]);report['cleanup_completed']=True
            except Exception as error:report['cleanup_error']=str(error);report['passed']=False
        else:report['cleanup_completed']=True
        report['finished_at']=datetime.now(timezone.utc).isoformat();report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--report',type=Path,default=Path('/tmp/tierbrain-throne-access.json'));args=parser.parse_args()
    report=run_checks(args.report.resolve());print(json.dumps({'passed':report['passed'],'checks':len(report['tests']),'report':str(args.report.resolve()),'cleanup_completed':report['cleanup_completed']}))
    if not report['passed']:print(report.get('last_case','setup')+'\n'+report.get('error',report.get('cleanup_error','Unknown error')));raise SystemExit(1)
