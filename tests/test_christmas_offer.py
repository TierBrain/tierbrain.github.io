"""The Christmas offer on the home page: honest UK price, safe links, and it switches itself off after Christmas."""
import functools
import http.server
import os
import re
import socketserver
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = ROOT / 'index.html'


def home():
    return HOME.read_text(encoding='utf-8')


def visible(html):
    return re.sub(r'<!--.*?-->', '', html, flags=re.S)


class ChristmasOfferPage(unittest.TestCase):
    def test_offer_shows_the_price_uk_buyers_pay(self):
        html = visible(home())
        offer = re.search(r'<a class="hero-new xm-offer" id="xmasOffer"[^>]*>(.*?)</a>', html, re.S)
        self.assertIsNotNone(offer)
        text = re.sub(r'<[^>]+>', ' ', offer.group(1))
        self.assertIn('Hosting a quiz night?', text)
        self.assertIn('60 questions', text)
        self.assertIn('£7.19 on Etsy', text)
        self.assertNotIn('£5.99', html)

    def test_offer_links_go_to_etsy_safely(self):
        html = home()
        for anchor in (r'<a class="hero-new xm-offer" id="xmasOffer"[^>]*>', r'<p class="xm-more" id="xmasMore">[^<]*<a [^>]*>'):
            tag = re.search(anchor, html).group(0)
            self.assertRegex(tag, r'href="https://www\.etsy\.com/uk/(shop/TierBrain|listing/\d+[^"]*)"')
            self.assertIn('target="_blank"', tag)
            self.assertIn('rel="noopener"', tag)

    def test_each_link_goes_to_its_own_listing(self):
        html = home()
        self.assertIn('id="xmasOffer" href="https://www.etsy.com/uk/listing/4607374205/christmas-quiz-powerpoint-and-printable"', html)
        self.assertIn('Hosting at church? <a href="https://www.etsy.com/uk/listing/4607401238/christmas-bible-quiz-powerpoint-and"', html)
        self.assertNotIn('logging_key', html)

    def test_offer_sits_above_the_quiz_maker_banner(self):
        html = home()
        self.assertLess(html.index('id="xmasOffer"'), html.index('<a class="hero-new" href="quiz-maker.html">'))
        self.assertIn('Date.UTC(2026,11,26)', html)


try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, 'Playwright is not installed')
class ChristmasOfferBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(_Quiet, directory=str(ROOT)))
        cls.url = 'http://127.0.0.1:%d/index.html' % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        exe = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        cls.browser = cls.pw.chromium.launch(**({'executable_path': exe} if exe else {}))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def page_on(self, y, m, d, width=390):
        ctx = self.browser.new_context(viewport={'width': width, 'height': 844})
        ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1:') else r.abort())
        ctx.add_init_script('(() => { const t = Date.UTC(%d, %d, %d, 12); Date.now = () => t; })();' % (y, m - 1, d))
        self.addCleanup(ctx.close)
        page = ctx.new_page(); page.goto(self.url); page.wait_for_selector('.hero')
        return page

    def test_shows_in_november_and_december(self):
        for day in ((2026, 11, 8), (2026, 12, 25)):
            page = self.page_on(*day)
            self.assertTrue(page.is_visible('#xmasOffer'), day)
            self.assertTrue(page.is_visible('#xmasMore'), day)
            self.assertTrue(page.is_visible('a.hero-new[href="quiz-maker.html"]'))

    def test_hides_itself_from_boxing_day_but_keeps_the_quiz_maker(self):
        page = self.page_on(2026, 12, 26)
        self.assertFalse(page.is_visible('#xmasOffer'))
        self.assertFalse(page.is_visible('#xmasMore'))
        self.assertTrue(page.is_visible('a.hero-new[href="quiz-maker.html"]'))

    def test_fits_a_phone_screen(self):
        page = self.page_on(2026, 11, 8)
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)


if __name__ == '__main__':
    unittest.main()
