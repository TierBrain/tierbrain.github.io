#!/usr/bin/env python3
"""Offline browser regressions. All external HTTP and WebSockets are intercepted.

Pages run on https://tierbrain.test using local source files. Supabase responses
are fabricated in memory, including simulated score submissions and host room
updates. No request is forwarded to a live backend, analytics or asset server.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
from pathlib import Path
import sys
import time
import unittest
from urllib.parse import parse_qs, unquote, urlsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from check_site import local_target

ORIGIN = "https://tierbrain.test"
BACKEND_HOST = "cgrbwtcydgfkbqhseeap.supabase.co"
GROUP = "SYNTHGROUP"
DECKS = ("flags", "planets", "animals", "objects", "sports")
DEBUG_PAGES = (
    "call-your-shot", "castle", "claim", "core", "creak-multi-play",
    "creak-multi", "creak-multi 5", "creak", "finish-line", "first-finger-bible", "first-finger",
    "five-clues-bible", "five-clues", "labyrinth", "matchup", "recall",
    "show-gen", "show", "snap-sort", "standing-room-multi", "tug-of-war",
    "unscramble", "wrestling-quiz",
)
DEBUG_GLOBALS = (
    "__ff_test", "__race_test", "__tug_test", "__core_test", "__qc_test",
    "__claim_test", "__CC", "__CM", "__CMP", "__SR", "__E",
)


def score(name, quiz, scope, level=1, correct=100, seconds=30):
    return {"name": name, "quiz_id": quiz, "group_code": scope, "level": level,
            "correct": correct, "time_left": seconds, "created_at": "2026-10-19T00:00:00Z"}


def mixed_scores():
    """Private/invalid rows deliberately rank ahead of valid public results."""
    rows = [
        score("FOREIGN_PREFIX_PBP", "qc_piecebypiece", f"flags~{GROUP}2", correct=9999),
        score("FOREIGN_PBP", "qc_piecebypiece", "flags~OTHERGROUP", correct=9998),
        score("UNKNOWN_DECK", "qc_piecebypiece", f"bogus~{GROUP}", correct=9997),
        score("UNKNOWN_QUIZ", "qc_bogus", GROUP, correct=9996),
        score("UNKNOWN_PUBLIC", "qc_piecebypiece", "bogus", correct=9995),
        score("FOREIGN_JIGSAW", "qc_jigsaw", "global~OTHERGROUP", seconds=1),
        score("FOREIGN_PREFIX_JIGSAW", "qc_jigsaw", f"global~{GROUP}2", seconds=2),
        score("UNKNOWN_JIGSAW", "qc_jigsaw", "bogus", seconds=3),
        score("FOREIGN_STANDARD", "qc_general-knowledge-quiz", GROUP + "2", correct=9994),
        score("UNKNOWN_PAIR", "qc_general-knowledge-quiz", "global", correct=9993),
    ]
    for deck in DECKS:
        rows.extend([
            score(f"GROUP_PBP_{deck}", "qc_piecebypiece", f"{deck}~{GROUP}", correct=200),
            score(f"PUBLIC_PBP_{deck}", "qc_piecebypiece", deck, correct=100),
        ])
    for tier in (1, 2):
        rows.extend([
            score(f"GROUP_JIGSAW_TIER{tier}", "qc_jigsaw", f"global~{GROUP}", level=tier, seconds=10 + tier),
            score(f"PUBLIC_JIGSAW_TIER{tier}", "qc_jigsaw", "global", level=tier, seconds=30 + tier),
        ])
    rows.extend([
        score("PUBLIC_BRAINCOASTER", "qc_braincoaster", "global"),
        score("GROUP_BRAINCOASTER", "qc_braincoaster", GROUP, correct=200),
        score("GROUP_STANDARD", "qc_general-knowledge-quiz", GROUP, correct=200),
    ])
    return rows


class OfflineBrowserChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
        cls.browser = cls.playwright.chromium.launch(
            **({"executable_path": executable} if executable else {}),
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-domain-reliability", "--disable-sync"],
        )
        cls.totals = {"local_requests": 0, "synthetic_backend_requests": 0,
                      "synthetic_mutations": 0, "blocked_external_requests": 0,
                      "blocked_websockets": 0}

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        print(json.dumps({"mode": "isolated local source and in-memory synthetic backend",
                          "live_backend_requests": 0, **cls.totals}, indent=2))

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 1280, "height": 800}, service_workers="block")
        self.context.set_default_timeout(6000)
        self.context.set_default_navigation_timeout(10000)
        self.calls = []
        self.errors = []
        self.guard_errors = []
        self.allow_scores_post = False
        self.allow_host_updates = False
        self.allow_show_phone = False
        self.show_prefix = "show_"
        self.show_joined = False
        self.show_member = {"id": "44444444-4444-4444-8444-444444444444", "code": "SYNTH",
                            "name": "PHONE_PLAYER", "tag": "youth", "score": 0,
                            "joined_at": "2026-01-01T00:00:00Z", "last_seen": "2026-01-01T00:00:00Z"}
        self.show_events = {}
        self.show_ack_mode = "confirm"
        self.show_held_acks = []
        self.show_room = {"id": "11111111-1111-4111-8111-111111111111", "code": "SYNTH",
                          "phase": "lobby", "seed": 12345, "run_id": None, "version": 0,
                          "q_id": "", "state": {"teams": {"youth": "Team A", "adult": "Team B"}, "bible": "KJV"}}
        self.context.route("**/*", self.route_request)
        # Never call connect_to_server: even newly introduced socket code is blocked.
        self.context.route_web_socket("**/*", self.block_websocket)
        self.context.add_init_script("""if (location.hostname === 'tierbrain.test') {
          localStorage.setItem('cv_stage_room', 'SYNTH');
          localStorage.setItem('cv_stage_room_gen', 'SYNTH');
          localStorage.setItem('tb_show_host_room_v1', 'SYNTH');
          localStorage.setItem('tb_bigquiz_host_room_v1', 'SYNTH');
        }""")

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.guard_errors, [], "Unexpected backend activity was blocked")
        self.assertEqual(self.errors, [], "Browser JavaScript exceptions")

    def block_websocket(self, socket):
        self.totals["blocked_websockets"] += 1
        socket.close()

    def route_request(self, route):
        request = route.request
        parsed = urlsplit(request.url)
        if parsed.hostname == "tierbrain.test":
            self.totals["local_requests"] += 1
            # local_target also rejects traversal and supports extensionless HTML.
            target = local_target(ROOT, ROOT / "index.html", parsed.path)
            if request.method not in {"GET", "HEAD"} or target is None or not target.is_file():
                self.guard_errors.append(f"Invalid local request: {request.method} {parsed.path}")
                route.fulfill(status=404, body="Missing local fixture")
            else:
                route.fulfill(status=200, body=target.read_bytes(),
                              content_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            return
        if parsed.hostname != BACKEND_HOST:
            self.totals["blocked_external_requests"] += 1
            route.abort()
            return

        table = parsed.path.removeprefix("/rest/v1/")
        self.calls.append({"method": request.method, "table": table,
                           "query": parse_qs(parsed.query), "body": request.post_data})
        self.totals["synthetic_backend_requests"] += 1
        headers = {"Access-Control-Allow-Origin": ORIGIN,
                   "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"}
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=headers)
            return
        if parsed.path.startswith('/auth/v1/'):
            # The real vendored SDK runs here; all Auth responses are synthetic.
            # This fixture tests browser integration, not JWT verification.
            allowed = (self.allow_host_updates or self.allow_show_phone) and (
                (parsed.path == '/auth/v1/signup' and request.method == 'POST')
                or (parsed.path == '/auth/v1/user' and request.method == 'GET'))
            if not allowed:
                self.guard_errors.append(f"Blocked unexpected synthetic Auth request: {request.method} {parsed.path}")
                route.abort()
                return
            user = {"id": "22222222-2222-4222-8222-222222222222", "aud": "authenticated",
                    "role": "authenticated", "is_anonymous": True, "app_metadata": {},
                    "user_metadata": {}, "identities": [], "created_at": "2026-01-01T00:00:00Z"}
            data = user
            if parsed.path.endswith('/signup'):
                expires = int(time.time()) + 3600
                def encode(value):
                    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
                token = encode({"alg": "HS256", "typ": "JWT"}) + '.' + encode(
                    {"sub": user['id'], "aud": "authenticated", "role": "authenticated",
                     "is_anonymous": True, "exp": expires, "iat": expires-3600}) + '.c3ludGhldGlj'
                data = {"access_token": token, "token_type": "bearer", "expires_in": 3600,
                        "expires_at": expires, "refresh_token": "offline-synthetic-refresh", "user": user}
                self.totals['synthetic_mutations'] += 1
            route.fulfill(status=200, headers=headers, content_type='application/json', body=json.dumps(data))
            return
        if table.startswith('rpc/' + self.show_prefix):
            host_rpcs = {'show_create_room', 'show_host_resume', 'show_begin_run', 'show_host_publish',
                         'show_host_members', 'show_host_answers', 'show_host_buzzes'}
            phone_params = {'show_preview': {'p_code'}, 'show_join': {'p_code', 'p_name', 'p_tag'},
                            'show_my_membership': {'p_code'}, 'show_heartbeat': {'p_code'},
                            'show_leave': {'p_code'}, 'show_player_state': {'p_code'},
                            'show_answer': {'p_code', 'p_question_key', 'p_choice'},
                            'show_buzz': {'p_code', 'p_question_key'}}
            name = 'show_' + table.removeprefix('rpc/' + self.show_prefix)
            allowed = ((self.allow_host_updates and name in host_rpcs)
                       or (self.allow_show_phone and name in phone_params))
            if not allowed or request.method != 'POST':
                self.guard_errors.append(f"Blocked unexpected synthetic Show RPC: {request.method} {name}")
                route.abort()
                return
            args = json.loads(request.post_data or '{}')
            if self.allow_show_phone and name in phone_params:
                self.assertEqual(set(args), phone_params[name], "Phone must send only the RPC contract fields")
                self.assertEqual(args['p_code'], 'SYNTH')
                if name == 'show_preview':
                    data = {'code': self.show_room['code'], 'phase': self.show_room['phase'],
                            'state': {key: self.show_room['state'][key] for key in ('teams', 'bible') if key in self.show_room['state']}}
                elif name == 'show_join':
                    self.show_joined = True
                    self.show_member.update(name=args['p_name'], tag=args['p_tag'])
                    data = self.show_member
                elif name in {'show_my_membership', 'show_heartbeat'}:
                    data = self.show_member if self.show_joined else None
                elif name == 'show_leave':
                    self.show_joined = False
                    data = {'left': True}
                elif name == 'show_player_state':
                    self.assertTrue(self.show_joined)
                    data = self.show_room
                else:
                    self.assertTrue(self.show_joined)
                    question = args['p_question_key']
                    event_key = (name, question)
                    data = self.show_events.get(event_key)
                    if self.show_ack_mode == 'deny':
                        route.fulfill(status=403, headers=headers, content_type='application/json',
                                      body=json.dumps({'code': '42501', 'message': 'Question is closed'}))
                        return
                    if data is None:
                        self.assertEqual(question, self.show_room['q_id'])
                        data = {'q_id': question, 'player_id': self.show_member['id'],
                                'tag': self.show_member['tag'], 'created_at': '2026-01-01T00:00:01Z'}
                        if name == 'show_answer':
                            self.assertIn(args['p_choice'], range(4))
                            data['choice'] = args['p_choice']
                            if self.show_room['phase'] == 'buzzer':
                                lane = self.show_room['state']['bz']['lanes'][self.show_member['tag']]
                                self.assertEqual(lane['bid'], self.show_member['id'])
                                self.assertEqual(lane['st'], 'answering')
                        else:
                            data['name'] = self.show_member['name']
                            self.assertEqual(self.show_room['state']['bz']['phase'], 'open')
                        self.show_events[event_key] = data
                        self.totals['synthetic_mutations'] += 1
                    elif name == 'show_answer':
                        self.assertEqual(data['choice'], args['p_choice'], "Retry must preserve the original choice")
                    if self.show_ack_mode == 'hold':
                        self.show_held_acks.append((route, headers, data))
                        return
                    if self.show_ack_mode == 'unknown':
                        # The synthetic commit succeeded; only its acknowledgement failed.
                        route.fulfill(status=503, headers=headers, content_type='application/json',
                                      body=json.dumps({'message': 'Synthetic lost acknowledgement'}))
                        return
                route.fulfill(status=200, headers=headers, content_type='application/json', body=json.dumps(data))
                return
            if name in {'show_host_members', 'show_host_answers', 'show_host_buzzes'}:
                data = []
            else:
                if name == 'show_begin_run':
                    self.show_room['run_id'] = '33333333-3333-4333-8333-333333333333'
                    self.show_room['version'] += 1
                elif name == 'show_host_publish':
                    self.assertEqual(args['p_expected_version'], self.show_room['version'])
                    self.show_room.update(args['p_patch'])
                    self.show_room['version'] += 1
                data = self.show_room
                self.totals['synthetic_mutations'] += 1
            route.fulfill(status=200, headers=headers, content_type='application/json', body=json.dumps(data))
            return
        if self.allow_show_phone:
            self.guard_errors.append(f"Blocked legacy phone data request: {request.method} {table}")
            route.abort()
            return
        if request.method not in {"GET", "HEAD"}:
            allowed = ((table == "scores" and request.method == "POST" and self.allow_scores_post)
                       or (table == "rooms" and request.method in {"POST", "PATCH"} and self.allow_host_updates))
            if not allowed:
                self.guard_errors.append(f"Blocked unexpected synthetic mutation: {request.method} {table}")
                route.abort()
                return
            self.totals["synthetic_mutations"] += 1
            response = []
            if table == "rooms" and request.method == "POST":
                response = [json.loads(request.post_data or "{}")]
            route.fulfill(status=200, headers=headers, content_type="application/json", body=json.dumps(response))
            return
        if table == "scores":
            # Intentionally ignore requested filters to verify defensive rendering.
            data = mixed_scores()
        elif table == "rooms":
            data = [{"code": "SYNTH", "phase": "lobby", "seed": 12345, "state": {}}]
        elif table in {"players", "answers", "buzzes", "legends"}:
            data = []
        else:
            self.guard_errors.append(f"Blocked unknown synthetic endpoint: {parsed.path}")
            route.abort()
            return
        route.fulfill(status=200, headers=headers, content_type="application/json", body=json.dumps(data))

    def open_page(self, path):
        self.show_prefix = 'bigquiz_' if path.split('?', 1)[0] in {'show-gen.html', 'play-gen.html'} else 'show_'
        page = self.context.new_page()
        page.on("pageerror", lambda error: self.errors.append(f"{path}: {error}"))
        page.goto(ORIGIN + "/" + path, wait_until="domcontentloaded")
        return page

    def release_show_acks(self):
        held, self.show_held_acks = self.show_held_acks, []
        self.assertTrue(held, "The phone must have a genuinely pending request")
        for route, headers, data in held:
            route.fulfill(status=200, headers=headers, content_type='application/json', body=json.dumps(data))

    def test_homepage_and_solo_games(self):
        page = self.open_page("index.html")
        page.wait_for_function("!document.body.innerText.includes('Loading today')")
        self.assertGreater(page.locator("[data-title]").count(), 0)
        self.assertFalse(page.evaluate("document.documentElement.scrollWidth > innerWidth"))
        page.set_viewport_size({"width": 390, "height": 844})
        self.assertFalse(page.evaluate("document.documentElement.scrollWidth > innerWidth"))
        page.close()
        page = self.open_page("daily.html")
        page.locator("#dGo").click()
        self.assertTrue(page.locator("#dQ").is_visible())
        self.assertTrue(page.locator("#dQ").inner_text().strip())
        page.close()
        page = self.open_page("general-knowledge-quiz.html")
        page.locator("#startBtn").click()
        self.assertEqual(page.locator("#opts button").count(), 4)

    def test_public_wall_filters_query_and_mixed_responses(self):
        page = self.open_page("wall.html")
        page.get_by_text("PUBLIC_PBP_flags", exact=True).first.wait_for()
        body = page.locator("body").inner_text()
        self.assertIn("PUBLIC_JIGSAW_TIER1", body)
        self.assertIn("PUBLIC_BRAINCOASTER", body)
        for row in mixed_scores():
            if not row["name"].startswith("PUBLIC_"):
                self.assertNotIn(row["name"], body)
        self.assertNotIn("UNKNOWN_PAIR", body)
        queries = [call["query"] for call in self.calls if call["table"] == "scores" and call["method"] == "GET"]
        self.assertEqual(len(queries), 4)
        pbp = next(query for query in queries if query.get("quiz_id") == ["eq.qc_piecebypiece"])
        self.assertEqual(pbp["group_code"], ["in.(" + ",".join(DECKS) + ")"])
        for quiz in ("qc_jigsaw", "qc_braincoaster"):
            query = next(query for query in queries if query.get("quiz_id") == ["eq." + quiz])
            self.assertEqual(query["group_code"], ["eq.global"])
        recent = next(query for query in queries if "or" in query)
        self.assertIn("and(quiz_id.eq.qc_piecebypiece,group_code.in.(" + ",".join(DECKS) + "))", recent["or"][0])
        self.assertIn("and(quiz_id.in.(qc_jigsaw,qc_braincoaster),group_code.eq.global)", recent["or"][0])

    def test_group_wall_retains_own_results_and_excludes_other_scopes(self):
        page = self.open_page("wall.html?group=" + GROUP.lower())
        page.get_by_text("GROUP_PBP_flags", exact=True).first.wait_for()
        body = page.locator("body").inner_text()
        self.assertIn("GROUP_JIGSAW_TIER1", body)
        self.assertIn("GROUP_STANDARD", body)
        for row in mixed_scores():
            if not row["name"].startswith("GROUP_"):
                self.assertNotIn(row["name"], body)
        queries = [call["query"] for call in self.calls if call["table"] == "scores" and call["method"] == "GET"]
        self.assertEqual(len(queries), 1)
        where = queries[0]["or"][0]
        self.assertIn("quiz_id.eq.qc_piecebypiece,group_code.in.(" + ",".join(f"{deck}~{GROUP}" for deck in DECKS) + ")", where)
        self.assertIn("and(quiz_id.eq.qc_jigsaw,group_code.eq.global~" + GROUP + ")", where)
        self.assertIn("group_code.eq." + GROUP, where)
        self.assertNotIn("like.", where)

    def test_wall_demo_and_invalid_group_fall_back_safely(self):
        page = self.open_page("wall.html?demo")
        self.assertIn("Priya", page.locator("body").inner_text())
        self.assertEqual(self.calls, [])
        page.close()
        page = self.open_page("wall.html?group=%3Cscript%3E")
        page.get_by_text("PUBLIC_PBP_flags", exact=True).first.wait_for()
        self.assertNotIn("GROUP_PBP_flags", page.locator("body").inner_text())

    def test_game_leaderboards_use_exact_saved_scope_and_jigsaw_tier(self):
        self.allow_scores_post = True
        for game in ("piece-by-piece", "jigsaw"):
            for group in ("", GROUP):
                with self.subTest(game=game, group=group or "public"):
                    self.calls.clear()
                    page = self.open_page(game + ".html")
                    page.locator("#groupInput").fill(group)
                    page.locator("#nameInput").fill("SYNTHETIC_PLAYER")
                    if game == "piece-by-piece":
                        page.locator("#deckFlags").click()
                        page.evaluate("clearInterval(intervalId); clearTimeout(graceId); submitAndLoad(12)")
                        box = page.locator("#ovLb")
                        expected = ("GROUP_" if group else "PUBLIC_") + "PBP_flags"
                        scope = "flags" + ("~" + group if group else "")
                        quiz = "qc_piecebypiece"
                    else:
                        page.locator("#tierList .tier").nth(1).click()
                        page.wait_for_function("pieces.length === 24")
                        page.evaluate("running = false; submitAndLoad(12)")
                        box = page.locator("#winLb")
                        expected = ("GROUP_" if group else "PUBLIC_") + "JIGSAW_TIER2"
                        scope = "global" + ("~" + group if group else "")
                        quiz = "qc_jigsaw"
                    box.get_by_text(expected, exact=True).wait_for(state="attached")
                    names = box.locator(".nm").all_text_contents()
                    self.assertEqual(names, [expected])
                    reads = [call for call in self.calls if call["method"] == "GET" and call["table"] == "scores"]
                    writes = [call for call in self.calls if call["method"] == "POST" and call["table"] == "scores"]
                    self.assertEqual(len(writes), 1)
                    self.assertEqual(json.loads(writes[0]["body"])[0]["group_code"], scope)
                    self.assertEqual(len(reads), 1)
                    self.assertEqual(reads[0]["query"]["quiz_id"], ["eq." + quiz])
                    self.assertEqual(reads[0]["query"]["group_code"], ["eq." + scope])
                    if game == "jigsaw":
                        self.assertEqual(reads[0]["query"]["level"], ["eq.2"])
                    page.close()

    def test_removed_debug_globals_and_labelled_group_inputs(self):
        self.allow_host_updates = True
        for name in DEBUG_PAGES:
            with self.subTest(page=name):
                page = self.open_page(name + ".html")
                exposed = page.evaluate("names => names.filter(name => name in window)", list(DEBUG_GLOBALS))
                self.assertEqual(exposed, [], f"Debug controls are exposed by {name}")
                if name in {"first-finger", "first-finger-bible", "finish-line", "tug-of-war"}:
                    self.assertEqual(page.locator("#nameIn").evaluate("el => el.labels.length"), 1)
                    self.assertEqual(page.locator("#codeIn").evaluate("el => el.labels.length"), 1)
                page.close()

    def test_host_show_cutscene_completes_normal_start_without_debug_export(self):
        self.allow_host_updates = True
        for name in ("show", "show-gen"):
            with self.subTest(page=name):
                self.calls.clear()
                page = self.open_page(name + ".html")
                page.wait_for_function("document.querySelector('#statusText').textContent.includes('Live')")
                self.assertTrue(page.locator("#startShow").is_visible())
                # Exercise the real cutscene continuation through its visible
                # tap-to-skip overlay, without calling a debug export/start hook.
                page.locator("#startShow").click()
                skip = page.locator(".tb-scene").filter(has_text="Tap to skip")
                skip.first.wait_for()
                skip.first.click()
                page.wait_for_function("document.body.classList.contains('playing')")
                self.assertFalse(page.locator("#startShow").is_visible())
                self.assertTrue(page.locator("#qPanel").is_visible())
                self.assertTrue(page.locator("#rLabel").inner_text().startswith("Round 1"))
                writes = [json.loads(call["body"]) for call in self.calls
                          if call["table"] == "rooms" and call["method"] == "PATCH"]
                if name in {'show', 'show-gen'}:
                    prefix = 'show_' if name == 'show' else 'bigquiz_'
                    writes = [json.loads(call['body'])['p_patch'] for call in self.calls
                              if call['table'] == 'rpc/' + prefix + 'host_publish']
                    self.assertFalse(any(call['table'] in {'rooms', 'players', 'answers', 'buzzes'}
                                         for call in self.calls))
                self.assertTrue(any(write.get("phase") == "round_intro" for write in writes))
                self.assertFalse(page.evaluate("'__E' in window"))
                page.close()

    def test_show_phone_mobile_join_normal_buzzer_and_clue_acknowledgements(self):
        self.check_show_phone_mobile('play.html')

    def test_big_quiz_phone_mobile_join_normal_buzzer_and_clue_acknowledgements(self):
        self.show_room['state'].pop('bible')
        self.check_show_phone_mobile('play-gen.html')

    def check_show_phone_mobile(self, page_path):
        self.allow_show_phone = True
        self.context.set_default_timeout(8000)
        run = '33333333-3333-4333-8333-333333333333'
        options = ['Synthetic A', 'Synthetic B', 'Synthetic C', 'Synthetic D']
        common = {'teams': {'youth': 'Team A', 'adult': 'Team B'}, 'bible': 'KJV',
                  'round': 'Synthetic round', 'qnum': 1, 'qtotal': 4}

        def question(index, phase, state):
            self.show_room.update(phase=phase, run_id=run, q_id=run + ':p0q' + str(index),
                                  version=self.show_room['version'] + 1,
                                  state={**common, **state})

        def poll_phone():
            # Invoke the normal polling function; all reads still traverse the
            # real vendored SDK and the strictly intercepted RPC fixture.
            page.evaluate('pollState()')

        def wait_submission(state):
            page.wait_for_function("value => { const node=document.querySelector('#submissionStatus'); return node && node.dataset.state===value; }",
                                   arg=state)

        question(0, 'question', {'opts': options, 'live': True, 'qkind': 'mc', 'qtext': 'Synthetic normal question'})
        page = self.open_page(page_path + '?c=SYNTH')
        page.set_viewport_size({'width': 375, 'height': 667})
        self.assertTrue(page.locator('#joinScreen').is_visible())
        self.assertEqual(page.locator('#code').input_value(), 'SYNTH')
        page.locator('#name').fill('PHONE_PLAYER')
        page.locator('#teamBtnYouth').click()
        page.locator('#playArea').get_by_text('Synthetic normal question', exact=True).wait_for()
        self.assertEqual(page.locator('#whoName').inner_text(), 'PHONE_PLAYER')
        self.assertTrue(page.locator('#waitScreen').is_visible())
        self.assertFalse(page.evaluate('document.documentElement.scrollWidth > innerWidth'))

        # A delayed response must not turn the local click into a confirmed save.
        self.show_ack_mode = 'hold'
        page.locator('#playArea button.pbtn').nth(1).click()
        wait_submission('pending')
        self.assertIn('Sending your answer', page.locator('#submissionStatus').inner_text())
        self.assertNotIn('Locked in', page.locator('#playArea').inner_text())
        self.release_show_acks()
        wait_submission('confirmed')
        self.assertIn('Locked in', page.locator('#submissionStatus').inner_text())

        # Buzzer arming/open/selected-answer phases use their own canonical acks.
        lanes = {'youth': {'st': 'open', 'bid': None, 'out': [], 'win': None},
                 'adult': {'st': 'open', 'bid': None, 'out': [], 'win': None}}
        buzzer = {'phase': 'arm', 'opts': options, 'correct': None, 'live': True,
                  'qtext': 'Synthetic buzzer question', 'lanes': lanes}
        question(1, 'buzzer', {'bz': buzzer})
        poll_phone()
        page.locator('#playArea').get_by_text('Buzzers arming!', exact=True).wait_for()
        self.assertEqual(page.locator('#playArea button.buzzbtn').count(), 0)
        buzzer['phase'] = 'open'
        question(1, 'buzzer', {'bz': buzzer})
        poll_phone()
        page.locator('#playArea button.buzzbtn').click()
        wait_submission('pending')
        self.assertIn('Sending your buzz', page.locator('#submissionStatus').inner_text())
        self.assertNotIn('Buzz recorded!', page.locator('#playArea').inner_text())
        self.release_show_acks()
        wait_submission('confirmed')
        self.assertIn('Buzz recorded!', page.locator('#submissionStatus').inner_text())
        lanes['youth'].update(st='answering', bid=self.show_member['id'], bname=self.show_member['name'],
                              adl=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 10)))
        question(1, 'buzzer', {'bz': buzzer})
        self.show_ack_mode = 'confirm'
        poll_phone()
        page.locator('#playArea').get_by_text('You buzzed first, answer!', exact=True).wait_for()
        page.locator('#playArea button.pbtn').nth(2).click()
        wait_submission('confirmed')
        lanes['youth'].update(st='done', win=self.show_member['name'])
        buzzer.update(phase='reveal', correct=2)
        question(1, 'buzzer', {'bz': buzzer})
        poll_phone()
        page.locator('#playArea').get_by_text('✓ You got it!', exact=True).wait_for()

        # Simulate a committed clue answer whose acknowledgement was lost.
        clues = {'phase': 'clue', 'opts': options, 'clueIdx': 0, 'pointsNow': 5,
                 'correct': None, 'live': True, 'cat': 'Person', 'clues': ['Synthetic clue']}
        question(2, 'fiveclues', {'fc': clues})
        poll_phone()
        page.locator('#playArea').get_by_text('Answer now for 5 points!', exact=True).wait_for()
        self.show_ack_mode = 'unknown'
        page.locator('#playArea button.pbtn').nth(0).click()
        wait_submission('unknown')
        self.assertNotIn('Locked in', page.locator('#playArea').inner_text())
        self.show_ack_mode = 'confirm'
        page.locator('#submissionRetry').click()
        wait_submission('confirmed')
        clues.update(phase='reveal', correct=0)
        self.show_member['score'] = 10
        question(2, 'fiveclues', {'fc': clues})
        poll_phone()
        page.locator('#playArea').get_by_text('✓ Correct!', exact=True).wait_for()
        self.assertNotIn('+5', page.locator('#playArea').inner_text(), 'Phone must not invent awarded points')
        self.assertEqual(page.locator('#myScore').inner_text(), '10')

        # A definite closed-question denial stays honest and offers no new choice.
        question(3, 'question', {'opts': options, 'live': True, 'qkind': 'mc', 'qtext': 'Synthetic closed question'})
        poll_phone()
        page.locator('#playArea').get_by_text('Synthetic closed question', exact=True).wait_for()
        self.show_ack_mode = 'deny'
        page.locator('#playArea button.pbtn').nth(3).click()
        wait_submission('failed')
        denial = page.locator('#submissionStatus').inner_text()
        self.assertIn('was not recorded', denial)
        self.assertIn('question has closed', denial)
        self.assertNotIn('Locked in', page.locator('#playArea').inner_text())
        self.assertEqual(page.locator('#submissionRetry').count(), 0)

        writes = [call for call in self.calls if call['table'] in {'rpc/' + self.show_prefix + 'answer', 'rpc/' + self.show_prefix + 'buzz'}]
        self.assertEqual(len(writes), 6)
        clue_writes = [json.loads(call['body']) for call in writes if json.loads(call['body'])['p_question_key'].endswith(':p0q2')]
        self.assertEqual(len(clue_writes), 2)
        self.assertEqual(clue_writes[0], clue_writes[1], 'An uncertain outcome must retry exactly the same answer')
        for call in writes:
            args = json.loads(call['body'])
            self.assertNotIn('player_id', args)
            self.assertNotIn('p_member_id', args)
            self.assertNotIn('name', args)
            self.assertNotIn('tag', args)
            self.assertEqual(call['method'], 'POST')
        self.assertFalse(any(call['table'] in {'rooms', 'players', 'answers', 'buzzes'} for call in self.calls))


if __name__ == "__main__":
    unittest.main(verbosity=2)
