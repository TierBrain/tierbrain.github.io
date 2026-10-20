"""Serve the built site locally with browser connections to live backends blocked.

Run python build-site.py first, then python preview-site.py.
This is a visual/solo-game preview, not a multiplayer staging environment.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-TierBrain-Preview', 'local-only; external-connections-blocked')
        super().end_headers()

    def do_GET(self):
        parsed = urlsplit(self.path)
        path = Path(self.translate_path(parsed.path))
        if not path.exists() and path.suffix == '' and path.with_suffix('.html').is_file():
            self.send_response(301)
            self.send_header('Location', parsed.path.rstrip('/') + '.html' + ('?' + parsed.query if parsed.query else ''))
            self.end_headers()
            return
        super().do_GET()

    def list_directory(self, path):
        self.send_error(404, 'Directory listings are disabled')
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    dist = ROOT / 'dist'
    if not (dist / 'index.html').is_file():
        parser.error('Run python build-site.py before starting the preview')
    handler = partial(PreviewHandler, directory=str(dist))
    with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        print(f'Local preview: http://127.0.0.1:{args.port}/', flush=True)
        print('External browser connections are blocked. Multiplayer and online scores are unavailable.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
