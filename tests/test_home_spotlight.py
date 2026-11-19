"""The flagship spotlight on the home page: seven games, one at a time, every game one tap away."""
import functools
import http.server
import os
import re
import socketserver
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / 'index.html'
FLAGSHIPS = ['ten-lanterns.html', 'lxx.html', 'ruffled-feathers.html', 'full-circuit.html', 'show-gen.html', 'throne.html', 'creak.html']
NAMES = ['Ten Lanterns', 'LXX', 'Ruffled Feathers', 'Full Circuit', 'The Big Quiz', 'Hold The Throne', 'Creak &amp; Coil']


def home():
    return HOME.read_text(encoding='utf-8')


def spotlight():
    html = home()
    i = html.index('<div class="spot" id="spot"')
    return html[i:html.index('</section>', i)]


class SpotlightPageTests(unittest.TestCase):
    def test_seven_flagships_in_order_each_with_a_tab(self):
        spot = spotlight()
        self.assertEqual(re.findall(r'<a class="sp-link" href="([^"]+)"', spot), FLAGSHIPS)
        self.assertEqual(re.findall(r'<h3>(.*?)</h3>', spot), NAMES)
        self.assertEqual(re.findall(r'aria-controls="(sp-\d)"', spot)[:7], ['sp-%d' % i for i in range(1, 8)])
        self.assertEqual(len(re.findall(r'<button class="st"', spot)), 7)
        self.assertEqual(spot.count('aria-current="true"'), 1)
        self.assertEqual(spot.count('aria-roledescription="slide"'), 7)
        for href in FLAGSHIPS:
            self.assertTrue((ROOT / href).is_file(), href)

    def test_every_flagship_is_still_in_the_catalogue_exactly_once(self):
        html = home()
        self.assertNotIn('data-title', spotlight())
        for href in FLAGSHIPS:
            self.assertEqual(len(re.findall(r'<a class="tc" href="%s" data-cat="[^"]+" data-title=' % re.escape(href), html)), 1, href)
        self.assertNotIn('class="fc ', html)

    def test_pictures_have_words_and_exist(self):
        spot = spotlight()
        for alt in re.findall(r'<div class="sp-media">.*?<img src="[^"]+" alt="([^"]*)"', spot, re.S):
            self.assertGreater(len(alt), 20)
        for src in re.findall(r'<img src="([^"]+)"', spot):
            if not src.startswith('data:'):
                self.assertTrue((ROOT / src).is_file(), src)
        self.assertEqual(len(re.findall(r'loading="lazy"', spot)), 6 + 7)

    def test_house_style(self):
        spot = spotlight()
        self.assertNotIn('—', spot)
        text = re.sub(r'<[^>]+>', ' ', re.sub(r'<svg.*?</svg>', '', spot, flags=re.S))
        for word in ('crystal', 'dome', 'vortex', 'wedge'):
            self.assertNotIn(word, text.lower())


