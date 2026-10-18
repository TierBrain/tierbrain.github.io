"""
Retake TierBrain game screenshots with your real fonts and full question banks.

Setup (once):   pip install playwright   then   playwright install chromium
Run:            python capture-screenshots.py

Saves 1280x800 (desktop) and 390x844 (phone) PNGs into ./shots from the LIVE site.
Solo games are captured automatically. For party games (Big Quiz, Hold The Throne)
open the host page and a phone page yourself and screenshot by hand, since they
need a real room and real players.
"""
from playwright.sync_api import sync_playwright
import pathlib

SITE = "https://tierbrain.co"
OUT = pathlib.Path("shots"); OUT.mkdir(exist_ok=True)

SOLO = {
    "creak":        ("creak.html",        1280, 800, "#roll"),     # click Roll first
    "full-circuit": ("full-circuit.html", 1280, 800, "#enterBtn"),  # click Step inside
    "smudged":      ("wheel.html",        390,  844, "#goBtn"),     # click Uncork the bottle
}

with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, (page_name, w, h, start_btn) in SOLO.items():
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2,
                                  is_mobile=(w < 500), has_touch=(w < 500))
        page = ctx.new_page()
        page.goto(f"{SITE}/{page_name}")
        page.wait_for_timeout(1500)
        page.screenshot(path=OUT / f"{name}-start.png")
        try:
            page.click(start_btn, timeout=3000)
            page.wait_for_timeout(2500 if name != "full-circuit" else 4000)
            page.screenshot(path=OUT / f"{name}-playing.png")
        except Exception as e:
            print(f"{name}: could not click {start_btn}: {e}")
        ctx.close()
    browser.close()
print("Saved to", OUT.resolve())
