"""The home page footer links to both shops: Payhip and Etsy."""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ETSY = "https://www.etsy.com/uk/shop/TierBrain"
PAYHIP = "https://payhip.com/TierBrain"


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_footer = 0
        self.links = []          # (href, attrs, text)
        self._open = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "footer":
            self.in_footer += 1
        if tag == "a" and self.in_footer:
            self._open = [a.get("href", ""), a, ""]

    def handle_endtag(self, tag):
        if tag == "footer":
            self.in_footer -= 1
        if tag == "a" and self._open:
            self._open[2] = " ".join(self._open[2].split())
            self.links.append(tuple(self._open))
            self._open = None

    def handle_data(self, data):
        if self._open:
            self._open[2] += data


def footer_links():
    p = _Links()
    p.feed((ROOT / "index.html").read_text(encoding="utf-8"))
    return p.links


class ShopLinks(unittest.TestCase):
    def test_etsy_in_footer_nav_and_as_button(self):
        etsy = [l for l in footer_links() if l[0] == ETSY]
        self.assertEqual(len(etsy), 2, "expected Etsy in the footer menu and as a button")
        classes = sorted(l[1].get("class", "") for l in etsy)
        self.assertEqual(classes, ["", "support"])

    def test_etsy_links_open_safely(self):
        for href, attrs, text in footer_links():
            if href == ETSY:
                self.assertEqual(attrs.get("target"), "_blank")
                self.assertIn("noopener", attrs.get("rel", ""))
                self.assertTrue(text, "Etsy link needs visible text")

    def test_payhip_links_still_present(self):
        payhip = [l for l in footer_links() if l[0] == PAYHIP]
        self.assertEqual(len(payhip), 2)

    def test_etsy_button_sits_after_print_packs_button(self):
        hrefs = [l[0] for l in footer_links() if l[1].get("class") == "support"]
        self.assertEqual(hrefs[:2], [PAYHIP, ETSY])

    def test_no_stray_shop_urls(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        for url in re.findall(r'https?://[^"\']*etsy[^"\']*', html):
            self.assertEqual(url, ETSY)


if __name__ == "__main__":
    unittest.main()
