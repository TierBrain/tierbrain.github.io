"""
Gives every TierBrain page its own <title>, description, canonical link and share (Open Graph / Twitter) tags.

How it works: reads your homepage (index.html) for each game and quiz, writes sensible metadata for every page,
saves them to seo-metadata.csv, and patches the <head> of each page file it finds in the folder.

Usage (from your site folder, which contains index.html and all the game pages):
    python apply-metadata.py --dry-run     # only writes seo-metadata.csv, changes no pages
    python apply-metadata.py               # patches the pages as well (keep a git commit or backup first)

Edit the OVERRIDES dictionary below to hand-write any page's title or description. Safe to run repeatedly.
"""
import re, csv, sys, html, pathlib

SITE = "https://tierbrain.co"
IMAGE = SITE + "/og-image.png?v=2"
DRY = "--dry-run" in sys.argv
FOLDER = pathlib.Path(".")

# Hand-written metadata. Anything here beats the automatic version. Keep titles under about 60 characters
# and descriptions under about 155.
OVERRIDES = {
    "creak.html": ("Creak & Coil: a snakes and ladders quiz game | TierBrain",
                   "Snakes and ladders on a board that is falling apart. Ladders rot, snakes strike and storms tear holes in the ground. Answer fast to climb."),
    "full-circuit.html": ("Full Circuit: explore a house, wake a machine | TierBrain",
                          "Explore a strange house, win the parts of a dormant machine, and bring it to life. Play alone or as a team on the big screen. Free, no sign-up."),
    "show-gen.html": ("The Big Quiz: a live game show for two teams | TierBrain",
                      "A full game show with an animated host: Rapid-Fire, Fill the Gap, Five Clues and a Buzzer finale. One big screen hosts, and everyone plays on their phones."),
    "wheel.html": ("Smudged: a message-in-a-bottle word puzzle | TierBrain",
                   "A message in a bottle, smudged by the sea. Spin the helm, answer to earn letters, and read the message before your ship sinks."),
    "throne-play.html": ("Hold The Throne: join a game | TierBrain",
                         "Join a Hold The Throne game on your phone. Enter the room code and your name, then grab the buzzer."),
}
SKIP = {"index.html", "404.html"}   # the homepage and 404 already have their own tags

def clean(t): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", t))).strip()
def fit(text, n):
    if len(text) <= n: return text
    cut = text[:n].rsplit(" ", 1)[0].rstrip(",;:- ")
    return cut + "…" if not cut.endswith(".") else cut

def catalogue(index_path):
    s = open(index_path, encoding="utf-8").read()
    s = re.sub(r"data:image/[a-z+]+;base64,[A-Za-z0-9+/=]+", "", s)
    items = {}
    for m in re.finditer(r'<a class="(tc|fc)[^"]*" href="([^"#?]+\.html)"([^>]*)>(.*?)</a>', s, re.S):
        kind, href, attrs, body = m.groups()
        cat = re.search(r'data-cat="([^"]*)"', attrs); cat = cat.group(1) if cat else ""
        h = re.search(r"<h3>(.*?)</h3>", body, re.S); p = re.search(r"<p>(.*?)</p>", body, re.S)
        if h: items[href] = {"type": "game", "name": clean(h.group(1)), "blurb": clean(p.group(1)) if p else "", "cat": cat}
    for m in re.finditer(r'<a class="qc" href="([^"#?]+\.html)"[^>]*>\s*<h4>(.*?)</h4><span>(.*?)</span>', s, re.S):
        href, name, meta = m.groups()
        items[href] = {"type": "quiz", "name": clean(name), "meta": clean(meta)}
    return items

def auto(href, it):
    if it["type"] == "quiz":
        n = re.search(r"([\d,]+)\s+questions", it["meta"]); n = n.group(1) if n else ""
        has_tiers = bool(re.search(r"4 tiers", it["meta"]))
        name = it["name"]; topic = name if name.lower().endswith("quiz") else name + " Quiz"
        lead = re.sub(r"^The ", "", name)
        title = f"{topic}: {n} questions" + (", four tiers" if has_tiers else "") + " | TierBrain" if n else f"{topic} | TierBrain"
        if len(title) > 60: title = f"{topic} | TierBrain"
        desc = f"A free {lead} quiz" + (f" with {n} questions" if n else "") + (" across four tiers, from Easy to Legends" if has_tiers else "") + ". Play in your browser, no app or sign-up."
        return title, fit(desc, 158)
    kind = ("party" if "multiplayer" in it["cat"] else "puzzle" if "puzzle" in it["cat"] else
            "adventure" if "adventure" in it["cat"] else "strategy" if "strategy" in it["cat"] else "online")
    title = f"{it['name']} | Free {kind} game | TierBrain"
    if len(title) > 60: title = f"{it['name']} | TierBrain"
    desc = it["blurb"]
    if desc and len(desc) + 28 <= 158: desc += " Free to play in your browser."
    return title, fit(desc or f"{it['name']}, a free game on TierBrain.", 158)

