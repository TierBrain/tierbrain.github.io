"""Build only TierBrain's public assets into dist/; never deploy anything."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
ASSET_EXTENSIONS = {'.html', '.js', '.css', '.png', '.webp', '.jpg', '.jpeg', '.svg', '.ico', '.gif', '.woff', '.woff2', '.ttf', '.mp3', '.ogg', '.wav', '.mp4', '.webmanifest', '.xml'}
ASSET_DIRECTORIES = {'q', 'answers', 'assets', 'fonts', 'images', 'audio'}
PUBLIC_TEXT_FILES = {'robots.txt', 'ads.txt', 'humans.txt'}
PREVIEW_NOTICE = (
    '<aside data-tierbrain-preview role="note" '
    'style="position:fixed;bottom:0;left:0;right:0;z-index:2147483647;'
    'padding:8px 12px;background:#1c1013;color:#fbf1e2;border-top:2px solid #f2d27a;'
    'font:14px/1.4 system-ui,sans-serif;text-align:center">'
    '<strong>Preview:</strong> Live scores, multiplayer and forms are unavailable.'
    '</aside>'
)
PREVIEW_CSP = "connect-src 'none'; form-action 'none'"


def preview_headers(source):
    """Restrict the copied rules without repeating a Cloudflare URL pattern."""
    lines = source.splitlines()
    pattern = None
    global_start = None
    global_csp = False
    global_robots = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        if not line[0].isspace():
            pattern = stripped
            if pattern == '/*':
                global_start = index + 1
            continue
        policy = re.match(r'^(\s*Content-Security-Policy\s*:)\s*(.*)$', line,
                          flags=re.IGNORECASE)
        if policy:
            directives = [part.strip() for part in policy.group(2).split(';')
                          if part.strip() and part.strip().split()[0].lower()
                          not in {'connect-src', 'form-action'}]
            lines[index] = policy.group(1) + ' ' + '; '.join(directives + [PREVIEW_CSP])
            if pattern == '/*':
                global_csp = True
        robots = re.match(r'^(\s*X-Robots-Tag\s*:)\s*(.*)$', line, flags=re.IGNORECASE)
        if robots and pattern == '/*':
            values = [part.strip() for part in robots.group(2).split(',') if part.strip()]
            for value in ('noindex', 'nofollow'):
                if value not in [part.lower() for part in values]:
                    values.append(value)
            lines[index] = robots.group(1) + ' ' + ', '.join(values)
            global_robots = True
    additions = []
    if not global_csp:
        additions.append('  Content-Security-Policy: ' + PREVIEW_CSP)
    if not global_robots:
        additions.append('  X-Robots-Tag: noindex, nofollow')
    if global_start is None:
        lines.extend(['', '/*', *additions])
    else:
        lines[global_start:global_start] = additions
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview', action='store_true',
                        default=os.environ.get('TIERBRAIN_PREVIEW') == '1',
                        help='Block backend connections and forms (also TIERBRAIN_PREVIEW=1).')
    args = parser.parse_args(argv)
    subprocess.run([sys.executable, str(ROOT / 'sync-catalogue.py'), '--check'], check=True)
    files = []
    for path in ROOT.rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(ROOT)
        if len(relative.parts) > 1 and relative.parts[0] not in ASSET_DIRECTORIES:
            continue
        if path.suffix.lower() in ASSET_EXTENSIONS or (len(relative.parts) == 1 and path.name in PUBLIC_TEXT_FILES):
            if path.stat().st_size > 25 * 1024 * 1024:
                raise ValueError('Asset exceeds Cloudflare 25 MiB limit: ' + str(relative))
            files.append(relative)
    if not files or Path('index.html') not in files or Path('404.html') not in files:
        raise ValueError('Build must include index.html and 404.html')
    # This path is fixed inside the repository; never clean an arbitrary target.
    if DIST.is_symlink():
        raise ValueError('Refusing to replace a symlink at dist/')
    if DIST.exists():
        shutil.rmtree(DIST)
    for relative in files:
        target = DIST / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
        if args.preview and relative.suffix.lower() == '.html':
            html = target.read_text(encoding='utf-8')
            # Verification files without a body must retain their exact content.
            html, replacements = re.subn(
                r'(<body\b[^>]*>)', lambda match: match.group(1) + PREVIEW_NOTICE,
                html, count=1, flags=re.IGNORECASE)
            if replacements:
                target.write_text(html, encoding='utf-8')
    if args.preview:
        headers = preview_headers((ROOT / '_headers').read_text(encoding='utf-8'))
        (DIST / '_headers').write_text(headers, encoding='utf-8')
    else:
        shutil.copyfile(ROOT / '_headers', DIST / '_headers')
    # Preserve current .html canonical URLs, and keep existing extensionless links usable.
    # With html_handling=none, the homepage needs its own exact 200 rewrite.
    redirects = ['/ /index.html 200']
    for relative in sorted(files):
        if relative.suffix != '.html' or relative.name in {'index.html', '404.html'}:
            continue
        canonical = '/' + quote(relative.as_posix(), safe='/')
        bare = canonical[:-5]
        redirects.extend([f'{bare} {canonical} 301', f'{bare}/ {canonical} 301'])
    (DIST / '_redirects').write_text('\n'.join(redirects) + '\n', encoding='utf-8')
    mode = 'preview (backend connections disabled)' if args.preview else 'production'
    print(f'Built {len(files)} public assets plus headers/routing into {DIST}: {mode}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
