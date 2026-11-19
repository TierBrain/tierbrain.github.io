#!/usr/bin/env python3
"""Disposable PostgreSQL acceptance for Ten Lanterns phone rooms.

No live project or HTTP is contacted. Like the other room checks, a driver-set
auth.uid() subject stands in for verified guest sessions. Most windows move
stored timestamps; contention cases wait across actual server deadlines.
Real JWT/PostgREST and phone
browser checks remain separate.

Runs in the pinned, cached Docker image like the other room checks, or against
local PostgreSQL server binaries with --local-pgbin (run as a non-root user).
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import secrets
import time
from uuid import uuid4

from check_show_access import LEGACY_AUDIT_SQL, literal
from check_ruffled_access import Database, RpcError, _try

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/show_auth_baseline.sql'
MIGRATION = ROOT / 'supabase/migrations/20261118210000_secure_lantern_rooms.sql'
ROLLBACK = ROOT / 'supabase/rollback/secure_lantern_rooms.sql'
TABLES = ('rooms', 'members', 'games', 'prompts', 'presses', 'answers', 'requests')
RPCS = ('lantern_create_room', 'lantern_host_state', 'lantern_begin_game', 'lantern_open_prompt', 'lantern_end_prompt',
        'lantern_set_phase', 'lantern_preview', 'lantern_join', 'lantern_my_membership', 'lantern_leave',
        'lantern_player_state', 'lantern_press', 'lantern_answer')


def run_checks(report_path: str, pgbin: str | None) -> dict:
    actors = {a: str(uuid4()) for a in ('H', 'P1', 'P2', 'P3', 'P4', 'X')}
    report = {'tests': [], 'limits': ['Driver-set auth.uid() subject; no GoTrue JWT validation',
                                      'Most windows moved by editing timestamps; contention crosses real deadlines']}
    with Database(pgbin) as db:
        def context(actor, statement, role='authenticated'):
            subject = actors[actor] if actor else ''
            return ('BEGIN; SET LOCAL ROLE ' + role + '; SET LOCAL request.jwt.claim.sub=' + literal(subject) + ';\n'
                    + statement + '\nCOMMIT;')

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

        def call(actor, function, role='authenticated', **args):
            parts = ', '.join('p_%s => %s' % (k, value(v)) for k, v in args.items())
            result = db.run(context(actor, "\\set VERBOSITY verbose\nSELECT public.%s(%s);" % (function, parts), role))
            if result.returncode:
                text = result.stderr
                state = text.split('ERROR:', 1)[1].strip().split(':', 1)[0].strip() if 'ERROR:' in text else '?'
                raise RpcError(state, text)
            out = result.stdout.strip()
            return json.loads(out) if out else None

        def record(label, condition=True, **details):
            if not condition:
                raise AssertionError(label + ' ' + json.dumps(details, default=str))
            report['tests'].append({'name': label, 'passed': True, **details})
            print(label + ': passed', flush=True)

        def rows():
            return db.sql("SELECT " + " || ".join("(SELECT count(*)::text FROM lantern_private.%s)||','" % t for t in TABLES) + ";")

        def denied(label, state, actor, function, role='authenticated', contains=None, **args):
            before = rows()
            try:
                call(actor, function, role, **args)
            except RpcError as error:
                ok = error.state == state and (contains is None or contains in error.text)
                record(label, ok and rows() == before, sqlstate=error.state)
                return
            raise AssertionError(label + ': expected ' + state)

        def shift(prompt_id, seconds):
            """Pretend `seconds` have passed for this prompt."""
            s = 'make_interval(secs=>%d)' % seconds
            db.sql("UPDATE lantern_private.prompts SET open_at=open_at-%s,deadline=deadline-%s,chosen_at=chosen_at-%s,choose_deadline=choose_deadline-%s WHERE id=%s;" % (s, s, s, s, literal(prompt_id)))
            db.sql("UPDATE lantern_private.presses SET created_at=created_at-%s WHERE prompt_id=%s;" % (s, literal(prompt_id)))
            db.sql("UPDATE lantern_private.answers SET created_at=created_at-%s WHERE prompt_id=%s;" % (s, literal(prompt_id)))

        paths = [FIXTURE, MIGRATION, ROLLBACK]
        report['input_sha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        db.sql(FIXTURE.read_text())
        legacy_before = json.loads(db.sql(LEGACY_AUDIT_SQL))
        ruffled_before = db.sql("SELECT count(*) FROM pg_namespace WHERE nspname='ruffled_private';")
        db.sql(MIGRATION.read_text(), single=True)
        record('migration applies atomically')
        dup = db.run(MIGRATION.read_text(), single=True)
        record('re-applying is refused by the preflight', dup.returncode != 0 and 'already exist' in dup.stderr)

        # ---------- privileges ----------
        facts = json.loads(db.sql("""SELECT json_build_object(
 'rls',(SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lantern_private' AND c.relkind='r'),
 'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lantern_private' AND c.relkind='r'),
 'client_table_grants',(SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='lantern_private' AND grantee IN ('PUBLIC','anon','authenticated')),
 'schema_usage',(SELECT bool_or(has_schema_privilege(r,'lantern_private','USAGE')) FROM unnest(ARRAY['anon','authenticated']) r),
 'private_exec',(SELECT bool_or(has_function_privilege(r,p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, unnest(ARRAY['anon','authenticated']) r WHERE n.nspname='lantern_private'),
 'api',(SELECT json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,'path',p.proconfig,
   'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'lantern\\_%' ESCAPE '\\'));"""))
        record('seven private tables, all with row security and no client grants',
               facts['rls'] and facts['tables'] == 7 and facts['client_table_grants'] == 0 and not facts['schema_usage'] and not facts['private_exec'])
        api = {f['name']: f for f in facts['api']}
        record('thirteen API functions: definer, empty search path, signed-in guests only',
               sorted(api) == sorted(RPCS) and all(f['definer'] and f['path'] == ['search_path=""'] and f['auth'] and not f['anon'] for f in api.values()))
        denied('anon cannot call the API', '42501', 'H', 'lantern_preview', role='anon', code='ABCDE')
        denied('a missing session is refused', '42501', None, 'lantern_preview', code='ABCDE')
        direct = db.run(context('H', 'SELECT * FROM lantern_private.rooms;'))
        record('guests cannot read private tables directly', direct.returncode != 0 and 'permission denied' in direct.stderr)

        # ---------- rooms and joining ----------
        req = str(uuid4())
        room = call('H', 'lantern_create_room', request_id=req)
        code = room['code']
        record('host creates a room with a five-character code', len(code) == 5 and room['phase'] == 'lobby' and room['version'] == 0)
        record('an identical create retry returns the same room', call('H', 'lantern_create_room', request_id=req)['code'] == code)
        record('preview shows only code and phase', call('X', 'lantern_preview', code=code.lower()) == {'code': code, 'phase': 'lobby'})
        denied('only the host can read the host view', '42501', 'P1', 'lantern_host_state', code=code)
        members = {}
        for actor, name in (('P1', 'Grandad'), ('P2', 'Amelia'), ('P3', 'Tom'), ('P4', 'Ruth')):
            members[actor] = call(actor, 'lantern_join', code=code, name='  ' + name + '  ')['id']
        record('players join and the server issues their IDs', len(set(members.values())) == 4)
        record('joining twice returns the same membership', call('P1', 'lantern_join', code=code, name='Grandad')['id'] == members['P1'])
        denied('a name already in the room is refused, ignoring case', '23505', 'X', 'lantern_join', code=code, name='AMELIA')
        denied('names longer than 14 characters are refused', '22023', 'X', 'lantern_join', code=code, name='A' * 15)
        denied('an unknown code is refused', '42501', 'X', 'lantern_join', code='ZZZZZ', name='Zed')
        denied('a non-member cannot read the game', '42501', 'X', 'lantern_player_state', code=code)

        # ---------- starting a game ----------
        roster = [members['P1'], members['P2'], members['P3']]
        denied('a stale version is refused', 'PT409', 'H', 'lantern_begin_game', code=code, config={'roster': roster}, expected_version=7, request_id=str(uuid4()))
        denied('one player is not enough', '22023', 'H', 'lantern_begin_game', code=code, config={'roster': roster[:1]}, expected_version=0, request_id=str(uuid4()))
        denied('a player outside the room is refused', 'PT412', 'H', 'lantern_begin_game', code=code, config={'roster': roster[:2] + [str(uuid4())]}, expected_version=0, request_id=str(uuid4()))
        denied('a player cannot start the game', '42501', 'P1', 'lantern_begin_game', code=code, config={'roster': roster}, expected_version=0, request_id=str(uuid4()))
        begin_req = str(uuid4())
        state = call('H', 'lantern_begin_game', code=code, config={'roster': roster}, expected_version=0, request_id=begin_req)
        game_id, version = state['game_id'], state['version']
        record('the host starts a game for three players', state['phase'] == 'play' and [m['id'] for m in state['game']['roster']] == roster)
        record('a begin retry returns the original response', call('H', 'lantern_begin_game', code=code, config={'roster': roster}, expected_version=0, request_id=begin_req)['game_id'] == game_id)
        denied('a request ID reused with other input is refused', '22023', 'H', 'lantern_begin_game', code=code, config={'roster': roster[:2]}, expected_version=0, request_id=begin_req)

        def prompt(spec, actor='H'):
            nonlocal version
            s = call(actor, 'lantern_open_prompt', code=code, game_id=game_id, prompt=spec, expected_version=version, request_id=str(uuid4()))
            version = s['version']
            return s

        def bad(label, spec, state='22023'):
            denied(label, state, 'H', 'lantern_open_prompt', code=code, game_id=game_id, prompt=spec, expected_version=version, request_id=str(uuid4()))

        Q = {'q': 'Which is the odd one out?', 'opts': ['W', 'X', 'Y', 'Z']}
        bad('a player outside the game is refused', dict(Q, kind='answer', eligible=[members['P4']], correct=1))
        bad('a question needs four options', {'kind': 'answer', 'eligible': [members['P1']], 'q': 'Q', 'opts': ['a', 'b', 'c'], 'correct': 0})
        bad('a question needs its correct option', dict(Q, kind='buzz', eligible=roster))
        bad('a choice has no correct option', {'kind': 'choose', 'eligible': [members['P1']], 'q': 'Dive?', 'opts': ['Dive', 'Surface'], 'correct': 0})
        bad('a claim has no options', {'kind': 'claim', 'eligible': roster, 'q': 'Steal?', 'opts': ['Me']})
        bad('a window must be between 3 and 120 seconds', dict(Q, kind='answer', eligible=[members['P1']], correct=1, window_ms=500))
        bad('an unknown kind is refused', dict(Q, kind='bet', eligible=[members['P1']], correct=1))

        # ---------- answer: one named player ----------
        s = prompt(dict(Q, kind='answer', eligible=[members['P1']], correct=2))
        a1 = s['prompt']['id']
        record('a question opens with the options but not the answer', s['prompt']['kind'] == 'answer' and s['prompt']['correct'] is None and s['prompt']['opts'] == Q['opts'])
        bad('a second prompt cannot open over a live one', dict(Q, kind='answer', eligible=[members['P2']], correct=0), '42501')
        p2_view = call('P2', 'lantern_player_state', code=code)
        record('a watching phone cannot see the answer either', p2_view['prompt']['correct'] is None)
        denied('only the named player can answer', '42501', 'P2', 'lantern_answer', code=code, prompt_id=a1, choice=2)
        denied('there is nothing to press on a question for one player', '42501', 'P1', 'lantern_press', code=code, prompt_id=a1)
        denied('an option that does not exist is refused', '22023', 'P1', 'lantern_answer', code=code, prompt_id=a1, choice=4)
        s = call('P1', 'lantern_answer', code=code, prompt_id=a1, choice=0)
        record('a wrong answer closes it and only then reveals the answer', s['prompt']['closed'] and s['prompt']['reason'] == 'wrong' and s['prompt']['choice'] == 0 and s['prompt']['correct'] == 2 and s['prompt']['winner'] is None)
        record('an identical answer replay is accepted', call('P1', 'lantern_answer', code=code, prompt_id=a1, choice=0)['prompt']['choice'] == 0)
        denied('a recorded answer cannot be changed', '22023', 'P1', 'lantern_answer', code=code, prompt_id=a1, choice=2)
        s = prompt(dict(Q, kind='answer', eligible=[members['P2']], correct=3, window_ms=12000))
        a2 = s['prompt']['id']
        s = call('P2', 'lantern_answer', code=code, prompt_id=a2, choice=3)
        record('a right answer closes it with that player as the winner', s['prompt']['reason'] == 'correct' and s['prompt']['winner'] == members['P2'])
        denied('an earlier question cannot be answered', '42501', 'P1', 'lantern_answer', code=code, prompt_id=a1, choice=1)
        s = prompt(dict(Q, kind='answer', eligible=[members['P3']], correct=1, window_ms=10000))
        a3 = s['prompt']['id']
        shift(a3, 11)
        s = call('H', 'lantern_host_state', code=code)
        record('when the window runs out the question closes on time', s['prompt']['closed'] and s['prompt']['reason'] == 'time' and s['prompt']['correct'] == 1)
        denied('nobody can answer after the window', '42501', 'P3', 'lantern_answer', code=code, prompt_id=a3, choice=1)

        # ---------- buzz: open to several ----------
        s = prompt(dict(Q, kind='buzz', eligible=roster, correct=1, window_ms=20000))
        b1 = s['prompt']['id']
        record('an open question gives a moment to read before presses count', 1200 <= s['prompt']['open_at'] - s['server_now'] <= 1600)
        denied('pressing before it opens is refused', '42501', 'P1', 'lantern_press', contains='Not yet', code=code, prompt_id=b1)
        shift(b1, 2)
        denied('answering without the turn is refused', '42501', 'P1', 'lantern_answer', code=code, prompt_id=b1, choice=1)
        s = call('P1', 'lantern_press', code=code, prompt_id=b1)
        record('the first press gets the turn and ten seconds to answer', s['prompt']['chooser'] == members['P1'] and 9500 <= s['prompt']['choose_deadline'] - s['server_now'] <= 10000)
        denied('the next press is beaten to it', '42501', 'P2', 'lantern_press', contains='Beaten to it', code=code, prompt_id=b1)
        denied('only the player with the turn can answer', '42501', 'P2', 'lantern_answer', code=code, prompt_id=b1, choice=1)
        s = call('P1', 'lantern_answer', code=code, prompt_id=b1, choice=0)
        record('a wrong answer locks that player out and reopens the question', s['prompt']['locked'] == [members['P1']] and s['prompt']['chooser'] is None
               and not s['prompt']['closed'] and s['prompt']['wrong'] == [{'member': members['P1'], 'choice': 0}] and s['prompt']['correct'] is None)
        denied('a locked-out player cannot press again', '42501', 'P1', 'lantern_press', contains='locked out', code=code, prompt_id=b1)
        call('P2', 'lantern_press', code=code, prompt_id=b1)
        before = call('P3', 'lantern_player_state', code=code)['prompt']['deadline']
        shift(b1, 11)
        s = call('P3', 'lantern_player_state', code=code)
        record('a player who runs out of time is locked out, and the clock waited for them',
               s['prompt']['locked'] == [members['P1'], members['P2']] and s['prompt']['chooser'] is None and not s['prompt']['closed']
               and abs((s['prompt']['deadline'] - before) - (10000 - 11000)) < 300)
        call('P3', 'lantern_press', code=code, prompt_id=b1)
        s = call('P3', 'lantern_answer', code=code, prompt_id=b1, choice=1)
        record('a right answer wins the open question and reveals the answer', s['prompt']['closed'] and s['prompt']['winner'] == members['P3'] and s['prompt']['reason'] == 'correct' and s['prompt']['correct'] == 1)
        s = prompt(dict(Q, kind='buzz', eligible=roster[:2], correct=3))
        b2 = s['prompt']['id']
        shift(b2, 2)
        call('P1', 'lantern_press', code=code, prompt_id=b2); call('P1', 'lantern_answer', code=code, prompt_id=b2, choice=0)
        call('P2', 'lantern_press', code=code, prompt_id=b2); s = call('P2', 'lantern_answer', code=code, prompt_id=b2, choice=1)
        record('when everyone named is wrong, the question closes', s['prompt']['closed'] and s['prompt']['reason'] == 'all' and s['prompt']['winner'] is None)
        denied('a player not named cannot press', '42501', 'P3', 'lantern_press', code=code, prompt_id=b2)

        # ---------- race ----------
        s = prompt(dict(Q, kind='buzz', eligible=roster, correct=0))
        b3 = s['prompt']['id']
        shift(b3, 2)
        with ThreadPoolExecutor(max_workers=3) as pool:
            outcomes = list(pool.map(lambda a: _try(lambda: call(a, 'lantern_press', code=code, prompt_id=b3)), ['P1', 'P2', 'P3']))
        record('three presses at once: exactly one player gets the turn', sum(o is None for o in outcomes) == 1
               and all('Beaten to it' in o.text for o in outcomes if o is not None))
        denied('the host cannot end a prompt that is not current', '42501', 'H', 'lantern_end_prompt', code=code, prompt_id=b1, expected_version=version, request_id=str(uuid4()))
        s = call('H', 'lantern_end_prompt', code=code, prompt_id=b3, expected_version=version, request_id=str(uuid4()))
        version = s['version']
        record('the host can close a prompt with no winner, never with one', s['prompt']['closed'] and s['prompt']['reason'] == 'host' and s['prompt']['winner'] is None)

        # ---------- choose and claim ----------
        s = prompt({'kind': 'choose', 'eligible': [members['P2']], 'q': 'Who took the gold watch?', 'opts': ['Major', 'Lady', 'Doctor', 'Miss'], 'disabled': [1]})
        c1 = s['prompt']['id']
        denied('a disabled option cannot be chosen', '22023', 'P2', 'lantern_answer', code=code, prompt_id=c1, choice=1)
        denied('only the named player can choose', '42501', 'P1', 'lantern_answer', code=code, prompt_id=c1, choice=0)
        s = call('P2', 'lantern_answer', code=code, prompt_id=c1, choice=3)
        record('a choice closes with what was chosen', s['prompt']['reason'] == 'chosen' and s['prompt']['choice'] == 3 and s['prompt']['winner'] == members['P2'] and s['prompt']['correct'] is None)
        bad('every option disabled is refused', {'kind': 'choose', 'eligible': [members['P1']], 'q': 'Pick', 'opts': ['a', 'b'], 'disabled': [0, 1]})
        ten_options = ['Player ' + str(i + 1) for i in range(10)]
        bad('a choice cannot offer eleven options', {'kind':'choose', 'eligible':[members['P2']], 'q':'Pick', 'opts':ten_options + ['Extra']})
        bad('a graded question still cannot offer seven options', {'kind':'answer', 'eligible':[members['P2']], 'q':'Pick', 'opts':ten_options[:7], 'correct':0})
        bad('a disabled index outside ten options is refused', {'kind':'choose', 'eligible':[members['P2']], 'q':'Pick', 'opts':ten_options, 'disabled':[10]})
        s = prompt({'kind':'choose', 'eligible':[members['P2']], 'q':'Which rival?', 'opts':ten_options, 'disabled':[8]})
        c10 = s['prompt']['id']
        denied('the ninth option may be disabled in a ten-option decision', '22023', 'P2', 'lantern_answer', code=code, prompt_id=c10, choice=8)
        denied('an answer index beyond ten options is refused', '22023', 'P2', 'lantern_answer', code=code, prompt_id=c10, choice=10)
        s = call('P2', 'lantern_answer', code=code, prompt_id=c10, choice=9)
        record('a ten-option decision accepts and records its tenth option', s['prompt']['reason'] == 'chosen' and s['prompt']['choice'] == 9 and s['prompt']['winner'] == members['P2'])
        s = prompt({'kind': 'claim', 'eligible': [members['P2'], members['P3']], 'q': 'Steal it? Tap your name.', 'opts': [], 'window_ms': 8000})
        k1 = s['prompt']['id']
        denied('a player not offered the claim cannot take it', '42501', 'P1', 'lantern_press', code=code, prompt_id=k1)
        denied('there is nothing to answer on a claim', '42501', 'P2', 'lantern_answer', code=code, prompt_id=k1, choice=0)
        s = call('P3', 'lantern_press', code=code, prompt_id=k1)
        record('the first to claim takes it', s['prompt']['closed'] and s['prompt']['reason'] == 'claimed' and s['prompt']['winner'] == members['P3'])
        denied('the second claim is beaten to it', '42501', 'P2', 'lantern_press', contains='Beaten to it', code=code, prompt_id=k1)
        record('claiming again is harmless', call('P3', 'lantern_press', code=code, prompt_id=k1)['prompt']['winner'] == members['P3'])

        # ---------- queued calls must use the clock after acquiring the row ----------
        def keep_present():
            # Real phones poll while these wall-clock contention cases run.
            for actor in ('P1', 'P2', 'P3'):
                call(actor, 'lantern_player_state', code=code)

        def wait_for_sql(statement):
            until = time.monotonic() + 8
            while time.monotonic() < until:
                if db.sql(statement) == 't':
                    return True
                time.sleep(0.05)
            return False

        def blocked_call(prompt_id, actor, statement, deadline_column='deadline'):
            # The holder never modifies the row: the waiter's pre-lock snapshot
            # is otherwise valid. Only wall-clock expiry makes the action late.
            holder_name = 'lantern-holder-' + secrets.token_hex(6)
            waiter_name = 'lantern-waiter-' + secrets.token_hex(6)
            db.sql("UPDATE lantern_private.prompts SET " + deadline_column
                   + "=clock_timestamp()+interval '5 seconds' WHERE id=" + literal(prompt_id) + ';')
            holder_sql = ("BEGIN; SET LOCAL application_name=" + literal(holder_name) + ";"
                          "SELECT id FROM lantern_private.prompts WHERE id=" + literal(prompt_id) + " FOR UPDATE;"
                          "SELECT pg_sleep(GREATEST(0,extract(epoch FROM (" + deadline_column + "-clock_timestamp())))+0.3) "
                          "FROM lantern_private.prompts WHERE id=" + literal(prompt_id) + ";"
                          "SELECT clock_timestamp()>=" + deadline_column + " FROM lantern_private.prompts WHERE id="
                          + literal(prompt_id) + ";COMMIT;")
            with ThreadPoolExecutor(max_workers=2) as pool:
                holder = pool.submit(db.run, holder_sql)
                assert wait_for_sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=" + literal(holder_name)
                                    + " AND wait_event='PgSleep');"), 'row-lock holder did not become ready'
                waiter = pool.submit(db.run, context(actor, "SET LOCAL application_name=" + literal(waiter_name)
                                     + ";\n\\set VERBOSITY verbose\n" + statement))
                assert wait_for_sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity w CROSS JOIN lantern_private.prompts p "
                                    "WHERE w.application_name=" + literal(waiter_name) + " AND p.id=" + literal(prompt_id)
                                    + " AND w.wait_event_type='Lock' AND w.query_start<p." + deadline_column
                                    + " AND clock_timestamp()<p." + deadline_column
                                    + " AND EXISTS(SELECT 1 FROM pg_stat_activity h WHERE h.application_name=" + literal(holder_name)
                                    + " AND h.pid=ANY(pg_blocking_pids(w.pid))));"), 'call did not queue before its deadline'
                held, waited = holder.result(), waiter.result()
            assert held.returncode == 0 and held.stdout.strip().splitlines()[-1] == 't', 'holder did not cross the deadline'
            return waited

        for kind in ('answer', 'choose', 'buzz', 'claim'):
            keep_present()
            if kind == 'choose':
                spec = {'kind':kind, 'eligible':[members['P1']], 'q':'Dive?', 'opts':['Dive','Surface'], 'window_ms':10000}
            elif kind == 'claim':
                spec = {'kind':kind, 'eligible':roster, 'q':'Steal?', 'opts':[], 'window_ms':10000}
            else:
                spec = dict(Q, kind=kind, eligible=roster, correct=0, window_ms=10000)
            s = prompt(spec)
            pid = s['prompt']['id']
            db.sql("UPDATE lantern_private.prompts SET open_at=clock_timestamp()-interval '1 second' WHERE id=" + literal(pid) + ';')
            function = 'lantern_press' if kind in ('buzz', 'claim') else 'lantern_answer'
            statement = "SELECT public." + function + '(' + literal(code) + ',' + literal(pid) + (',0' if function == 'lantern_answer' else '') + ');'
            late = blocked_call(pid, 'P1', statement)
            record(kind + ': an action queued before expiry is refused after the row lock releases',
                   late.returncode != 0 and '42501' in late.stderr
                   and ('Beaten to it' if kind == 'claim' else 'This question has closed') in late.stderr)
            unchanged = json.loads(db.sql("SELECT json_build_object('chooser',p.chooser_id,'winner',p.winner_id,"
                "'presses',(SELECT count(*) FROM lantern_private.presses WHERE prompt_id=p.id),"
                "'answers',(SELECT count(*) FROM lantern_private.answers WHERE prompt_id=p.id)) "
                "FROM lantern_private.prompts p WHERE p.id=" + literal(pid) + ';'))
            record(kind + ': the late action records no press, answer, chooser or winner',
                   unchanged == {'chooser':None,'winner':None,'presses':0,'answers':0})
            s = call('H', 'lantern_host_state', code=code)
            record(kind + ': the next poll resolves expiry with no winner',
                   s['prompt']['closed'] and s['prompt']['reason'] == 'time' and s['prompt']['winner'] is None)

        keep_present()
        s = prompt(dict(Q, kind='buzz', eligible=roster, correct=0, window_ms=30000))
        pid = s['prompt']['id']
        shift(pid, 2)
        call('P1', 'lantern_press', code=code, prompt_id=pid)
        late = blocked_call(pid, 'P1', "SELECT public.lantern_answer(" + literal(code) + ',' + literal(pid) + ',0);', 'choose_deadline')
        record('a buzz chooser cannot answer after a deadline crossed while queued',
               late.returncode != 0 and '42501' in late.stderr)
        s = call('H', 'lantern_host_state', code=code)
        record('the expired queued chooser is locked out without an answer',
               s['prompt']['locked'] == [members['P1']] and s['prompt']['chooser'] is None and not s['prompt']['closed']
               and db.sql("SELECT count(*) FROM lantern_private.answers WHERE prompt_id=" + literal(pid) + ';') == '0')
        s = call('H', 'lantern_end_prompt', code=code, prompt_id=pid, expected_version=version, request_id=str(uuid4()))
        version = s['version']

        keep_present()
        s = prompt(dict(Q, kind='answer', eligible=[members['P1']], correct=0, window_ms=10000))
        pid = s['prompt']['id']
        polled = blocked_call(pid, 'H', "SELECT public.lantern_host_state(" + literal(code) + ');')
        polled_state = json.loads(polled.stdout.strip()) if polled.returncode == 0 else {}
        record('a host poll queued before expiry returns the settled state after acquiring the row',
               polled_state.get('prompt', {}).get('closed') is True
               and polled_state['prompt']['reason'] == 'time' and polled_state['prompt']['winner'] is None)

        # ---------- leaving and finishing ----------
        call('P3', 'lantern_leave', code=code)
        record('a player who leaves loses access', call('P3', 'lantern_my_membership', code=code) is None)
        denied('and cannot read the game', '42501', 'P3', 'lantern_player_state', code=code)
        bad('a prompt for a player who has left cannot open', dict(Q, kind='answer', eligible=[members['P3']], correct=0), 'PT412')
        s = call('H', 'lantern_set_phase', code=code, phase='final', expected_version=version, request_id=str(uuid4()))
        version = s['version']
        record('the host can finish the game', s['phase'] == 'final' and s['game']['finished'])
        bad('a finished game takes no more prompts', dict(Q, kind='answer', eligible=[members['P1']], correct=0), '42501')
        record('the departed player still appears in the roster', any(m['id'] == members['P3'] and not m['active'] for m in s['game']['roster']))
        s = call('H', 'lantern_set_phase', code=code, phase='lobby', expected_version=version, request_id=str(uuid4()))
        version = s['version']
        s = call('H', 'lantern_begin_game', code=code, config={'roster': [members['P1'], members['P2']]}, expected_version=version, request_id=str(uuid4()))
        record('a new game can start in the same room with two players', s['phase'] == 'play' and s['game_id'] != game_id and len(s['game']['roster']) == 2)

        # ---------- untouched neighbours and rollback ----------
        record('legacy tables, policies and cleanup are unchanged', json.loads(db.sql(LEGACY_AUDIT_SQL)) == legacy_before)
        record('no other room type is touched', db.sql("SELECT count(*) FROM pg_namespace WHERE nspname='ruffled_private';") == ruffled_before)
        counts = rows()
        db.sql(ROLLBACK.read_text(), single=True)
        try:
            call('P1', 'lantern_player_state', code=code)
            raise AssertionError('rollback left the API callable')
        except RpcError as error:
            record('rollback removes access', error.state == '42501')
        record('rollback keeps every record', rows() == counts)
    Path(report_path).write_text(json.dumps(report, indent=1))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True)
    parser.add_argument('--local-pgbin', help='use local PostgreSQL server binaries instead of Docker')
    args = parser.parse_args()
    report = run_checks(args.report, args.local_pgbin)
    print('%d checks passed' % len(report['tests']))


if __name__ == '__main__':
    main()