def esc(t): return html.escape(t, quote=True)

def patch(path, href, title, desc):
    s = open(path, encoding="utf-8").read()
    url = f"{SITE}/{href}"
    tags = {
        'meta[name="description"]': f'<meta name="description" content="{esc(desc)}">',
        'link[rel="canonical"]': f'<link rel="canonical" href="{url}">',
        'meta[property="og:type"]': '<meta property="og:type" content="website">',
        'meta[property="og:site_name"]': '<meta property="og:site_name" content="TierBrain">',
        'meta[property="og:url"]': f'<meta property="og:url" content="{url}">',
        'meta[property="og:title"]': f'<meta property="og:title" content="{esc(title)}">',
        'meta[property="og:description"]': f'<meta property="og:description" content="{esc(desc)}">',
        'meta[property="og:image"]': f'<meta property="og:image" content="{IMAGE}">',
        'meta[name="twitter:card"]': '<meta name="twitter:card" content="summary_large_image">',
        'meta[name="twitter:title"]': f'<meta name="twitter:title" content="{esc(title)}">',
        'meta[name="twitter:description"]': f'<meta name="twitter:description" content="{esc(desc)}">',
        'meta[name="twitter:image"]': f'<meta name="twitter:image" content="{IMAGE}">',
    }
    pats = {
        'meta[name="description"]': r'<meta\s+name="description"[^>]*>', 'link[rel="canonical"]': r'<link\s+rel="canonical"[^>]*>',
        'meta[property="og:type"]': r'<meta\s+property="og:type"[^>]*>', 'meta[property="og:site_name"]': r'<meta\s+property="og:site_name"[^>]*>',
        'meta[property="og:url"]': r'<meta\s+property="og:url"[^>]*>', 'meta[property="og:title"]': r'<meta\s+property="og:title"[^>]*>',
        'meta[property="og:description"]': r'<meta\s+property="og:description"[^>]*>', 'meta[property="og:image"]': r'<meta\s+property="og:image"[^>]*>',
        'meta[name="twitter:card"]': r'<meta\s+name="twitter:card"[^>]*>', 'meta[name="twitter:title"]': r'<meta\s+name="twitter:title"[^>]*>',
        'meta[name="twitter:description"]': r'<meta\s+name="twitter:description"[^>]*>', 'meta[name="twitter:image"]': r'<meta\s+name="twitter:image"[^>]*>',
    }
    tt = f"<title>{esc(title)}</title>"
    s = re.sub(r"<title>.*?</title>", lambda m: tt, s, count=1, flags=re.S) if re.search(r"<title>", s) else s.replace("</head>", tt + "\n</head>", 1)
    missing = []
    for k, tag in tags.items():
        if re.search(pats[k], s): s = re.sub(pats[k], lambda m, t=tag: t, s, count=1)
        else: missing.append(tag)
    if missing: s = s.replace("</head>", "\n".join(missing) + "\n</head>", 1)
    return s

def main():
    idx = FOLDER / "index.html"
    if not idx.exists(): sys.exit("Run this from the folder that contains index.html")
    cat = catalogue(idx)
    rows = []
    for href in sorted(set(cat) | set(OVERRIDES)):
        if href in SKIP: continue
        if href in OVERRIDES: title, desc = OVERRIDES[href]; note = "hand-written"
        elif href in cat: title, desc = auto(href, cat[href]); note = "automatic"
        else: continue
        rows.append((href, title, desc, len(title), len(desc), note))
    with open(FOLDER / "seo-metadata.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["file", "title", "description", "title_chars", "description_chars", "source"]); w.writerows(rows)
    print(f"Wrote seo-metadata.csv ({len(rows)} pages).")
    if DRY: return
    done = 0
    for href, title, desc, *_ in rows:
        p = FOLDER / href
        if not p.exists(): continue
        new = patch(p, href, title, desc)
        if new != p.read_text(encoding="utf-8"): p.write_text(new, encoding="utf-8"); done += 1
    print(f"Patched {done} page(s).")

if __name__ == "__main__": main()
