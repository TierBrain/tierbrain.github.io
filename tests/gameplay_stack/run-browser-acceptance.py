#!/usr/bin/env python3
"""Run complete game pages against disposable real Auth and PostgreSQL.

Only synthetic data is used. Intercepted browser HTTP is carried over a
persistent docker-exec pipe into the internal Compose network. There are no
host ports, public fixture listeners or hosted Supabase requests.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
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

TRANSPORT = r"""
const readline=require('node:readline');
const input=readline.createInterface({input:process.stdin,terminal:false});
input.on('line',async line=>{
  try {
    const q=JSON.parse(line), base={'/auth/v1':'http://auth:9999','/rest/v1':'http://rest:3000'}[q.prefix];
    if(!base||typeof q.path!=='string'||!q.path.startsWith('/'))throw Error('Invalid fixture target');
    const response=await fetch(base+q.path,{method:q.method,headers:q.headers,
      body:q.body===null?undefined:Buffer.from(q.body,'base64'),
      redirect:'error',signal:AbortSignal.timeout(20000)});
    const body=Buffer.from(await response.arrayBuffer()).toString('base64');
    process.stdout.write(JSON.stringify({status:response.status,headers:Object.fromEntries(response.headers),body})+'\n');
  } catch(error) {process.stdout.write(JSON.stringify({error:'Internal fixture HTTP transport failed: '+error.name})+'\n');}
});
"""


def run(family, report_path, *, module_path=None, env_class=BrowserEnv, browser_engine='chromium', extra_inputs=()):
    module_path = module_path or ROOT/('tests/gameplay_'+family+'.py')
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
        (stack/'compose.yaml').write_text((SHARED/'compose.yaml').read_text())
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
        bridge = None
        try:
            migrations = sorted((ROOT/'supabase/migrations').glob('*.sql'))
            if len(migrations) != 7:
                raise AssertionError('Review fixture order when migration set changes')
            inputs = [*migrations,SHARED/'compose.yaml',SHARED/'bootstrap.sql',SHARED/'auth-claims.sql',
                      ROOT/'tests/fixtures/show_auth_baseline.sql',ROOT/'tests/fixtures/legacy_retirement_baseline.sql',
                      ROOT/'tests/fixtures/scores_baseline.sql',Path(__file__),Path(__file__).with_name('browser_env.py'),
                      module_path,ROOT/'vendor/supabase.js']
            inputs += list(extra_inputs)
            inputs += list(ROOT.glob('js/*.js'))
            inputs += list(ROOT.glob('*.js'))
            inputs += list(ROOT.glob('*.css'))
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
                if bindings:raise AssertionError('Host ports are forbidden')
                networks.update(value['NetworkID'] for value in container['NetworkSettings']['Networks'].values())
            if len(networks) != 1:raise AssertionError('Expected one fixture network')
            if not json.loads(command(DOCKER+['network','inspect',*networks]))[0]['Internal']:
                raise AssertionError('Fixture network must be internal')
            dc(['exec','-T','driver','node','-e',
                "require('fs').writeFileSync('/tmp/browser-transport.cjs',require('fs').readFileSync(0))"],TRANSPORT,30)
            bridge = subprocess.Popen(compose+['exec','-T','driver','node','/tmp/browser-transport.cjs'],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                text=True,bufsize=1,env=ENV)
            def transport(prefix,path,method,headers,body):
                bridge.stdin.write(json.dumps({'prefix':prefix,'path':path,'method':method,'headers':headers,
                    'body':None if body is None else base64.b64encode(body).decode('ascii')})+'\n')
                bridge.stdin.flush()
                if not select.select([bridge.stdout],[],[],25)[0]:
                    raise RuntimeError('Internal fixture HTTP pipe timed out')
                response = json.loads(bridge.stdout.readline())
                if response.get('error'):raise RuntimeError(response['error'])
                return response['status'],base64.b64decode(response['body']),response['headers']
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                launch = {'headless':True}
                if browser_engine == 'chromium':
                    launch.update(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE') or None,
                                  args=['--no-sandbox'])
                browser = getattr(playwright,browser_engine).launch(**launch)
                browser_env = env_class(browser,ROOT,transport,report,report_path)
                report['browser_engine'] = browser_engine
                spec = importlib.util.spec_from_file_location('gameplay_'+family,module_path)
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
            if bridge is not None:
                bridge.stdin.close()
                try:bridge.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    bridge.kill()
                    bridge.wait(timeout=5)
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
