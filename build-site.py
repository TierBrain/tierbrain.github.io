"""Build only TierBrain's public assets into dist/; never deploy anything."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
ASSET_EXTENSIONS = {'.html', '.js', '.css', '.png', '.webp', '.jpg', '.jpeg', '.svg', '.ico', '.gif', '.woff', '.woff2', '.ttf', '.mp3', '.ogg', '.wav', '.mp4', '.webmanifest', '.xml'}
ASSET_DIRECTORIES = {'q', 'answers', 'assets', 'fonts', 'images', 'audio'}
PUBLIC_TEXT_FILES = {'robots.txt', 'ads.txt', 'humans.txt'}


def main():
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
    shutil.copyfile(ROOT / '_headers', DIST / '_headers')
    # Preserve current .html canonical URLs, and keep existing extensionless links usable.
    # With html_handling=none, the homepage needs its own exact 200 rewrite.
    redirects = ['/ /index.html 200']
    for relative in sorted(files):
        if relative.suffix != '.html' or relative.name in {'index.html', '404.html'}:
            continue
        canonical = '/' + relative.as_posix()
        bare = canonical[:-5]
        redirects.extend([f'{bare} {canonical} 301', f'{bare}/ {canonical} 301'])
    (DIST / '_redirects').write_text('\n'.join(redirects) + '\n', encoding='utf-8')
    print(f'Built {len(files)} public assets plus headers/routing into {DIST}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
