"""Ruffled Feathers: a round-robin quiz for 3 to 10 players on one screen."""
import functools
import http.server
import itertools
import json
import os
import re
import socketserver
import subprocess
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'ruffled-feathers.html'
TOPICS = ROOT / 'ruffled-topics.js'


def page_text():
    return PAGE.read_text(encoding='utf-8')


class RuffledPageTests(unittest.TestCase):
    def test_page_is_published_and_listed_once(self):
        html = page_text()
        self.assertIn('<link rel="canonical" href="https://tierbrain.co/ruffled-feathers.html">', html)
        self.assertIn('<title>Ruffled Feathers | Free round-robin quiz game | TierBrain</title>', html)
        self.assertIn('<loc>https://tierbrain.co/ruffled-feathers.html</loc>', (ROOT / 'sitemap.xml').read_text(encoding='utf-8'))
        home = (ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertEqual(home.count('<a class="tc" href="ruffled-feathers.html" data-cat="game multiplayer" data-title="Ruffled Feathers"'), 1)
        self.assertNotIn('noindex', html.lower())

    def test_catalogue_counts_include_it(self):
        home = (ROOT / 'index.html').read_text(encoding='utf-8')
        cards = len(re.findall(r'<a\b[^>]*\bdata-title="', home))
        self.assertGreaterEqual(cards, 71)
        self.assertIn('id="count" role="status" aria-live="polite">%d games<' % cards, home)
        catalogue = json.loads((ROOT / 'docs/readiness-catalogue.json').read_text(encoding='utf-8'))
        self.assertEqual(catalogue['counts']['catalogue_entries'], cards)
        self.assertEqual(sum(1 for row in catalogue['entries'] if row['href'] == 'ruffled-feathers.html'), 1)

    def test_no_backend_and_nothing_sent(self):
        text = page_text() + TOPICS.read_text(encoding='utf-8')
        for marker in ('fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'supabase', 'document.cookie'):
            self.assertNotIn(marker, text, marker)

    def test_uses_shared_banks_and_the_site_sound_switch(self):
        html = page_text()
        self.assertRegex(html, r'<script src="questions\.js\?v=\d+"></script>')
        for name in ('bible-bank.js', 'ruffled-topics.js', 'tb-shell.js'):
            self.assertIn('<script src="' + name, html)
            self.assertTrue((ROOT / name).is_file(), name)
        self.assertIn("TB.bank('gk')", html)
        self.assertIn('window.tbSetMuted', html)

    def test_the_agreed_rules_are_stated(self):
        html = page_text()
        self.assertIn('The first correct peck wins 2 points.', html)
        self.assertIn('Both wrong, or the clock runs out: 0–0, and nobody scores.', html)
        self.assertIn('The bout between those players decides it, then the fastest average correct peck.', html)
        self.assertIn("T.players[w].pts += 2;", html)

    def test_sentences_never_put_a_verb_after_a_name(self):
        # A name may be "You" or "The Smiths", so no present-tense verb may have to agree with it.
        self.assertEqual(re.findall(r"\.name \+ ' (?:wins|pecks|is|has|rules|leads|takes|gets|scores|beats|knows)\b", page_text()), [])

    def test_no_em_dashes_in_what_players_read(self):
        self.assertNotIn('\u2014', page_text())
        home = (ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertNotIn('\u2014', home.split('ruffled-feathers.html')[1].split('</a>')[0])

    def test_topic_questions_are_well_formed(self):
        script = "global.window=global;require(process.argv[1]);const o=[];for(const k in RF_BANK)for(const t in RF_BANK[k])for(const q of RF_BANK[k][t])o.push([k,t,q]);console.log(JSON.stringify({labels:RF_TOPICS,rows:o}))"
        try:
            out = subprocess.run(['node', '-e', script, str(TOPICS)], capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            self.skipTest('node is not installed')
        self.assertEqual(out.returncode, 0, out.stderr)
        data = json.loads(out.stdout)
        self.assertEqual(len(data['labels']), 9)
        per_topic = {}
        for topic, tier, q in data['rows']:
            self.assertIn(topic, data['labels'])
            self.assertEqual(len({q['correct'], *q['wrong']}), 4, q['q'])
            self.assertEqual(len(q['wrong']), 3, q['q'])
            self.assertTrue(q['q'].strip() and len(q['q']) <= 160, q['q'])
            per_topic[topic] = per_topic.get(topic, 0) + 1
        self.assertTrue(all(count >= 150 for count in per_topic.values()), per_topic)


try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


NAMES = ['Priya', 'Sam', 'Grandad', 'Ruth', 'Tom', 'Ama', 'Joe', 'Bea', 'Idris', 'Mo']


@unittest.skipIf(sync_playwright is None, 'Playwright is not installed')
class RuffledBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(_Quiet, directory=str(ROOT))
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), handler)
        cls.base = 'http://127.0.0.1:%d/ruffled-feathers.html' % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        exe = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        cls.browser = cls.pw.chromium.launch(**({'executable_path': exe} if exe else {}))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def open(self, width=1366, height=768, motion='reduce', clock=False):
        self.ctx = self.browser.new_context(viewport={'width': width, 'height': height}, reduced_motion=motion)
        self.outside = []

        def route(r):
            if r.request.url.startswith('http://127.0.0.1:'):
                return r.continue_()
            self.outside.append(r.request.url); return r.abort()
        self.ctx.route('**/*', route)
        self.page = self.ctx.new_page()
        if clock:
            self.page.clock.install()
        self.errors, self.missing = [], []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('response', lambda r: self.missing.append(r.url) if r.status >= 400 else None)
        self.page.goto(self.base)
        self.page.wait_for_selector('#beginBtn')
        self.page.evaluate('window.__noConfirm = true')
        return self.page

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [])
        self.assertEqual(self.missing, [])
        self.assertEqual([u for u in self.outside if 'fonts.g' not in u], [])

    def players(self, n, names=None):
        pg = self.page
        while pg.locator('#plist input').count() < n:
            pg.click('#addBtn')
        while pg.locator('#plist input').count() > n:
            pg.locator('#plist .rm').last.click()
        for i, name in enumerate(names or NAMES[:n]):
            pg.locator('#plist input').nth(i).fill(name)

    def begin(self, n=5, names=None):
        self.players(n, names)
        self.page.click('#beginBtn')
        self.page.wait_for_selector('#boutBtn')

    def to_open(self, clock=False):
        pg = self.page
        pg.click('#boutBtn')
        if clock:
            pg.clock.run_for(2000)
        pg.wait_for_function("window.__rf.B && window.__rf.B.phase === 'open'")

    def pick(self, correct):
        pg = self.page
        state = pg.evaluate('({c: __rf.B.q.correct, o: __rf.B.opts})')
        for i, option in enumerate(state['o']):
            button = pg.locator('#opts .opt').nth(i)
            if (option == state['c']) == correct and not button.is_disabled():
                button.click(); return
        self.fail('no such option')

    def peck(self, side):
        self.page.dispatch_event('#sideL' if side == 0 else '#sideR', 'pointerdown')

    def table(self):
        return self.page.evaluate('({players: __rf.T.players.map(p => [p.name, p.pts, p.won, p.lost, p.nil]), bouts: __rf.T.bouts.map(b => [b.a, b.b, b.winner])})')

    def test_every_pair_meets_once_and_points_add_up(self):
        for n in (3, 5, 8):
            with self.subTest(players=n):
                self.open(); self.begin(n)
                total = n * (n - 1) // 2
                for k in range(total):
                    self.to_open()
                    kind = k % 4
                    if kind == 0:
                        self.peck(0); self.pick(True)
                    elif kind == 1:
                        self.peck(1); self.pick(False); self.peck(0); self.pick(True)
                    elif kind == 2:
                        self.peck(0); self.pick(False); self.peck(1); self.pick(False)
                    else:
                        self.peck(1); self.pick(True)
                    self.page.click('#nextBtn')
                self.page.wait_for_selector('#final:not([hidden])')
                state = self.table()
                pairs = sorted(tuple(sorted(b[:2])) for b in state['bouts'])
                self.assertEqual(pairs, sorted(itertools.combinations(range(n), 2)))
                wins = sum(1 for b in state['bouts'] if b[2] >= 0)
                self.assertEqual(sum(p[1] for p in state['players']), 2 * wins)
                for name, pts, won, lost, nil in state['players']:
                    self.assertEqual(won + lost + nil, n - 1, name)
                    self.assertEqual(pts, 2 * won, name)
                self.assertEqual(self.page.locator('#finalTree .perch').count(), n)
                self.assertTrue(self.page.text_content('#champName').strip())
                self.ctx.close()
        self.open()

    def test_first_correct_peck_wins_two_and_the_other_gets_nothing(self):
        self.open(); self.begin(5); self.to_open()
        ids = self.page.evaluate('__rf.B.ids')
        self.peck(1); self.pick(True)
        state = self.table()
        self.assertEqual(state['players'][ids[1]][1:], [2, 1, 0, 0])
        self.assertEqual(state['players'][ids[0]][1:], [0, 0, 1, 0])
        self.assertIn('Two points to ' + state['players'][ids[1]][0], self.page.text_content('#msg'))
        self.assertEqual(self.page.text_content('#pillR'), '+2 points')

    def test_a_wrong_peck_locks_that_player_out_but_the_other_can_still_win(self):
        self.open(); self.begin(5); self.to_open()
        ids = self.page.evaluate('__rf.B.ids')
        self.peck(0); self.pick(False)
        self.assertTrue(self.page.locator('#sideL').is_disabled())
        self.assertFalse(self.page.locator('#sideR').is_disabled())
        self.assertEqual(self.page.text_content('#pillL'), 'Wrong: locked out')
        self.assertEqual(self.page.locator('#opts .opt.gone').count(), 1)
        self.peck(0)  # ignored: locked out
        self.assertEqual(self.page.evaluate('__rf.B.phase'), 'open')
        self.peck(1); self.pick(True)
        self.assertEqual(self.table()['players'][ids[1]][1], 2)
        self.assertEqual(self.table()['players'][ids[0]][1], 0)

    def test_both_wrong_scores_nothing(self):
        self.open(); self.begin(5); self.to_open()
        self.peck(0); self.pick(False); self.peck(1); self.pick(False)
        state = self.table()
        self.assertEqual(sum(p[1] for p in state['players']), 0)
        self.assertEqual(state['bouts'][0][2], -1)
        self.assertIn('0–0', self.page.text_content('#msg'))
        self.assertEqual(self.page.locator('#opts .opt.right').count(), 1)
        self.page.click('#nextBtn')
        self.assertEqual(self.page.locator('#xt td.zero').count(), 2)

    def test_time_running_out_scores_nothing(self):
        self.open(clock=True); self.begin(5); self.to_open(clock=True)
        self.assertEqual(self.page.locator('#timer i').count(), 10)
        self.page.clock.run_for(16000)
        self.assertIn('Time’s up', self.page.text_content('#msg'))
        self.assertEqual(sum(p[1] for p in self.table()['players']), 0)
        self.assertTrue(self.page.locator('#nextBtn').is_visible())

    def test_a_player_who_pecks_must_choose_in_time(self):
        self.open(clock=True); self.begin(5); self.to_open(clock=True)
        self.peck(0)
        self.page.clock.run_for(7000)
        self.assertEqual(self.page.text_content('#pillL'), 'Too slow: locked out')
        self.assertFalse(self.page.locator('#sideR').is_disabled())

    def test_relaxed_mode_has_no_clock_and_offers_a_way_out(self):
        self.open(clock=True); self.players(5)
        self.page.click('#clock [data-v="relaxed"]')
        self.page.click('#beginBtn'); self.to_open(clock=True)
        self.assertEqual(self.page.locator('#timer i').count(), 0)
        self.assertIn('No clock', self.page.text_content('#timer'))
        self.page.clock.run_for(60000)
        self.assertEqual(self.page.evaluate('__rf.B.phase'), 'open')
        self.page.click('#giveUp')
        self.assertIn('Nobody knew', self.page.text_content('#msg'))
        self.assertEqual(sum(p[1] for p in self.table()['players']), 0)

    def test_keyboard_pecks_and_answers(self):
        self.open(); self.begin(5); self.to_open()
        ids = self.page.evaluate('__rf.B.ids')
        self.page.keyboard.press('p')
        self.assertEqual(self.page.evaluate('__rf.B.chooser'), 1)
        self.page.keyboard.press('q')  # too late: the other robin pecked first
        self.assertEqual(self.page.evaluate('__rf.B.chooser'), 1)
        index = self.page.evaluate('__rf.B.opts.indexOf(__rf.B.q.correct)')
        self.page.keyboard.press(str(index + 1))
        self.assertEqual(self.table()['players'][ids[1]][1], 2)

    def test_head_to_head_then_speed_break_ties(self):
        self.open(); self.begin(4)
        order = self.page.evaluate('''() => { const T = __rf.T;
          T.players.forEach((p, i) => { p.pts = [4, 4, 2, 2][i]; p.times = [[900], [300], [800], [200]][i]; p.won = p.pts / 2; });
          T.bouts.forEach(b => { b.winner = undefined; });
          const set = (a, b, w) => { const x = T.bouts.find(z => (z.a === a && z.b === b) || (z.a === b && z.b === a)); x.winner = w; };
          set(0, 1, 0);      // level on 4: player 0 beat player 1, so 0 ranks first despite being slower
          set(2, 3, -1);     // level on 2 with a 0-0 between them: the faster average (player 3) ranks higher
          const s = __rf.standings(); return { order: s.order, pos: s.pos }; }''')
        self.assertEqual(order['order'], [0, 1, 3, 2])
        self.assertEqual(order['pos'], [1, 2, 3, 4])

    def test_bout_order_is_random_and_avoids_back_to_back_bouts(self):
        self.open()
        result = self.page.evaluate('''() => { const worst = {}, seen = new Set();
          for (const n of [5, 6, 8, 10]) { worst[n] = 0; for (let i = 0; i < 12; i++) { const s = __rf.schedule(n); worst[n] = Math.max(worst[n], __rf.backToBack(s));
            if (n === 6) seen.add(s.map(b => b.a + '-' + b.b).join(',')); } }
          return { worst, different: seen.size }; }''')
        self.assertEqual(result['worst'], {'5': 0, '6': 0, '8': 0, '10': 0})
        self.assertGreater(result['different'], 6)

    def test_names_are_tidied_and_never_run_as_markup(self):
        self.open(); self.begin(4, ['<img src=x onerror=alert(1)>', 'Sam', 'sam', ''])
        names = [p[0] for p in self.table()['players']]
        self.assertEqual(names[1:], ['Sam', 'sam 2', 'Player 4'])
        self.assertEqual(self.page.locator('#tree img').count(), 0)
        self.assertIn('<img', self.page.locator('#tree').inner_text())

    def test_topics_bible_and_difficulty_draw_from_the_right_bank(self):
        for topic in ('bible', 'science', 'books'):
            with self.subTest(topic=topic):
                self.open(); self.players(3)
                self.page.select_option('#topic', topic)
                self.page.click('#diff [data-v="mix"]')
                self.page.click('#beginBtn'); self.to_open()
                found = self.page.evaluate('''(topic) => { const q = __rf.B.q.q, bank = topic === 'bible' ? TB_BIBLE : RF_BANK[topic];
                  return Object.keys(bank).some(t => bank[t].some(x => x.q === q)); }''', topic)
                self.assertTrue(found, topic)
                self.assertEqual(len(set(self.page.evaluate('__rf.B.opts'))), 4)
                self.ctx.close()
        self.open()

    def test_fits_phones_tablets_and_a_tv_without_sideways_scrolling(self):
        for width, height in ((320, 640), (390, 844), (1180, 820), (1920, 1080)):
            with self.subTest(width=width):
                self.open(width, height); self.begin(10)
                for stage in ('order', 'open', 'done'):
                    if stage == 'open':
                        self.to_open()
                    if stage == 'done':
                        self.peck(0); self.pick(True)
                    self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1, stage)
                if width >= 1180:
                    box = self.page.locator('.card').bounding_box()
                    self.assertLessEqual(box['y'] + box['height'], height, 'question card fits the screen')
                self.ctx.close()
        self.open()

    def test_every_robin_has_its_own_chirp(self):
        self.open()
        songs = self.page.evaluate('[...Array(10).keys()].map(i => JSON.stringify(__rf.songOf(i)))')
        self.assertEqual(len(set(songs)), 10)
        self.assertIn('Each robin has its own chirp for a buzzer.', page_text())
        self.page.locator('#plist .sw').first.click()  # previewing a chirp must not error

    def test_pecking_before_the_question_opens_costs_nothing(self):
        self.open(); self.begin(5)
        self.page.click('#boutBtn')
        self.assertEqual(self.page.evaluate('__rf.B.phase'), 'read')
        self.page.wait_for_timeout(500)
        self.peck(0)
        self.assertEqual(self.page.text_content('#pillL'), 'Not yet!')
        self.assertEqual(self.page.evaluate('__rf.B.locked'), [False, False])
        self.page.wait_for_function("__rf.B.phase === 'open'")
        self.peck(0); self.pick(True)
        self.assertEqual(sum(p[1] for p in self.table()['players']), 2)

    def test_quitting_asks_first_and_the_clock_waits(self):
        self.open(clock=True); self.begin(5); self.to_open(clock=True)
        self.page.evaluate('window.__noConfirm = false')
        left = self.page.evaluate('__rf.B.left')
        self.page.click('#quitBtn')
        self.assertTrue(self.page.locator('#dlg').is_visible())
        self.page.clock.run_for(20000)
        self.assertEqual(self.page.evaluate('__rf.B.phase'), 'open')
        self.assertAlmostEqual(self.page.evaluate('__rf.B.left'), left, delta=200)
        self.page.click('#stayBtn')
        self.assertFalse(self.page.locator('#dlg').is_visible())
        self.page.click('#quitBtn'); self.page.click('#leaveBtn')
        self.assertTrue(self.page.locator('#setup').is_visible())

    def test_play_again_keeps_the_players_and_resets_the_scores(self):
        self.open(); self.begin(3)
        for _ in range(3):
            self.to_open(); self.peck(0); self.pick(True); self.page.click('#nextBtn')
        self.page.click('#againBtn')
        state = self.table()
        self.assertEqual([p[0] for p in state['players']], NAMES[:3])
        self.assertEqual(sum(p[1] for p in state['players']), 0)
        self.assertTrue(all(b[2] is None for b in state['bouts']))


if __name__ == '__main__':
    unittest.main()
