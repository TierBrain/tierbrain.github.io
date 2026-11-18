"""Ten Lanterns: spin the great dial, land on one of ten lantern worlds and play its round (stage 1, one screen)."""
import functools
import http.server
import os
import re
import socketserver
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'ten-lanterns.html'
ART = ROOT / 'ten-lanterns-art.js'
WORLDS = ROOT / 'ten-lanterns-worlds.js'
ROUNDS = ROOT / 'ten-lanterns-rounds.js'
SOUND = ROOT / 'ten-lanterns-sound.js'
PLAY = ROOT / 'ten-lanterns-play.html'


def page_text():
    return PAGE.read_text(encoding='utf-8')


class TenLanternsPageTests(unittest.TestCase):
    def test_page_stays_unlisted_while_it_is_built(self):
        html = page_text()
        self.assertIn('<meta name="robots" content="noindex">', html)
        self.assertIn('<link rel="canonical" href="https://tierbrain.co/ten-lanterns.html">', html)
        self.assertIn('<title>Ten Lanterns | Free quiz game | TierBrain</title>', html)
        self.assertNotIn('ten-lanterns.html', (ROOT / 'index.html').read_text(encoding='utf-8'))
        self.assertNotIn('ten-lanterns.html', (ROOT / 'sitemap.xml').read_text(encoding='utf-8'))

    def test_uses_shared_banks_the_sound_switch_and_no_backend(self):
        html = page_text()
        self.assertRegex(html, r'<script src="questions\.js\?v=\d+"></script>')
        for name in ('ruffled-topics.js', 'ten-lanterns-art.js', 'ten-lanterns-worlds.js', 'ten-lanterns-sound.js', 'ten-lanterns-rounds.js', 'tb-shell.js'):
            self.assertIn('<script src="' + name, html)
            self.assertTrue((ROOT / name).is_file(), name)
        self.assertIn("TB.bank('gk')", html)
        self.assertIn('window.tbSetMuted', html)
        for marker in ('fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'document.cookie'):
            self.assertNotIn(marker, html + ''.join(p.read_text(encoding='utf-8') for p in (ART, WORLDS, ROUNDS, SOUND)), marker)

    def test_house_style(self):
        for path in (PAGE, ART, WORLDS, ROUNDS, SOUND, PLAY):
            text = path.read_text(encoding='utf-8')
            self.assertNotIn('—', text, path.name)
        html = page_text()
        # Messages put no present-tense verb straight after a name: "Grandad to spin", "Amelia lit the lantern".
        every = html + ROUNDS.read_text(encoding='utf-8') + PLAY.read_text(encoding='utf-8')
        for bad in ("' wins", "' takes", "' steals", "' lights", "' keeps", "' spins the", "' scores", "' gets", "' is answering", "' is choosing", "' reaches", "' has the last"):
            self.assertNotIn(bad, every, bad)
        self.assertIn("' to spin'", html.replace('</span>', "'"))

    def test_ten_worlds_and_nothing_borrowed(self):
        art = ART.read_text(encoding='utf-8')
        names = re.findall(r"name: '([^']+)'", art)
        self.assertEqual(names, ['Ancient Rome', 'The submarine', 'The night flight', 'The mountain railway', 'The galleon',
                                 'The Ice Age cave', 'The hot air balloon', 'The manor at midnight', 'The big top', 'Smoke City'])
        # The daily dial runs on UK dates, so the time zone name is the one place a real city may appear.
        low = (art + page_text() + WORLDS.read_text(encoding='utf-8')).lower().replace("timezone: 'europe/london'", '')
        for word in ('crystal', 'zone', 'dome', 'vortex', 'time machine', 'tardis', 'wedge', 'aztec', 'atlantis', 'london', 'paris'):
            self.assertNotIn(word, low, word)


    def test_each_world_has_its_own_game_and_the_content_is_sound(self):
        js = ROUNDS.read_text(encoding='utf-8')
        for name in ('classic', 'city', 'railway', 'manor', 'flight', 'rome', 'submarine', 'galleon', 'cave', 'balloon', 'bigtop'):
            self.assertRegex(js, r'\b%s(: \{| = \{)' % name)
        places = re.findall(r"\['([^']+)', '(Europe|Asia|Africa|Americas|Oceania)', \[([^\]]+)\]\]", js.replace("\\'", ''))
        self.assertEqual(len(places), 32)
        for name, continent, clues in places:
            self.assertEqual(len(re.findall(r"'[^']+'", clues)), 4, name)
        low = js.lower()
        for word in ('crystal', 'vortex', 'time machine', 'tardis', 'wedge', 'aztec', 'atlantis', 'cluedo', 'poirot'):
            self.assertNotIn(word, low, word)

    def test_phone_play_is_secured_and_kept_apart(self):
        html, play = page_text(), PLAY.read_text(encoding='utf-8')
        self.assertIn('<meta name="robots" content="noindex">', play)
        self.assertIn('<script src="vendor/supabase.js"></script>', play)
        self.assertIn('<script src="js/lantern-access.js"></script>', play)
        self.assertIn("loadScript('js/lantern-access.js')", html)          # only loaded when phones are chosen
        self.assertNotIn('<script src="vendor/supabase.js"', html)
        sql = (ROOT / 'supabase/migrations/20261118210000_secure_lantern_rooms.sql').read_text(encoding='utf-8')
        self.assertIn("CREATE SCHEMA lantern_private;", sql)
        self.assertEqual(sql.count('SECURITY DEFINER'), 13)
        self.assertEqual(sql.count("SET search_path=''"), sql.count('CREATE FUNCTION'))
        self.assertIn("'correct',CASE WHEN p.closed_at IS NOT NULL THEN p.correct_idx END", sql)
        self.assertTrue((ROOT / 'supabase/rollback/secure_lantern_rooms.sql').is_file())
        self.assertTrue((ROOT / 'supabase/LANTERN-ACCESS.md').is_file())

    def test_the_worlds_move_only_cheap_properties_and_hold_still_for_reduced_motion(self):
        js = WORLDS.read_text(encoding='utf-8')
        frames = re.findall(r'@keyframes (tlw-[\w-]+)\{(.*?)\}\n', js)
        self.assertGreaterEqual(len(frames), 20)
        for name, body in frames:
            props = set(re.findall(r'([a-z-]+):', re.sub(r'var\([^)]*\)', '', body)))
            self.assertLessEqual(props, {'transform', 'opacity'}, name)
        self.assertIn('@media (prefers-reduced-motion:reduce){.tlw *{animation:none!important}.tlw .fx{display:none}}', js)
        self.assertNotIn('filter', js)


try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, 'Playwright is not installed')
class TenLanternsBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(_Quiet, directory=str(ROOT))
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), handler)
        cls.base = 'http://127.0.0.1:%d/ten-lanterns.html' % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        exe = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        cls.browser = cls.pw.chromium.launch(**({'executable_path': exe} if exe else {}))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def open(self, width=1366, height=768, motion='reduce', ctx=None):
        self.ctx = ctx or self.browser.new_context(viewport={'width': width, 'height': height}, reduced_motion=motion)
        self.outside = []

        def route(r):
            if r.request.url.startswith('http://127.0.0.1:'):
                return r.continue_()
            self.outside.append(r.request.url); return r.abort()
        self.ctx.route('**/*', route)
        self.page = self.ctx.new_page()
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

    # ---------- helpers ----------
    def setup(self, mode='versus', names=('Grandad', 'Amelia', 'Tom'), length='standard', relaxed=True, style='simple', auto='tap'):
        pg = self.page
        pg.click('#mode button[data-v="%s"]' % mode)
        if mode == 'versus':
            while pg.locator('#plist input').count() < len(names):
                pg.click('#addBtn')
            while pg.locator('#plist input').count() > len(names):
                pg.locator('#plist .rm').last.click()
            for i, n in enumerate(names):
                pg.locator('#plist input').nth(i).fill(n)
        if mode != 'daily':
            pg.click('#length button[data-v="%s"]' % length)
            pg.click('#style button[data-v="%s"]' % style)
        pg.click('#auto button[data-v="%s"]' % auto)
        pg.click('#timed button[data-v="%s"]' % ('relaxed' if relaxed else 'timed'))
        pg.click('#beginBtn')
        pg.wait_for_selector('#spinBtn:not([disabled])')

    def S(self, expr):
        return self.page.evaluate('(() => { const S = __tl.S, R = __tl.R; return ' + expr + '; })()')

    def spin(self, to=None):
        pg = self.page
        if to is not None:
            pg.evaluate('__tl.force(%d)' % to)
        pg.click('#spinBtn')
        pg.wait_for_selector('#landBox:not([hidden])')
        return self.S('S.pos')

    def go(self):
        self.page.click('#goBtn')
        self.page.wait_for_selector('#qBox:not([hidden]) .opt')

    def pick(self, right):
        i = self.S('R.q.opts.indexOf(R.q.correct)' if right else 'R.q.opts.findIndex(o => o !== R.q.correct)')
        self.page.locator('#opts .opt').nth(i).click()

    def question(self, right=True, steal=None, steal_right=True):
        """The spinner answers; on a miss, `steal` names who steals (an index) or None for no steal."""
        pg = self.page
        self.pick(right)
        if not right and pg.locator('#stealBox:not([hidden])').count():
            if steal is None:
                pg.click('#stealBtns button[data-k="-1"]')
            else:
                pg.click('#stealBtns button[data-k="%d"]' % steal)
                self.pick(steal_right)
        pg.wait_for_selector('#nextBtn:not([hidden])')
        pg.click('#nextBtn')

    def play_round(self, right=True):
        """Play whatever the world asks, answering right (or wrong) throughout. Returns the lantern's heading."""
        pg = self.page
        for _ in range(400):
            if pg.locator('#roundEnd').is_visible():
                return pg.inner_text('#reHead')
            ph = self.S('R && R.phase')
            if ph == 'intro':
                pg.click('#round')
            elif ph in ('ask', 'steal'):
                self.pick(right)
            elif ph == 'next':
                pg.click('#nextBtn')
            elif ph == 'buzz':
                pg.locator('#stealBtns button').first.click()
            elif ph in ('stealpick', 'pickwho'):
                pg.click('#stealBtns button[data-k="-1"]')
            elif ph == 'choose':
                title = pg.inner_text('#qText')
                opts = [o.strip() for o in pg.locator('#opts .opt span').all_text_contents()]
                live = [i for i in range(len(opts)) if not pg.locator('#opts .opt').nth(i).is_disabled()]
                target = None
                if 'who took the gold watch' in title.lower():
                    thief = pg.evaluate('(m => m.people[m.thief].name)(TL_ROUNDS.last.mystery)')
                    target = opts.index(thief) if right else next(i for i in live if opts[i] != thief)
                elif 'where are we' in title.lower():
                    place = pg.evaluate('TL_ROUNDS.last.place[0]')
                    target = opts.index(place) if right else next(i for i in live if opts[i] not in (place, 'Fly on for another clue'))
                pg.locator('#opts .opt').nth(live[0] if target is None else target).click()
            else:
                pg.wait_for_timeout(40)
        raise AssertionError('the round did not finish')

    def round(self, to=None, plan=(True, True, True)):
        self.spin(to); self.go()
        for step in plan:
            if isinstance(step, tuple):
                self.question(*step)
            else:
                self.question(step)
        self.page.wait_for_selector('#roundEnd:not([hidden])')
        head = self.page.inner_text('#reHead')
        self.page.click('#backBtn')
        return head

    # ---------- tests ----------
    def test_a_versus_game_runs_to_the_end(self):
        pg = self.open()
        self.setup('versus', ('Grandad', 'Amelia'))
        self.assertEqual(self.S('S.spins'), 10)
        self.assertIn('Grandad to spin', pg.inner_text('#turn'))
        for k in range(10):
            self.round(plan=(k % 2 == 0, True, False))
        pg.wait_for_selector('#end:not([hidden])')
        head = pg.inner_text('#endHead')
        self.assertTrue(head.startswith('Top of the night: ') or head == 'Level at the top', head)
        self.assertEqual(pg.locator('#endList li').count(), 2)
        self.assertEqual(pg.locator('#endLanterns span').count(), 10)
        self.assertIsNone(pg.evaluate("localStorage.getItem('tb-ten-lanterns-game')"))

    def test_turns_round_up_so_everyone_spins_equally(self):
        self.open()
        self.setup('versus', ('A', 'B', 'C'))
        self.assertEqual(self.S('S.spins'), 12)
        self.page.click('#quitBtn')
        self.setup('versus', ('A', 'B', 'C', 'D'), length='long')
        self.assertEqual(self.S('S.spins'), 20)
        self.page.click('#quitBtn')
        self.setup('team', length='evening')
        self.assertEqual(self.S('S.spins'), 40)
        self.assertEqual(self.S('S.players.map(p => p.name)'), ['Gold team', 'Blue team'])

    def test_every_world_comes_round_before_any_repeats_in_solo(self):
        self.open()
        self.setup('solo', length='long')
        seen = []
        for k in range(10):
            self.spin(); seen.append(self.S('S.pos')); self.go()
            for _ in range(3):
                self.question(False)
            self.page.click('#backBtn')
        self.assertEqual(sorted(seen), list(range(10)))

    def test_lighting_scoring_and_the_solo_threshold(self):
        pg = self.open()
        self.setup('solo')
        self.assertEqual(self.round(to=2, plan=(True, True, False)), 'Lantern lit')
        self.assertEqual(self.S('S.players[0].pts'), 20 + 20)
        self.assertEqual(self.S('S.owner[2]'), 0)
        self.assertEqual(self.round(to=5, plan=(True, False, False)), 'The lantern stays dark')
        self.assertEqual(self.S('S.owner[5]'), -1)
        self.assertEqual(self.S('S.players[0].pts'), 50)
        self.assertIn('1 lantern', pg.inner_text('#board'))

    def test_a_miss_can_be_stolen_and_the_round_winner_takes_the_lantern(self):
        pg = self.open()
        self.setup('versus')
        # Grandad misses all three; Amelia steals two, Tom one: Amelia lights it.
        head = self.round(to=4, plan=((False, 1, True), (False, 1, True), (False, 2, True)))
        self.assertEqual(head, 'Amelia lit the lantern')
        self.assertEqual(self.S('S.players.map(p => p.pts)'), [0, 20 + 20, 10])
        self.assertEqual(self.S('S.owner[4]'), 1)
        self.assertIn('Amelia to spin', pg.inner_text('#turn'))

    def test_a_rivals_lantern_can_be_stolen_and_an_owner_keeps_it_on_a_tie(self):
        self.open()
        self.setup('versus')
        self.round(to=6, plan=(True, True, True))                               # Grandad lights 6
        self.round(to=1, plan=(False, False, False))                            # Amelia, elsewhere
        self.assertEqual(self.round(to=6, plan=(True, True, False)), 'Tom stole the lantern')
        self.assertEqual(self.S('S.owner[6]'), 2)
        self.round(to=0, plan=(False, False, False))                            # Grandad, elsewhere
        # Amelia lands on Tom's lantern; one right each: level, so Tom keeps it.
        head = self.round(to=6, plan=(True, (False, 2, True), False))
        self.assertEqual(head, 'Tom kept the lantern')
        self.assertEqual(self.S('S.owner[6]'), 2)

    def test_nudges_cost_points_and_are_free_when_catching_up(self):
        pg = self.open()
        self.setup('versus', ('Grandad', 'Amelia'))
        self.spin(3)
        self.assertTrue(pg.is_disabled('#nudgeR'))
        self.assertIn('A nudge costs 10 points', pg.inner_text('#msg'))
        self.go()
        for _ in range(3):
            self.question(True)
        pg.click('#backBtn')                                                     # Grandad 50, Amelia 0
        self.spin(7)
        self.assertIn('(free)', pg.inner_text('#nudgeR'))
        pg.click('#nudgeR')
        self.assertEqual(self.S('S.pos'), 8)
        self.assertEqual(self.S('S.players[1].pts'), 0)
        self.assertTrue(pg.locator('#nudges').is_hidden())                       # once per spin
        self.go()
        for _ in range(3):
            self.question(False)
        pg.click('#backBtn')
        self.spin(0)                                                             # Grandad leads: 10 points
        pg.click('#nudgeL')
        self.assertEqual(self.S('S.pos'), 9)
        self.assertEqual(self.S('S.players[0].pts'), 40)

    def test_the_last_spin_counts_double(self):
        pg = self.open()
        self.setup('versus', ('Grandad', 'Amelia'))
        for k in range(9):
            self.round(plan=(False, False, False) if k % 2 else ((False, None), (False, None), (False, None)))
        self.assertIn('counts double', pg.inner_text('#turnNote'))
        before = self.S('S.players[1].pts')
        self.spin(); self.go()
        self.assertFalse(pg.locator('#lastChip').is_hidden())
        self.assertIn('Double points: 20 points', pg.inner_text('#rPts'))
        for _ in range(3):
            self.question(True)
        self.assertEqual(self.S('S.players[1].pts') - before, 3 * 20 + 40)

    def test_together_mode_wins_when_every_lantern_is_lit(self):
        pg = self.open()
        self.setup('coop')
        self.assertEqual(self.S('S.spins'), 14)
        for k in range(10):
            self.round(plan=(True, True, False))
        pg.wait_for_selector('#end:not([hidden])')
        self.assertEqual(pg.inner_text('#endHead'), 'Every lantern lit')
        self.assertIn('4 spins to spare', pg.inner_text('#endLine'))

    def test_teams_take_turns_and_steal_from_each_other(self):
        pg = self.open()
        self.setup('team')
        self.assertIn('Gold team to spin', pg.inner_text('#turn'))
        self.round(to=0, plan=((False, 1, True), True, False))
        self.assertIn('Blue team to spin', pg.inner_text('#turn'))
        # Level on 10 each, so the spinning team takes the lantern and its 20.
        self.assertEqual(self.S('S.players.map(p => p.pts)'), [30, 10])
        self.assertEqual(self.S('S.owner[0]'), 0)

    def test_the_daily_dial_is_the_same_everywhere_and_counts_once(self):
        pg = self.open()
        plan = pg.evaluate('JSON.stringify(__tl.dailyPlan(__tl.today()))')
        other = self.browser.new_context(reduced_motion='reduce')
        p2 = other.new_page(); p2.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1:') else r.abort())
        p2.goto(self.base); p2.wait_for_selector('#beginBtn')
        self.assertEqual(p2.evaluate('JSON.stringify(__tl.dailyPlan(__tl.today()))'), plan)
        self.assertNotEqual(p2.evaluate("JSON.stringify(__tl.dailyPlan('2026-01-02'))"), plan)
        other.close()
        self.setup('daily')
        self.assertEqual(self.S('S.spins'), 5)
        spins = pg.evaluate('__tl.dailyPlan(__tl.today()).spins')
        self.assertEqual(len(set(spins)), 5)
        for k in range(5):
            self.assertEqual(self.spin(), spins[k])
            self.assertTrue(pg.locator('#nudges').is_hidden())
            pg.click('#goBtn')
            self.assertEqual(self.S('R.kind'), self.S('__tl.D[S.pos].id'))       # the daily dial plays each world's own game
            self.play_round(k < 3)
            pg.click('#backBtn')
        pg.wait_for_selector('#end:not([hidden])')
        share = pg.inner_text('#shareText')
        self.assertIn('🏮🏮🏮⚫⚫', share)
        self.assertIn('tierbrain.co/ten-lanterns.html', share)
        pg.click('#changeBtn')
        self.assertIn('You have played today', pg.inner_text('#beginNote'))
        self.assertEqual(pg.inner_text('#beginBtn'), "Practise today's dial")

    def test_a_game_carries_on_after_a_refresh(self):
        pg = self.open()
        self.setup('versus')
        self.round(to=3, plan=(True, True, True))
        self.spin(5)                                                              # mid-turn when the page reloads
        pg.reload(); pg.wait_for_selector('#beginBtn'); pg.evaluate('window.__noConfirm = true')
        self.assertFalse(pg.locator('#resumeBox').is_hidden())
        self.assertIn('spin 2 of 12', pg.inner_text('#resumeText'))
        pg.click('#resumeBtn')
        pg.wait_for_selector('#spinBtn:not([disabled])')
        self.assertIn('Amelia to spin', pg.inner_text('#turn'))
        self.assertEqual(self.S('S.owner[3]'), 0)
        self.assertEqual(self.S('S.players[0].pts'), 50)

    def test_keys_answer_and_the_timer_runs_out(self):
        pg = self.open()
        self.setup('solo', relaxed=False)
        self.spin(); self.go()
        i = self.S('R.q.opts.indexOf(R.q.correct)')
        pg.keyboard.press(str(i + 1))
        pg.wait_for_selector('#nextBtn:not([hidden])')
        self.assertEqual(self.S('S.players[0].pts'), 10)
        pg.click('#nextBtn')
        pg.evaluate('window.performance.now = (n => () => n() + 30000)(performance.now.bind(performance))')
        pg.wait_for_selector('#nextBtn:not([hidden])')
        self.assertIn("Time's up", pg.inner_text('#rmsg'))

    def test_every_world_has_a_living_scene_behind_its_round(self):
        pg = self.open()
        ids = pg.evaluate('__tl.D.map(d => d.id)')
        self.assertEqual(sorted(pg.evaluate('TL_WORLDS.ids')), sorted(ids))
        for i in ids:
            n = pg.evaluate("(id => { const d = document.createElement('div'); d.innerHTML = TL_WORLDS.scene(id); const s = d.querySelector('svg.tlw'); return s ? s.querySelectorAll('*').length : 0; })('%s')" % i)
            self.assertGreater(n, 60, i)
        self.setup('coop')
        self.spin(5); self.go()
        self.assertEqual(pg.locator('#roundArt svg.tlw-cave').count(), 1)
        # Reduced motion: the scene holds still and the passing sparks are left out.
        self.assertEqual(pg.evaluate("getComputedStyle(document.querySelector('#roundArt .flame')).animationName"), 'none')
        self.assertEqual(pg.evaluate("getComputedStyle(document.querySelector('#roundArt .fx')).display"), 'none')
        for _ in range(3):
            self.question(True)
        pg.click('#backBtn')
        self.assertTrue(pg.locator('#round').is_hidden())
        self.assertEqual(pg.inner_html('#roundArt'), '')

    def test_with_motion_the_lantern_opens_into_its_world_and_lights_on_the_way_back(self):
        pg = self.open(motion='no-preference')
        self.setup('solo')
        pg.evaluate('__tl.force(6)'); pg.click('#spinBtn')
        pg.wait_for_selector('#landBox:not([hidden])', timeout=10000)
        pg.click('#goBtn')
        # the world opens out of the lantern, and there is a moment to take it in
        self.assertGreater(pg.evaluate("document.getElementById('round').getAnimations().length"), 0)
        self.assertTrue(pg.evaluate("document.getElementById('round').classList.contains('intro')"))
        self.assertEqual(self.S('R.phase'), 'intro')
        self.assertEqual(pg.locator('#opts .opt').count(), 0)
        self.assertGreater(pg.evaluate("getComputedStyle(document.querySelector('#roundArt .balloon')).animationName.length"), 4)
        pg.wait_for_timeout(300)
        pg.keyboard.press('Space')                                               # any key skips the moment
        pg.wait_for_selector('#qBox .opt')
        self.assertEqual(self.S('R.phase'), 'ask')
        for k in range(3):
            pg.wait_for_selector('#opts.opts-live')
            self.pick(True)
            if k == 0:
                self.assertEqual(pg.locator('#fx .plus').inner_text(), '+10')
                self.assertGreater(pg.locator('#fx .spark').count(), 8)
            pg.click('#nextBtn')
        pg.wait_for_selector('#roundEnd:not([hidden])')
        self.assertEqual(pg.get_attribute('#reLantern', 'class'), 'lit')
        pg.click('#backBtn')
        pg.wait_for_selector('#dial .burst', state='attached', timeout=4000)     # the lantern bursts alight
        pg.wait_for_selector('#round', state='hidden')
        pg.wait_for_function("document.querySelector('#board .pt').textContent === '50'")
        self.assertEqual(self.S('S.owner[6]'), 0)

    def test_every_world_plays_its_own_game_to_a_lit_lantern(self):
        pg = self.open()
        self.setup('solo', style='worlds')
        heads = {}
        for i in range(10):
            self.spin(i); pg.click('#goBtn')
            pg.click('#round')
            kind = self.S('R.kind')
            self.assertEqual(kind, self.S('__tl.D[S.pos].id'))
            self.assertIn(pg.evaluate('TL_ROUNDS.types[__tl.R.kind].title'), pg.inner_text('#rRule'))
            heads[kind] = self.play_round(True)
            pg.click('#backBtn')
        self.assertEqual(set(heads.values()), {'Lantern lit'}, heads)

    def test_the_lift_race_candles_and_the_hull(self):
        pg = self.open()
        self.setup('versus', style='worlds')
        self.spin(9); pg.click('#goBtn'); pg.click('#round')                       # Smoke City: open questions
        pg.wait_for_selector('#stealBtns button[data-k="1"]')
        self.assertEqual(pg.locator('#stealBtns button').count(), 4)              # three names and Nobody
        pg.click('#stealBtns button[data-k="1"]'); self.pick(True)
        pg.wait_for_selector('#nextBtn:not([hidden])')
        self.assertEqual(pg.evaluate("[...document.querySelectorAll('#rStage .rs-car')].map(c => c.style.getPropertyValue('--f'))"), ['0', '1', '0'])
        self.play_round(True); pg.click('#backBtn')
        self.spin(7); pg.click('#goBtn'); pg.click('#round')                       # the manor: Amelia answers first
        pg.wait_for_selector('#opts.opts-live'); self.pick(False)
        pg.wait_for_selector('#nextBtn:not([hidden])')
        self.assertEqual(pg.locator('#rStage .rs-candle.out').count(), 1)
        self.assertIn('candle went out', pg.inner_text('#rmsg'))
        pg2 = self.page
        pg2.evaluate('localStorage.clear()'); pg2.reload(); pg2.wait_for_selector('#beginBtn'); pg2.evaluate('window.__noConfirm = true')
        self.setup('solo', style='worlds')
        self.spin(1); pg2.click('#goBtn'); pg2.click('#round')                      # the submarine: one creak, then a flood
        pg2.wait_for_selector('#opts.opts-live'); self.pick(True); pg2.click('#nextBtn')
        pg2.wait_for_selector('#opts .opt.choice'); pg2.locator('#opts .opt').first.click()   # dive deeper
        pg2.wait_for_selector('#opts.opts-live'); self.pick(False)
        pg2.wait_for_selector('#nextBtn:not([hidden])')
        self.assertIn('hull creaks', pg2.inner_text('#rmsg'))
        self.assertIn('Hull creaking', pg2.inner_text('#rStage'))
        pg2.click('#nextBtn'); pg2.wait_for_selector('#opts .opt.choice')
        pg2.locator('#opts .opt').nth(1).click()                                     # surface with 8
        pg2.wait_for_selector('#roundEnd:not([hidden])')
        self.assertEqual(self.S('S.players[0].pts'), 8)

    def test_the_next_question_can_come_by_itself(self):
        pg = self.open()
        self.setup('solo', auto='auto')
        self.spin(); self.go()
        self.pick(True)
        pg.wait_for_selector('#nextBtn.auto')
        pg.wait_for_function("__tl.R.phase === 'ask' && document.getElementById('qCount').textContent === 'Question 2 of 3'", timeout=6000)
        self.pick(False)
        pg.wait_for_selector('#nextBtn.auto')
        started = pg.evaluate('performance.now()')
        pg.wait_for_function("document.getElementById('qCount').textContent === 'Question 3 of 3'", timeout=8000)
        self.assertGreater(pg.evaluate('performance.now()') - started, 3500)      # a miss leaves longer to read the answer

    def test_each_world_has_its_own_sound_which_stops_on_the_way_out(self):
        pg = self.open()
        self.setup('solo')
        self.spin(4); self.go()
        self.assertTrue(pg.evaluate('!!__tl.amb'))
        for _ in range(3):
            self.question(True)
        pg.click('#backBtn')
        self.assertFalse(pg.evaluate('!!__tl.amb'))
        self.assertEqual(sorted(pg.evaluate('TL_SOUND.ids')), sorted(pg.evaluate('__tl.D.map(d => d.id)')))

    def test_with_motion_there_is_an_opening_a_first_visit_and_a_finale(self):
        pg = self.open(motion='no-preference')
        self.setup('solo')
        pg.wait_for_selector('#cut')
        self.assertIn('Spin the dial to begin', pg.inner_text('#cut'))
        pg.keyboard.press('Escape')
        pg.wait_for_selector('#cut', state='detached')
        self.S('S.spin = S.spins - 1')
        pg.evaluate('__tl.force(8)'); pg.click('#spinBtn')
        pg.wait_for_selector('#landBox:not([hidden])', timeout=10000); pg.click('#goBtn')
        self.assertTrue(pg.evaluate("document.getElementById('round').classList.contains('first')"))
        self.assertIn('show is about to begin', pg.inner_text('#rTale'))
        self.assertEqual(self.S('S.seen'), ['bigtop'])
        pg.click('#round')
        for _ in range(3):
            pg.wait_for_selector('#opts.opts-live'); self.pick(True); pg.click('#nextBtn')
        pg.wait_for_selector('#roundEnd:not([hidden])'); pg.click('#backBtn')
        pg.wait_for_selector('#finale')
        self.assertIn('points', pg.inner_text('#finale h2'))
        self.assertEqual(pg.locator('#finale .fl.lit').count(), 1)
        pg.click('#finale')
        pg.wait_for_selector('#finale', state='detached')
        self.assertTrue(pg.locator('#end').is_visible())

    def test_fits_a_phone_and_a_television_without_sideways_scroll(self):
        for w, h in ((320, 640), (1920, 1080)):
            pg = self.open(w, h)
            for mode in ('versus', 'team', 'solo', 'daily', 'coop'):
                pg.click('#mode button[data-v="%s"]' % mode)
                self.assertLessEqual(pg.evaluate('document.documentElement.scrollWidth'), w, mode)
            self.setup('versus', ('Bartholomew', 'Wilhelmina', 'Maximilian'))
            self.assertLessEqual(pg.evaluate('document.documentElement.scrollWidth'), w)
            self.spin(); self.assertLessEqual(pg.evaluate('document.documentElement.scrollWidth'), w)
            self.go(); self.pick(False)
            self.assertLessEqual(pg.evaluate('document.documentElement.scrollWidth'), w)
            self.ctx.close()
            self.assertEqual(self.errors, [])
        self.ctx = self.browser.new_context()
