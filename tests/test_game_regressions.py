#!/usr/bin/env python3
"""Regression guards for game bugs that have already reached the live site once.

Each test names the bug it protects against. They exist so that uploading an
older copy of a page fails the Site checks instead of quietly breaking a game.

Static checks use only the standard library. Browser checks run pages from the
local source on https://tierbrain.test against an in-memory stand-in for the
database (rooms, players, moves, buzzes, answers). Nothing reaches the live
backend: every other external request is aborted.
"""

from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import threading
import time
import unittest
from urllib.parse import parse_qsl, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from check_site import local_target  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # static checks still run without the browser package
    sync_playwright = None

ORIGIN = "https://tierbrain.test"
BACKEND_HOST = "cgrbwtcydgfkbqhseeap.supabase.co"
HOSTED_PAGES = ("show.html", "show-gen.html", "throne.html", "throne-bible.html", "spines.html",
                "spines-bible.html", "standing-room-multi.html", "creak-multi.html")
# Copies an iPhone makes when a file is downloaded twice ("name 2.html").
# Ones already on the site are listed here; any new one fails the check.
KNOWN_DUPLICATE_COPIES = {"creak-multi 5.html"}


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


class StaticGameGuards(unittest.TestCase):
    def test_shared_climb_host_sends_the_question_to_phones(self):
        """Bug: the host never shared the pending question, so it could never be answered."""
        body = re.search(r"function writeState\(\)\{(.*?)\}\}\); \}", read("creak-multi.html"), re.S)
        self.assertIsNotNone(body, "creak-multi.html: writeState() not found")
        self.assertIn("pendingQ:G.pendingQ", body.group(1))
        self.assertNotIn("pendingQCorrect", body.group(1), "The correct answer must never be shared")

    def test_shared_climb_phone_redraws_when_a_question_arrives(self):
        """Bug: the phone only redrew on a new turn, so a mid-turn question never appeared."""
        source = read("creak-multi-play.html")
        self.assertIn("const sig='live|'+st.turnSeq+'|'+myTurn+'|'+(st.pendingQ?st.pendingQ.qId:'');", source)

    def test_shared_climb_shows_why_a_piece_moves(self):
        """Bug: pieces jumped up or down with no Roc, rocks, debris or snake slide on screen."""
        source = read("creak-multi.html")
        checks = {
            "rocEvent": "await flyRoc(playerId, to);",
            "rockfallEvent": "spawnRocks(",
            "fallIntoCrater": "spawnDebris(",
        }
        for fn, needle in checks.items():
            with self.subTest(event=fn):
                body = re.search(r"async function " + fn + r"\(.*?\n\}", source, re.S)
                self.assertIsNotNone(body, f"creak-multi.html: {fn}() not found")
                self.assertIn(needle, body.group(0))
        self.assertIn("await slideAlongSnake(playerId, hit.obj);", source, "a woken snake must carry the piece down its body")
        self.assertIn("drawRoc();", source, "the Roc must be drawn on the board")

    def test_shared_climb_outcomes_stay_on_screen(self):
        """Bug: a right answer on a snake or storm was replaced by 'Waiting for...' instantly, so the TV never showed it."""
        source = read("creak-multi.html")
        self.assertIn("async function holdOutcome()", source)
        self.assertEqual(source.count("await holdOutcome();"), 2, "both end-of-turn paths must hold the outcome")

    def test_hosted_games_load_the_host_and_cutscene_engines(self):
        """Bug guard: an older upload of a hosted game drops its animated host and cutscenes."""
        for name in ("tb-hosts.js", "tb-scenes.js"):
            self.assertTrue((ROOT / name).is_file(), f"{name} is missing")
        for page in HOSTED_PAGES:
            with self.subTest(page=page):
                source = read(page)
                self.assertIn('src="tb-hosts.js"', source)
                self.assertIn('src="tb-scenes.js"', source)

    def test_no_new_duplicate_copies_of_pages(self):
        """Bug: a fix uploaded as 'creak-multi 5.html' never replaced the real page."""
        copies = {path.name for path in ROOT.glob("*.html") if re.search(r" \d+\.html$", path.name)}
        new = sorted(copies - KNOWN_DUPLICATE_COPIES)
        self.assertEqual(new, [], "Rename these to the real page name (or delete them): " + ", ".join(new))


