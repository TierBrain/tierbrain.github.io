"""Keep non-writing source validation separate from strict generated counts."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('sync_catalogue', ROOT / 'sync-catalogue.py')
CATALOGUE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CATALOGUE)


class SyncCatalogueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tierbrain-catalogue-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sources = {
            'index.html': '<span id="count">72 games</span>'
                          '<a data-title="First" href="first.html">First</a>'
                          '<a data-title="Second" href="second.html">Second</a>\n',
            'packs.html': '<span id="packCount">72</span>'
                          '<span id="catalogueCount">72</span>'
                          '<a class="g" href="first.html">First</a>\n',
            'first.html': '<html>First game</html>\n',
            'second.html': '<html>Second game</html>\n',
        }
        self.write_sources()

    def write_sources(self):
        for name, text in self.sources.items():
            (self.root / name).write_text(text, encoding='utf-8')

    def assert_sources_unchanged(self):
        for name, text in self.sources.items():
            self.assertEqual((self.root / name).read_text(encoding='utf-8'), text, name)

    def test_validate_only_accepts_stale_counts_without_writing(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / 'sync-catalogue.py'), '--validate-only',
             '--root', str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Links and count markers are valid.', result.stdout)
        self.assertNotIn('Counts are current.', result.stdout)
        self.assert_sources_unchanged()

    def test_strict_check_rejects_stale_counts_without_writing(self):
        with self.assertRaisesRegex(ValueError, 'Catalogue counts are stale in index.html, packs.html'):
            CATALOGUE.synchronise(self.root, check=True)
        self.assert_sources_unchanged()

    def test_default_sync_generates_counts_that_pass_strict_check(self):
        self.assertEqual(CATALOGUE.synchronise(self.root), (2, 1))
        self.assertIn('<span id="count">2 games</span>',
                      (self.root / 'index.html').read_text(encoding='utf-8'))
        packs = (self.root / 'packs.html').read_text(encoding='utf-8')
        self.assertIn('<span id="packCount">1</span>', packs)
        self.assertIn('<span id="catalogueCount">2</span>', packs)
        self.assertEqual(CATALOGUE.synchronise(self.root, check=True), (2, 1))

    def test_validate_only_rejects_invalid_and_duplicate_catalogue_targets(self):
        invalid = ('missing.html', 'https://example.com/first.html',
                   'first.html?query=1', 'first.html#fragment', '../first.html')
        original = self.sources['index.html']
        for href in invalid:
            with self.subTest(href=href):
                self.sources['index.html'] = original.replace('first.html', href)
                self.write_sources()
                with self.assertRaisesRegex(ValueError, 'Invalid catalogue target:'):
                    CATALOGUE.synchronise(self.root, validate_only=True)
                self.assert_sources_unchanged()
        self.sources['index.html'] = original.replace('second.html', 'first.html')
        self.write_sources()
        with self.assertRaisesRegex(ValueError, 'Duplicate catalogue target: first.html'):
            CATALOGUE.synchronise(self.root, validate_only=True)
        self.assert_sources_unchanged()

    def test_validate_only_rejects_pack_target_missing_from_catalogue(self):
        self.sources['packs.html'] = self.sources['packs.html'].replace('first.html', 'missing.html')
        self.write_sources()
        with self.assertRaisesRegex(ValueError, 'Pack target missing from catalogue: missing.html'):
            CATALOGUE.synchronise(self.root, validate_only=True)
        self.assert_sources_unchanged()

    def test_validate_only_rejects_missing_and_duplicate_count_markers(self):
        originals = self.sources.copy()
        for name, marker in (('index.html', 'count'), ('packs.html', 'packCount'),
                             ('packs.html', 'catalogueCount')):
            for duplicate in (False, True):
                with self.subTest(marker=marker, duplicate=duplicate):
                    self.sources = originals.copy()
                    if duplicate:
                        self.sources[name] += f'<span id="{marker}">72</span>'
                    else:
                        self.sources[name] = self.sources[name].replace(
                            f'id="{marker}"', f'id="removed-{marker}"')
                    self.write_sources()
                    with self.assertRaisesRegex(ValueError, 'Expected exactly one count marker: ' + marker):
                        CATALOGUE.synchronise(self.root, validate_only=True)
                    self.assert_sources_unchanged()


if __name__ == '__main__':
    unittest.main()
