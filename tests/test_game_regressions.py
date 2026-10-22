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

    def test_creak_pages_draw_with_the_shared_artwork(self):
        """Guard: an older upload of either Creak & Coil page drops the new board, sky, zooms and cutscenes."""
        self.assertTrue((ROOT / "creak-art.js").is_file(), "creak-art.js is missing")
        for page in ("creak.html", "creak-multi.html"):
            source = read(page)
            for needle in ('src="creak-art.js', 'src="tb-hosts.js"', 'src="tb-scenes.js"', "CreakArt.sky.mount()",
                           "CreakArt.climber(", "CreakArt.snake(", "CreakArt.ladder(", "zoomIn(", "CreakArt.sky.storm(true)"):
                with self.subTest(page=page, needle=needle):
                    self.assertIn(needle, source)

    def test_shared_climb_players_have_different_colours(self):
        """Bug: the second and fifth players were given the same green, so their pieces looked identical."""
        palette = re.search(r"const PALETTE=\[(.*?)\];", read("creak-multi.html")).group(1)
        colours = [c.lower() for c in re.findall(r"'(#[0-9a-fA-F]{6})'", palette)]
        self.assertEqual(len(colours), len(set(colours)), "two players share a colour")

    def test_climb_cutscenes_hold_the_turn_and_never_interrupt_a_question(self):
        """Cutscenes: the phones are told to watch the TV, nothing plays mid-question, and never two within three turns."""
        host, phone, solo = read("creak-multi.html"), read("creak-multi-play.html"), read("creak.html")
        body = re.search(r"function writeState\(\)\{(.*?)\}\}\); \}", host, re.S).group(1)
        self.assertIn("scene:G.scene||null", body)
        self.assertIn("if(st.phase==='live' && st.scene){", phone)
        for page, source, call, question in (("creak-multi.html", host, "ccMoment('rumble'", "askQuestionFor("),
                                             ("creak.html", solo, "moment('rumble'", "askQuestion(")):
            with self.subTest(page=page):
                start = source.index("async function rockfallEvent(")
                rock = source[start:start + 500]
                self.assertIn(call, rock)
                self.assertLess(rock.index(call), rock.index(question), "the scene must finish before the question")
        self.assertIn("G.turnSeq - lastCut < 3", host)
        self.assertIn("turns-lastCut<3", solo)
        self.assertIn('id="cutsToggle"', solo)

    def test_climb_has_its_moments_and_variants(self):
        """Guard: the Creak & Coil scenes (and random variants of the opening and summit) are in the cutscene engine."""
        scenes = read("tb-scenes.js")
        for kind in ("basecamp:", "sight:", "roc:", "rumble:", "comeback:", "podium:"):
            with self.subTest(kind=kind):
                self.assertIn(kind, scenes)
        self.assertIn("'[object Array]'", scenes)

    def test_climbers_can_be_chosen_in_both_creak_games(self):
        """Players choose their climber: the solo game remembers it, and Shared Climb phones send it to the TV."""
        solo, host, phone = read("creak.html"), read("creak-multi.html"), read("creak-multi-play.html")
        self.assertIn('id="climberBtn"', solo)
        self.assertIn("CreakArt.lookStyle(myLook)", solo)
        self.assertIn('src="creak-art.js', phone)
        self.assertIn('id="climberCard"', phone)
        self.assertIn("select=id,name,tag", host)
        self.assertIn("looks:G.looks||null", re.search(r"function writeState\(\)\{(.*?)\}\}\); \}", host, re.S).group(1))

    QUIZ_FAMILY = {"quiz-climb": ("Quiz Climb", "climb"), "higher-lower": ("Higher or Lower", "higher"), "odd-one-out": ("Odd One Out", "odd"),
                   "spot-the-lie": ("Spot the Lie", "lie"), "fact-fiction": ("Fact or Fiction", "fact"), "matchup": ("Match Up", "match"),
                   "unscramble": ("Unscramble", "scramble"), "recall": ("Recall", "recall"), "call-your-shot": ("Call Your Shot", "shot"),
                   "five-clues": ("Five Clues", "clues")}

    def test_quiz_family_has_its_look_and_clear_start_screens(self):
        """Guard: each quiz-family game loads its themed look, is named on its start screen, and its rules match the clock you pick."""
        self.assertTrue((ROOT / "tb-quiz.js").is_file(), "tb-quiz.js is missing")
        for page, (name, theme) in self.QUIZ_FAMILY.items():
            with self.subTest(page=page):
                source = read(page + ".html")
                self.assertIn('src="tb-quiz.js', source)
                self.assertIn('data-theme="%s"' % theme, source)
                start = source[source.index('id="startScreen"'):]
                self.assertIn('<h1 class="big display">%s</h1>' % name, start[:600])
                self.assertNotIn("Your 2 minutes are up", source)
                self.assertNotIn("you have 2 minutes", source)

    def test_quiz_family_playability_fixes(self):
        """Recall's clock waits while the pattern plays, Match Up counts matches not attempts,
        and Five Clues forgives a small spelling slip."""
        recall, matchup, clues = read("recall.html"), read("matchup.html"), read("five-clues.html")
        self.assertIn("inputPos=0; accepting=false; pauseClock();", recall)
        self.assertIn("accepting=true; resumeClock();", recall)
        self.assertIn("if(correct>=20){ endDone(); return; }", matchup)
        self.assertIn("if(left.length===1){ board.matched[left[0]]=true;", matchup)
        self.assertIn("function edits(a,b)", clues)

    def test_map_games_draw_their_worlds(self):
        """Guard: Escape the Keep, Out of the Labyrinth and Reach the Core draw their illustrated worlds,
        name every stop for screen readers, and never call a winning run "Out"."""
        self.assertTrue((ROOT / "tb-worlds.js").is_file(), "tb-worlds.js is missing")
        for page, world in (("castle.html", "keep"), ("labyrinth.html", "maze"), ("core.html", "space")):
            with self.subTest(page=page):
                source = read(page)
                self.assertIn('src="tb-worlds.js', source)
                self.assertIn('data-world="%s"' % world, source)
                for hook in ("TBWorld.build(", "TBWorld.update(", "TBWorld.obstacle(", "TBWorld.answer(", "TBWorld.result(", "el.setAttribute('aria-label',"):
                    self.assertIn(hook, source)
                self.assertNotIn("return 'Out \\u00b7 '", source)

    def test_throne_host_never_runs_two_polls_at_once(self):
        """Bug: on a slow connection the 300ms poll overlapped itself and graded one answer several times
        (a first win showed 'A streak of 2', and a one-question Grand Finale ended 2-0)."""
        for page in ("throne.html", "throne-bible.html"):
            with self.subTest(page=page):
                source = read(page)
                self.assertIn("if(tickBusy) return;", source)
                self.assertIn("try{ await tickOnce(); } finally { tickBusy=false; }", source)

    def test_standing_room_acts_on_each_reply_once(self):
        """Same overlap risk in Standing Room's answer and step polls: a reply must be acted on once."""
        source = read("standing-room-multi.html")
        self.assertEqual(source.count("if(busy || gen!==pollGen) return; busy=true;"), 2)

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

    def test_show_plays_the_round_order_the_lobby_announced(self):
        """Bug: the lobby previewed the rounds from the room's seed, but the show shuffled them with a new random seed."""
        for page in ("show.html", "show-gen.html"):
            with self.subTest(page=page):
                source = read(page)
                self.assertIn("buildShowOrder((room.seed|0)||1)", source.split("function refreshLineup", 1)[1][:400])
                self.assertIn("SHOW_ORDER=buildShowOrder((room.seed|0)||1)", source)
                self.assertNotIn("SHOW_ORDER=buildShowOrder(G.gameSeed)", source)

    def test_chapter_and_verse_scripture_follows_the_chosen_bible(self):
        """Bug: themed and closing verses had one modern wording, even with the King James Version chosen."""
        source = read("show.html")
        themed = source.split("const THEMED={", 1)[1].split("\n  };", 1)[0]
        for block in ("vblank:[", "vref:["):
            entries = [line for line in themed.split(block, 1)[1].split("\n    ]", 1)[0].splitlines() if "{th:" in line]
            self.assertGreater(len(entries), 0, block)
            for line in entries:
                self.assertIn("KJV:", line, line[:80]); self.assertIn("NIV:", line, line[:80])
        closers = [line for line in source.split("const CLOSERS={", 1)[1].split("const CLOSE_LINES", 1)[0].splitlines() if "{ref:" in line]
        self.assertGreater(len(closers), 0)
        for line in closers:
            self.assertIn("KJV:", line, line[:80]); self.assertIn("NIV:", line, line[:80])
        self.assertIn("c[BIBLE_VERSION]", source)

    def test_smudged_bible_edition_matches_the_general_game(self):
        """Bug: the Bible copy fell behind wheel.html, so it could repeat a message within one game."""
        def body(name):
            text = read(name)
            text = re.sub(r'<title>[^<]*</title>|<meta (name|property)="(description|og:url|og:title|og:description|twitter:title|twitter:description)" content="[^"]*">|<link rel="canonical" href="[^"]*">', "", text)
            return re.sub(r"^var ED = .*$", "", text, flags=re.M)
        self.assertEqual(body("smudged-bible.html"), body("wheel.html"),
                         "Rebuild smudged-bible.html from wheel.html (only the titles and ED line should differ)")

    def test_smudged_has_plenty_of_messages_and_no_repeats_across_levels(self):
        wheel, extra = read("wheel.html"), read("smudged-bank.js")
        def norm(text):
            return re.sub(r"^(THE|A|AN) ", "", re.sub(r"[^A-Z ]", "", text.upper())).replace(" ", "")
        def gather(base_var, key, minimum):
            base = json.loads(re.search(r"^var %s = (\{.*?\});\s*$" % base_var, wheel, re.M).group(1))
            section = extra.split("\n%s: {" % key, 1)[1]
            seen, counts = {}, {}
            for level in "1234":
                block = re.search(r'"%s": \[\n(.*?)\n\]' % level, section, re.S).group(1)
                texts = [p["text"] for p in base[level]] + [r.split("|")[1] for r in re.findall(r'"([^"]+)"', block)]
                for text in texts:
                    key_ = norm(text)
                    if key_ in seen:
                        self.assertEqual(seen[key_], level, f"{text} appears at two levels")
                        continue
                    seen[key_] = level
                    counts[level] = counts.get(level, 0) + 1
            for level in "1234":
                self.assertGreaterEqual(counts.get(level, 0), minimum, f"{key} level {level}")
        gather("PHRASES", "phrases", 100)
        gather("BIBLE_PHRASES", "bible", 75)

    def test_gradient_titles_keep_their_text(self):
        """Bug: an !important 'background' shorthand reset background-clip, so titles showed as a plain gold bar."""
        bad = re.compile(r"background:[^;{}]*gradient\([^;{}]*\)\s*!important;\s*-webkit-background-clip:\s*text\s*;")
        found = sorted(path.name for path in ROOT.glob("*.html") if bad.search(path.read_text(encoding="utf-8", errors="ignore")))
        self.assertEqual(found, [], "Add !important to background-clip:text in: " + ", ".join(found))

    def test_live_races_use_the_race_art_and_tidy_rules(self):
        """The live races draw a real scene, and their rules read as sentences, not comma splices."""
        for name, kind in (("tug-of-war.html", "tug"), ("finish-line.html", "race")):
            with self.subTest(page=name):
                source = read(name)
                self.assertIn('<script src="tb-races.js?v=1" data-race="%s"></script>' % kind, source)
                self.assertNotIn("then every right answer hauls", source)
                self.assertNotIn("as fast as they can, every right answer", source)
        self.assertTrue((ROOT / "tb-races.js").is_file())

    def test_live_races_only_count_this_rounds_rows(self):
        """Bug: Rematch replayed the old start signal at once, and Finish Line cars began on the finish line."""
        for name in ("tug-of-war.html", "finish-line.html"):
            with self.subTest(page=name):
                source = read(name)
                self.assertIn("if(fresh){ goUsed=goAt; if(nowSrv-goAt<8000 && !started) beginCountdown(); }", source)
                self.assertIn("if(racing ? goUsed-at>12000 : top-at>12000) return;", source)

    def test_tug_of_war_ends_the_same_tug_on_every_phone(self):
        """Bug: one phone saw the rope cross and stopped while the others kept tugging for minutes."""
        source = read("tug-of-war.html")
        self.assertIn("ping(END,winner||3,0,0); finish(winner);", source)
        self.assertIn("else if(phase==='tug' && endW){ finish(endW===3?0:endW, true); }", source)


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

    def test_shared_climb_moment_holds_the_turn_and_tells_the_phones(self):
        """A moment on the mountain plays on the TV while every phone says to watch the big screen; a tap skips it."""
        host, phones = self.shared_climb()
        host.evaluate("() => { localStorage.setItem('tb-cutscenes-guide', '1'); window.__m = ccMoment('basecamp', {name: 'Maya'}, 1, true); }")
        host.wait_for_selector(".tb-scene")
        phones["Leo"].wait_for_function("document.body.innerText.includes('Watch the big screen!')", timeout=8000)
        host.locator(".tb-scene").click()
        host.wait_for_function("G.scene === null && !document.querySelector('.tb-scene')")
        phones["Leo"].wait_for_function("!document.body.innerText.includes('Watch the big screen!')", timeout=8000)

    def test_solo_climb_draws_the_new_board(self):
        """The solo climb draws its board, sky and climber without errors on a phone."""
        page = self.open(self.context(390, 844), "creak.html")
        page.wait_for_function("window.CreakArt && document.getElementById('ccSky') && document.getElementById('board').width > 300")
        page.wait_for_timeout(600)

    def test_shared_climb_climbers_never_share_a_colour(self):
        """Each phone picks a climber; a colour someone already chose is crossed out, and the TV keeps everyone distinct."""
        host = self.open(self.context(1280, 720, {"tb-cutscenes-guide": "0"}), "creak-multi.html")
        host.wait_for_function("/^[A-Z]{5}$/.test(document.getElementById('code').textContent.trim())")
        code = host.locator("#code").inner_text().strip()
        phones = []
        for name in ("Maya", "Leo"):
            phone = self.open(self.context(390, 844), "creak-multi-play.html?c=" + code)
            phone.locator("#codeIn").fill(code)
            phone.locator("#nameIn").fill(name)
            phone.locator("#joinBtn").click()
            phone.wait_for_selector("#climberPick [data-k='c'] button")
            phones.append(phone)
        phones[0].locator("#climberPick [data-k='c'] button[data-v='3']").click()
        phones[0].locator("#climberPick [data-k='h'] button[data-v='helmet']").click()
        phones[1].wait_for_function("document.querySelector(`#climberPick [data-k='c'] button[data-v='3']`).disabled", timeout=8000)
        host.wait_for_function("G.players.length === 2 && G.players.some(p => /c3[.]s[0-9][.]hhelmet/.test(p.tag || ''))", timeout=8000)
        host.locator("#startBtn").click()
        host.wait_for_function("G.phase === 'live'")
        looks = host.evaluate("() => G.order.map(id => G.looks[id])")
        self.assertEqual((looks[0]["col"], looks[0]["hat"]), ("#8f7be6", "helmet"))
        self.assertNotEqual(looks[0]["col"], looks[1]["col"])

    def test_quiz_family_games_start_with_their_look(self):
        """Each quiz-family game starts cleanly with its backdrop, hearts and tier steps in place."""
        for page in StaticGameGuards.QUIZ_FAMILY:
            with self.subTest(page=page):
                game = self.open(self.context(390, 844), page + ".html")
                game.wait_for_function("document.body.classList.contains('tbq') && document.getElementById('tbqSky')")
                game.locator("#startBtn").click()
                game.wait_for_function("document.querySelectorAll('#strikes .strike').length === 4 && document.querySelectorAll('.tbq-tier i').length === 4")
                game.wait_for_timeout(400)

    def test_map_game_opens_an_illustrated_obstacle(self):
        """Tapping the next stop on the map opens its obstacle, drawn, with a question to answer."""
        game = self.open(self.context(390, 844), "castle.html")
        game.wait_for_function("window.TBWorld && document.getElementById('menuArt')")
        game.locator("#startBtn").click()
        game.wait_for_function("document.getElementById('mapArt') && document.querySelectorAll('.node.reachable').length > 0")
        self.assertTrue(game.evaluate("() => [...document.querySelectorAll('.node')].every(n => n.getAttribute('aria-label'))"))
        game.locator(".node.reachable").first.click()
        game.wait_for_function("!document.getElementById('obWrap').classList.contains('hidden') && document.getElementById('obArt') && document.querySelectorAll('#obOpts .opt').length === 4")

    def race_room(self, page_name, names, sides=None):
        phones = []
        for i, name in enumerate(names):
            phone = self.open(self.context(390, 844), page_name)
            phone.wait_for_function("window.TBRace && document.querySelector('.tbr-scene')")
            phone.locator("#nameIn").fill(name)
            phone.locator("#codeIn").fill("RACE7")
            phone.locator("#joinBtn").click()
            phone.wait_for_function("!document.getElementById('lobbyScreen').classList.contains('hidden')")
            if sides:
                phone.locator("#joinBlue" if sides[i] == 1 else "#joinRed").click()
            phones.append(phone)
        return phones

    def test_live_race_ignores_an_old_start_and_rematches_from_the_grid(self):
        """Bugs: an old start signal launched a lone countdown, and rematch cars began on the finish line."""
        self.backend.tables.setdefault("scores", []).append(
            {"quiz_id": "qc_race", "group_code": "RACE7", "name": "__GO__", "correct": 0, "level": 0, "time_left": 0,
             "created_at": "%.6f" % (time.time() - 90)})
        maya, leo = self.race_room("finish-line.html", ["Maya", "Leo"])
        maya.wait_for_timeout(2500)
        self.assertTrue(maya.locator("#lobbyScreen").is_visible(), "An old start signal began a race")
        maya.locator("#goBtn").click()
        for phone in (maya, leo):
            phone.wait_for_function("!document.getElementById('raceScreen').classList.contains('hidden')", timeout=8000)
        maya.wait_for_function("""() => { const p = parseInt(document.getElementById('raceProg').textContent, 10); if (p >= 12) return true;
            const b = document.querySelector('#opts .opt[data-a="1"]'); if (b && !document.getElementById('opts').classList.contains('locked')) b.click(); return false; }""",
            polling=250, timeout=40000)
        maya.wait_for_function("!document.getElementById('resultScreen').classList.contains('hidden')", timeout=8000)
        leo.wait_for_function("document.querySelectorAll('#track .lane.done').length === 1", timeout=8000)
        maya.locator("#againBtn").click()
        maya.wait_for_timeout(3000)
        self.assertTrue(maya.locator("#lobbyScreen").is_visible(), "Rematch restarted the old race")
        maya.locator("#goBtn").click()
        maya.wait_for_function("!document.getElementById('raceScreen').classList.contains('hidden')", timeout=8000)
        maya.wait_for_timeout(2000)
        self.assertEqual(maya.locator("#raceProg").inner_text().strip(), "0 / 12")
        self.assertEqual(maya.evaluate("() => document.querySelectorAll('#track .lane.done').length"), 0)

    def test_tug_of_war_ends_on_every_phone_when_one_calls_it(self):
        """Bug: each phone judged the finish alone, so one stopped while the rest tugged on."""
        maya, leo = self.race_room("tug-of-war.html", ["Maya", "Leo"], sides=[1, 2])
        maya.wait_for_function("!document.getElementById('goBtn').disabled", timeout=8000)
        maya.locator("#goBtn").click()
        for phone in (maya, leo):
            phone.wait_for_function("!document.getElementById('tugScreen').classList.contains('hidden') && document.querySelector('#tugScreen #tugArt')", timeout=8000)
        self.backend.tables["scores"].append({"quiz_id": "qc_tug", "group_code": "RACE7", "name": "__END__", "correct": 0,
                                              "level": 2, "time_left": 0, "created_at": "%.6f" % time.time()})
        for phone in (maya, leo):
            phone.wait_for_function("!document.getElementById('resultScreen').classList.contains('hidden')", timeout=10000)
            self.assertIn("Red wins", phone.locator("#winBanner").inner_text())

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
