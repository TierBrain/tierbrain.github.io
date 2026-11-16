#!/usr/bin/env python3
"""Disposable PostgreSQL acceptance for Ruffled Feathers phone rooms.

No live project or HTTP is contacted. Like the other room checks, a driver-set
auth.uid() subject stands in for verified guest sessions, and windows are tested
by moving stored timestamps rather than sleeping. Real JWT/PostgREST and phone
browser checks remain separate.

Runs in the pinned, cached Docker image like the other room checks, or against
local PostgreSQL server binaries with --local-pgbin (run as a non-root user).
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
from uuid import uuid4

from check_show_access import IMAGE, DOCKER, LEGACY_AUDIT_SQL, literal

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/show_auth_baseline.sql'
MIGRATION = ROOT / 'supabase/migrations/20261116100000_secure_ruffled_rooms.sql'
ROLLBACK = ROOT / 'supabase/rollback/secure_ruffled_rooms.sql'
TABLES = ('rooms', 'members', 'runs', 'bouts', 'pecks', 'answers', 'resolutions', 'requests')
RPCS = ('ruffled_create_room', 'ruffled_host_state', 'ruffled_begin_run', 'ruffled_open_bout', 'ruffled_end_bout',
        'ruffled_set_phase', 'ruffled_preview', 'ruffled_join', 'ruffled_my_membership', 'ruffled_leave',
        'ruffled_player_state', 'ruffled_peck', 'ruffled_answer')


class Database:
    """A throwaway server: local binaries in a temporary directory, or the pinned Docker image."""

    def __init__(self, pgbin: str | None):
        self.pgbin, self.tmp, self.container = pgbin, None, None

    def __enter__(self):
        if self.pgbin:
            self.tmp = tempfile.mkdtemp(prefix='tierbrain-ruffled-')
            data = os.path.join(self.tmp, 'data')
            subprocess.run([os.path.join(self.pgbin, 'initdb'), '-D', data, '-U', 'postgres', '-A', 'trust'],
                           check=True, capture_output=True, text=True)
            subprocess.run([os.path.join(self.pgbin, 'pg_ctl'), '-D', data, '-w', '-l', os.path.join(self.tmp, 'log'),
                            '-o', "-c listen_addresses='' -k " + self.tmp, 'start'], check=True, capture_output=True, text=True)
            self.base = [os.path.join(self.pgbin, 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', self.tmp, '-U', 'postgres', '-d', 'postgres']
        else:
            env = {k: v for k, v in os.environ.items() if not k.startswith('DOCKER_')}
            subprocess.run(DOCKER + ['image', 'inspect', IMAGE], check=True, capture_output=True, env=env)  # cached only, never pull
            name = 'tierbrain-ruffled-access-' + secrets.token_hex(6)
            subprocess.run(DOCKER + ['run', '--detach', '--name', name, '--network', 'none', '--memory', '512m',
                                     '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_PASSWORD=' + secrets.token_urlsafe(24), IMAGE],
                           check=True, capture_output=True, env=env)
            self.container = name
            for _ in range(60):
                if subprocess.run(DOCKER + ['exec', name, 'pg_isready', '-U', 'postgres'], capture_output=True).returncode == 0:
                    break
                time.sleep(1)
            self.base = DOCKER + ['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']
        return self

    def __exit__(self, *exc):
        if self.pgbin and self.tmp:
            subprocess.run([os.path.join(self.pgbin, 'pg_ctl'), '-D', os.path.join(self.tmp, 'data'), '-m', 'immediate', 'stop'], capture_output=True)
            shutil.rmtree(self.tmp, ignore_errors=True)
        if self.container:
            subprocess.run(DOCKER + ['rm', '--force', self.container], capture_output=True)

    def run(self, statement: str, single: bool = False) -> subprocess.CompletedProcess:
        return subprocess.run(self.base + (['-1'] if single else []), input=statement, text=True, capture_output=True, timeout=60)

    def sql(self, statement: str, single: bool = False) -> str:
        result = self.run(statement, single)
        if result.returncode:
            raise AssertionError('PostgreSQL operation failed:\n' + result.stderr)
        return result.stdout.strip()


class RpcError(Exception):
    def __init__(self, state, text):
        super().__init__(state + ' ' + text)
        self.state, self.text = state, text


def run_checks(report_path: str, pgbin: str | None) -> dict:
    actors = {a: str(uuid4()) for a in ('H', 'O', 'P1', 'P2', 'P3', 'P4', 'X')}
    report = {'tests': [], 'limits': ['Driver-set auth.uid() subject; no GoTrue JWT validation',
                                      'Windows moved by editing timestamps, not by waiting']}
    with Database(pgbin) as db:
        def context(actor, statement, role='authenticated'):
            subject = actors[actor] if actor else ''
            return ('BEGIN; SET LOCAL ROLE ' + role + '; SET LOCAL request.jwt.claim.sub=' + literal(subject) + ';\n'
                    + statement + '\nCOMMIT;')

        def call(actor, function, role='authenticated', **args):
            parts = ', '.join('p_%s => %s' % (k, value(v)) for k, v in args.items())
            result = db.run(context(actor, "\\set VERBOSITY verbose\nSELECT public.%s(%s);" % (function, parts), role))
            if result.returncode:
                text = result.stderr
                state = text.split('ERROR:', 1)[1].strip().split(':', 1)[0].strip() if 'ERROR:' in text else '?'
                raise RpcError(state, text)
            out = result.stdout.strip()
            return json.loads(out) if out else None

        def value(v):
            if v is None:
                return 'NULL'
            if isinstance(v, bool):
                return 'true' if v else 'false'
            if isinstance(v, int):
                return str(v)
            if isinstance(v, (dict, list)):
                return literal(json.dumps(v)) + '::jsonb'
            return literal(str(v))

        def record(label, condition=True, **details):
            if not condition:
                raise AssertionError(label + ' ' + json.dumps(details, default=str))
            report['tests'].append({'name': label, 'passed': True, **details})
            print(label + ': passed', flush=True)

        def denied(label, state, actor, function, role='authenticated', contains=None, **args):
            before = rows()
            try:
                call(actor, function, role, **args)
            except RpcError as error:
                ok = error.state == state and (contains is None or contains in error.text)
                record(label, ok and rows() == before, sqlstate=error.state)
                return
            raise AssertionError(label + ': expected ' + state)

        def rows():
            return db.sql("SELECT " + " || ".join(
                "(SELECT count(*)::text FROM ruffled_private.%s)||','" % t for t in TABLES) + ";")

        def shift(bout_id, seconds):
            """Pretend `seconds` have passed for this bout."""
            db.sql("UPDATE ruffled_private.bouts SET open_at=open_at-make_interval(secs=>%d),"
                   "peck_deadline=peck_deadline-make_interval(secs=>%d),chosen_at=chosen_at-make_interval(secs=>%d),"
                   "choose_deadline=choose_deadline-make_interval(secs=>%d) WHERE id=%s;" % (seconds, seconds, seconds, seconds, literal(bout_id)))
            db.sql("UPDATE ruffled_private.pecks SET created_at=created_at-make_interval(secs=>%d) WHERE bout_id=%s;" % (seconds, literal(bout_id)))
            db.sql("UPDATE ruffled_private.answers SET created_at=created_at-make_interval(secs=>%d) WHERE bout_id=%s;" % (seconds, literal(bout_id)))

        paths = [FIXTURE, MIGRATION, ROLLBACK]
        report['input_sha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        db.sql(FIXTURE.read_text())
        legacy_before = json.loads(db.sql(LEGACY_AUDIT_SQL))
        db.sql(MIGRATION.read_text(), single=True)
        record('migration applies atomically')
        dup = db.run(MIGRATION.read_text(), single=True)
        record('re-applying is refused by the preflight', dup.returncode != 0 and 'already exist' in dup.stderr)

        # ---------- privileges ----------
        facts = json.loads(db.sql("""SELECT json_build_object(
 'rls',(SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ruffled_private' AND c.relkind='r'),
 'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ruffled_private' AND c.relkind='r'),
 'client_table_grants',(SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='ruffled_private' AND grantee IN ('PUBLIC','anon','authenticated')),
 'schema_usage',(SELECT bool_or(has_schema_privilege(r,'ruffled_private','USAGE')) FROM unnest(ARRAY['anon','authenticated']) r),
 'private_exec',(SELECT bool_or(has_function_privilege(r,p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, unnest(ARRAY['anon','authenticated']) r WHERE n.nspname='ruffled_private'),
 'api',(SELECT json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,'path',p.proconfig,
   'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ruffled\\_%' ESCAPE '\\'));"""))
        record('eight private tables, all with row security and no client grants',
               facts['rls'] and facts['tables'] == 8 and facts['client_table_grants'] == 0 and not facts['schema_usage'] and not facts['private_exec'])
        api = {f['name']: f for f in facts['api']}
        record('thirteen API functions: definer, empty search path, signed-in guests only',
               sorted(api) == sorted(RPCS) and all(f['definer'] and f['path'] == ['search_path=""'] and f['auth'] and not f['anon'] for f in api.values()))
        denied('anon cannot call the API', '42501', 'H', 'ruffled_preview', role='anon', code='ABCDE')
        denied('a missing session is refused', '42501', None, 'ruffled_preview', code='ABCDE')
        direct = db.run(context('H', 'SELECT * FROM ruffled_private.rooms;'))
        record('guests cannot read private tables directly', direct.returncode != 0 and 'permission denied' in direct.stderr)

        # ---------- rooms and joining ----------
        req = str(uuid4())
        room = call('H', 'ruffled_create_room', request_id=req)
        code = room['code']
        record('host creates a room with a five-character code', len(code) == 5 and room['phase'] == 'lobby' and room['version'] == 0)
        record('an identical create retry returns the same room', call('H', 'ruffled_create_room', request_id=req)['code'] == code)
        record('preview shows only code and phase', call('X', 'ruffled_preview', code=code.lower()) == {'code': code, 'phase': 'lobby'})
        denied('only the host can read the host view', '42501', 'P1', 'ruffled_host_state', code=code)
        members = {}
        for actor, name in (('P1', 'Priya'), ('P2', 'Sam'), ('P3', 'Ruth'), ('P4', 'Tom')):
            members[actor] = call(actor, 'ruffled_join', code=code, name='  ' + name + '  ')['id']
        record('players join and the server issues their IDs', len(set(members.values())) == 4)
        record('joining twice returns the same membership', call('P1', 'ruffled_join', code=code, name='Priya')['id'] == members['P1'])
        denied('a name already in the room is refused, ignoring case', '23505', 'X', 'ruffled_join', code=code, name='SAM')
        denied('names longer than 14 characters are refused', '22023', 'X', 'ruffled_join', code=code, name='A' * 15)
        denied('an unknown code is refused', '42501', 'X', 'ruffled_join', code='ZZZZZ', name='Zed')
        denied('a non-member cannot read the game', '42501', 'X', 'ruffled_player_state', code=code)
        host = call('H', 'ruffled_host_state', code=code)
        record('the host sees the four players', [m['name'] for m in host['members']] == ['Priya', 'Sam', 'Ruth', 'Tom'])

        # ---------- starting a game ----------
        roster = [members['P1'], members['P2'], members['P3']]
        denied('a stale version is refused', 'PT409', 'H', 'ruffled_begin_run', code=code, config={'roster': roster, 'timed': True, 'topic': 'General knowledge'}, expected_version=7, request_id=str(uuid4()))
        denied('two players are not enough', '22023', 'H', 'ruffled_begin_run', code=code, config={'roster': roster[:2], 'timed': True, 'topic': 'GK'}, expected_version=0, request_id=str(uuid4()))
        denied('a player outside the room is refused', 'PT412', 'H', 'ruffled_begin_run', code=code, config={'roster': roster[:2] + [str(uuid4())], 'timed': True, 'topic': 'GK'}, expected_version=0, request_id=str(uuid4()))
        denied('a player cannot start the game', '42501', 'P1', 'ruffled_begin_run', code=code, config={'roster': roster, 'timed': True, 'topic': 'GK'}, expected_version=0, request_id=str(uuid4()))
        begin_req = str(uuid4())
        state = call('H', 'ruffled_begin_run', code=code, config={'roster': roster, 'timed': True, 'topic': 'General knowledge'}, expected_version=0, request_id=begin_req)
        run_id, version = state['run_id'], state['version']
        record('the host starts a timed game for three players', state['phase'] == 'table' and state['run']['peck_ms'] == 15000
               and [m['id'] for m in state['run']['roster']] == roster and all(v == 0 for v in state['run']['points'].values()))
        record('a begin retry returns the original response', call('H', 'ruffled_begin_run', code=code, config={'roster': roster, 'timed': True, 'topic': 'General knowledge'}, expected_version=0, request_id=begin_req)['run_id'] == run_id)
        denied('a request ID reused with other input is refused', '22023', 'H', 'ruffled_begin_run', code=code, config={'roster': roster, 'timed': False, 'topic': 'General knowledge'}, expected_version=0, request_id=begin_req)

        def bout(a, b, correct=1, q='Which is the odd one out?'):
            nonlocal version
            s = call('H', 'ruffled_open_bout', code=code, run_id=run_id, bout={'a': a, 'b': b, 'q': q, 'opts': ['W', 'X', 'Y', 'Z'], 'correct': correct},
                     expected_version=version, request_id=str(uuid4()))
            version = s['version']
            return s

        denied('a pairing outside the game is refused', '22023', 'H', 'ruffled_open_bout', code=code, run_id=run_id,
               bout={'a': members['P1'], 'b': members['P4'], 'q': 'Q', 'opts': ['a', 'b', 'c', 'd'], 'correct': 0}, expected_version=version, request_id=str(uuid4()))
        denied('three options are refused', '22023', 'H', 'ruffled_open_bout', code=code, run_id=run_id,
               bout={'a': members['P1'], 'b': members['P2'], 'q': 'Q', 'opts': ['a', 'b', 'c'], 'correct': 0}, expected_version=version, request_id=str(uuid4()))

        # ---------- bout 1: wrong, then the opponent wins ----------
        s = bout(members['P1'], members['P2'], correct=2)
        b1 = s['bout']['id']
        record('a bout opens with the question but not the answer', s['phase'] == 'live' and s['bout']['correct'] is None and s['bout']['opts'] == ['W', 'X', 'Y', 'Z'])
        record('the server opens pecking after a short reading time', 2000 <= s['bout']['open_at'] - s['server_now'] <= 2600)
        denied('pecking before it opens is refused', '42501', 'P1', 'ruffled_peck', contains='Not yet', code=code, bout_id=b1)
        shift(b1, 3)
        denied('a player outside the bout cannot peck', '42501', 'P3', 'ruffled_peck', code=code, bout_id=b1)
        s = call('P1', 'ruffled_peck', code=code, bout_id=b1)
        record('the first peck gets the turn and six seconds to choose', s['bout']['chooser'] == members['P1'] and 5500 <= s['bout']['choose_deadline'] - s['server_now'] <= 6000)
        denied('the other robin is beaten to it', '42501', 'P2', 'ruffled_peck', contains='Beaten to it', code=code, bout_id=b1)
        denied('only the chooser can answer', '42501', 'P2', 'ruffled_answer', code=code, bout_id=b1, choice=2)
        s = call('P1', 'ruffled_answer', code=code, bout_id=b1, choice=0)
        record('a wrong answer locks that player out and reopens pecking', s['bout']['locked'] == [members['P1']] and s['bout']['chooser'] is None
               and not s['bout']['closed'] and s['bout']['wrong'] == [{'member': members['P1'], 'choice': 0}] and s['bout']['correct'] is None)
        denied('a locked-out player cannot peck again', '42501', 'P1', 'ruffled_peck', contains='locked out', code=code, bout_id=b1)
        denied('a recorded answer cannot be changed', '22023', 'P1', 'ruffled_answer', code=code, bout_id=b1, choice=3)
        call('P2', 'ruffled_peck', code=code, bout_id=b1)
        s = call('P2', 'ruffled_answer', code=code, bout_id=b1, choice=2)
        record('a correct answer wins 2 points and reveals the answer', s['bout']['closed'] and s['bout']['winner'] == members['P2'] and s['bout']['reason'] == 'correct'
               and s['bout']['correct'] == 2 and s['run']['points'][members['P2']] == 2 and s['run']['points'][members['P1']] == 0)
        record('the winner’s reaction time leaves out the opponent’s choosing time', 0 <= s['bout']['peck_ms'] <= 3500, peck_ms=s['bout']['peck_ms'])
        record('an identical answer replay is accepted', call('P2', 'ruffled_answer', code=code, bout_id=b1, choice=2)['bout']['winner'] == members['P2'])
        denied('nobody else can answer a closed bout', '42501', 'P3', 'ruffled_answer', code=code, bout_id=b1, choice=2)

        # ---------- pairs meet once ----------
        denied('a pair cannot meet twice, whichever side', '22023', 'H', 'ruffled_open_bout', code=code, run_id=run_id,
               bout={'a': members['P2'], 'b': members['P1'], 'q': 'Q', 'opts': ['a', 'b', 'c', 'd'], 'correct': 0}, expected_version=version, request_id=str(uuid4()))
        denied('the final table waits until every pair has met', '42501', 'H', 'ruffled_set_phase', code=code, phase='final', expected_version=version, request_id=str(uuid4()))

        # ---------- bout 2: chooser runs out of time, then the clock runs out ----------
        s = bout(members['P1'], members['P3'])
        b2 = s['bout']['id']
        denied('a second bout cannot open over a live one', '42501', 'H', 'ruffled_open_bout', code=code, run_id=run_id,
               bout={'a': members['P2'], 'b': members['P3'], 'q': 'Q', 'opts': ['a', 'b', 'c', 'd'], 'correct': 0}, expected_version=version, request_id=str(uuid4()))
        shift(b2, 3)
        call('P3', 'ruffled_peck', code=code, bout_id=b2)
        before = call('P1', 'ruffled_player_state', code=code)['bout']['peck_deadline']
        shift(b2, 7)
        s = call('P1', 'ruffled_player_state', code=code)
        record('a chooser who runs out of time is locked out, and the clock waited for them',
               s['bout']['locked'] == [members['P3']] and s['bout']['chooser'] is None and not s['bout']['closed']
               and abs((s['bout']['peck_deadline'] - before) - (6000 - 7000)) < 300)
        shift(b2, 30)
        s = call('H', 'ruffled_host_state', code=code)
        record('when the clock runs out the bout ends 0-0', s['bout']['closed'] and s['bout']['outcome'] == 'nil' and s['bout']['reason'] == 'time' and s['bout']['correct'] == 1)

        # ---------- bout 3: both wrong ----------
        s = bout(members['P2'], members['P3'], correct=3)
        b3 = s['bout']['id']
        shift(b3, 3)
        call('P2', 'ruffled_peck', code=code, bout_id=b3); call('P2', 'ruffled_answer', code=code, bout_id=b3, choice=0)
        call('P3', 'ruffled_peck', code=code, bout_id=b3); s = call('P3', 'ruffled_answer', code=code, bout_id=b3, choice=1)
        record('both wrong ends the bout 0-0', s['bout']['closed'] and s['bout']['reason'] == 'both' and s['run']['points'] == {members['P1']: 0, members['P2']: 2, members['P3']: 0})
        s = call('H', 'ruffled_set_phase', code=code, phase='final', expected_version=version, request_id=str(uuid4()))
        version = s['version']
        record('with every pair met the game can finish', s['phase'] == 'final' and s['run']['finished'] and len(s['run']['results']) == 3)
        denied('a finished game takes no more bouts', '42501', 'H', 'ruffled_open_bout', code=code, run_id=run_id,
               bout={'a': members['P1'], 'b': members['P2'], 'q': 'Q', 'opts': ['a', 'b', 'c', 'd'], 'correct': 0}, expected_version=version, request_id=str(uuid4()))

        # ---------- a relaxed game, a race and a player leaving ----------
        roster = [members['P1'], members['P2'], members['P3'], members['P4']]
        s = call('H', 'ruffled_begin_run', code=code, config={'roster': roster, 'timed': False, 'topic': 'Bible'}, expected_version=version, request_id=str(uuid4()))
        run_id, version = s['run_id'], s['version']
        record('a new relaxed game starts with fresh points', s['run']['peck_ms'] is None and s['run']['points'][members['P2']] == 0)
        s = bout(members['P1'], members['P4'])
        b4 = s['bout']['id']
        shift(b4, 600)
        record('a relaxed bout has no clock', not call('H', 'ruffled_host_state', code=code)['bout']['closed'])
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda a: _try(lambda: call(a, 'ruffled_peck', code=code, bout_id=b4)), ['P1', 'P4']))
        record('two pecks at once: exactly one robin gets the turn', sorted(o is None for o in outcomes) == [False, True]
               and any(isinstance(o, RpcError) and 'Beaten to it' in o.text for o in outcomes if o is not None))
        denied('the host cannot end a bout that is not current', '42501', 'H', 'ruffled_end_bout', code=code, bout_id=b1, expected_version=version, request_id=str(uuid4()))
        s = call('H', 'ruffled_end_bout', code=code, bout_id=b4, expected_version=version, request_id=str(uuid4()))
        version = s['version']
        record('the host can end a bout with no points, never with points', s['bout']['closed'] and s['bout']['reason'] == 'host' and s['bout']['winner'] is None)
        call('P4', 'ruffled_leave', code=code)
        record('a player who leaves loses access', call('P4', 'ruffled_my_membership', code=code) is None)
        denied('and cannot read the game', '42501', 'P4', 'ruffled_player_state', code=code)
        denied('a bout with a player who has left cannot open', 'PT412', 'H', 'ruffled_open_bout', code=code, run_id=run_id,
               bout={'a': members['P2'], 'b': members['P4'], 'q': 'Q', 'opts': ['a', 'b', 'c', 'd'], 'correct': 0}, expected_version=version, request_id=str(uuid4()))
        for a, b in ((members['P1'], members['P2']), (members['P1'], members['P3']), (members['P2'], members['P3'])):
            s = bout(a, b)
            s = call('H', 'ruffled_end_bout', code=code, bout_id=s['bout']['id'], expected_version=version, request_id=str(uuid4()))
            version = s['version']
        s = call('H', 'ruffled_set_phase', code=code, phase='final', expected_version=version, request_id=str(uuid4()))
        version = s['version']
        record('pairs with a departed player do not block the end', s['phase'] == 'final')
        record('the departed player still appears in the results', any(m['id'] == members['P4'] and not m['active'] for m in s['run']['roster']))

        # ---------- untouched neighbours and rollback ----------
        record('legacy tables, policies and cleanup are unchanged', json.loads(db.sql(LEGACY_AUDIT_SQL)) == legacy_before)
        counts = rows()
        db.sql(ROLLBACK.read_text(), single=True)
        try:
            call('P1', 'ruffled_player_state', code=code)
            raise AssertionError('rollback left the API callable')
        except RpcError as error:
            record('rollback removes access', error.state == '42501')
        record('rollback keeps every record', rows() == counts)
    Path(report_path).write_text(json.dumps(report, indent=1))
    return report


def _try(fn):
    try:
        fn()
        return None
    except RpcError as error:
        return error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True)
    parser.add_argument('--local-pgbin', help='use local PostgreSQL server binaries instead of Docker')
    args = parser.parse_args()
    report = run_checks(args.report, args.local_pgbin)
    print('%d checks passed' % len(report['tests']))


if __name__ == '__main__':
    main()
