"""Keep published counts in sync with the homepage's existing game catalogue.

Run after adding/removing a game: python sync-catalogue.py
Validate without writing:        python sync-catalogue.py --check
The index.html data-title cards remain the single catalogue source.
"""
import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


class CatalogueParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.games = []
        self.pack_links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != 'a':
            return
        if attrs.get('data-title'):
            self.games.append(attrs)
        if 'g' in attrs.get('class', '').split():
            self.pack_links.append(attrs.get('href', ''))


def read_catalogue(root):
    parser = CatalogueParser()
    parser.feed((root / 'index.html').read_text(encoding='utf-8'))
    games = {}
    for card in parser.games:
        href = card.get('href', '')
        url = urlsplit(href)
        target = (root / unquote(url.path.lstrip('/'))).resolve()
        if (url.scheme or url.netloc or url.query or url.fragment
                or not target.is_relative_to(root.resolve()) or not target.is_file()):
            raise ValueError('Invalid catalogue target: ' + href)
        if href in games:
            raise ValueError('Duplicate catalogue target: ' + href)
        games[href] = card
    if not games:
        raise ValueError('No catalogue cards found in index.html')
    return games


def replace_count(text, element_id, value):
    pattern = r'(<(?:div|span|a)\b[^>]*\bid="' + re.escape(element_id) + r'"[^>]*>)[^<]*(</(?:div|span|a)>)'
    result, count = re.subn(pattern, lambda m: m[1] + value + m[2], text)
    if count != 1:
        raise ValueError('Expected exactly one count marker: ' + element_id)
    return result


def synchronise(root, check=False):
    games = read_catalogue(root)
    packs = CatalogueParser()
    packs_text = (root / 'packs.html').read_text(encoding='utf-8')
    packs.feed(packs_text)
    for href in packs.pack_links:
        if href not in games:
            raise ValueError('Pack target missing from catalogue: ' + href)
    expected = {
        'index.html': replace_count((root / 'index.html').read_text(encoding='utf-8'), 'count', str(len(games)) + (' game' if len(games) == 1 else ' games')),
        'packs.html': replace_count(replace_count(packs_text, 'packCount', str(len(set(packs.pack_links)))), 'catalogueCount', str(len(games))),
    }
    stale = []
    for name, text in expected.items():
        path = root / name
        if path.read_text(encoding='utf-8') != text:
            stale.append(name)
            if not check:
                path.write_text(text, encoding='utf-8')
    if check and stale:
        raise ValueError('Catalogue counts are stale in ' + ', '.join(stale) + '; run python sync-catalogue.py')
    return len(games), len(set(packs.pack_links))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        total, featured = synchronise(args.root, args.check)
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f'Catalogue: {total} games; {featured} unique games in packs. Counts are current.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