class FakeBackend:
    """Stateful in-memory stand-in for the database REST calls the party games make."""

    def __init__(self):
        self.tables = {}
        self.seq = 0
        self.lock = threading.Lock()

    @staticmethod
    def matches(row, filters):
        for column, op, value in filters:
            have = row.get(column)
            if op == "eq" and str(have) != value and not (have is None and value == "null"):
                return False
            if op == "neq" and str(have) == value:
                return False
            if op in {"gt", "gte", "lt", "lte"}:
                try:
                    a, b = float(have), float(value)
                except (TypeError, ValueError):
                    a, b = str(have), value
                if not {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]:
                    return False
            if op == "in" and str(have) not in [x.strip('"') for x in value.strip("()").split(",")]:
                return False
        return True

    def respond(self, method, path, query, body, prefer):
        table = path.removeprefix("/rest/v1/")
        filters, select, order, limit = [], None, None, None
        for key, value in parse_qsl(query, keep_blank_values=True):
            if key == "select":
                select = value.split(",")
            elif key == "order":
                order = value
            elif key == "limit":
                limit = int(value)
            elif key != "on_conflict":
                op, _, val = value.partition(".")
                filters.append((key, op, unquote(val)))
        with self.lock:
            rows = self.tables.setdefault(table, [])
            if method == "GET":
                out = [row for row in rows if self.matches(row, filters)]
                if order:
                    for part in reversed(order.split(",")):
                        column, _, direction = part.partition(".")
                        out.sort(key=lambda r: (r.get(column) is None, r.get(column)),
                                 reverse=direction.startswith("desc"))
                out = out[:limit] if limit else out
                if select and select != ["*"]:
                    out = [{c: row.get(c) for c in select} for row in out]
                return 200, out
            if method == "POST":
                items = json.loads(body or "{}")
                made = []
                for item in items if isinstance(items, list) else [items]:
                    self.seq += 1
                    row = dict(item)
                    row.setdefault("id", self.seq)
                    row.setdefault("created_at", "%.6f" % time.time())
                    rows.append(row)
                    made.append(row)
                return 201, made if "return=representation" in prefer else []
            if method == "PATCH":
                hit = [row for row in rows if self.matches(row, filters)]
                for row in hit:
                    row.update(json.loads(body or "{}"))
                return 200, hit if "return=representation" in prefer else []
            if method == "DELETE":
                self.tables[table] = [row for row in rows if not self.matches(row, filters)]
                return 200, []
        return 405, []


