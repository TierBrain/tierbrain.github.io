"""Run only a named local acceptance driver; retain redacted results across UI yields."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parent
name = sys.argv[1]
if name not in {'acceptance', 'sdk-acceptance', 'gameplay-acceptance'}:
    raise SystemExit('Unknown local driver')
env = {k:v for k,v in os.environ.items() if k not in {
    'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'}}
configured_source = os.environ.get('TIERBRAIN_SHOW_SOURCE')
if configured_source:
    source_root = Path(configured_source).expanduser().resolve()
else:
    # Repository layout: <repo>/tests/show_stack/. The second candidate keeps
    # the operator's separate private working directory usable as well.
    candidates = [root.parent.parent, root.parent / 'tierbrain-repairs']
    source_root = next((candidate for candidate in candidates
                        if (candidate/'vendor/supabase.js').is_file()
                        and (candidate/'js/show-access.js').is_file()), None)
if source_root is None or not (source_root/'vendor/supabase.js').is_file() \
        or not (source_root/'js/show-access.js').is_file():
    raise SystemExit('Set TIERBRAIN_SHOW_SOURCE to the repository containing vendor/supabase.js and js/show-access.js')
for source, target in [(source_root/'vendor/supabase.js','tierbrain-supabase.js'),
                       (source_root/'js/show-access.js','tierbrain-show-access.js'),
                       (root/'acceptance.mjs','acceptance.mjs')]:
    staged = subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',
        'tierbrain-show-acceptance-driver-1','node','-e',
        "require('fs').writeFileSync(process.argv[1],require('fs').readFileSync(0))",
        '/tmp/'+target], input=source.read_bytes(),capture_output=True,env=env,timeout=15)
    if staged.returncode:
        raise SystemExit('Could not stage a local fixture input in driver tmpfs')
command = ['docker','--host=unix:///var/run/docker.sock','compose',
           '--project-directory',str(root),'--env-file',str(root/'.env'),
           '-f',str(root/'compose.yaml'),'exec','-T']
if name == 'gameplay-acceptance':
    command += ['-e','STACK_DRIVER_LIBRARY=1']
command += ['driver','node','--input-type=module']
result = subprocess.run(command, input=(root/(name+'.mjs')).read_text(),
                        text=True,capture_output=True,env=env,timeout=180)
output = result.stdout + result.stderr
for line in (root/'.env').read_text().splitlines():
    if '=' in line:
        output = output.replace(line.split('=',1)[1], '[local secret redacted]')
output = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[fixture JWT redacted]', output)
(root/(name+'-result.txt')).write_text(output)
print(output, end='')
raise SystemExit(result.returncode)
