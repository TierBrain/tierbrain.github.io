#!/usr/bin/env python3
"""Run complete game pages against disposable real Auth and PostgreSQL.

Only synthetic data is used. Auth and REST publish ephemeral loopback ports so
the host browser can reach the internal Compose network. All browser requests
are intercepted; the hosted Supabase project is never contacted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import traceback

from browser_env import BrowserEnv

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT/'tests/big_quiz_stack'
DOCKER = ['docker','--host=unix:///var/run/docker.sock']
ENV = {k:v for k,v in os.environ.items() if k not in {
    'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
FAMILIES = ('big_quiz','throne','creak','standing','circuit','spines')


def run(family, report_path):
    report = {'passed':False,'cleanup_completed':False,'family':family,
              'started_at':datetime.now(timezone.utc).isoformat(),
              'fixture':'actual pages and vendored SDK / local GoTrue / PostgREST / PostgreSQL',
              'limits':['Synthetic test data only; no production Auth or data',
                        'Test modules may control named presentation helpers and random outcomes',
                        'QR images and third-party integrations are outside this pass']}
    project = 'tierbrain-gameplay-'+secrets.token_hex(6)
    values = {k:secrets.token_hex(48 if k=='JWT_SECRET' else 24)
              for k in ('DB_PASSWORD','AUTH_DB_PASSWORD','REST_DB_PASSWORD','JWT_SECRET')}
    values['TEST_DRIVER_IMAGE']='node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392'

    def redact(text):
        for secret in values.values():
            text = text.replace(secret,'[fixture value redacted]')
        return re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',
                      '[fixture JWT redacted]',text)

    def command(args, data=None, timeout=180):
        result = subprocess.run(args,input=data,text=True,capture_output=True,env=ENV,timeout=timeout)
        if result.returncode:
            raise RuntimeError(redact(result.stderr+result.stdout)[-5000:])
        return result.stdout

    with tempfile.TemporaryDirectory(prefix=project+'-') as temp:
        stack = Path(temp)
        compose_text = (SHARED/'compose.yaml').read_text()
        for service,port in (('auth',9999),('rest',3000)):
            compose_text = compose_text.replace('  '+service+':\n',
                '  '+service+':\n    ports:\n      - target: '+str(port)+
                '\n        published: "0"\n        host_ip: 127.0.0.1\n        protocol: tcp\n')
        (stack/'compose.yaml').write_text(compose_text)
        env_file = stack/'.env'
        fd = os.open(env_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as handle:
            handle.write(''.join(k+'='+v+'\n' for k,v in values.items()))
        compose = DOCKER+['compose','--project-name',project,'--project-directory',str(stack),
                         '--env-file',str(env_file),'-f',str(stack/'compose.yaml')]
        def dc(args,data=None,timeout=180):return command(compose+args,data,timeout)
        def sql(text):return dc(['exec','-T','db','psql','-X','--single-transaction','-v',
                                'ON_ERROR_STOP=1','-U','postgres','-d','postgres'],text,70)
        def node(text):return dc(['exec','-T','driver','node','--input-type=module'],text,70)
        browser_env = None
        try:
            migrations = sorted((ROOT/'supabase/migrations').glob('*.sql'))
            if len(migrations) != 7:
                raise AssertionError('Review fixture order when migration set changes')
            inputs = [*migrations,SHARED/'compose.yaml',SHARED/'bootstrap.sql',SHARED/'auth-claims.sql',
                      ROOT/'tests/fixtures/show_auth_baseline.sql',ROOT/'tests/fixtures/legacy_retirement_baseline.sql',
                      ROOT/'tests/fixtures/scores_baseline.sql',Path(__file__),Path(__file__).with_name('browser_env.py'),
                      ROOT/('tests/gameplay_'+family+'.py'),ROOT/'vendor/supabase.js']
            inputs += list(ROOT.glob('js/*access.js'))
            inputs += list(ROOT.glob('*.html'))
            report['input_sha256'] = {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest()
                                      for path in inputs}
            dc(['up','-d','--wait','--wait-timeout','70','db','driver'],timeout=240)
            sql((SHARED/'bootstrap.sql').read_text())
            dc(['up','-d','auth'],timeout=240)
            node("""for(let i=0;i<60;i++) {try {const r=await fetch('http://auth:9999/health',
              {signal:AbortSignal.timeout(2000)});if(r.ok)process.exit(0);}catch{}
              await new Promise(r=>setTimeout(r,500));}throw Error('Fixture Auth readiness timed out');""")
            sql((SHARED/'auth-claims.sql').read_text())
            # Reuse exact synthetic legacy baseline, retaining the real GoTrue
            # auth schema and verified-JWT accessor installed above.
            fixture = 'DO $legacy$'+(ROOT/'tests/fixtures/show_auth_baseline.sql').read_text().split('DO $legacy$',1)[1]
            fixture += (ROOT/'tests/fixtures/legacy_retirement_baseline.sql').read_text()
            fixture += 'DROP TABLE public.scores;\nCREATE TABLE public.scores'+(ROOT/'tests/fixtures/scores_baseline.sql').read_text().split('CREATE TABLE public.scores',1)[1]
            # The cleanup migration expects the reviewed pre-cutover EXECUTE
            # grant. Restore only this fixture grant before applying all seven.
            fixture += '\nGRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO authenticated;\n'
            sql(fixture)
            for migration in migrations:
                sql(migration.read_text())
            dc(['up','-d','rest'],timeout=240)
            node("""for(let i=0;i<60;i++) {try {const r=await fetch('http://rest:3000/rpc/party_preview',{
              method:'POST',headers:{'content-type':'application/json'},
              body:JSON.stringify({p_code:'ZZZZZ',p_family:'spines',p_edition:'general'}),
              signal:AbortSignal.timeout(2000)});if(r.status===401&&(await r.json()).code==='42501')process.exit(0);}catch{}
              await new Promise(r=>setTimeout(r,500));}throw Error('Fixture REST readiness timed out');""")
            ids = dc(['ps','--all','--quiet']).split()
            if len(ids) != 4:raise AssertionError('Expected exactly four fixture services')
            containers = json.loads(command(DOCKER+['inspect',*ids]))
            networks = set()
            for container in containers:
                labels = container['Config']['Labels']
                if labels.get('com.docker.compose.project') != project:raise AssertionError('Wrong fixture project')
                bindings = container['HostConfig'].get('PortBindings') or {}
                service = labels['com.docker.compose.service']
                expected = {'auth':'9999/tcp','rest':'3000/tcp'}.get(service)
                if set(bindings) != ({expected} if expected else set()):raise AssertionError('Unexpected exposed service')
                if any(binding['HostIp'] != '127.0.0.1' for ports in bindings.values() for binding in ports):
                    raise AssertionError('Fixture port is not confined to loopback')
                networks.update(value['NetworkID'] for value in container['NetworkSettings']['Networks'].values())
            if len(networks) != 1:raise AssertionError('Expected one fixture network')
            if not json.loads(command(DOCKER+['network','inspect',*networks]))[0]['Internal']:
                raise AssertionError('Fixture network must be internal')
            def address(service,port):
                value = dc(['port',service,str(port)]).strip()
                if not re.fullmatch(r'127\.0\.0\.1:\d+',value):raise AssertionError('Invalid loopback mapping')
                return 'http://'+value
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True,
                    executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None,
                    args=['--no-sandbox'])
                browser_env = BrowserEnv(browser,ROOT,address('auth',9999),address('rest',3000),report,report_path)
                spec = importlib.util.spec_from_file_location('gameplay_'+family,ROOT/('tests/gameplay_'+family+'.py'))
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                try:
                    module.run(browser_env)
                    browser_env.finish()
                    report['passed'] = True
                except Exception:
                    browser_env.capture_failure()
                    raise
                finally:
                    browser_env.close()
                    browser.close()
        except Exception as error:
            report['error'] = redact(str(error))
            report['traceback'] = redact(traceback.format_exc())[-12000:]
            print(report['error'],flush=True)
        finally:
            try:
                dc(['down','--volumes','--remove-orphans'],timeout=90)
                if dc(['ps','--all','--quiet']).strip():raise AssertionError('Fixture containers remain')
                report['cleanup_completed'] = True
            except Exception as error:
                report['cleanup_error'] = redact(str(error))
                report['passed'] = False
            report['finished_at'] = datetime.now(timezone.utc).isoformat()
            report_path.parent.mkdir(parents=True,exist_ok=True)
            report_path.write_text(redact(json.dumps(report,indent=2))+'\n')
            report_path.chmod(0o600)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--family',choices=FAMILIES,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args = parser.parse_args()
    result = run(args.family,args.report.resolve())
    print(json.dumps({key:result[key] for key in ('passed','cleanup_completed')}))
    raise SystemExit(0 if result['passed'] else 1)