try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, 'Playwright is not installed')
class SpotlightBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(_Quiet, directory=str(ROOT))
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), handler)
        cls.base = 'http://127.0.0.1:%d/index.html' % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        exe = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        cls.browser = cls.pw.chromium.launch(**({'executable_path': exe} if exe else {}))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def open(self, width=1440, height=900, motion='no-preference', ms=None):
        self.ctx = self.browser.new_context(viewport={'width': width, 'height': height}, reduced_motion=motion)
        self.ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1:') else r.abort())
        pg = self.ctx.new_page()
        self.errors = []
        pg.on('pageerror', lambda e: self.errors.append(str(e)))
        if ms:
            pg.add_init_script('window.__spotMs = %d' % ms)
        pg.goto(self.base)
        pg.wait_for_function('window.__spot')
        return pg

    def tearDown(self):
        self.assertEqual(self.errors, [])
        self.ctx.close()

    def bring_into_view(self, pg):
        pg.evaluate("document.getElementById('spotTrack').scrollIntoView({block: 'center'})")

    def test_moves_on_by_itself_only_when_seen_and_nobody_is_using_it(self):
        pg = self.open(ms=700)
        pg.wait_for_timeout(1600)
        self.assertEqual(pg.evaluate('__spot.cur'), 0, 'it should wait until it is on screen')
        self.bring_into_view(pg)
        pg.wait_for_function('__spot.cur === 1', timeout=4000)
        self.assertEqual(pg.get_attribute('#spotTabs .st:nth-child(2)', 'aria-current'), 'true')
        self.assertIsNone(pg.get_attribute('#sp-2 a', 'tabindex'))
        self.assertEqual(pg.get_attribute('#sp-1 a', 'tabindex'), '-1')
        # hovering holds it still
        pg.hover('#spotTrack')
        at = pg.evaluate('__spot.cur'); pg.wait_for_timeout(1600)
        self.assertEqual(pg.evaluate('__spot.cur'), at)
        pg.mouse.move(5, 5)
        pg.wait_for_function('c => __spot.cur !== c', arg=at, timeout=4000)
        # it goes round: after the last game comes the first
        pg.evaluate('__spot.go(6)')
        pg.wait_for_function('__spot.cur === 0', timeout=4000)

    def test_choosing_a_game_shows_it_and_stops_the_movement(self):
        pg = self.open(ms=700)
        self.bring_into_view(pg)
        pg.click('#spotTabs .st:nth-child(3)')
        pg.wait_for_function("Math.abs(document.getElementById('spotTrack').scrollLeft - 2 * document.getElementById('spotTrack').clientWidth) < 2")
        self.assertEqual(pg.evaluate('__spot.cur'), 2)
        self.assertTrue(pg.evaluate('__spot.stopped'))
        self.assertEqual(pg.inner_text('#spotPause'), 'Resume')
        pg.mouse.move(5, 5); pg.wait_for_timeout(1600)
        self.assertEqual(pg.evaluate('__spot.cur'), 2)
        box = pg.locator('#sp-3').bounding_box()
        self.assertGreaterEqual(box['x'], 170); self.assertLess(box['x'], 200)
        self.assertEqual(pg.get_attribute('#sp-3 a', 'href'), 'ruffled-feathers.html')
        # arrows and the keyboard
        pg.click('#spotNext'); pg.wait_for_function('__spot.cur === 3')
        pg.click('#spotPrev'); pg.click('#spotPrev'); pg.wait_for_function('__spot.cur === 1')
        pg.focus('#sp-2 a'); pg.keyboard.press('ArrowRight'); pg.wait_for_function('__spot.cur === 2')
        self.assertEqual(pg.evaluate('document.activeElement.getAttribute("href")'), 'ruffled-feathers.html')
        # Resume starts it again
        pg.click('#spotPause'); self.assertEqual(pg.inner_text('#spotPause'), 'Pause')
        pg.mouse.move(5, 5)
        pg.wait_for_function('__spot.cur === 3', timeout=4000)

    def test_holds_still_for_people_who_ask_for_less_motion(self):
        pg = self.open(motion='reduce', ms=500)
        self.bring_into_view(pg)
        pg.wait_for_timeout(1500)
        self.assertEqual(pg.evaluate('__spot.cur'), 0)
        self.assertTrue(pg.locator('#spotPause').is_hidden())
        pg.click('#spotTabs .st:nth-child(5)')
        self.assertEqual(pg.evaluate("Math.round(document.getElementById('spotTrack').scrollLeft / document.getElementById('spotTrack').clientWidth)"), 4)

    def test_searching_hides_the_spotlight_and_finds_the_games(self):
        pg = self.open()
        self.assertEqual(pg.inner_text('#count'), '72 games')
        pg.fill('#q', 'ten lanterns')
        self.assertTrue(pg.locator('#start').is_hidden())
        self.assertEqual(pg.inner_text('#count'), '1 game')
        self.assertTrue(pg.locator('a.tc[href="ten-lanterns.html"]').is_visible())
        pg.fill('#q', 'hold the throne')
        self.assertTrue(pg.locator('a.tc[href="throne.html"]').is_visible())
        pg.fill('#q', '')
        self.assertTrue(pg.locator('#start').is_visible())
        pg.click('.pill[data-f="multiplayer"]')
        self.assertTrue(pg.locator('#start').is_hidden())
        pg.click('.pill[data-f="all"]')
        self.assertTrue(pg.locator('#start').is_visible())

    def test_layout_at_desktop_tablet_and_phone(self):
        for w, h in ((1440, 900), (820, 1180), (390, 844), (320, 640)):
            with self.subTest(width=w):
                pg = self.open(w, h, motion='reduce')
                self.assertLessEqual(pg.evaluate('document.documentElement.scrollWidth'), w)
                slide = pg.locator('#sp-1').bounding_box(); track = pg.locator('#spotTrack').bounding_box()
                self.assertAlmostEqual(slide['width'], track['width'], delta=1)
                tab = pg.locator('#spotTabs .st').first.bounding_box()
                self.assertGreaterEqual(tab['height'], 24)
                thumbs = pg.locator('#spotTabs .st img').first.is_visible()
                self.assertEqual(thumbs, w > 860, 'thumbnails on wide screens, dots on narrow ones')
                self.assertEqual(pg.locator('#spotNext').is_visible(), w > 560)
                if w > 860:
                    # the arrow never sits on the words
                    arrow = pg.locator('#spotNext').bounding_box(); words = pg.locator('#sp-1 .sp-body p').bounding_box()
                    self.assertGreater(arrow['x'], words['x'] + words['width'])
                self.assertEqual(self.errors, [])
                self.ctx.close()
                self.ctx = self.browser.new_context()

    def test_a_swipe_follows_the_track(self):
        pg = self.open(390, 844)
        self.bring_into_view(pg)
        pg.dispatch_event('#spotTrack', 'touchstart')
        pg.evaluate("const t = document.getElementById('spotTrack'); t.scrollTo({left: t.clientWidth * 4})")
        pg.wait_for_function('__spot.cur === 4')
        self.assertTrue(pg.evaluate('__spot.stopped'))
        self.assertEqual(pg.get_attribute('#spotTabs .st:nth-child(5)', 'aria-current'), 'true')


if __name__ == '__main__':
    unittest.main()
