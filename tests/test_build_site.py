"""Exercise deployable build output in an isolated fixture, without network access."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class BuildSiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tierbrain-build-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copyfile(ROOT / 'build-site.py', self.root / 'build-site.py')
        self.sources = {
            'index.html': '<!doctype html><html><body class="home">Home</body></html>\n',
            '404.html': '<html><BODY>Missing</BODY></html>\n',
            'creak-multi 5.html': '<html><body>Game</body></html>\n',
            'q/A+B #1.html': '<html><body>Question</body></html>\n',
            'google-verification.html': 'google-site-verification: fixture.html\n',
            '_headers': "/*\n  X-Content-Type-Options: nosniff\n"
                        "  Content-Security-Policy: base-uri 'self'; object-src 'none'; "
                        "frame-ancestors 'self'; connect-src 'self'; form-action https://tierbrain.co\n",
            'robots.txt': 'User-agent: *\n',
            'site.js': 'const answer = 42;\n',
            'docs/private.html': '<html><body>Internal documentation</body></html>\n',
            'CNAME': 'tierbrain.co\n',
            'sync-catalogue.py': 'import sys\nassert sys.argv[1:] == ["--check"]\n',
        }
        for relative, content in self.sources.items():
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf-8')

    def build(self, *args, preview_env=False):
        environment = os.environ.copy()
        environment.pop('TIERBRAIN_PREVIEW', None)
        if preview_env:
            environment['TIERBRAIN_PREVIEW'] = '1'
        result = subprocess.run([sys.executable, str(self.root / 'build-site.py'), *args],
                                cwd=self.root, env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.root / 'dist'

    def assert_sources_unchanged(self):
        for relative, content in self.sources.items():
            self.assertEqual((self.root / relative).read_text(encoding='utf-8'), content, relative)

    def test_production_is_unmodified_and_internal_files_are_excluded(self):
        dist = self.build()
        for relative in ('index.html', '404.html', 'site.js', '_headers', 'robots.txt'):
            self.assertEqual((dist / relative).read_bytes(), (self.root / relative).read_bytes())
        for relative in ('build-site.py', 'sync-catalogue.py', 'docs/private.html', 'CNAME'):
            self.assertFalse((dist / relative).exists(), relative)
        self.assert_sources_unchanged()

    def test_preview_blocks_backend_and_forms_without_modifying_sources(self):
        dist = self.build('--preview')
        headers = (dist / '_headers').read_text(encoding='utf-8')
        self.assertEqual(headers.splitlines().count('/*'), 1)
        self.assertIn('  X-Content-Type-Options: nosniff', headers)
        self.assertIn("  Content-Security-Policy: base-uri 'self'; object-src 'none'; "
                      "frame-ancestors 'self'; connect-src 'none'; form-action 'none'", headers)
        self.assertEqual(headers.count('connect-src'), 1)
        self.assertEqual(headers.count('form-action'), 1)
        self.assertNotIn("connect-src 'self'", headers)
        self.assertNotIn('form-action https://tierbrain.co', headers)
        self.assertIn('  X-Robots-Tag: noindex, nofollow', headers)
        for relative in ('index.html', '404.html', 'creak-multi 5.html', 'q/A+B #1.html'):
            html = (dist / relative).read_text(encoding='utf-8')
            self.assertEqual(html.count('data-tierbrain-preview'), 1, relative)
            self.assertIn('Live scores, multiplayer and forms are unavailable.', html)
        self.assertEqual((dist / 'google-verification.html').read_bytes(),
                         (self.root / 'google-verification.html').read_bytes())
        self.assert_sources_unchanged()
        # Returning to a production build must not retain preview restrictions/notices.
        self.build()
        for relative in ('index.html', '404.html', '_headers'):
            self.assertEqual((dist / relative).read_bytes(), (self.root / relative).read_bytes())

    def test_redirects_encode_spaces_and_reserved_characters(self):
        dist = self.build()
        lines = (dist / '_redirects').read_text(encoding='utf-8').splitlines()
        self.assertIn('/ /index.html 200', lines)
        self.assertIn('/creak-multi%205 /creak-multi%205.html 301', lines)
        self.assertIn('/creak-multi%205/ /creak-multi%205.html 301', lines)
        self.assertIn('/q/A%2BB%20%231 /q/A%2BB%20%231.html 301', lines)
        self.assertTrue(all(len(line.split()) == 3 for line in lines))
        self.assertTrue((dist / 'creak-multi 5.html').exists())

    def test_environment_keeps_automatic_rebuilds_in_preview_mode(self):
        dist = self.build(preview_env=True)
        self.assertIn("connect-src 'none'", (dist / '_headers').read_text(encoding='utf-8'))
        self.assertIn('data-tierbrain-preview', (dist / 'index.html').read_text(encoding='utf-8'))
        self.assert_sources_unchanged()

    def test_preview_adds_missing_global_policy_without_duplicate_rules(self):
        for headers in ('/*\n  X-Content-Type-Options: nosniff\n',
                        '/join.html\n  X-Robots-Tag: noindex\n'):
            with self.subTest(headers=headers):
                (self.root / '_headers').write_text(headers, encoding='utf-8')
                dist = self.build('--preview')
                result = (dist / '_headers').read_text(encoding='utf-8')
                self.assertEqual(result.splitlines().count('/*'), 1)
                self.assertIn("  Content-Security-Policy: connect-src 'none'; form-action 'none'", result)
                self.assertIn('  X-Robots-Tag: noindex, nofollow', result)
                self.assertEqual((self.root / '_headers').read_text(encoding='utf-8'), headers)


if __name__ == '__main__':
    unittest.main()
