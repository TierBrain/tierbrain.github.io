"""Site ownership tags must stay in place, or Pinterest and Google drop the claim."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PINTEREST_TAG = '<meta name="p:domain_verify" content="2dad95ce8c944d006fb182e4680b1ceb"/>'


class SiteVerificationTests(unittest.TestCase):
    def setUp(self):
        self.html = (ROOT / 'index.html').read_text(encoding='utf-8')

    def test_pinterest_tag_present_once(self):
        self.assertEqual(self.html.count(PINTEREST_TAG), 1)
        self.assertEqual(len(re.findall(r'p:domain_verify', self.html)), 1)

    def test_pinterest_tag_inside_head(self):
        head = self.html.split('</head>', 1)[0]
        self.assertIn(PINTEREST_TAG, head)
        self.assertLess(self.html.index('<head>'), self.html.index(PINTEREST_TAG))

    def test_google_verification_file_kept(self):
        self.assertTrue((ROOT / 'googlee43e503a4a8877f7.html').is_file())


if __name__ == '__main__':
    unittest.main()
