"""Ruffled Feathers: a round-robin quiz for 3 to 10 players on one screen."""
import functools
import http.server
import itertools
import json
import os
import re
import socketserver
import subprocess
import sys
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

    def test_catalogue_inventory_includes_it(self):
        home = (ROOT / 'index.html').read_text(encoding='utf-8')
        cards = len(re.findall(r'<a\b[^>]*\bdata-title="', home))
        self.assertGreaterEqual(cards, 71)
        # Published counts are generated during the build; source labels may lag.
        result = subprocess.run([sys.executable, str(ROOT / 'sync-catalogue.py'), '--validate-only'],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        catalogue = json.loads((ROOT / 'docs/readiness-catalogue.json').read_text(encoding='utf-8'))
        self.assertEqual(catalogue['counts']['catalogue_entries'], cards)
        self.assertEqual(sum(1 for row in catalogue['entries'] if row['href'] == 'ruffled-feathers.html'), 1)

    def test_one_screen_play_needs_no_backend(self):
        html = page_text()
        # The connection scripts load only when a host chooses phones as buzzers.
        self.assertNotIn('<script src="vendor/supabase.js"', html)
        self.assertNotIn('<script src="js/ruffled-access.js"', html)
        self.assertIn("loadScript('vendor/supabase.js')", html)
        for marker in ('fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'document.cookie'):
            self.assertNotIn(marker, html + TOPICS.read_text(encoding='utf-8'), marker)

    def test_phone_rooms_ship_with_their_database_change_checks_and_undo(self):
        for name in ('ruffled-play.html', 'js/ruffled-access.js', 'supabase/migrations/20261116100000_secure_ruffled_rooms.sql',
                     'supabase/rollback/secure_ruffled_rooms.sql', 'supabase/RUFFLED-ACCESS.md', 'tests/check_ruffled_access.py', 'tests/ruffled_phone_checks.py'):
            self.assertTrue((ROOT / name).is_file(), name)
        play = (ROOT / 'ruffled-play.html').read_text(encoding='utf-8')
        self.assertIn('<meta name="robots" content="noindex">', play)
        self.assertIn('<script src="vendor/supabase.js"></script>\n<script src="js/ruffled-access.js"></script>', play)
        self.assertNotIn('ruffled-play.html', (ROOT / 'sitemap.xml').read_text(encoding='utf-8'))
        sql = (ROOT / 'supabase/migrations/20261116100000_secure_ruffled_rooms.sql').read_text(encoding='utf-8')
        self.assertIn("'correct',CASE WHEN b.closed_at IS NOT NULL THEN b.correct_idx END", sql)
        self.assertIn("GRANT EXECUTE ON FUNCTION %s TO authenticated", sql)
        self.assertNotIn('TO anon', sql)

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

    def test_two_questions_reworded_after_feedback(self):
        q = (ROOT / 'questions.js').read_text(encoding='utf-8'); ff = (ROOT / 'ff-sets-bible.js').read_text(encoding='utf-8')
        self.assertNotIn('Where in London does the monarch live', q)
        self.assertIn('{q:"What is the monarch\'s official London residence?", correct:"Buckingham Palace"', q)
        self.assertNotIn('high priest that year?', ff)
        self.assertIn('["Which of these men was the high priest the year Jesus was crucified?", "Caiaphas"]', ff)

    def test_the_ark_ships_on_both_pages_and_stays_offline(self):
        ark = (ROOT / 'ruffled-ark.js').read_text(encoding='utf-8')
        html, play = page_text(), (ROOT / 'ruffled-play.html').read_text(encoding='utf-8')
        self.assertIn('<script src="bible-bank.js?v=1"></script>\n<script src="ff-sets-bible.js?v=1"></script>\n<script src="ruffled-ark.js?v=1"></script>', html)
        self.assertIn('<script src="ruffled-ark.js?v=1"></script>', play)
        self.assertTrue((ROOT / 'ff-sets-bible.js').is_file())
        for marker in ('fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'document.cookie', 'localStorage', '\u2014'):
            self.assertNotIn(marker, ark, marker)
        # every bird carries its King James verse
        for ref in ('Genesis 8:11', 'Genesis 8:7', 'Psalm 84:3', 'Isaiah 40:31', 'Jeremiah 8:7', 'Psalm 102:6', '1 Kings 10:22', 'Exodus 16:13'):
            self.assertIn("ref: '" + ref + "'", ark)

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

    def open(self, width=1366, height=768, motion='reduce', clock=False, query=''):
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
        self.page.goto(self.base + query)
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

    def test_phones_mode_without_the_database_change_explains_and_one_screen_still_works(self):
        self.open()
        # A live site without the database change: sign-in works, the room functions do not exist.
        stub = ("window.supabase={createClient(){return{auth:{async getSession(){return{data:{session:{}}}},"
                "async signInAnonymously(){return{data:{}}},async getUser(){return{data:{user:{id:'u'}}}}},"
                "async rpc(n){return{error:{code:'PGRST202',message:'Could not find the function public.'+n},status:404}}}}};")
        self.page.route('**/vendor/supabase.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=stub))
        self.page.click('#playMode [data-v="phones"]')
        self.assertTrue(self.page.locator('#lobbyBox').is_visible())
        self.assertTrue(self.page.locator('#localBox').is_hidden())
        self.page.wait_for_function("!/Opening/.test(document.getElementById('lobbyMsg').textContent)", timeout=10000)
        self.assertEqual(self.page.text_content('#lobbyMsg'), 'Phone play is not switched on for this site yet. Play on one screen for now.')
        self.page.click('#playMode [data-v="one"]')
        self.assertTrue(self.page.locator('#localBox').is_visible())
        self.begin(3)
        self.to_open(); self.peck(0); self.pick(True)
        self.assertEqual(sum(p[1] for p in self.table()['players']), 2)
        self.outside = [u for u in self.outside if 'supabase.co' not in u and 'qrserver.com' not in u]

    def test_one_screen_play_never_contacts_the_backend(self):
        self.open(); self.begin(3)
        self.to_open(); self.peck(1); self.pick(True); self.page.click('#nextBtn')
        self.assertFalse(self.page.evaluate("!!window.supabase || !!window.RuffledAccess"))

    def test_ten_player_tables_fit_a_tv_and_explain_ties_exactly(self):
        self.open(1920, 1080); self.begin(10)
        self.page.evaluate("""() => { const T = __rf.T, pts = [10, 10, 10, 10, 8, 8, 6, 6, 4, 4];
          T.players.forEach((p, i) => { p.pts = pts[i]; p.won = pts[i] / 2; p.times = [[1700], [2800], [1720], [1830], [1400], [2700], [2800], [1750], [2000], [2200]][i]; });
          T.bouts.forEach(b => { b.winner = -1; });
          const set = (a, b, w) => { const x = T.bouts.find(z => (z.a === a && z.b === b) || (z.a === b && z.b === a)); x.winner = w; };
          set(0, 1, 1); set(0, 2, 0); set(0, 3, 0); set(1, 2, 1); set(1, 3, 3); set(2, 3, 2);  // the night's real four-way tie
          T.k = T.bouts.length; __rf.showFinal(); }""")
        self.page.wait_for_selector('#final:not([hidden])')
        bottom = self.page.evaluate("Math.max(...[...document.querySelectorAll('#finalTree .perch')].map(e => e.getBoundingClientRect().bottom))")
        self.assertLessEqual(bottom, 1080, 'every robin on the final tree is on screen')
        self.assertEqual(self.page.locator('#finalTree .perch').count(), 10)
        self.assertLessEqual(self.page.locator('#againBtn').bounding_box()['y'] + self.page.locator('#againBtn').bounding_box()['height'], 1080, 'Play again stays on screen')
        note = self.page.text_content('#tieNote')
        self.assertIn('Level on 10 points: ' + ', '.join(NAMES[:4]) + '. Their bouts against each other set the order, with ' + NAMES[0] + ' ahead of ' + NAMES[1] + ' and ' + NAMES[2] + ' ahead of ' + NAMES[3] + ' on the fastest average correct peck.', note)
        self.page.evaluate("__rf.T.k = 22; __rf.showOrder(false)")
        bottom = self.page.evaluate("Math.max(...[...document.querySelectorAll('#tree .perch')].map(e => e.getBoundingClientRect().bottom))")
        self.assertLessEqual(bottom, 1080, 'every robin on the Pecking Order is on screen')

    def test_play_again_keeps_the_players_and_resets_the_scores(self):
        self.open(); self.begin(3)
        for _ in range(3):
            self.to_open(); self.peck(0); self.pick(True); self.page.click('#nextBtn')
        self.page.click('#againBtn')
        state = self.table()
        self.assertEqual([p[0] for p in state['players']], NAMES[:3])
        self.assertEqual(sum(p[1] for p in state['players']), 0)
        self.assertTrue(all(b[2] is None for b in state['bouts']))

    def test_reading_time_fits_the_question_and_each_result_gets_a_moment(self):
        # With motion on: pecking opens after the card lands plus about 0.15 s a word (2.4 s to 4.8 s),
        # and the button to move on appears 1.2 s after the result, so nothing is rushed.
        self.open(1920, 1080, motion='no-preference', clock=True, query='?scene=ark'); self.begin(3)
        for q, expect in ((['Who built the ark?', 'Noah', 'Moses', 'Abraham', 'David'], 2400),
                          (['Guess it: I was a leader among the Pharisees. I came to Jesus under cover of night. I was told I must be born again.', 'Nicodemus', 'Joseph of Arimathea', 'Gamaliel', 'Caiaphas'], 4800),
                          (['Which of these prophets was fed by ravens?', 'Elijah', 'Moses', 'Elisha', 'Jonah'], 1100 + 150 * 12)):
            with self.subTest(expect=expect):
                self.page.evaluate("q => { const T = __rf.T; T.pool.splice(T.qi, 0, { q: q[0], correct: q[1], wrong: q.slice(2) }); }", q)
                self.page.click('#boutBtn')
                self.page.clock.run_for(expect - 100)
                self.assertEqual(self.page.evaluate('__rf.B.phase'), 'read')
                self.page.clock.run_for(200)
                self.assertEqual(self.page.evaluate('__rf.B.phase'), 'open')
                self.peck(0); self.pick(True)
                self.assertTrue(self.page.locator('#nextBtn').is_hidden(), 'a breath before moving on')
                self.page.clock.run_for(1300)
                self.assertTrue(self.page.locator('#nextBtn').is_visible())
                self.page.click('#nextBtn'); self.page.clock.run_for(500)

    def test_an_answer_under_a_resting_mouse_stays_still(self):
        # the hover lift used to move an answer out from under a pointer resting on its bottom edge, so it flickered
        self.open(motion='no-preference'); self.begin(3); self.to_open(); self.peck(0)
        box = self.page.locator('#opts .opt').nth(2).bounding_box()
        self.page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] - 1.5)
        self.page.wait_for_timeout(400)
        seen = set()
        for _ in range(10):
            seen.add(self.page.evaluate("getComputedStyle(document.querySelectorAll('#opts .opt')[2]).transform")); self.page.wait_for_timeout(60)
        self.assertEqual(len(seen), 1, seen)
        self.pick(True)

    def test_everyone_level_at_the_top_is_named(self):
        self.open(); self.begin(4)
        line = lambda: self.page.text_content('#nextBox div').strip()
        # three level on 2 points: all three are named, in Pecking Order order
        self.page.evaluate('''() => { const T = __rf.T, P = T.players; [2, 2, 2, 0].forEach((v, i) => { P[i].pts = v; P[i].won = v / 2; });
          T.k = 3; __rf.showOrder(false); }''')
        st = self.page.evaluate('__rf.standings().order.slice(0, 3).map(i => __rf.T.players[i].name)')
        self.assertTrue(line().startswith('Level at the top on 2 points: %s, %s and %s.' % tuple(st)), line())
        # two level: both named
        self.page.evaluate('''() => { const T = __rf.T, P = T.players; [4, 4, 2, 0].forEach((v, i) => { P[i].pts = v; P[i].won = v / 2; }); __rf.showOrder(false); }''')
        st = self.page.evaluate('__rf.standings().order.slice(0, 2).map(i => __rf.T.players[i].name)')
        self.assertTrue(line().startswith('Level at the top on 4 points: %s and %s.' % tuple(st)), line())
        # one clear leader
        self.page.evaluate('''() => { const T = __rf.T, P = T.players; [6, 2, 2, 0].forEach((v, i) => { P[i].pts = v; P[i].won = v / 2; }); __rf.showOrder(false); }''')
        self.assertTrue(line().startswith('Top of the tree: %s, 4 points clear.' % self.page.evaluate('__rf.T.players[0].name')), line())
        # a chaser catching a shared lead is "level with the leaders"
        self.page.evaluate('''() => { const T = __rf.T, P = T.players, nb = T.bouts[T.k]; P.forEach(p => { p.pts = 4; p.won = 2; });
          P[nb.a].pts = 2; P[nb.a].won = 1; P[nb.b].pts = 0; P[nb.b].won = 0; __rf.showOrder(false); }''')
        self.assertIn('level with the leaders.', line())

    # ---------- The Ark: the Bible scene ----------
    def test_the_ark_asks_bible_questions_only_from_every_bible_game(self):
        self.open(query='?scene=ark')
        self.assertTrue(self.page.evaluate("document.body.classList.contains('ark')"))
        self.assertTrue(self.page.locator('#topicField').is_hidden())
        check = self.page.evaluate('''() => { const bank = RF_ARK.bible(), all = [].concat(...Object.values(bank)), qs = new Set(all.map(q => q.q));
          const tb = [].concat(...Object.values(TB_BIBLE)), ff = [].concat(...FF_SETS.map(s => s.q.map(([q, a]) => ({ q, a, set: s.a }))));
          const key = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), keys = new Set(all.map(q => key(q.q)));
          const gk = [].concat(...Object.values(TB.bank('gk'))).filter(q => qs.has(q.q)).map(q => q.q);
          const ffOk = ff.every(x => keys.has(key(x.q)) && all.filter(q => key(q.q) === key(x.q)).every(q => q.correct === x.a || tb.some(t => t.q === q.q)));
          return { total: all.length, good: all.filter(q => new Set([q.correct].concat(q.wrong)).size === 4 && q.wrong.length === 3).length, unique: keys.size,
                   tb: tb.every(q => qs.has(q.q)), ff: ffOk, ffCount: ff.length, gk, more: ['Bezalel', 'The Temple', 'The Bible', 'Egypt'].every(a => all.some(q => q.correct === a)),
                   note: document.getElementById('arkTopic').textContent }; }''')
        self.assertTrue(check['tb'], 'every bible-bank.js question is in The Ark')
        self.assertTrue(check['ff'], 'every First Finger Bible question is in The Ark, with its set as the options')
        self.assertTrue(check['more'], 'the Throne Bible and religion quiz extras are in')
        self.assertEqual(check['gk'], [], 'no general knowledge questions')
        self.assertEqual(check['good'], check['total'], 'four different options each')
        self.assertEqual(check['unique'], check['total'], 'no question appears twice')
        self.assertGreaterEqual(check['total'], 1000)
        self.assertEqual(check['note'], 'Bible questions only: all {:,} from across TierBrain\'s Bible games.'.format(check['total']))
        self.players(3); self.page.click('#diff [data-v="mix"]'); self.page.click('#beginBtn'); self.page.wait_for_selector('#boutBtn')
        self.assertEqual(self.page.evaluate('__rf.T.topic'), 'ark')
        self.assertTrue(self.page.evaluate("__rf.T.pool.every(q => [].concat(...Object.values(RF_ARK.bible())).includes(q))"))
        for _ in range(3):
            self.to_open()
            self.assertTrue(self.page.evaluate("[].concat(...Object.values(RF_ARK.bible())).some(q => q.q === __rf.B.q.q)"))
            self.assertIn('Bible', self.page.text_content('#boutInfo'))
            self.peck(0); self.pick(True); self.page.click('#nextBtn')

    def test_the_ark_gives_each_player_a_bible_bird_with_its_own_call(self):
        self.open(query='?scene=ark'); self.players(10)
        birds = self.page.evaluate("[...document.querySelectorAll('#plist .sw svg')].map(s => s.dataset.bird)")
        self.assertEqual(birds, ['Dove', 'Raven', 'Sparrow', 'Swallow', 'Eagle', 'Stork', 'Pelican', 'Owl', 'Peacock', 'Quail'])
        self.assertEqual(self.page.get_attribute('#plist .sw >> nth=7', 'aria-label'), 'Hear the owl for player 8')
        calls = self.page.evaluate('''() => [...Array(10).keys()].map(i => { const log = [], h = {};
          ['tone', 'syll', 'flutter'].forEach(k => { h[k] = (...a) => log.push(k + a.map(x => typeof x === 'number' ? x.toFixed(2) : x).join(',')); });
          RF_ARK.call(i, h, 0, .2); return log.join('|'); })''')
        self.assertEqual(len(set(calls)), 10, 'no two birds sound alike')
        self.assertTrue(all(calls), 'every bird makes a sound')
        self.page.locator('#plist .sw').nth(5).click()  # hearing a call must not error
        self.begin(10)
        self.assertEqual(self.page.evaluate("[...document.querySelectorAll('#tree .perch svg')].map(s => s.dataset.bird).length"), 10)

    def test_the_ark_waters_go_down_and_the_bow_comes_out_at_the_end(self):
        self.open(1920, 1080, query='?scene=ark'); self.begin(10)
        tide = lambda: self.page.get_attribute('#arkWaters', 'transform')
        self.assertEqual(self.page.text_content('#orderSub'), 'Before the first bout · 45 bouts to dry land')
        self.assertEqual(tide(), 'translate(0 0)')
        self.page.evaluate('__rf.T.k = 23; __rf.showOrder(false)')
        self.assertEqual(self.page.text_content('#orderSub'), 'After bout 23 of 45 · 22 bouts to dry land')
        self.assertEqual(tide(), 'translate(0 36)')
        self.page.evaluate('__rf.T.k = 44; __rf.showOrder(false)')
        self.assertTrue(self.page.text_content('#orderSub').endswith(' · 1 bout to dry land'))
        self.assertFalse(self.page.evaluate("document.querySelector('#sky .bow').classList.contains('on')"))
        self.page.evaluate('''() => { const T = __rf.T, pts = [12, 10, 10, 10, 8, 8, 6, 6, 4, 4];
          T.players.forEach((p, i) => { p.pts = pts[i]; p.won = pts[i] / 2; p.times = [1500 + i * 100]; }); T.k = T.bouts.length; __rf.showFinal(); }''')
        self.page.wait_for_selector('#final:not([hidden])')
        self.assertTrue(self.page.evaluate("document.querySelector('#sky .bow').classList.contains('on')"))
        # the waters drain to a strip of shore and the ark rests on dry land
        self.assertEqual(tide(), 'translate(0 125)')
        self.assertEqual(self.page.get_attribute('#arkFront', 'transform'), 'translate(0 125)')
        self.assertTrue(self.page.evaluate("document.querySelector('#sky .hills').classList.contains('drained')"))
        self.assertEqual(self.page.evaluate("document.getElementById('arkBoat').closest('.tide')"), None, 'the ark stays put as the water goes')
        self.assertEqual(self.page.locator('#arkLand').count(), 1)
        self.assertEqual(self.page.locator('#champBird .r-leaf').count(), 1, 'the winner holds the olive leaf')
        self.assertEqual(self.page.locator('#champBird .r-crown').count(), 1)
        self.assertTrue(self.page.locator('#arkVerse').is_visible())
        self.assertEqual(self.page.text_content('#arkVerse'), '\u201cand, lo, in her mouth was an olive leaf pluckt off\u201d Genesis 8:11')
        bottom = self.page.evaluate("Math.max(...[...document.querySelectorAll('#finalTree .perch')].map(e => e.getBoundingClientRect().bottom))")
        self.assertLessEqual(bottom, 1080)
        self.page.click('#changeBtn')
        self.assertEqual(tide(), 'translate(0 0)')
        self.assertFalse(self.page.evaluate("document.querySelector('#sky .hills').classList.contains('drained')"))
        self.assertFalse(self.page.evaluate("document.querySelector('#sky .bow').classList.contains('on')"))

    def test_the_flood_uncovers_the_land_bit_by_bit(self):
        # the land sits under both water layers, so it shows only as the water goes down
        self.open(1920, 1080, query='?scene=ark'); self.begin(4)
        order = self.page.evaluate("[...document.querySelector('#sky .hills').children].map(e => e.id).filter(Boolean)")
        self.assertEqual(order, ['arkLand', 'arkWaters', 'arkBoat', 'arkFront'])
        seen = lambda: self.page.evaluate('''() => { const land = document.getElementById('arkLand').getBoundingClientRect(),
          sea = document.querySelector('#arkWaters path').getBoundingClientRect(); return Math.round(sea.top - land.top); }''')
        start = seen()
        self.page.evaluate('__rf.T.k = 3; __rf.showOrder(false)'); self.page.wait_for_timeout(3000)
        self.assertGreater(seen(), start, 'more land shows as the waters go down')

    def test_the_ark_fits_phones_and_a_tv(self):
        for width, height in ((320, 640), (1920, 1080)):
            with self.subTest(width=width):
                self.open(width, height, query='?scene=ark'); self.begin(10)
                self.to_open(); self.peck(0); self.pick(True)
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width + 1)
                self.ctx.close()
        self.open()

    def test_the_winter_garden_comes_back_unchanged_and_the_scene_is_remembered(self):
        self.open()
        garden = self.page.evaluate("document.querySelector('#sky .hills').innerHTML")
        self.assertFalse(self.page.evaluate("document.body.classList.contains('ark')"))
        self.assertEqual(self.page.get_attribute('#scene [data-v="garden"]', 'aria-pressed'), 'true')
        self.assertEqual(self.page.locator('#plist .ark-bird').count(), 0)
        self.page.click('#scene [data-v="ark"]')
        self.assertTrue(self.page.evaluate("document.body.classList.contains('ark')"))
        self.assertGreater(self.page.locator('#plist .ark-bird').count(), 0)
        self.assertIn('Every bird faces every other bird once', self.page.text_content('.hero .tag'))
        self.page.click('#scene [data-v="garden"]')
        self.assertEqual(self.page.evaluate("document.querySelector('#sky .hills').innerHTML"), garden)
        self.assertEqual(self.page.locator('.ark-bird').count(), 0)
        self.assertTrue(self.page.locator('#topicField').is_visible())
        self.assertIn('Every robin faces every other robin once', self.page.text_content('.hero .tag'))
        self.page.click('#scene [data-v="ark"]'); self.begin(3)
        self.page.goto(self.base); self.page.wait_for_selector('#beginBtn')
        self.assertTrue(self.page.evaluate("document.body.classList.contains('ark')"), 'the last scene is remembered')
        self.page.goto(self.base + '?scene=garden'); self.page.wait_for_selector('#beginBtn')
        self.assertFalse(self.page.evaluate("document.body.classList.contains('ark')"), 'a link can still ask for the garden')

    def test_phones_join_the_ark_with_the_same_bible_birds(self):
        self.open(query='?scene=ark')
        link = self.page.evaluate("NET = { code: 'ABCDE' }; paintJoin(); document.getElementById('joinUrl').getAttribute('href')")
        self.assertTrue(link.endswith('/ruffled-play.html?c=ABCDE&s=ark'), link)
        self.page.click('#scene [data-v="garden"]')
        self.assertTrue(self.page.evaluate("paintJoin(); document.getElementById('joinUrl').getAttribute('href')").endswith('?c=ABCDE'))
        stub = ("window.supabase={createClient(){return{auth:{async getSession(){return{data:{session:null}}},"
                "async signInAnonymously(){return{data:{}}},async getUser(){return{data:{user:null}}}},"
                "async rpc(n){return{error:{code:'PGRST202',message:'Could not find the function public.'+n},status:404}}}}};")
        play = self.base.replace('ruffled-feathers.html', 'ruffled-play.html')
        for query, bird in (('?c=ABCDE&s=ark', 'Dove'), ('?c=ABCDE', None)):
            phone = self.ctx.new_page()
            phone.on('pageerror', lambda e: self.errors.append(str(e)))
            phone.route('**/vendor/supabase.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=stub))
            phone.goto(play + query); phone.wait_for_selector('#joinBird svg')
            self.assertEqual(phone.evaluate("document.querySelector('#joinBird svg').dataset.bird || null"), bird)
            phone.close()
        self.outside = [u for u in self.outside if 'qrserver.com' not in u]


if __name__ == '__main__':
    unittest.main()
