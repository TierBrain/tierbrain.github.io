#!/usr/bin/env python3
"""Run readiness checks in Chromium or WebKit against synthetic local services."""
import argparse
import importlib.util
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT/'tests/gameplay_stack'
sys.path.insert(0,str(SHARED))
sys.path.insert(1,str(ROOT/'tests'))
spec = importlib.util.spec_from_file_location('gameplay_runner',SHARED/'run-browser-acceptance.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
# This filename deliberately differs from shared browser_env to avoid imports
# resolving a second module under the same name.
spec = importlib.util.spec_from_file_location('readiness_browser_env',Path(__file__).with_name('browser_env.py'))
environment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(environment)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--family',choices=('ux','ops','quiz','solo_a','solo_b','catalogue','races','race_a','race_b'),required=True)
    parser.add_argument('--browser',choices=('chromium','webkit'),default='chromium')
    parser.add_argument('--report',type=Path,required=True)
    args = parser.parse_args()
    result = runner.run(args.family,args.report.resolve(),
        module_path=ROOT/('tests/readiness_'+args.family+'.py'),
        env_class=environment.ReadinessEnv,browser_engine=args.browser,
        extra_inputs=(Path(__file__),Path(__file__).with_name('browser_env.py'),
                      *ROOT.glob('tests/readiness_*.py')))
    raise SystemExit(0 if result['passed'] else 1)
