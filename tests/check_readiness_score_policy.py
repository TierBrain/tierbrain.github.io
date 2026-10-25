#!/usr/bin/env python3
"""Source-derived score contracts against disposable PostgreSQL only.

No hosted requests, real users or application rows. The shared harness checks
role isolation, unchanged grants/schema/seed rows, guarded failures and rollback.
Run --unit for source derivation only; the full check requires the cached pinned
PostgreSQL image used by tests/check_score_policy.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from datetime import datetime, timezone

import check_score_policy as base

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20261024123525_readiness_score_contracts.sql'
ROLLBACK = ROOT / 'supabase/rollback/readiness_score_contracts.sql'
PREDECESSOR = ROOT / 'supabase/migrations/20261020180854_score_game_contracts.sql'
BUS_IDS = ['qc_race', 'qc_tug', 'qc_ff2', 'qc_ff2_bible', 'qc_keep_mp', 'qc_core_mp', 'qc_labyrinth_mp']


def new_case(label, allowed=True, **values):
    return base.case(label, allowed, **values)


def regressions(allowed):
    return [
        new_case('Claim completed loss', allowed, quiz_id='qc_claim', correct=12, level=0),
        new_case('Claim complete ownership win', allowed, quiz_id='qc_claim', correct=25, level=1),
        new_case('Call Your Shot four certain misses', allowed, quiz_id='qc_call-your-shot', correct=-12),
        new_case('Call Your Shot twenty certain rights', allowed, quiz_id='qc_call-your-shot', correct=60),
        new_case('Five Clues twelve first-clue solves', allowed, quiz_id='qc_five-clues', correct=60),
        new_case('Five Clues Bible twelve first-clue solves', allowed, quiz_id='qc_five-clues-bible', correct=60),
        new_case('Smudged first message', allowed, quiz_id='qc_smudged', correct=175, level=1),
        new_case('Smudged Bible first message', allowed, quiz_id='qc_smudged-bible', correct=205, level=1),
        new_case('Smudged zero solved result', allowed, quiz_id='qc_smudged', correct=0, level=0),
    ]


def new_allowed():
    result = regressions(True)
    for points, won in [(0, 0), (12, 0), (13, 1), (25, 1)]:
        result.append(new_case('Claim boundary '+str(points), quiz_id='qc_claim', correct=points, level=won, time_left=0))
    for qid in ['qc_call-your-shot', 'qc_five-clues', 'qc_five-clues-bible']:
        maximum = 210000 if qid == 'qc_call-your-shot' else 360000
        result.append(new_case(qid+' maximum leftover ms', quiz_id=qid, correct=60, level=4, time_left=maximum))
    for qid, maxima in [('qc_smudged', [15,26,27,39]), ('qc_smudged-bible', [18,25,28,27])]:
        for count in range(21):
            upper = 25*count + 10*sum(maxima[(i-1)//5] for i in range(1,count+1))
            for points in sorted({25*count, upper}):
                result.append(new_case(f'{qid} message {count} points {points}', quiz_id=qid,
                                       correct=points, level=count, time_left=240))
    result.append(new_case('expanded contracts maximum shared scope and nickname', quiz_id='qc_call-your-shot',
                           name='N'*20, group_code='A'*24, correct=60, level=4, time_left=0))
    return result


def new_denied():
    result = []
    def denied(qid, label, **values):
        result.append(new_case(qid+' '+label, False, quiz_id=qid, **values))
    for qid in BUS_IDS:
        denied(qid, 'old plausible scoreboard bus event', correct=3, level=2, time_left=0)
        denied(qid, 'old zero-level heartbeat', correct=0, level=0, time_left=0)
    for label, values in [
        ('loss cannot claim majority',dict(correct=13,level=0)),
        ('win requires majority',dict(correct=12,level=1)),
        ('negative plots',dict(correct=-1,level=0)),
        ('26 plots exceed board',dict(correct=26,level=1)),
        ('level is boolean',dict(correct=15,level=2)),
        ('negative elapsed',dict(correct=15,level=1,time_left=-1)),
    ]: denied('qc_claim',label,**values)
    for qid in ['qc_call-your-shot','qc_five-clues','qc_five-clues-bible']:
        minimum = -12 if qid == 'qc_call-your-shot' else 0
        limit = 210000 if qid == 'qc_call-your-shot' else 360000
        for label, values in [
            ('below points floor',dict(correct=minimum-1)),
            ('above points cap',dict(correct=61)),
            ('zero tier',dict(correct=0,level=0)),
            ('above tier cap',dict(correct=0,level=5)),
            ('negative leftover',dict(correct=0,time_left=-1)),
            ('excess leftover',dict(correct=0,time_left=limit+1)),
        ]: denied(qid,label,**values)
    for qid, maxima in [('qc_smudged',[15,26,27,39]),('qc_smudged-bible',[18,25,28,27])]:
        for count in range(1,21):
            upper = 25*count + 10*sum(maxima[(i-1)//5] for i in range(1,count+1))
            denied(qid,'below message minimum '+str(count),correct=25*count-10,level=count)
            denied(qid,'above source letter maximum '+str(count),correct=upper+10,level=count)
            denied(qid,'impossible points increment '+str(count),correct=25*count+1,level=count)
        for label, values in [
            ('negative solved',dict(correct=0,level=-1)),
            ('more than20 messages',dict(correct=525,level=21)),
            ('points without solved message',dict(correct=10,level=0)),
            ('negative leftover',dict(correct=25,level=1,time_left=-1)),
            ('more than240 seconds left',dict(correct=25,level=1,time_left=241)),
            ('bigint arithmetic rejects malicious integer maximum',dict(correct=2147483647,level=2147483647)),
            ('bigint arithmetic rejects malicious integer minimum',dict(correct=-2147483648,level=-2147483648)),
        ]: denied(qid,label,**values)
    for qid, points, level in [('qc_claim',13,1),('qc_call-your-shot',60,4),('qc_five-clues',60,4),('qc_five-clues-bible',60,4),('qc_smudged',25,1),('qc_smudged-bible',25,1)]:
        for code in ['', 'a', 'A.B', 'A'*25, 'É']:
            denied(qid,'invalid group '+repr(code),correct=points,level=level,group_code=code)
    return result


def derive_from_source():
    """Evaluate the actual declared constants/banks; never duplicate bank data."""
    script = r'''
const fs=require('fs'),vm=require('vm');
const read=n=>fs.readFileSync(n,'utf8');
const wheel=read('wheel.html'),bible=read('smudged-bible.html');
const context=vm.createContext({window:{}});
vm.runInContext(read('smudged-bank.js'),context);
for(const name of ['PHRASES','BIBLE_PHRASES']){
 const declaration=wheel.match(new RegExp('var '+name+' = (\\{.*?\\});'))[0];
 if(!bible.includes(declaration))throw Error('Bible/source base banks diverged');
 vm.runInContext(declaration,context);
}
const maxima={};
for(const [variable,kind] of [['PHRASES','phrases'],['BIBLE_PHRASES','bible']]){
 maxima[kind]=['1','2','3','4'].map(tier=>{
  const phrases=context[variable][tier].map(p=>p.text).concat((context.window.SMUDGED[kind][tier]||[]).map(p=>p.split('|')[1]));
  return Math.max(...phrases.map(p=>p.replace(/[^A-Z]/g,'').length));
 });
}
const cys=read('call-your-shot.html');
vm.runInContext(cys.match(/const PAY=(\{.*?\});/)[0].replace('const PAY=','var PAY='),context);
const pay=Object.values(context.PAY);
console.log(JSON.stringify({maxima,shot:{right:Math.max(...pay.map(p=>p.r)),wrong:Math.min(...pay.map(p=>p.w))}}));
'''
    result = subprocess.run(['node','-e',script],cwd=ROOT,text=True,capture_output=True,timeout=20,check=True)
    found = json.loads(result.stdout)
    assert found == {'maxima':{'phrases':[15,26,27,39],'bible':[18,25,28,27]},'shot':{'right':3,'wrong':-3}}, found
    claim = (ROOT/'claim.html').read_text()
    assert re.search(r'var N=5,',claim) and 'level:(win?1:0)' in claim and 'correct:cc.you' in claim
    assert 'win=cc.you>cc.riv' in claim and 'function full(G){ return counts(G).free===0; }' in claim
    cys = (ROOT/'call-your-shot.html').read_text()
    assert 'if(totalWrong>=4)' in cys and 'if(answered>=20)' in cys
    assert re.search(r"ms:210000",cys) and 'timeLeft:remainingMs()' in cys
    for filename in ['five-clues.html','five-clues-bible.html']:
        text = (ROOT/filename).read_text()
        assert 'const ROUNDS=12' in text and 'const pts=6-cluesShown' in text
        assert 'cluesShown=1' in text and 'if(cluesShown<5)' in text
        assert 'savedMs+=clueRemaining()' in text and 'ms:30000' in text
    for filename in ['wheel.html','smudged-bible.html']:
        text=(ROOT/filename).read_text()
        assert 'var gain = 25 + bonusLetters * 10' in text and 'if(G.puzzle >= 20)' in text
        assert '1 + Math.floor((G.puzzle - 1) / 5)' in text and "ms:240000" in text
        assert 'correct:RUN.pts, level:RUN.solved, time_left:RUN.left' in text
    for filename in ['core.html','castle.html','labyrinth.html']:
        text=(ROOT/filename).read_text()
        assert re.findall(r'rows:(\d+),base:',text)==['5','6','7','8']
        assert 'var LIVES=3' in text and 'sealed:{time:16,delta:0,pass:2}' in text
        assert 'S.correct++' in text and 'S.pending.have=0' in text
        # Eight nodes * two answers, plus at most two retried first answers.
        assert 8*2+(3-1) <= 20
    gaslight=(ROOT/'gaslight.html').read_text()
    assert all('total:'+str(n) in gaslight for n in [15,18,16])
    data=json.loads(re.search(r'var DATA = (\{.*\});',gaslight)[1])
    assert max(15,18,16,data['T4'],data['T5'])+2 <= 20
    assert 'const score=deductions+(accusedRight?2:0)' in gaslight
    found['claim_cells']=25
    found['five_clues_rounds']=12
    found['note']='Bounded client-reported input validation; not proof of a played game'
    return found


def run_wasm(report_path, module_path):
    """Same role/predicate cases on real local PostgreSQL/WASM, no network."""
    from check_race_access import BRIDGE
    report={'format':'tierbrain-readiness-score-policy-wasm-v1','passed':False,
            'started_at':datetime.now(timezone.utc).isoformat(),'tests':[],
            'limits':['Local PostgreSQL/WASM sequential SQL checks; pinned native PostgreSQL CI remains required'],
            'source':'Synthetic fixture only; no hosted requests or application rows'}
    process=None
    def record(name, **details):
        report['tests'].append({'name':name,'passed':True,**details})
        print(name+': passed',flush=True)
    try:
        report['derivation']=derive_from_source()
        report['input_sha256']={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest()
                                for path in [base.FIXTURE,PREDECESSOR,MIGRATION,ROLLBACK]}
        with tempfile.TemporaryDirectory(prefix='tierbrain-score-wasm-') as temporary:
            script=Path(temporary)/'bridge.mjs'
            script.write_text(BRIDGE)
            process=subprocess.Popen(['node',str(script),str(Path(module_path).resolve())],
                                      stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            def sql(statement, expected_failure=None):
                process.stdin.write(json.dumps({'sql':statement})+'\n');process.stdin.flush()
                line=process.stdout.readline()
                if not line:raise AssertionError('Local PostgreSQL/WASM bridge stopped: '+process.stderr.read())
                reply=json.loads(line)
                if expected_failure is not None:
                    if expected_failure not in reply.get('error',''):
                        raise AssertionError('Expected guarded failure not observed: '+str(reply))
                    sql('ROLLBACK;')
                elif 'error' in reply:
                    raise AssertionError('PostgreSQL/WASM SQL error '+reply.get('code','')+': '+reply['error'])
                return reply.get('output','')
            def audit():return json.loads(sql(base.AUDIT_SQL))
            def unchanged(expected, observed, predicate=False):
                expected=json.loads(json.dumps(expected));observed=json.loads(json.dumps(observed))
                if predicate:
                    for state in [expected,observed]:
                        next(p for p in state['policies'] if p['name']=='add scores')['check']='<intended predicate>'
                assert expected==observed,'Unexpected seed/schema/policy/grant metadata change'
            report['postgres_version']=sql('SELECT version();')
            sql('BEGIN;'+base.FIXTURE.read_text()+'COMMIT;')
            sql('BEGIN;'+PREDECESSOR.read_text()+'COMMIT;')
            sql("INSERT INTO public.scores(quiz_id,group_code,name,correct,level,time_left,created_at) VALUES ('ordinary_quiz','SYNTHETIC','Synthetic ordinary',7,2,10,'2026-01-01T00:00:00Z'),('qc_claim','SYNTHETIC','Synthetic legacy',7,1,10,'2026-01-01T00:00:00Z'),('qc_tug','SYNTHETIC','Synthetic old bus',3,2,0,'2026-01-01T00:00:00Z');")
            before=audit()
            sql(base.case_sql(regressions(False)))
            record('predecessor rejects all nine new score-save regressions')
            sql('BEGIN;'+MIGRATION.read_text()+'COMMIT;')
            repaired=audit();unchanged(before,repaired,True)
            record('migration preserves schema/grants/three legacy rows and changes only the INSERT predicate')
            accepted=base.allowed_cases()+new_allowed();denied=base.denied_cases()+new_denied()
            sql(base.case_sql(accepted+denied));unchanged(repaired,audit())
            record('actual anon role accepts/rejects source-derived matrix',accepted=len(accepted),denied=len(denied))
            sql(base.case_sql([base.case('authenticated cannot append',False)],'authenticated'))
            for principal, rows in [('anon',3),('authenticated',0)]:
                sql('BEGIN;SET LOCAL ROLE '+principal+''';DO $check$ DECLARE n integer;BEGIN
                  SELECT count(*) INTO n FROM public.scores;
                  IF n<>'''+str(rows)+''' THEN RAISE EXCEPTION 'Unexpected SELECT visibility';END IF;
                  UPDATE public.scores SET name='Unexpected';GET DIAGNOSTICS n=ROW_COUNT;
                  IF n<>0 THEN RAISE EXCEPTION 'UPDATE unexpectedly allowed';END IF;
                  DELETE FROM public.scores;GET DIAGNOSTICS n=ROW_COUNT;
                  IF n<>0 THEN RAISE EXCEPTION 'DELETE unexpectedly allowed';END IF;
                  END $check$;ROLLBACK;''')
            unchanged(repaired,audit());record('anon SELECT and authenticated denial preserved; neither role can update/delete')
            sql('BEGIN;'+ROLLBACK.read_text()+'COMMIT;');unchanged(before,audit())
            sql(base.case_sql(regressions(False)));record('operator rollback restores exact predecessor and all nine original rejections')
            for name, modification, message in [
                ('changed predicate','ALTER POLICY "add scores" ON public.scores WITH CHECK(true);','Score validation changed since review'),
                ('extra INSERT policy','CREATE POLICY unexpected_write ON public.scores FOR INSERT TO anon WITH CHECK(true);','Additional score write policies exist'),
                ('extra ALL policy','CREATE POLICY unexpected_all ON public.scores FOR ALL TO anon USING(true) WITH CHECK(true);','Additional score write policies exist'),
                ('changed role','ALTER POLICY "add scores" ON public.scores TO authenticated;','Unexpected score INSERT policy scope'),
                ('disabled RLS','ALTER TABLE public.scores DISABLE ROW LEVEL SECURITY;','scores RLS must already be enabled')]:
                sql('BEGIN;'+modification+MIGRATION.read_text()+'COMMIT;',message)
                unchanged(before,audit());record('preflight atomically aborts '+name)
            report['passed']=True
    except Exception as error:
        report['error']=str(error)
    finally:
        if process:
            if process.stdin:process.stdin.close()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        report['cleanup_completed']=process is None or process.returncode is not None
        report['finished_at']=datetime.now(timezone.utc).isoformat()
        report_path.parent.mkdir(parents=True,exist_ok=True)
        report_path.write_text(json.dumps(report,indent=2)+'\n')
    return report


def run(report_path):
    derivation = derive_from_source()
    legacy_allowed, legacy_denied = base.allowed_cases(), base.denied_cases()
    base.MIGRATION, base.ROLLBACK = MIGRATION, ROLLBACK
    base.TASK_LABEL = 'tierbrain-readiness-score-policy-tests'
    base.regression_cases = regressions
    base.allowed_cases = lambda: legacy_allowed + new_allowed()
    base.denied_cases = lambda: legacy_denied + new_denied()
    report = base.run_checks(report_path,predecessor=PREDECESSOR)
    report['format']='tierbrain-readiness-score-policy-tests-v1'
    report['derivation']=derivation
    source_paths = ['claim.html','call-your-shot.html','five-clues.html','five-clues-bible.html','wheel.html','smudged-bible.html','smudged-bank.js']
    report['source_sha256']={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in source_paths}
    report_path.write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--unit',action='store_true')
    parser.add_argument('--pglite-module',type=Path)
    parser.add_argument('--report',type=Path,default=Path('/tmp/tierbrain-readiness-score-policy.json'))
    args=parser.parse_args()
    if args.unit:
        print(json.dumps({'source_derivation_passed':True,**derive_from_source()}))
        return
    report=run_wasm(args.report.resolve(),args.pglite_module) if args.pglite_module else run(args.report.resolve())
    print(json.dumps({'passed':report['passed'],'checks':len(report['tests']),'cleanup_completed':report['cleanup_completed'],'report':str(args.report.resolve())}))
    if not report['passed']:
        print(report.get('error',report.get('cleanup_error','Unknown failure')))
        raise SystemExit(1)


if __name__=='__main__':
    main()
