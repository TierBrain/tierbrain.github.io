#!/usr/bin/env python3
"""Stage and run one Throne proof in an already prepared disposable Compose stack."""
import os
from pathlib import Path
import re
import subprocess
import sys

HERE=Path(__file__).resolve().parent
SOURCE=Path(os.environ.get('TIERBRAIN_THRONE_SOURCE',HERE.parent.parent)).resolve()
configured=os.environ.get('TIERBRAIN_THRONE_STACK')
if not configured:
    raise SystemExit('Set TIERBRAIN_THRONE_STACK to the already running disposable Compose directory')
STACK=Path(configured).resolve()
if not (STACK/'compose.yaml').is_file() or not (STACK/'.env').is_file():
    raise SystemExit('The disposable stack requires compose.yaml and its generated local .env')
for relative in ('vendor/supabase.js','js/throne-access.js'):
    if not (SOURCE/relative).is_file():
        raise SystemExit('Set TIERBRAIN_THRONE_SOURCE to the reviewed Throne source checkout')
env={key:value for key,value in os.environ.items() if key not in {'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
compose=['docker','--host=unix:///var/run/docker.sock','compose','--project-directory',str(STACK),'--env-file',str(STACK/'.env'),'-f',str(STACK/'compose.yaml'),'exec','-T']
inputs=[(SOURCE/'vendor/supabase.js','/tmp/tierbrain-throne-supabase.js'),(SOURCE/'js/throne-access.js','/tmp/tierbrain-throne-access.js'),(HERE/'sdk-gameplay-acceptance.mjs','/tmp/tierbrain-throne-sdk-gameplay.mjs')]
for source,target in inputs:
    result=subprocess.run(compose+['driver','node','-e',"require('fs').writeFileSync(process.argv[1],require('fs').readFileSync(0))",target],input=source.read_bytes(),capture_output=True,env=env,timeout=20)
    if result.returncode:
        raise SystemExit('Could not stage reviewed Throne fixture input in driver tmpfs')
result=subprocess.run(compose+['driver','node','/tmp/tierbrain-throne-sdk-gameplay.mjs'],capture_output=True,text=True,env=env,timeout=180)
output=result.stdout+result.stderr
# Only generated disposable fixture secrets are read here, solely for redaction.
for line in (STACK/'.env').read_text().splitlines():
    if '=' in line:
        value=line.split('=',1)[1]
        if value:output=output.replace(value,'[local fixture value redacted]')
output=re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[fixture JWT redacted]',output)
report=STACK/'throne-sdk-gameplay-result.txt'
report.write_text(output);report.chmod(0o600)
print(output,end='')
sys.exit(result.returncode)