@unittest.skipIf(sync_playwright is None, "Playwright is not installed")
class BrowserGameGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
        cls.browser = cls.playwright.chromium.launch(
            **({"executable_path": executable} if executable else {}),
            args=["--disable-background-networking", "--disable-component-update",
                  "--autoplay-policy=no-user-gesture-required"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.backend = FakeBackend()
        self.contexts = []
        self.errors = []

    def tearDown(self):
        for context in self.contexts:
            context.close()
        self.assertEqual(self.errors, [], "Browser JavaScript exceptions")

    def route(self, route):
        request = route.request
        parsed = urlsplit(request.url)
        if parsed.hostname == "tierbrain.test":
            target = local_target(ROOT, ROOT / "index.html", parsed.path)
            if target is None or not target.is_file():
                route.fulfill(status=404, body="Missing local file")
            else:
                route.fulfill(status=200, body=target.read_bytes(),
                              content_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            return
        if parsed.hostname != BACKEND_HOST:
            route.abort()
            return
        headers = {"Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "*",
                   "Access-Control-Allow-Methods": "*"}
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=headers)
            return
        status, data = self.backend.respond(request.method, parsed.path, parsed.query,
                                            request.post_data, request.headers.get("prefer") or "")
        route.fulfill(status=status, headers=headers, content_type="application/json", body=json.dumps(data))

    def context(self, width, height, storage=None):
        context = self.browser.new_context(viewport={"width": width, "height": height}, service_workers="block")
        context.set_default_timeout(10000)
        context.route("**/*", self.route)
        context.route_web_socket("**/*", lambda socket: socket.close())
        if storage:
            context.add_init_script("if (location.hostname === 'tierbrain.test') {"
                                    + "".join(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});"
                                              for k, v in storage.items()) + "}")
        self.contexts.append(context)
        return context

    def open(self, context, path):
        page = context.new_page()
        page.on("pageerror", lambda error: self.errors.append(f"{path}: {error}"))
        page.goto(ORIGIN + "/" + path, wait_until="domcontentloaded")
        return page

    def shared_climb(self, players=("Maya", "Leo"), sound_probe=False):
        host_context = self.context(1280, 720, {"tb-cutscenes-guide": "0"})
        if sound_probe:
            host_context.add_init_script("""window.__sounds = 0;
              for (const make of ['createOscillator', 'createBufferSource']) {
                const original = BaseAudioContext.prototype[make];
                BaseAudioContext.prototype[make] = function () { window.__sounds++; return original.apply(this, arguments); };
              }""")
        host = self.open(host_context, "creak-multi.html")
        host.wait_for_function("/^[A-Z]{5}$/.test(document.getElementById('code').textContent.trim())")
        code = host.locator("#code").inner_text().strip()
        phones = {}
        for name in players:
            phone = self.open(self.context(390, 760), "creak-multi-play.html?c=" + code)
            phone.locator("#codeIn").fill(code)
            phone.locator("#nameIn").fill(name)
            phone.locator("#joinBtn").click()
            phones[name] = phone
        host.wait_for_function("document.getElementById('startBtn') && !document.getElementById('startBtn').disabled")
        host.locator("#startBtn").click()
        host.wait_for_function("G.phase === 'live'")
        return host, phones

    def test_shared_climb_question_reaches_the_phone_and_the_answer_counts(self):
        """Bug: questions never reached phones, so every answer timed out as wrong."""
        host, phones = self.shared_climb()
        asked = host.evaluate("""() => { const id = G.order[G.turnIdx];
            window.__answer = askQuestionFor(id, 'ladder', 10); return nameOf(id); }""")
        phone = phones[asked]
        phone.wait_for_function("document.querySelectorAll('.qopt2').length === 4")
        # Bug: on TV-shaped screens the question card fell below the bottom of the screen.
        box = host.locator("#qview").bounding_box()
        self.assertLessEqual(box["y"] + box["height"], 720, "Question card is off screen at 1280x720")
        correct = host.evaluate("G.pendingQCorrect")
        phone.locator(".qopt2", has_text=correct).first.click()
        self.assertTrue(host.evaluate("() => window.__answer"), "The right answer from the phone did not count")

    def test_shared_climb_plays_sounds_and_mute_keeps_them_off(self):
        """Bugs: the Shared Climb was silent in play, and a new sound could undo mute."""
        host, _ = self.shared_climb(sound_probe=True)
        host.evaluate("() => { window.__sounds = 0; setStatus('Maya is rolling\\u2026'); }")
        host.wait_for_function("window.__sounds > 0", timeout=3000)
        host.evaluate("() => { tbSetMuted(true); window.__sounds = 0; setStatus('Maya is rolling\\u2026'); }")
        host.wait_for_timeout(700)
        self.assertEqual(host.evaluate("window.__sounds"), 0, "A sound played while muted")
        host.evaluate("() => tbSetMuted(false)")

    def throne(self, page_name, cutscenes="1"):
        host = self.open(self.context(1280, 720, {"tb-cutscenes-throne": cutscenes}), page_name)
        host.wait_for_function("/^[A-Z]{5}$/.test(document.getElementById('code').textContent.trim())")
        return host

    def test_throne_question_count_steps_through_25(self):
        """Bug: '+' went 20, 21, 26, so a 25-question game could not be chosen."""
        for page_name in ("throne.html", "throne-bible.html"):
            with self.subTest(page=page_name):
                host = self.throne(page_name)
                seen = []
                for button in ("#qPlus", "#qPlus", "#qMinus", "#qMinus", "#qMinus"):
                    host.locator(button).click()
                    seen.append(host.locator("#qTot").inner_text().strip())
                self.assertEqual(seen, ["25", "30", "25", "20", "19"])

    def test_throne_finale_waits_for_its_cutscene_and_the_last_banner_is_honest(self):
        """Bugs: the finale's first question started over its cutscene, and the banner
        after the last question named a next challenger who never came."""
        for page_name in ("throne.html", "throne-bible.html"):
            with self.subTest(page=page_name):
                host = self.throne(page_name)
                self.assertGreaterEqual(host.evaluate("ThroneHall.finaleMs()"), 5000)
                messages = host.evaluate("""() => {
                    const now = new Date().toISOString();
                    const ps = ['A', 'B', 'C'].map(n => ({id: n, name: n, last_seen: now}));
                    const banner = (qIndex) => {
                        Object.assign(G, {players: ps, champ: {id: 'A', name: 'A'}, chal: {id: 'B', name: 'B'},
                            queue: [{id: 'C', name: 'C'}], pendingLoser: {id: 'B', name: 'B'}, outcome: 'win',
                            mode: 'spine', streak: 1, qIndex: qIndex, qTotal: 5});
                        afterReveal(); clearTimeout(G._t); return G.betweenMsg; };
                    return [banner(2), banner(5)]; }""")
                self.assertIn("Next:", messages[0])
                self.assertIn("last question", messages[1])
                self.assertNotIn("Next:", messages[1])
                host.close()
                host = self.throne(page_name, cutscenes="0")
                self.assertLess(host.evaluate("ThroneHall.finaleMs()"), 5000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
