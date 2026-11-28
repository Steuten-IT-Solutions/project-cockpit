#!/usr/bin/env python3
"""Refreshes the app screenshots on the company website (website/assets/projects/*.webp).

Run weekly by .github/workflows/website-screenshots.yml, or by hand:
    pip install playwright pillow && playwright install chromium
    python3 bin/website-screenshots.py

Each app is opened like on a phone (390 x 844, German), install hints are closed, and the page is
saved as WebP at 540 px width. A picture is only replaced when it looks noticeably different, so
small rendering noise does not create a change every week. If an app does not answer, redirects
elsewhere or shows an unexpected title (an error or maintenance page), the script stops with an
error and replaces nothing, so a broken state never reaches the website.
"""
import io
import sys
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / 'website' / 'assets' / 'projects'

# file name -> (address, a word the page title must contain)
APPS = {
    'marine': ('https://marinekompanie-lank.de/app', 'Marinekompanie'),
    # 'bruderschaft': ('https://bruderschaft-lanklatum-app.de/', 'Sebastianus'),  # may be shown from 10 Dec 2026
    'toolbox': ('https://toolbox-hub.app', 'ToolBox'),
    'garden': ('https://my-garden-planner.app', 'Garden'),
    'party': ('https://partyplaylist.app', 'PartyPlaylist'),
}

WIDTH, HEIGHT = 540, 1169
# Mean difference per colour channel (0-255) above which a picture counts as changed.
THRESHOLD = 2.0
# Buttons that close "install the app" hints and similar overlays.
CLOSE = ['button[aria-label*="chlie"]', 'button[aria-label*="lose"]', 'button:has-text("×")', 'button:has-text("✕")']


def capture(page, url: str, title_word: str) -> Image.Image:
    response = page.goto(url, wait_until='networkidle', timeout=45_000)
    if response is None or response.status >= 400:
        raise RuntimeError(f'{url} answered with status {response.status if response else "none"}')
    if urlparse(page.url).hostname != urlparse(url).hostname:
        raise RuntimeError(f'{url} redirected to {page.url}')
    title = page.title()
    if title_word.lower() not in title.lower():
        raise RuntimeError(f'{url} has the unexpected title "{title}"')
    page.wait_for_timeout(1500)
    for selector in CLOSE:
        button = page.locator(selector).first
        if button.is_visible():
            button.click()
            page.wait_for_timeout(500)
    shot = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
    return shot.resize((WIDTH, HEIGHT), Image.LANCZOS)


def differs(new: Image.Image, path: Path) -> bool:
    if not path.exists():
        return True
    old = Image.open(path).convert('RGB').resize((WIDTH, HEIGHT))
    diff = ImageStat.Stat(ImageChops.difference(new, old)).mean
    return sum(diff) / len(diff) > THRESHOLD


def main() -> int:
    shots = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                                      is_mobile=True, has_touch=True, locale='de-DE', color_scheme='light')
        for name, (url, title_word) in APPS.items():
            page = context.new_page()
            shots[name] = capture(page, url, title_word)
            page.close()
        browser.close()

    # Only write once every app was captured, so a failure leaves all pictures as they were.
    changed = []
    for name, image in shots.items():
        path = OUT / f'{name}.webp'
        if differs(image, path):
            image.save(path, 'WEBP', quality=74, method=6)
            changed.append(name)
    print('changed: ' + (', '.join(changed) if changed else 'none'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
