#!/usr/bin/env python3
"""Run real anonymous Auth/SDK/PostgREST checks in a disposable local Docker stack.

No hosted endpoint, production credentials, host ports or persistent database
volumes are used. The temporary project's credentials are generated and removed
by this process; commands retain the environment's proxy and CA configuration.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SHARED = ROOT / 'tests/big_quiz_stack'
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ENV = {k:v for k,v in os.environ.items() if k not in {
    'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}


def run(report_path):
    report = {'passed':False,'cleanup_completed':False,
              'started_at':datetime.now(timezone.utc).isoformat(),
              'hosted_requests':0,'fixture':'real local GoTrue, SDK and PostgREST'}
    project = 'tierbrain-party-http-' + secrets.token_hex(6)
    values = {k:secrets.token_hex(48 if k=='JWT_SECRET' else 24)
              for k in ['DB_PASSWORD','AUTH_DB_PASSWORD','REST_DB_PASSWORD','JWT_SECRET']}
    values['TEST_DRIVER_IMAGE']='node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392'

    def redact(value):
        for secret in values.values():
            value=value.replace(secret,'[fixture value redacted]')
        return re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',
                      '[fixture JWT redacted]',value)

    def command(args,data=None,timeout=180):
        p=subprocess.run(args,input=data,text=True,capture_output=True,env=ENV,timeout=timeout)
        if p.returncode:
            raise RuntimeError(redact(p.stderr+p.stdout)[-5000:])
        return p.stdout

    with tempfile.TemporaryDirectory(prefix=project+'-') as temp:
        stack=Path(temp)
        shutil.copyfile(SHARED/'compose.yaml',stack/'compose.yaml')
        env_file=stack/'.env'
        fd=os.open(env_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as f:
            f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
        compose=DOCKER+['compose','--project-name',project,'--project-directory',str(stack),
                        '--env-file',str(env_file),'-f',str(stack/'compose.yaml')]

        def dc(args,data=None,timeout=180):return command(compose+args,data,timeout)
        def sql(text):
            return dc(['exec','-T','db','psql','-X','--single-transaction','-v','ON_ERROR_STOP=1',
                       '-U','postgres','-d','postgres'],text,60)
        def node(text,timeout=70):
            return dc(['exec','-T','driver','node','--input-type=module'],text,timeout)
        try:
            migration,=list((ROOT/'supabase/migrations').glob('*_secure_party_rooms.sql'))
            inputs=[migration,ROOT/'js/party-access.js',ROOT/'vendor/supabase.js',
                    HERE/'sdk-gameplay-acceptance.mjs',SHARED/'compose.yaml',
                    SHARED/'bootstrap.sql',SHARED/'auth-claims.sql',HERE/'run-acceptance.py']
            report['input_sha256']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
                                    for p in inputs}
            dc(['up','-d','--wait','--wait-timeout','70','db','driver'],timeout=240)
            sql((SHARED/'bootstrap.sql').read_text())
            dc(['up','-d','auth'],timeout=240)
            node("""for(let i=0;i<50;i++) {
              try { const r=await fetch('http://auth:9999/health',{signal:AbortSignal.timeout(2000)});
                if(r.ok)process.exit(0); }catch{}
              await new Promise(r=>setTimeout(r,500));
            } throw Error('Disposable Auth readiness timed out');""")
            sql((SHARED/'auth-claims.sql').read_text())
            sql(migration.read_text())
            dc(['up','-d','rest'],timeout=240)
            node("""for(let i=0;i<50;i++) {
              try { const r=await fetch('http://rest:3000/rpc/party_preview',{
                method:'POST',headers:{'content-type':'application/json'},
                body:JSON.stringify({p_code:'ZZZZZ',p_family:'spines',p_edition:'general'}),signal:AbortSignal.timeout(2000)});
                if(r.status===401&&(await r.json()).code==='42501')process.exit(0); }catch{}
              await new Promise(r=>setTimeout(r,500));
            } throw Error('Disposable PostgREST readiness timed out');""")
            ids=dc(['ps','--all','--quiet']).split()
            if len(ids)!=4:raise AssertionError('Expected exactly four isolated services')
            containers=json.loads(command(DOCKER+['inspect',*ids]))
            network_ids=set()
            for c in containers:
                if c['HostConfig'].get('PortBindings'):raise AssertionError('Host ports are forbidden')
                if c['Config']['Labels'].get('com.docker.compose.project')!=project:
                    raise AssertionError('Unexpected Compose project')
                for v in c['NetworkSettings']['Networks'].values():network_ids.add(v['NetworkID'])
            if len(network_ids)!=1:raise AssertionError('Expected one isolated network')
            network=json.loads(command(DOCKER+['network','inspect',*network_ids]))[0]
            if not network['Internal']:raise AssertionError('Fixture network must be internal')
            staged=[(ROOT/'vendor/supabase.js','/tmp/tierbrain-party-supabase.js'),
                    (ROOT/'js/party-access.js','/tmp/tierbrain-party-access.js'),
                    (HERE/'sdk-gameplay-acceptance.mjs','/tmp/tierbrain-party-sdk-gameplay.mjs')]
            for source,target in staged:
                dc(['exec','-T','driver','node','-e',
                    "require('fs').writeFileSync(process.argv[1],require('fs').readFileSync(0))",target],
                   source.read_text(),30)
            output=redact(dc(['exec','-T','driver','node','/tmp/tierbrain-party-sdk-gameplay.mjs'],timeout=360))
            report['driver_output']=output
            print(output,end='',flush=True)
            report['passed']=True
        except Exception as error:
            report['error']=redact(str(error));print(report['error'],flush=True)
        finally:
            try:
                dc(['down','--volumes','--remove-orphans'],timeout=90)
                if dc(['ps','--all','--quiet']).strip():raise AssertionError('Fixture containers remain')
                report['cleanup_completed']=True
            except Exception as error:
                report['cleanup_error']=redact(str(error));report['passed']=False
            report['finished_at']=datetime.now(timezone.utc).isoformat()
            report_path.parent.mkdir(parents=True,exist_ok=True)
            report_path.write_text(json.dumps(report,indent=2)+'\n');report_path.chmod(0o600)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report',type=Path,default=Path('/tmp/tierbrain-party-http.json'))
    result=run(parser.parse_args().report.resolve())
    print(json.dumps({k:result[k] for k in ['passed','cleanup_completed']}))
    raise SystemExit(0 if result['passed'] else 1)
