#!/usr/bin/env python3
"""Private host lead intake SQL checks using synthetic isolated records only.

Reuses the disposable PostgreSQL/WASM or cached pinned native PostgreSQL driver.
No production data, credentials, requests or Auth users are involved.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
from pathlib import Path

import check_race_access as driver

ROOT=Path(__file__).resolve().parents[1]
MIGRATION=ROOT/'supabase/migrations/20261024184826_private_host_lead_intake.sql'
ROLLBACK=ROOT/'supabase/rollback/private_host_lead_intake.sql'
BASELINE="""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.host_intake_unrelated_fixture(id integer PRIMARY KEY,note text);
INSERT INTO public.host_intake_unrelated_fixture VALUES(1,'Synthetic pre-existing sentinel');
"""


def suite(sql,report,concurrent=False):
    def record(label,condition=True):
        if not condition:raise AssertionError(label)
        report['tests'].append({'name':label,'passed':True})
        print(label+': passed',flush=True)
    def call(email,context=None,role='anon'):
        return json.loads(sql('BEGIN;SET LOCAL ROLE '+role+';SELECT public.submit_host_lead('+driver.val(email)+','+driver.val(context)+');COMMIT;'))
    def snapshot():return sql("SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY email),'[]') FROM public.host_leads x;")
    def denied(label,statement,role='anon',state='42501'):
        before=snapshot()
        sql('BEGIN;SET LOCAL ROLE '+role+''';DO $deny$ DECLARE observed text;BEGIN
          BEGIN EXECUTE '''+driver.lit(statement)+''';EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;END;
          IF observed IS DISTINCT FROM '''+driver.lit(state)+''' THEN
            RAISE EXCEPTION 'Expected SQLSTATE, observed %',observed;END IF;
          END $deny$;COMMIT;''')
        record(label,snapshot()==before)
    sentinel=sql('SELECT to_jsonb(x) FROM public.host_intake_unrelated_fixture x;')
    sql('BEGIN;'+MIGRATION.read_text()+'COMMIT;')
    acl=json.loads(sql("""SELECT jsonb_build_object(
      'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.host_leads'::regclass),
      'policies',(SELECT count(*) FROM pg_policy WHERE polrelid='public.host_leads'::regclass),
      'anon_table',has_table_privilege('anon','public.host_leads','SELECT,INSERT,UPDATE,DELETE'),
      'auth_table',has_table_privilege('authenticated','public.host_leads','SELECT,INSERT,UPDATE,DELETE'),
      'anon_rpc',has_function_privilege('anon','public.submit_host_lead(text,text)','EXECUTE'),
      'auth_rpc',has_function_privilege('authenticated','public.submit_host_lead(text,text)','EXECUTE'),
      'definer',(SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.submit_host_lead(text,text)'::regprocedure));"""))
    record('RLS with no table grants/policies; restricted fixed-path public intake RPC',acl=={'rls':True,'policies':0,'anon_table':False,'auth_table':False,'anon_rpc':True,'auth_rpc':True,'definer':True})
    for role in ('anon','authenticated'):
        for label,statement in [
            ('SELECT','SELECT * FROM public.host_leads'),
            ('INSERT',"INSERT INTO public.host_leads(email) VALUES('direct@example.invalid')"),
            ('UPDATE',"UPDATE public.host_leads SET context='pub'"),
            ('DELETE','DELETE FROM public.host_leads')]:
            denied(role+' cannot directly '+label,statement,role)
    first=call('  Readiness@Example.Invalid  ','pub')
    initial=snapshot()
    record('anonymous submission returns only a generic acknowledgement',first=={'ok':True})
    record('stored address normalizes case and whitespace',json.loads(initial)[0]['email']=='readiness@example.invalid')
    duplicate=call('READINESS@example.invalid','church','authenticated')
    record('duplicate returns identical generic receipt and cannot modify another record',duplicate==first and snapshot()==initial)
    for context in (None,'','pub','office','church','school','party','other'):
        accepted=call(('context'+str(len(report['tests'])))+'@example.invalid',context)
        record('valid listed context '+repr(context),accepted==first)
    for email in (None,'','not-an-email','bad@@example.invalid','bad@example','x y@example.invalid','a\nb@example.invalid','A'*65+'@example.invalid','A'*250+'@example.invalid'):
        denied('invalid email rejected without writes',
               'SELECT public.submit_host_lead('+driver.val(email)+',NULL)',state='22023')
    for context in ('free text','PUB','church<script>', 'X'*10000):
        denied('unlisted context rejected without writes',
               'SELECT public.submit_host_lead(\'valid@example.invalid\','+driver.val(context)+')',state='22023')
    if concurrent:
        with ThreadPoolExecutor(max_workers=8) as pool:
            receipts=list(pool.map(lambda _:call('concurrent@example.invalid','party'),range(16)))
        count=int(sql("SELECT count(*) FROM public.host_leads WHERE email='concurrent@example.invalid';"))
        record('sixteen concurrent duplicates produce one private lead and identical receipts',count==1 and all(value==first for value in receipts))
    else:
        report['limits'].append('WASM driver is sequential; concurrent duplicate and capacity checks require native PostgreSQL CI')
    # Capacity fixtures are private synthetic rows inserted by the test owner.
    sql("TRUNCATE public.host_leads;INSERT INTO public.host_leads(email) SELECT 'daily'||n||'@example.invalid' FROM generate_series(1,999)n;")
    if concurrent:
        def last_daily_slot(n):
            statement="PERFORM public.submit_host_lead('daily-race"+str(n)+"@example.invalid',NULL)"
            # Catch the expected capacity error inside each transaction.
            return sql('BEGIN;SET LOCAL ROLE anon;DO $capacity$ BEGIN BEGIN '+statement+''';
              EXCEPTION WHEN program_limit_exceeded THEN NULL;END;END $capacity$;COMMIT;''')
        with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(last_daily_slot,range(16)))
        record('concurrent final daily slot never exceeds one thousand rows',int(sql('SELECT count(*) FROM public.host_leads;'))==1000)
    else:
        call('daily-last@example.invalid')
    denied('daily capacity rejects new addresses with availability error',"SELECT public.submit_host_lead('daily-over@example.invalid',NULL)",state='54000')
    denied('daily capacity also rejects known addresses without an existence side channel',"SELECT public.submit_host_lead('daily1@example.invalid',NULL)",state='54000')
    sql("TRUNCATE public.host_leads;INSERT INTO public.host_leads(email,created_at) SELECT 'total'||n||'@example.invalid',clock_timestamp()-interval '2 days' FROM generate_series(1,10000)n;")
    denied('total capacity rejects new addresses with availability error',"SELECT public.submit_host_lead('total-over@example.invalid',NULL)",state='54000')
    denied('total capacity also rejects known addresses identically',"SELECT public.submit_host_lead('total1@example.invalid',NULL)",state='54000')
    before_rollback=snapshot()
    sql('BEGIN;'+ROLLBACK.read_text()+'COMMIT;')
    record('operator rollback disables intake and preserves all private opt-in records',snapshot()==before_rollback and sql("SELECT to_regprocedure('public.submit_host_lead(text,text)') IS NULL;") in ('t','true'))
    for role in ('anon','authenticated'):
        denied('rollback keeps '+role+' table reads denied','SELECT * FROM public.host_leads',role)
    record('existing unrelated application sentinel is unchanged',sql('SELECT to_jsonb(x) FROM public.host_intake_unrelated_fixture x;')==sentinel)


def run(report_path,pglite_module=None):
    # Reuse transport/isolation/lifecycle only, with this suite's own schema.
    driver.MIGRATION,driver.ROLLBACK,driver.BASELINE,driver.suite=MIGRATION,ROLLBACK,BASELINE,suite
    report=driver.run(report_path,pglite_module)
    report['format']='tierbrain-private-host-lead-intake-v1'
    report['limits']=[item for item in report['limits'] if 'auth.uid' not in item]
    report['input_sha256'][str(Path(__file__).relative_to(ROOT))]=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report_path.write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report',required=True,type=Path)
    parser.add_argument('--pglite-module',type=Path)
    args=parser.parse_args();report=run(args.report,args.pglite_module)
    raise SystemExit(0 if report['passed'] and report['cleanup_completed'] else 1)
