"""Offline operational regressions; never contacts Supabase or another host.

Run python tests/readiness_ops.py --unit. A browser runner may also call run(env)
to cover malformed join URLs under its normal blocked-network page fixture.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def prefill_source(page):
    text = (ROOT / page).read_text()
    return text[text.index('function prefillCode(){'):text.index('\nasync function roomExists(')]


class OperationalRegressions(unittest.TestCase):
    def test_malformed_join_code_does_not_stop_reconnect_setup(self):
        cases = [
            ('?c=abc12', '', 'ABC12'),
            ('?c=%80', '', ''),
            ('?c=%E0%A4%A', '', 'A'),
            ('?c=%ZZ', '', 'ZZ'),
            ('?from=poster&c=ab%203cd&tracking=kept', '', 'AB3CD'),
            ('?c=a%26b', '', 'AB'),
            ('?c=abc12&c=zzzzz', '', 'ABC12'),
            ('?other=kept', '#abc12', 'ABC12'),
            ('?c=', '#abc12', 'ABC12'),
            ('?other=kept', '', ''),
        ]
        for page in ('play.html', 'play-gen.html'):
            script = r"""
const assert=require('node:assert/strict'),vm=require('node:vm');
const source=SOURCE,cases=CASES;
for(const [search,hash,expected] of cases){
 const code={value:'',listeners:[],addEventListener(type,listener){this.listeners.push(type);}};
 const location={search,hash};let peeks=0,resumes=0;
 const context={location,URLSearchParams,$:id=>{assert.equal(id,'code');return code;},peekTeams(){peeks++;},tryResume(){resumes++;}};
 vm.runInNewContext(source+'\nprefillCode();tryResume();',context);
 assert.equal(code.value,expected,search+' '+hash);
 assert.equal(resumes,1,'later reconnect setup must run');
 assert.equal(peeks,1);assert.deepEqual(code.listeners,['input']);
 assert.equal(location.search,search,'unrelated query parameters stay intact');
 assert.equal(location.hash,hash);
}
""".replace('SOURCE', json.dumps(prefill_source(page))).replace('CASES', json.dumps(cases))
            result = subprocess.run(['node', '-'], input=script, text=True,
                                    capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, page + ': ' + result.stdout + result.stderr)

    def test_health_check_uses_bounded_read_only_endpoint_and_fails_closed(self):
        text = (ROOT / '.github/workflows/keepalive.yml').read_text()
        match = re.search(r'(?m)^        run: \|\n((?:          .*\n?)+)', text)
        self.assertIsNotNone(match)
        shell = '\n'.join(line[10:] for line in match[1].splitlines())
        self.assertIn('timeout-minutes: 2', text)
        self.assertIn('contents: read', text)
        with tempfile.TemporaryDirectory(prefix='tierbrain-health-fixture-') as temp:
            directory = Path(temp)
            fake = directory / 'curl'
            fake.write_text('#!' + sys.executable + '\n' +
                'import json,os,pathlib,sys\n'
                'pathlib.Path(os.environ["READINESS_CURL_ARGS"]).write_text(json.dumps(sys.argv[1:]))\n'
                'sys.stdout.write(os.environ["READINESS_CURL_STATUS"])\n'
                'sys.exit(int(os.environ["READINESS_CURL_EXIT"]))\n')
            fake.chmod(0o700)
            for status, exit_code, should_pass in (('200', 0, True), ('403', 0, False),
                                                  ('302', 0, False), ('000', 28, False)):
                args_file = directory / 'arguments.json'
                env = {**os.environ, 'PATH': str(directory) + os.pathsep + os.environ.get('PATH', ''),
                       'READINESS_CURL_ARGS': str(args_file), 'READINESS_CURL_STATUS': status,
                       'READINESS_CURL_EXIT': str(exit_code)}
                result = subprocess.run(['bash', '-e', '-c', shell], env=env, text=True,
                                        capture_output=True, timeout=5)
                self.assertEqual(result.returncode == 0, should_pass, result.stdout + result.stderr)
                args = json.loads(args_file.read_text())
                urls = [arg for arg in args if arg.startswith('https://')]
                self.assertEqual(urls, ['https://cgrbwtcydgfkbqhseeap.supabase.co/rest/v1/scores?select=id&limit=0'])
                self.assertNotIn('-X', args)
                self.assertNotIn('--request', args)
                self.assertNotIn('--data', args)
                self.assertIn('--fail', args)
                for flag, value in (('--connect-timeout', '8'), ('--max-time', '20'),
                                    ('--retry', '2'), ('--retry-max-time', '65'), ('--output', '/dev/null')):
                    self.assertEqual(args[args.index(flag) + 1], value)


def run(env):
    for page_name in ('play.html', 'play-gen.html'):
        for query, expected in (('?c=%80&from=poster', ''), ('?c=ab%203cd&from=poster', 'AB3CD')):
            label = page_name.replace('.html', '') + ('_malformed' if not expected else '_encoded')
            page = env.new_page('/' + page_name + query, label, mobile=True)
            env.check(label + '_safe_code_prefill', page.locator('#code').input_value() == expected)
            env.check(label + '_nickname_and_join_controls_available', page.locator('#name').is_visible()
                      and page.locator('.team-btn').count() == 2)
            env.check(label + '_query_kept', page.evaluate("new URLSearchParams(location.search).get('from')") == 'poster')


if __name__ == '__main__':
    if '--unit' in sys.argv:
        sys.argv.remove('--unit')
    unittest.main()
