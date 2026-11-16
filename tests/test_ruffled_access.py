"""Offline checks of js/ruffled-access.js with a stub SDK: no network is used."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HARNESS = r"""
const fs = require('fs'); const calls = []; let fail = [];
const store = {};
global.window = global; global.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
global.crypto = require('crypto').webcrypto; global.fetch = () => Promise.reject(new Error('no network'));
let version = 0;
global.supabase = { createClient(url, key, opts) { calls.push(['client', url, key, opts.auth.storageKey]);
  return { auth: { async getSession(){ return { data: { session: null } }; }, async signInAnonymously(){ calls.push(['anon']); return { data: {} }; },
                   async getUser(){ return { data: { user: { id: 'u1' } } }; } },
           async rpc(name, args){ calls.push(['rpc', name, args]);
             if (fail.length) { const f = fail.shift(); return { error: f, status: f.status || 500 }; }
             if (/create|begin|open|end|phase/.test(name)) version++;
             return { data: { id: 'room', code: 'ABCDE', run_id: 'run', version, server_now: Date.now() } }; } }; } };
eval(fs.readFileSync(process.argv[1], 'utf8'));
(async () => {
  const a = RuffledAccess.create('https://example.supabase.co', 'sb_publishable_x');
  await a.createRoom();
  await a.join('ABCDE', 'Priya'); await a.peck('ABCDE', 'b1'); await a.answer('ABCDE', 'b1', 2);
  fail = [{ message: 'connection reset' }];
  const retried = a.beginRun({ roster: ['m1', 'm2', 'm3'], timed: true, topic: 'GK' });
  await new Promise(r => setTimeout(r, 20)); a.retry(); await retried;
  fail = [{ code: 'PGRST202', message: 'Could not find the function public.ruffled_host_state', status: 404 }];
  let missing = ''; try { await a.hostState('ABCDE'); } catch (e) { missing = a.message(e); }
  console.log(JSON.stringify({ calls, store, missing, saved: a.savedHostCode() }));
})().catch(e => { console.error(e); process.exit(1); });
"""


class RuffledAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            out = subprocess.run(['node', '-e', HARNESS, str(ROOT / 'js/ruffled-access.js')], capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            raise unittest.SkipTest('node is not installed')
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.data = json.loads(out.stdout)
        cls.rpcs = [c for c in cls.data['calls'] if c[0] == 'rpc']

    def test_guest_session_is_namespaced_and_verified(self):
        client = self.data['calls'][0]
        self.assertEqual(client[3], 'tb_ruffled_auth_v1')
        self.assertIn(['anon'], self.data['calls'])
        self.assertEqual(self.data['saved'], 'ABCDE')

    def test_players_never_claim_an_identity_or_score(self):
        for name, args in [(c[1], c[2]) for c in self.rpcs if c[1] in ('ruffled_join', 'ruffled_peck', 'ruffled_answer')]:
            self.assertFalse({'p_player_id', 'p_member_id', 'p_user_id', 'p_score', 'p_points', 'p_time'} & set(args), name)
        self.assertEqual([c[2] for c in self.rpcs if c[1] == 'ruffled_answer'], [{'p_code': 'ABCDE', 'p_bout_id': 'b1', 'p_choice': 2}])

    def test_an_uncertain_host_request_is_retried_unchanged(self):
        begins = [c[2] for c in self.rpcs if c[1] == 'ruffled_begin_run']
        self.assertEqual(len(begins), 2)
        self.assertEqual(begins[0], begins[1])
        self.assertRegex(begins[0]['p_request_id'], r'^[0-9a-f-]{36}$')
        self.assertEqual(begins[0]['p_expected_version'], 1)

    def test_a_site_without_the_database_change_gets_a_plain_message(self):
        self.assertEqual(self.data['missing'], 'Phone play is not switched on for this site yet. Play on one screen for now.')


if __name__ == '__main__':
    unittest.main()
