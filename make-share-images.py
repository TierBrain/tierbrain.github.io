"""
Builds TierBrain's share image and app icons as PNGs.

Setup (once):  pip install playwright pillow   then   playwright install chromium
Run:           python make-share-images.py
Output (in ./out): og-image.png, apple-touch-icon.png, icon-192.png, icon-512.png, favicon-32.png, favicon-48.png

Run it on a computer with internet access so the real Baloo 2 font loads.
Offline it falls back to a system font and the text will look different.
"""
from playwright.sync_api import sync_playwright
from PIL import Image
import pathlib, io

OUT = pathlib.Path("out"); OUT.mkdir(exist_ok=True)
FONT = ("<link href='https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;800&display=swap' rel='stylesheet'>"
        "<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Baloo 2','DejaVu Sans',Verdana,sans-serif}</style>")

LOBES_L = "M22.8 9C15 6 6 10 6 20C3 24 4 32 9 34C10 40 18 42 22.8 38Z"
LOBES_R = "M25.2 9C33 6 42 10 42 20C45 24 44 32 39 34C38 40 30 42 25.2 38Z"
SMALL_L = "M22.3 9C15 6 6 10 6 20C3 24 4 32 9 34C10 40 18 42 22.3 38Z"
SMALL_R = "M25.7 9C33 6 42 10 42 20C45 24 44 32 39 34C38 40 30 42 25.7 38Z"

def mark(size, small=False, cid="c"):
    l, r = (SMALL_L, SMALL_R) if small else (LOBES_L, LOBES_R)
    bands = ('<rect y="5" width="48" height="11.07" fill="#f2d27a"/><rect y="19.47" width="48" height="9.07" fill="#d9694f"/><rect y="31.93" width="48" height="10.07" fill="#86bf9d"/>'
             if small else
             '<rect y="5" width="48" height="8.45" fill="#f2d27a"/><rect y="15.85" width="48" height="6.45" fill="#d9694f"/><rect y="24.7" width="48" height="6.45" fill="#e0a458"/><rect y="33.55" width="48" height="8.45" fill="#86bf9d"/>')
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 48 48"><defs><clipPath id="{cid}"><path d="{l}"/><path d="{r}"/></clipPath></defs>'
            f'<g clip-path="url(#{cid})">{bands}</g></svg>')

LADDER = '''<svg width="330" height="470" viewBox="100 0 240 330">
  <rect x="136" y="34" width="10" height="282" rx="5" fill="#9b7455"/><rect x="294" y="34" width="10" height="282" rx="5" fill="#9b7455"/>
  <rect x="141" y="240" width="158" height="44" rx="12" fill="#86bf9d"/><rect x="141" y="170" width="158" height="44" rx="12" fill="#e0a458"/>
  <rect x="141" y="100" width="158" height="44" rx="12" fill="#d9694f"/><rect x="141" y="30" width="158" height="44" rx="12" fill="#f2d27a"/>
  <g font-family="Baloo 2, DejaVu Sans, Verdana, sans-serif" font-weight="800" font-size="19" fill="#1c1013" text-anchor="middle">
    <text x="220" y="268">Easy</text><text x="220" y="198">Medium</text><text x="220" y="128">Hard</text><text x="220" y="58">Legends</text></g>
  <circle cx="220" cy="157" r="9" fill="#fbf1e2" stroke="#f2d27a" stroke-width="3"/>
  <path d="M380 4 L383 11 L390.5 11.5 L384.6 16.3 L386.5 23.5 L380 19.5 L373.5 23.5 L375.4 16.3 L369.5 11.5 L377 11 Z" transform="translate(-160 2)" fill="#f2d27a"/></svg>'''

OG = f'''<!doctype html><html><head><meta charset="utf-8">{FONT}</head><body style="width:1200px;height:630px;overflow:hidden;color:#fbf1e2;
background:radial-gradient(60% 70% at 12% 0%,rgba(230,182,85,.20),transparent 60%),radial-gradient(55% 60% at 100% 100%,rgba(217,105,79,.18),transparent 60%),linear-gradient(165deg,#130a0d,#1c1013 55%,#241418);position:relative">
  <div style="position:absolute;left:80px;top:70px;display:flex;align-items:center;gap:22px">{mark(88)}<div style="font-size:60px;font-weight:500;letter-spacing:-.01em">Tier<span style="color:#e6b655;font-weight:800">Brain</span></div></div>
  <div style="position:absolute;left:80px;top:210px;width:700px;font-size:76px;font-weight:800;line-height:1.05;letter-spacing:-.015em;text-wrap:balance">Games that run on <span style="color:#e6b655">what you know.</span></div>
  <div style="position:absolute;left:80px;bottom:64px;font-size:30px;font-weight:500;color:#c2a99a">Free in your browser. No app, no sign-up.</div>
  <div style="position:absolute;right:70px;top:80px">{LADDER}</div>
</body></html>'''

def tile(size, small, radius_pct, pad_pct, bg="#1c1013"):
    inner = int(size * (1 - 2 * pad_pct))
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>*{{margin:0;padding:0}}html,body{{background:transparent}}</style></head>'
            f'<body style="width:{size}px;height:{size}px"><div style="width:{size}px;height:{size}px;background:{bg};border-radius:{int(size*radius_pct)}px;display:grid;place-items:center">{mark(inner, small)}</div></body></html>')

def shot(browser, html, w, h, name, transparent=False, wait=1500):
    pg = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    pg.set_content(html, wait_until="networkidle" if "fonts.googleapis" in html else "load")
    pg.wait_for_timeout(wait)
    png = pg.screenshot(omit_background=transparent)
    pg.close()
    im = Image.open(io.BytesIO(png))
    im.save(OUT / name, optimize=True)
    print("wrote", name, im.size)

with sync_playwright() as p:
    b = p.chromium.launch()
    shot(b, OG, 1200, 630, "og-image.png")
    shot(b, tile(180, False, 0.0, 0.16), 180, 180, "apple-touch-icon.png")      # iOS rounds the corners itself
    shot(b, tile(192, False, 0.0, 0.16), 192, 192, "icon-192.png")
    shot(b, tile(512, False, 0.0, 0.16), 512, 512, "icon-512.png")
    shot(b, tile(32, True, 0.22, 0.08), 32, 32, "favicon-32.png", transparent=True)
    shot(b, tile(48, True, 0.22, 0.08), 48, 48, "favicon-48.png", transparent=True)
    b.close()
