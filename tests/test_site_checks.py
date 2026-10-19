"""Verify that the read-only validator catches real corruption in temp fixtures."""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_site import validate


class SiteValidatorTests(unittest.TestCase):
    def check_fixture(self, files):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, body in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(body, encoding="utf-8")
            return validate(root)

    def test_extensionless_and_directory_routes_are_valid(self):
        result = self.check_fixture({
            "index.html": '<a href="/quiz?mode=solo#start">Quiz</a><a href="/answers/">Answers</a>',
            "quiz.html": '<script>const answer = 42;</script><script type="application/ld+json">{"@type":"Game"}</script>',
            "answers/index.html": '<a href="../quiz">Quiz</a>',
        })
        self.assertEqual(result["errors"], [])

    def test_missing_link_and_script_fail(self):
        result = self.check_fixture({"index.html": '<a href="/missing">Gone</a><script src="lost.js"></script>'})
        self.assertEqual(len(result["errors"]), 2)
        self.assertTrue(all("missing local target" in error for error in result["errors"]))

    def test_invalid_inline_and_external_javascript_fail(self):
        result = self.check_fixture({"index.html": '<script>const = 42;</script>', "bad.js": "function ("})
        self.assertEqual(len(result["errors"]), 2)
        self.assertTrue(all("invalid JavaScript" in error for error in result["errors"]))

    def test_invalid_jsonld_and_json_fail(self):
        result = self.check_fixture({"index.html": '<script type="application/ld+json">{bad}</script>', "data.json": "[broken]"})
        self.assertEqual(len(result["errors"]), 2)
        self.assertTrue(all("invalid" in error for error in result["errors"]))

    def test_broken_sitemap_and_advertised_sitemap_fail(self):
        result = self.check_fixture({
            "sitemap.xml": '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://tierbrain.co/missing</loc></url></urlset>',
            "sitemap-bad.xml": "<urlset>",
            "robots.txt": "Sitemap: https://tierbrain.co/sitemap-absent.xml\n",
        })
        self.assertEqual(len(result["errors"]), 3)
        self.assertTrue(any("invalid sitemap XML" in error for error in result["errors"]))


if __name__ == "__main__":
    unittest.main()
