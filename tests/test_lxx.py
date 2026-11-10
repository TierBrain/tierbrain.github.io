"""LXX, the seventieth game: a Roman campaign for one player, rivals or teams on one screen."""
import functools
import http.server
import os
import random
import re
import socketserver
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'lxx.html'


def page_text():
    return PAGE.read_text(encoding='utf-8')


class LxxPageTests(unittest.TestCase):
    def test_page_is_published_and_listed_as_a_game(self):
        html = page_text()
        self.assertIn('<link rel="canonical" href="https://tierbrain.co/lxx.html">', html)
        self.assertIn('<title>LXX | Free Roman quiz game | TierBrain</title>', html)
        self.assertIn('<loc>https://tierbrain.co/lxx.html</loc>', (ROOT / 'sitemap.xml').read_text(encoding='utf-8'))
        home = (ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertEqual(home.count('<a class="tc" href="lxx.html" data-cat="game multiplayer" data-title="LXX"'), 1)
        self.assertNotIn('noindex', html.lower())
        self.assertNotIn('PROTOTYPE', html)
        self.assertNotIn('TierBrain prototype', html)

    def test_it_is_the_seventieth_game(self):
        home = (ROOT / 'index.html').read_text(encoding='utf-8')
        cards = re.findall(r'<a\b[^>]*\bdata-title="', home)
        self.assertGreaterEqual(len(cards), 70)
        self.assertRegex(home, r'id="count"[^>]*>\d+ games<')

    def test_uses_the_shared_question_bank_and_its_own_files(self):
        html = page_text()
        self.assertRegex(html, r'<script src="questions\.js\?v=\d+"></script>')
        for name in ('lxx-bank.js', 'lxx-scenes.js', 'tb-shell.js'):
            self.assertIn('<script src="' + name, html)
            self.assertTrue((ROOT / name).is_file(), name)
        self.assertIn("TB.bank('gk')", html)

    def test_uses_the_site_sound_switch(self):
        html = page_text()
        self.assertIn('window.tbSetMuted', html)
        self.assertNotIn('tb-lxx-sound', html)

    def test_no_backend_and_nothing_sent(self):
        text = page_text() + (ROOT / 'lxx-scenes.js').read_text(encoding='utf-8') + (ROOT / 'lxx-bank.js').read_text(encoding='utf-8')
        for marker in ('fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'supabase', 'document.cookie'):
            self.assertNotIn(marker, text, marker)

    def test_sentences_never_put_a_verb_after_a_name(self):
        # "You reaches Rome": a name may be You, Livia or The Lions, so no verb may have to agree with it.
        script = page_text()
        self.assertEqual(re.findall(r"\.name \+ ' (?:reaches|marches|yields|brings|carries|carry|is|wins|holds)\b", script), [])
        self.assertIn("endLevel('Rome is reached'", script)

    def test_roman_set_is_well_formed(self):
        bank = (ROOT / 'lxx-bank.js').read_text(encoding='utf-8')
        rows = re.findall(r"^\s+\[(.+)\],?$", bank, re.M)
        self.assertGreater(len(rows), 60)
        self.assertNotIn('—', bank)


try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

ANSWER = """q => { for (const k of ['via','arena','wall','life']) for (const x of BANK[k]) if (x[0] === q) return ['roman', x[1]];
  for (const t in TB_BANK.gk) for (const x of TB_BANK.gk[t]) if (x.q === q) return ['shared', x.correct]; return null; }"""
NUMERALS = """digits => [...document.querySelectorAll('[data-n]')].filter(el => { const want = digits !== el.hasAttribute('data-alt'), t = el.textContent.trim();
  return want ? !/^\\d+$/.test(t) : !/^[IVXLCDMN]+$/.test(t); }).map(el => el.textContent + ' for ' + el.dataset.n)"""


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, 'Playwright is not installed')
class LxxBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(_Quiet, directory=str(ROOT))
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), handler)
        cls.base = 'http://127.0.0.1:%d/lxx.html' % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        exe = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        cls.browser = cls.pw.chromium.launch(**({'executable_path': exe} if exe else {}))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def open(self, width=390, height=844, motion='no-preference'):
        self.ctx = self.browser.new_context(viewport={'width': width, 'height': height}, reduced_motion=motion)
        self.outside = []
        def route(r):
            if r.request.url.startswith('http://127.0.0.1:'):
                return r.continue_()
            self.outside.append(r.request.url); return r.abort()
        self.ctx.route('**/*', route)
        self.page = self.ctx.new_page()
        self.errors = []
        self.missing = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('response', lambda r: self.missing.append(r.url) if r.status >= 400 else None)
        self.page.goto(self.base)
        self.page.wait_for_selector('#beginBtn')
        return self.page

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [])
        self.assertEqual(self.missing, [])
        self.assertEqual([u for u in self.outside if 'fonts.g' not in u], [])

    def skip_scene(self):
        pg = self.page
        pg.wait_for_timeout(150)
        had = pg.locator('.sting').count() > 0
        if had:
            pg.locator('.sting').click(position={'x': 20, 'y': 120})
            pg.wait_for_selector('.sting', state='detached', timeout=3000)
        return had

    def answer(self, accuracy):
        pg = self.page
        question = pg.text_content('#qBox .q')
        found = pg.evaluate(ANSWER, question)
        self.assertIsNotNone(found, question)
        options = pg.locator('#qBox .opt').all()
        texts = [o.get_attribute('data-o') for o in options]
        self.assertEqual(len(set(texts)), 4, question)
        self.assertIn(found[1], texts, question)
        pick = options[texts.index(found[1])] if random.random() < accuracy else options[random.randrange(4)]
        pick.click()
        return found[0]

    def play_level(self, sides, accuracy, digits=None):
        pg = self.page; kinds = set(); steps = 0
        while pg.is_visible('#vLevel') and steps < 110:
            steps += 1
            pg.wait_for_selector('#qBox .opt:not(:disabled), #qBox .thumb:not(:disabled)', timeout=6000)
            if digits is not None: self.assertEqual(pg.evaluate(NUMERALS, digits), [])
            if pg.locator('#qBox .opt').count(): kinds.add(self.answer(accuracy))
            elif pg.locator('#qBox .bigvote').count():
                kinds.add('claim-shared' if pg.locator('#qBox .says').count() else 'claim-roman')
                pg.locator('#qBox .thumb').nth(random.randrange(2)).click()
            else:
                self.assertEqual(pg.locator('#qBox .vrow').count(), sides)
                for k in range(sides): pg.locator('#qBox .thumb[data-k="%d"]' % k).nth(random.randrange(2)).click()
            pg.wait_for_selector('#nextBar:not([hidden])', timeout=4000)
            self.assertEqual(pg.locator('#contBtn').count(), 0)
            pg.click('#nextBar'); pg.wait_for_timeout(50)
            self.skip_scene()
        self.assertTrue(pg.is_visible('#vLevelEnd'))
        return kinds

    def campaign(self, sides=1, accuracy=.75, digits=None):
        pg = self.page; kinds = set()
        pg.click('#beginBtn'); self.skip_scene()
        for level in range(4):
            self.assertTrue(pg.is_visible('#vMap'))
            pg.click('#enterBtn'); self.skip_scene()
            kinds |= self.play_level(sides, accuracy, digits)
            pg.click('#leNext')
        self.skip_scene()
        self.assertTrue(pg.is_visible('#vTriumph'))
        return kinds

    def test_solo_campaign_runs_to_the_triumph_on_both_question_sets(self):
        pg = self.open()
        kinds = self.campaign(digits=False)
        self.assertTrue({'roman', 'shared', 'claim-roman', 'claim-shared'} <= kinds, kinds)
        pg.wait_for_timeout(2200)
        self.assertRegex(pg.text_content('#trGlory'), r'^[IVXLCDMN]+$')
        self.assertIn(pg.text_content('#trRank'), ('Emperor', 'Consul', 'Senator', 'Tribune', 'Centurion', 'Legionary'))
        self.assertLessEqual(pg.evaluate('document.documentElement.scrollWidth'), 390)

    def test_eight_rivals_finish_a_campaign(self):
        pg = self.open(1280, 720)
        pg.click('#mRivals')
        for _ in range(6): pg.click('#addTeam')
        self.assertEqual(pg.locator('#teamList input').count(), 8)
        self.assertTrue(pg.is_disabled('#addTeam'))
        pg.click('#cOff'); pg.uncheck('#cutsToggle')
        self.campaign(sides=8, accuracy=.6)
        self.assertEqual(pg.locator('#trBoard .brow').count(), 8)

    def test_teams_stop_at_four_and_rivals_at_eight(self):
        pg = self.open()
        pg.click('#mTeams')
        for _ in range(2): pg.click('#addTeam')
        self.assertEqual(pg.locator('#teamList input').count(), 4)
        self.assertTrue(pg.is_disabled('#addTeam'))
        pg.click('#mSolo')
        self.assertTrue(pg.is_hidden('#teamBox'))

    def test_first_level_title_reads_correctly_for_an_unnamed_player(self):
        pg = self.open()
        pg.uncheck('#cutsToggle'); pg.click('#beginBtn'); self.skip_scene(); pg.click('#enterBtn'); self.skip_scene()
        self.play_level(1, 1.0)
        self.assertEqual(pg.text_content('#leTitle'), 'Rome is reached')
        self.assertIn('You beat Marcus to the gates.', pg.text_content('#leLine'))
        self.assertNotIn('You reaches', pg.inner_text('body'))

    def test_every_question_has_a_clock_unless_relaxed(self):
        pg = self.open()
        pg.click('#beginBtn'); self.skip_scene(); pg.click('#enterBtn'); self.skip_scene()
        pg.wait_for_selector('#qBox .opt')
        self.assertEqual(pg.locator('#clock').count(), 1)
        self.assertEqual(pg.text_content('#clockN'), '20')
        self.ctx.close()
        pg = self.open()
        pg.click('#cOff'); pg.click('#beginBtn'); self.skip_scene(); pg.click('#enterBtn'); self.skip_scene()
        pg.wait_for_selector('#qBox .opt')
        self.assertEqual(pg.locator('#clock').count(), 0)

    def test_moves_on_by_itself_after_an_answer(self):
        pg = self.open()
        pg.click('#beginBtn'); self.skip_scene(); pg.click('#enterBtn'); self.skip_scene()
        pg.wait_for_selector('#qBox .opt:not(:disabled)')
        first = pg.text_content('#qBox .q')
        self.answer(1.0)
        pg.wait_for_function('q => document.querySelector("#qBox .q").textContent !== q', arg=first, timeout=7000)
        self.assertEqual(pg.locator('#qBox .opt:disabled').count(), 0)

    def test_numeral_switch_changes_every_number_and_is_remembered(self):
        pg = self.open()
        self.assertEqual(pg.get_attribute('#numBtn', 'aria-checked'), 'false')
        pg.click('#beginBtn'); self.skip_scene(); pg.click('#enterBtn'); self.skip_scene()
        pg.wait_for_selector('#qBox .opt')
        self.assertEqual(pg.evaluate(NUMERALS, False), [])
        self.assertEqual(pg.locator('#qBox .opt .L').first.text_content(), 'I')
        pg.click('#numBtn')
        self.assertEqual(pg.evaluate(NUMERALS, True), [])
        self.assertEqual(pg.locator('#qBox .opt .L').first.text_content(), '1')
        self.assertIn('MARCUS 0 MILES', pg.text_content('#lvProg'))
        pg.reload(); pg.wait_for_selector('#beginBtn')
        self.assertEqual(pg.get_attribute('#numBtn', 'aria-checked'), 'true')

    def test_cutscenes_play_skip_and_can_be_turned_off(self):
        pg = self.open()
        pg.click('#beginBtn'); pg.wait_for_selector('.sting.cine canvas.cinecv')
        self.assertTrue(self.skip_scene())
        pg.click('#quitBtn'); pg.uncheck('#cutsToggle'); pg.click('#beginBtn'); pg.wait_for_selector('.sting')
        self.assertEqual(pg.locator('.sting canvas').count(), 0)
        self.skip_scene()
        self.ctx.close()
        pg = self.open(motion='reduce')
        pg.click('#beginBtn'); pg.wait_for_timeout(200)
        self.assertEqual(pg.locator('.sting').count(), 0)
        self.assertTrue(pg.is_visible('#vMap'))

    def test_every_cutscene_draws_without_error(self):
        pg = self.open()
        drawn = pg.evaluate("""() => LXXScenes.kinds.map(k => { const c = document.createElement('canvas'); c.width = 320; c.height = 180;
          for (const f of [0, .3, .6, .99]) LXXScenes.frame(k, c, LXXScenes.length(k) * f, { colour:'#2d5885' });
          const d = c.getContext('2d').getImageData(0, 0, 320, 180).data; let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) lit++; return [k, lit > 50000]; })""")
        self.assertEqual(sorted(k for k, ok in drawn if ok), ['arena', 'defeat', 'opening', 'senate', 'triumph', 'via', 'victory', 'wall'])

    def test_sound_button_uses_the_site_wide_switch(self):
        pg = self.open()
        self.assertEqual(pg.get_attribute('#soundBtn', 'aria-pressed'), 'true')
        pg.click('#soundBtn')
        self.assertEqual(pg.evaluate("localStorage.getItem('tb_muted')"), '1')
        pg.reload(); pg.wait_for_selector('#beginBtn')
        self.assertEqual(pg.get_attribute('#soundBtn', 'aria-pressed'), 'false')

    def test_fits_small_phones_and_shows_the_site_footer(self):
        for width in (320, 390):
            pg = self.open(width)
            pg.click('#mRivals')
            self.assertLessEqual(pg.evaluate('document.documentElement.scrollWidth'), width + 1, width)
            pg.wait_for_selector('#tb-shell')
            self.ctx.close()
        self.open()


if __name__ == '__main__':
    unittest.main()
