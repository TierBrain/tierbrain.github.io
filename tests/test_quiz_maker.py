"""Quiz Maker: free, plays on screen only, keeps what is typed on the device, and clears it."""
import functools
import http.server
import json
import os
import re
import socketserver
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'quiz-maker.html'
ETSY = 'https://www.etsy.com/uk/shop/TierBrain'
LISTING = 'https://www.etsy.com/uk/listing/4609352388/personalised-quiz-custom-birthday-quiz'
OFFICE = 'https://www.etsy.com/uk/listing/4609363760/custom-office-christmas-party-quiz-with'
KEY = 'tb-quiz-maker-v1'
NOKEEP = 'tb-quiz-maker-nokeep'


def page_text():
    return PAGE.read_text(encoding='utf-8')


def inline_scripts(html):
    return [m.group(2) for m in re.finditer(r'<script(\s[^>]*)?>(.*?)</script>', html, re.S) if m.group(2).strip()]


class QuizMakerPageTests(unittest.TestCase):
    def test_page_is_published_and_linked(self):
        html = page_text()
        self.assertIn('<link rel="canonical" href="https://tierbrain.co/quiz-maker.html">', html)
        self.assertIn('<loc>https://tierbrain.co/quiz-maker.html</loc>', (ROOT / 'sitemap.xml').read_text(encoding='utf-8'))
        home = (ROOT / 'index.html').read_text(encoding='utf-8')
        self.assertIn('<a class="hero-new" href="quiz-maker.html"><span class="hn-text"><span class="hn-top"><b>New</b>Quiz Maker</span>', home)
        self.assertIn('<span class="hn-sub">A quiz all about them, for birthdays, leaving dos and family Christmas</span>', home)
        self.assertIn('<a class="tn-chip" href="quiz-maker.html">', (ROOT / 'index.html').read_text(encoding='utf-8'))
        self.assertNotIn('noindex', html.lower())
        self.assertNotIn('Prototype', html)

    def test_free_version_has_no_file_export_or_logo_upload(self):
        html = page_text()
        for marker in ('id="occ-canvas"', 'dlPrint', 'dlSlides', 'makePdf', 'application/pdf', 'toBlob', 'downloads', 'type="file"', 'logoIn', 'takeLogo'):
            self.assertNotIn(marker, html, marker)

    def test_page_script_never_sends_what_is_typed(self):
        code = '\n'.join(inline_scripts(page_text()))
        for call in ('fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'navigator.share', 'supabase', 'postMessage'):
            self.assertNotIn(call, code, call)

    def test_storage_is_dated_and_cleared(self):
        code = '\n'.join(inline_scripts(page_text()))
        self.assertIn(f"KEY = '{KEY}'", code)
        self.assertIn('KEEP_DAYS = 7', code)
        self.assertRegex(code, r'if \(isExample \|\| noKeep\(\)\) \{ forget\(\); return; \}')
        self.assertIn('savedAt:Date.now()', code)

    def test_privacy_controls_and_promise_are_on_the_page(self):
        html = page_text()
        self.assertIn('id="deleteBtn"', html)
        self.assertIn('id="endDeleteBtn"', html)
        self.assertIn('id="noKeep"', html)
        self.assertIn('TierBrain never sees what you type.', html)
        self.assertIn('href="privacy.html#quiz-maker"', html)
        self.assertNotIn('never saved or stored', html)

    def test_privacy_and_terms_describe_it(self):
        privacy = (ROOT / 'privacy.html').read_text(encoding='utf-8')
        terms = (ROOT / 'terms.html').read_text(encoding='utf-8')
        self.assertIn('<h2 id="quiz-maker">Quiz Maker</h2>', privacy)
        self.assertIn('cleared automatically after 7 days', privacy)
        self.assertIn('Nothing is sent unless you paste and send it yourself', privacy)
        self.assertIn('<h2 id="quiz-maker">Quiz Maker</h2>', terms)
        self.assertIn('keep them kind', terms)

    def test_made_for_you_links_open_safely(self):
        html = page_text()
        for url in (LISTING, OFFICE):
            links = re.findall(r'<a [^>]*href="' + re.escape(url) + r'"[^>]*>', html)
            self.assertEqual(len(links), 2, url)
            for link in links:
                self.assertIn('target="_blank"', link)
                self.assertIn('rel="noopener"', link)

    def test_order_button_shows_the_price_uk_buyers_pay(self):
        # Etsy adds 20% VAT for UK buyers: £12.99 shows as £15.59 and £19.99 as £23.99. Change both if an Etsy price changes.
        buttons = re.findall(r'<a class="btn go" href="' + re.escape(LISTING) + r'"[^>]*>([^<]*)</a>', page_text())
        self.assertEqual(buttons, ['Order yours: £15.59'] * 2)
        office = re.findall(r'<a href="' + re.escape(OFFICE) + r'"[^>]*>([^<]*)</a>', page_text())
        self.assertEqual(office, ['See the office quiz: £23.99'] * 2)


try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, 'Playwright is not installed')
class QuizMakerBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(_Quiet, directory=str(ROOT))
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), handler)
        cls.base = 'http://127.0.0.1:%d/quiz-maker.html' % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        exe = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        cls.browser = cls.pw.chromium.launch(**({'executable_path': exe} if exe else {}))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def setUp(self):
        self.ctx = self.browser.new_context(viewport={'width': 390, 'height': 844})
        self.outside = []
        def route(r):
            if r.request.url.startswith('http://127.0.0.1:'):
                return r.continue_()
            self.outside.append(r.request.url); return r.abort()
        self.ctx.route('**/*', route)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))

    def tearDown(self):
        self.ctx.close()

    def open(self, seed=None):
        if seed is not None:
            self.page.add_init_script('localStorage.setItem(%s, %s);' % (json.dumps(KEY), json.dumps(json.dumps(seed))))
        self.page.goto(self.base)
        self.page.wait_for_selector('#f-n')

    def stored(self):
        raw = self.page.evaluate('k => localStorage.getItem(k)', KEY)
        return json.loads(raw) if raw else None

    def type_name(self, name):
        self.page.click('#clearBtn'); self.page.fill('#f-n', name); self.page.fill('#f-born', 'Swansea')

    def test_example_is_not_stored_and_typing_is_stored_on_the_device_only(self):
        self.open()
        self.assertIsNone(self.stored())
        self.type_name('Zebedee')
        data = self.stored()
        self.assertEqual(data['v']['n'], 'Zebedee')
        self.assertIsInstance(data['savedAt'], (int, float))
        self.assertFalse(any('Zebedee' in u for u in self.outside), self.outside)
        self.assertEqual(self.errors, [])

    def test_make_and_play_on_screen(self):
        self.open()
        self.page.click('#makeBtn')
        self.assertTrue(self.page.is_visible('#reviewView'))
        self.assertGreater(self.page.locator('#qlist li').count(), 10)
        self.page.click('#playBtn'); self.assertTrue(self.page.is_visible('#playView'))
        self.page.click('#nextBtn'); self.assertIn('revealed', self.page.get_attribute('#qcard', 'class'))
        self.assertFalse(self.page.locator('#tb-shell').is_visible())
        self.assertEqual(self.errors, [])

    def test_delete_needs_two_taps_and_clears_everything(self):
        self.open(); self.type_name('Zebedee')
        self.page.click('#deleteBtn')
        self.assertEqual(self.page.text_content('#deleteBtn'), 'Tap again to delete')
        self.assertIsNotNone(self.stored())
        self.page.click('#deleteBtn')
        self.assertIsNone(self.stored())
        self.assertEqual(self.page.input_value('#f-n'), 'Ken')
        self.assertIn('Deleted', self.page.text_content('#deleteMsg'))
        self.page.reload(); self.page.wait_for_selector('#f-n')
        self.assertNotEqual(self.page.input_value('#f-n'), 'Zebedee')

    def test_delete_from_the_end_screen(self):
        self.open(); self.type_name('Zebedee')
        self.page.click('#makeBtn'); self.page.click('#playBtn')
        self.page.evaluate("() => { for (let i = 0; i < 200 && document.getElementById('endView').hidden; i++) document.getElementById('nextBtn').click(); }")
        self.assertTrue(self.page.is_visible('#endView'))
        self.page.click('#endDeleteBtn'); self.page.click('#endDeleteBtn')
        self.assertIsNone(self.stored())
        self.assertTrue(self.page.is_visible('#makeView'))

    def test_quiz_older_than_seven_days_is_cleared_on_load(self):
        old = {'savedAt': 0, 'occ': 'birthday', 'isExample': False, 'v': {'n': 'Oldname'}, 'teams': ['Team 1', 'Team 2'], 'teamsAuto': True}
        import time
        old['savedAt'] = int((time.time() - 8 * 86400) * 1000)
        self.open(seed=old)
        self.assertNotEqual(self.page.input_value('#f-n'), 'Oldname')
        self.assertIsNone(self.stored())

    def test_recent_quiz_is_restored(self):
        import time
        recent = {'savedAt': int((time.time() - 2 * 86400) * 1000), 'occ': 'birthday', 'isExample': False, 'v': {'n': 'Recent'}, 'teams': ['Team 1', 'Team 2'], 'teamsAuto': True}
        self.open(seed=recent)
        self.assertEqual(self.page.input_value('#f-n'), 'Recent')

    def test_dont_keep_option_stops_saving(self):
        self.open(); self.type_name('Zebedee')
        self.page.check('#noKeep')
        self.assertIsNone(self.stored())
        self.page.fill('#f-born', 'Leeds')
        self.assertIsNone(self.stored())
        self.assertEqual(self.page.evaluate('k => localStorage.getItem(k)', NOKEEP), '1')
        self.page.uncheck('#noKeep')
        self.assertEqual(self.stored()['v']['born'], 'Leeds')

    def test_company_quizzes_are_made_to_order_not_free(self):
        self.open()
        self.assertEqual(self.page.locator('#occ-canvas').count(), 0)
        self.assertEqual(self.page.locator('input[type=file]').count(), 0)
        self.assertEqual(sorted(self.page.eval_on_selector_all('[data-occ]', 'els => els.map(e => e.dataset.occ)')), ['birthday', 'couple', 'family', 'leaving'])
        self.assertIn('own rounds, logo and colours', self.page.text_content('#reviewView .cta .small'))

    def test_a_saved_company_quiz_is_not_restored(self):
        import time
        old = {'savedAt': int(time.time() * 1000), 'occ': 'canvas', 'isExample': False, 'v': {'title': 'Office'}, 'teams': ['Team 1', 'Team 2'], 'teamsAuto': True}
        self.open(seed=old)
        self.assertEqual(self.page.get_attribute('#occ-birthday', 'aria-pressed'), 'true')
        self.assertEqual(self.errors, [])

    def test_copy_for_etsy_order_round_trips_and_only_runs_when_tapped(self):
        self.ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        self.open(); self.type_name('Zebedee O’Neil')
        self.page.click('#makeBtn')
        self.assertTrue(self.page.is_hidden('#sendCode'))
        self.page.click('#sendBtn'); self.page.wait_for_timeout(150)
        code = self.page.input_value('#sendCode')
        self.assertTrue(code.startswith('My TierBrain quiz: TBQ'), code[:30])
        self.assertTrue(code.endswith('~'))
        self.assertLess(len(code), 2000)
        self.assertEqual(self.page.evaluate('navigator.clipboard.readText()'), code)
        decoded = self.page.evaluate("""async code => {
          const m = code.match(/TBQ([01]):([A-Za-z0-9_-]+)~/); let b = m[2].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
          let bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
          if (m[1] === '1') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
          return JSON.parse(new TextDecoder().decode(bytes)); }""", code)
        self.assertEqual(decoded['o'], 'birthday')
        self.assertEqual(decoded['v']['n'], 'Zebedee O’Neil')
        self.assertEqual(decoded['v']['born'], 'Swansea')
        self.assertFalse(any('Zebedee' in u for u in self.outside), self.outside)

    def options_for(self, words, runs=12):
        seen = []
        for i in range(runs):
            self.page.click('#makeBtn') if self.page.is_visible('#makeView') else self.page.click('#reshuffle')
            for li in self.page.locator('#qlist li').all():
                if any(w in li.locator('.qt').text_content() for w in words):
                    seen.append([o.strip() for o in li.locator('.qa').text_content().split('·')])
        return seen

    def fill_birthday(self):
        self.open(); self.page.click('#clearBtn')
        for field, value in (('#f-n', 'Ken'), ('#f-age', '75'), ('#f-born', 'Leeds'), ('#f-drink', 'Tea'), ('#f-partner', 'Jean'), ('#f-siblings', '2')):
            self.page.fill(field, value)
        self.page.locator('.tfrow .ts').first.fill('Ken once met the Queen')

    def test_wrong_answers_come_from_the_same_group(self):
        self.fill_birthday()
        yorkshire = {'Leeds', 'Bradford', 'Wakefield', 'York', 'Sheffield', 'Huddersfield', 'Halifax', 'Doncaster', 'Hull', 'Harrogate', 'Rotherham', 'Barnsley', 'Scarborough'}
        hot = {'Tea', 'Coffee', 'Hot chocolate', 'Earl Grey', 'Latte', 'Cappuccino', 'Flat white', 'Black coffee'}
        women = {'Joan', 'Betty', 'Doreen', 'Irene', 'Margaret', 'Jean', 'Patricia', 'Sheila', 'Valerie', 'Brenda', 'Ruth', 'Pauline', 'Susan', 'Linda', 'Christine', 'Gillian', 'Karen', 'Julie', 'Helen', 'Tracey'}
        for words, group in ((['born'], yorkshire), (['drink'], hot), (['partner', 'other half'], women)):
            seen = self.options_for(words, runs=6)
            self.assertTrue(seen, words)
            for opts in seen:
                self.assertEqual(len(opts), 4, opts)
                self.assertTrue(set(opts) <= group, (words, opts))
        self.assertEqual(self.errors, [])

    def test_numbers_always_have_options_above_and_below(self):
        self.fill_birthday()
        for words, answer in ((['birthday', 'old'], 75), (['brothers'], 2)):
            seen = self.options_for(words, runs=15)
            self.assertTrue(seen, words)
            for opts in seen:
                nums = [int(o) for o in opts]
                self.assertLess(min(nums), answer, opts); self.assertGreater(max(nums), answer, opts)

    def test_drink_question_suits_any_drink(self):
        self.assertNotIn('At the bar', page_text())
        self.assertIn("'What is {n}’s drink of choice?','What would {n} choose to drink?'", page_text())

    def test_true_or_false_has_new_wording(self):
        self.fill_birthday(); self.page.click('#makeBtn')
        item = lambda: [l for l in self.page.locator('#qlist li').all() if 'met the Queen' in l.locator('.qt').text_content()][0]
        self.assertEqual(item().locator('.kind').text_content(), 'True or false?')
        item().locator('[data-re]').click()
        self.assertEqual(item().locator('.kind').text_content(), 'Fact or fib?')
        self.assertEqual(item().locator('.qa b').text_content(), 'Fact')
        item().locator('[data-re]').click()
        self.assertEqual(item().locator('.kind').text_content(), 'True or false?')
        self.assertEqual(item().locator('.qa b').text_content(), 'True')

    def test_fits_a_phone_screen(self):
        self.open()
        for view in ('makeView', 'reviewView'):
            if view == 'reviewView':
                self.page.click('#makeBtn')
            self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), 390, view)


if __name__ == '__main__':
    unittest.main()
