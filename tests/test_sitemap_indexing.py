"""Every page listed in a sitemap must be allowed into search results.

A page that is in sitemap.xml but carries a noindex robots tag sends search
engines mixed signals: Search Console flags it and crawl budget is wasted.
If a page should stay out of search, remove it from the sitemap instead.
"""

from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://tierbrain.co"
NOINDEX_META = re.compile(
    r"<meta\b(?=[^>]*\bname\s*=\s*[\"']?(?:robots|googlebot)[\"']?)(?=[^>]*\bcontent\s*=\s*[\"'][^\"']*noindex)[^>]*>",
    re.IGNORECASE)


def sitemap_paths():
    for sitemap in sorted(ROOT.glob("sitemap*.xml")):
        for element in ET.parse(sitemap).getroot().iter():
            if element.tag.rsplit("}", 1)[-1] == "loc" and element.text and element.text.strip().startswith(SITE):
                yield sitemap.name, element.text.strip()[len(SITE):] or "/"


def local_file(path):
    path = path.split("#", 1)[0].split("?", 1)[0]
    relative = path.lstrip("/")
    candidates = [ROOT / relative / "index.html"] if not relative or path.endswith("/") else [ROOT / relative, ROOT / (relative + ".html")]
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def header_noindex_paths():
    headers = ROOT / "_headers"
    found, pattern = set(), None
    if not headers.exists():
        return found
    for line in headers.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line[0].isspace():
            pattern = line.strip()
        elif pattern and re.match(r"\s*X-Robots-Tag\s*:.*noindex", line, re.IGNORECASE):
            found.add(pattern)
    return found


def robots_disallowed():
    robots = ROOT / "robots.txt"
    rules = []
    if robots.exists():
        for line in robots.read_text(encoding="utf-8").splitlines():
            match = re.match(r"\s*Disallow\s*:\s*(\S+)", line, re.IGNORECASE)
            if match:
                rules.append(match.group(1))
    return rules


class SitemapIndexingTests(unittest.TestCase):
    def test_sitemap_pages_exist_and_are_indexable(self):
        listed = list(sitemap_paths())
        self.assertTrue(listed, "no sitemap URLs found")
        blocked_by_header = header_noindex_paths()
        disallowed = robots_disallowed()
        problems = []
        for sitemap, path in listed:
            target = local_file(path)
            if target is None:
                problems.append(f"{sitemap}: {path} has no page")
                continue
            if target.suffix == ".html" and NOINDEX_META.search(target.read_text(encoding="utf-8", errors="replace")):
                problems.append(f"{sitemap}: {path} is listed but carries a noindex robots tag")
            if path in blocked_by_header:
                problems.append(f"{sitemap}: {path} is listed but _headers sends X-Robots-Tag noindex")
            if any(path.startswith(rule) for rule in disallowed):
                problems.append(f"{sitemap}: {path} is listed but robots.txt disallows it")
        self.assertEqual(problems, [])

    def test_featured_new_games_are_indexable(self):
        for name in ("full-circuit.html", "full-circuit-bible.html", "full-circuit-host.html",
                     "full-circuit-bible-host.html", "spines.html", "spines-bible.html"):
            with self.subTest(page=name):
                self.assertIsNone(NOINDEX_META.search((ROOT / name).read_text(encoding="utf-8")))

    def test_detector_catches_noindex_in_either_attribute_order(self):
        for tag in ('<meta name="robots" content="noindex">', "<meta content='noindex, nofollow' name='ROBOTS'>",
                    '<meta name="googlebot" content="noindex">'):
            with self.subTest(tag=tag):
                self.assertIsNotNone(NOINDEX_META.search(tag))
        self.assertIsNone(NOINDEX_META.search('<meta name="robots" content="index, follow">'))
        self.assertIsNone(NOINDEX_META.search('<meta name="description" content="noindex is a word here">'))


if __name__ == "__main__":
    unittest.main()
