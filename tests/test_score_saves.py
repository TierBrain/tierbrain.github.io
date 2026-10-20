#!/usr/bin/env python3
"""Offline score-save regressions; every HTTP request and socket is intercepted.

Only local source and synthetic score responses are used. No live backend,
analytics, image or font request is forwarded. Classic-script game state is
driven through Playwright rather than exposing test controls in public pages.
"""
from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://tierbrain.test"
BACKEND = "cgrbwtcydgfkbqhseeap.supabase.co"
GAMES = ("piece-by-piece", "jigsaw", "brain-coaster")


class ScoreSaveChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
        cls.browser = cls.playwright.chromium.launch(
            **({"executable_path": executable} if executable else {}),
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-domain-reliability", "--disable-sync"],
        )
        cls.total_posts = 0

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        print(json.dumps({"mode": "offline local pages and synthetic score responses",
                          "live_backend_requests": 0, "synthetic_score_posts": cls.total_posts}))

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 1280, "height": 800}, service_workers="block")
        self.context.set_default_timeout(6000)
        self.context.set_default_navigation_timeout(10000)
        self.context.route("**/*", self.route)
        self.context.route_web_socket("**/*", lambda socket: socket.close())
        self.posts = []
        self.gets = []
        self.held = []
        self.errors = []
        self.guard_errors = []
        self.post_mode = 201
        self.get_status = 200

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.guard_errors, [], "Unexpected requests were blocked")
        self.assertEqual(self.errors, [], "Uncaught browser JavaScript exceptions")

    def route(self, route):
        request = route.request
        parsed = urlsplit(request.url)
        if parsed.hostname == "tierbrain.test":
            path = ROOT / unquote(parsed.path).lstrip("/")
            if request.method != "GET" or not path.resolve().is_relative_to(ROOT) or not path.is_file():
                self.guard_errors.append(f"Invalid local request: {request.method} {parsed.path}")
                route.fulfill(status=404, body="Missing local fixture")
            else:
                route.fulfill(status=200, body=path.read_bytes(),
                              content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            return
        if parsed.hostname != BACKEND:
            route.abort()
            return
        headers = {"Access-Control-Allow-Origin": ORIGIN,
                   "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"}
        if parsed.path != "/rest/v1/scores":
            self.guard_errors.append(f"Unknown synthetic endpoint: {request.method} {parsed.path}")
            route.abort()
            return
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=headers)
        elif request.method == "POST":
            self.posts.append(json.loads(request.post_data or "null"))
            type(self).total_posts += 1
            if self.post_mode == "hold":
                self.held.append(route)
            elif self.post_mode == "network":
                route.abort("failed")
            else:
                route.fulfill(status=self.post_mode, headers=headers,
                              content_type="application/json",
                              body="[]" if self.post_mode < 400 else '{"message":"synthetic denial"}')
        elif request.method == "GET":
            self.gets.append(request.url)
            route.fulfill(status=self.get_status, headers=headers,
                          content_type="application/json", body="[]")
        else:
            self.guard_errors.append(f"Unexpected synthetic mutation: {request.method}")
            route.abort()

    def open_game(self, game, group=""):
        page = self.context.new_page()
        page.on("pageerror", lambda error: self.errors.append(f"{game}: {error}"))
        page.goto(f"{ORIGIN}/{game}.html", wait_until="domcontentloaded")
        if game == "brain-coaster":
            page.evaluate("value => { localStorage.setItem('qc_group', value); document.getElementById('groupInput').value=value; document.getElementById('nameInput').value='SYNTHETIC'; }", group)
        else:
            page.locator("#groupInput").fill(group)
            page.locator("#nameInput").fill("SYNTHETIC")
        self.start_game(page, game)
        return page

    def start_game(self, page, game):
        if game == "piece-by-piece":
            page.evaluate("startGame('flags')")
            page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
            page.evaluate("clearInterval(intervalId); clearTimeout(graceId)")
        elif game == "jigsaw":
            page.evaluate("startTier(TIERS[1])")
            page.evaluate("new Promise(resolve => requestAnimationFrame(resolve))")
            page.wait_for_function("pieces.length === 24")
            page.evaluate("running = false")
        else:
            page.evaluate("startGame('mixed')")

    def complete(self, page, game, points=92, level=1):
        if game == "piece-by-piece":
            page.evaluate("values => { clearInterval(intervalId); clearTimeout(graceId); score=values[0]; correctCount=values[1]; gameStartMs=Date.now()-12000; gameOver(); }", [points, level])
        elif game == "jigsaw":
            page.evaluate("running=false; startMs=Date.now()-12000; finish()")
        else:
            page.evaluate("values => { score=values[0]; bestStreak=values[1]; gameOver(); }", [points, level])

    def resubmit(self, page, game):
        page.evaluate("(() => { submitAndLoad(12); return null; })()")

    def state(self, page, expected):
        page.wait_for_function("value => document.querySelector('#scoreStatus').dataset.state === value", arg=expected)
        return page.locator("#scoreStatus").inner_text()

    def pump(self, page):
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")

    def release_posts(self):
        headers = {"Access-Control-Allow-Origin": ORIGIN,
                   "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"}
        held, self.held = self.held, []
        for route in held:
            route.fulfill(status=201, headers=headers, content_type="application/json", body="[]")

    def test_http_rejection_stays_visible_and_requires_explicit_retry(self):
        for game in GAMES:
            with self.subTest(game=game):
                self.posts.clear()
                self.gets.clear()
                self.post_mode = 403
                page = self.open_game(game)
                self.complete(page, game, 5 if game == "brain-coaster" else 92, 5 if game == "brain-coaster" else 1)
                self.assertIn("not saved", self.state(page, "failed").lower())
                page.wait_for_function("document.querySelector('#boardRefresh') !== null")
                self.pump(page)
                self.assertGreaterEqual(len(self.gets), 1)
                self.resubmit(page, game)
                self.pump(page)
                self.assertEqual(len(self.posts), 1, "A denied save must not retry implicitly")
                page.evaluate("document.getElementById('nameInput').value='CHANGED'; document.getElementById('groupInput').value='CHANGED'")
                self.post_mode = 201
                page.locator("#scoreRetry").click()
                self.assertIn("saved", self.state(page, "saved").lower())
                self.assertEqual(len(self.posts), 2)
                self.assertEqual(self.posts[0], self.posts[1], "Explicit retry must preserve the original result")
                page.close()

    def test_success_survives_board_failure_and_board_refresh_never_reposts(self):
        for game in GAMES:
            with self.subTest(game=game):
                self.posts.clear()
                self.get_status = 503
                page = self.open_game(game)
                self.complete(page, game, 5 if game == "brain-coaster" else 92, 5 if game == "brain-coaster" else 1)
                self.assertIn("saved", self.state(page, "saved").lower())
                page.locator("#boardRefresh").click()
                self.pump(page)
                self.assertEqual(len(self.posts), 1)
                self.assertIn("saved", page.locator("#scoreStatus").inner_text().lower())
                page.close()

    def test_ambiguous_outcomes_do_not_allow_automatic_or_button_retry(self):
        for game in GAMES:
            for mode in ("network", 500, 408):
                with self.subTest(game=game, outcome=mode):
                    self.posts.clear()
                    self.post_mode = mode
                    page = self.open_game(game)
                    self.complete(page, game, 5 if game == "brain-coaster" else 92, 5 if game == "brain-coaster" else 1)
                    self.assertIn("confirm", self.state(page, "unknown").lower())
                    self.assertFalse(page.locator("#scoreRetry").is_visible())
                    self.resubmit(page, game)
                    page.locator("#boardRefresh").click()
                    self.pump(page)
                    self.assertEqual(len(self.posts), 1)
                    page.close()

    def test_inflight_and_successful_results_are_posted_once_per_run(self):
        for game in GAMES:
            with self.subTest(game=game):
                self.posts.clear()
                self.post_mode = "hold"
                page = self.open_game(game)
                self.complete(page, game, 5 if game == "brain-coaster" else 92, 5 if game == "brain-coaster" else 1)
                self.state(page, "saving")
                self.resubmit(page, game)
                self.pump(page)
                self.assertEqual(len(self.posts), 1)
                self.release_posts()
                self.state(page, "saved")
                self.resubmit(page, game)
                self.pump(page)
                self.assertEqual(len(self.posts), 1)
                self.start_game(page, game)
                self.post_mode = 201
                self.complete(page, game, 6 if game == "brain-coaster" else 184, 6 if game == "brain-coaster" else 2)
                self.state(page, "saved")
                self.assertEqual(len(self.posts), 2)
                page.close()

    def test_previous_run_response_cannot_change_new_run_status(self):
        for game in GAMES:
            with self.subTest(game=game):
                self.posts.clear()
                self.post_mode = "hold"
                page = self.open_game(game)
                self.complete(page, game, 5 if game == "brain-coaster" else 92, 5 if game == "brain-coaster" else 1)
                self.state(page, "saving")
                self.start_game(page, game)
                self.state(page, "idle")
                self.release_posts()
                self.pump(page)
                self.assertEqual(page.locator("#scoreStatus").get_attribute("data-state"), "idle")
                page.close()

    def test_brain_coaster_group_changes_save_only_distinct_targets(self):
        page = self.open_game("brain-coaster", "SYNTH_A")
        self.complete(page, "brain-coaster", 21, 21)
        self.state(page, "saved")
        page.locator("#groupInput").fill("SYNTH_B")
        page.locator("#groupInput").dispatch_event("change")
        self.state(page, "saved")
        page.locator("#groupInput").fill("SYNTH_A")
        page.locator("#groupInput").dispatch_event("change")
        self.pump(page)
        self.assertEqual(len(self.posts), 2)
        rows = [batch[0] for batch in self.posts]
        self.assertEqual({r["group_code"] for r in rows}, {"SYNTH_A", "SYNTH_B"})
        self.assertTrue(all((r["correct"], r["level"], r["time_left"]) == (21, 21, 0) for r in rows))

    def test_payload_units_and_maximum_group_scopes_are_preserved(self):
        group = "A" * 24
        cases = [
            ("piece-by-piece", 92, 1, "flags~" + group, 92, 1),
            ("piece-by-piece", 0, 0, "flags~" + group, 0, 0),
            ("brain-coaster", 21, 21, group, 21, 21),
        ]
        for game, points, level, scope, expected_points, expected_level in cases:
            with self.subTest(game=game, points=points):
                self.posts.clear()
                page = self.open_game(game, group)
                self.complete(page, game, points, level)
                self.state(page, "saved")
                row = self.posts[0][0]
                self.assertEqual((row["correct"], row["level"], row["group_code"]),
                                 (expected_points, expected_level, scope))
                page.close()

    def test_jigsaw_tier_payloads_and_maximum_group_scope_are_preserved(self):
        group = 'A' * 24
        for index, pieces in [(0, 12), (1, 24), (2, 35), (3, 48)]:
            with self.subTest(game="jigsaw", pieces=pieces):
                self.posts.clear()
                page = self.open_game("jigsaw", group)
                page.evaluate("index => startTier(TIERS[index])", index)
                page.wait_for_function("count => pieces.length === count", arg=pieces)
                self.complete(page, "jigsaw")
                self.state(page, "saved")
                row = self.posts[0][0]
                self.assertEqual((row["correct"], row["level"], row["group_code"]),
                                 (pieces, index + 1, "global~" + group))
                page.close()

    def test_brain_coaster_question_banks_fit_database_limit(self):
        page = self.open_game('brain-coaster')
        sizes = page.evaluate("({total:CATS.filter(c=>c.key!=='mixed').reduce((n,c)=>n+c.bank.length,0), mixed:CATS[0].bank.length})")
        self.assertEqual(sizes['total'], 170, 'Update the score policy and its tests when question banks grow')
        self.assertLessEqual(sizes['mixed'], 170)

    def test_mobile_uncertain_save_keeps_refresh_accessible(self):
        self.post_mode = 'network'
        for game in GAMES:
            with self.subTest(game=game):
                self.posts.clear()
                page = self.open_game(game)
                page.set_viewport_size({'width':375,'height':667})
                self.complete(page,game,5 if game=='brain-coaster' else 92,5 if game=='brain-coaster' else 1)
                self.assertIn('confirm',self.state(page,'unknown').lower())
                page.locator('#boardRefresh').click()
                self.pump(page)
                self.assertEqual(len(self.posts),1)
                page.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
