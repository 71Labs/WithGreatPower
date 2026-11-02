"""
Previews a hero render in the real X header: x-header.html with the moon window's frame
swapped for the city backdrop and the hero laid over it, fist on the web at (930, 240).

    python3 launch/brand/hero/preview.py [--hero hero-swing.png] [--backdrop ../art/city-backdrop.png]
        [--out preview-header.png]

Writes <out> (1500 × 500) and <out>@2x (3000 × 1000), plus the placement it used as JSON,
so the same numbers can go into x-header.html. Like launch/brand/render.sh, it loads the
header's fonts from Google Fonts.
"""

import argparse
import json
import os
import re
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import placement as P  # noqa: E402

CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
MOON = (730.0, -310.0)  # the .moon element's top-left on the header


def build_html(hero, backdrop, place):
    src = open(os.path.join(BRAND, "x-header.html"), encoding="utf-8").read()
    rel = lambda p: os.path.relpath(os.path.abspath(p), BRAND)  # noqa: E731
    style = (
        f"left:{place['left'] - MOON[0]:.2f}px;top:{place['top'] - MOON[1]:.2f}px;"
        f"width:{place['width']:.2f}px;height:{place['height']:.2f}px"
    )
    moon = f'<div class="moon"><img src="{rel(backdrop)}" alt="" /><img src="{rel(hero)}" alt="" style="{style}" /></div>'
    out, n = re.subn(r'<div class="moon">.*?</div>', moon, src, count=1, flags=re.S)
    assert n == 1, "x-header.html has no moon window"
    return out.replace("<head>", f'<head>\n    <base href="file://{BRAND}/" />', 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", default=os.path.join(HERE, "hero-swing.png"))
    ap.add_argument("--backdrop", default=os.path.join(BRAND, "art", "city-backdrop.png"))
    ap.add_argument("--out", default=os.path.join(HERE, "preview-header.png"))
    a = ap.parse_args()

    place = P.placement(a.hero)
    build = os.path.join(HERE, "build")
    os.makedirs(build, exist_ok=True)
    page = os.path.join(build, "preview-header.html")
    with open(page, "w", encoding="utf-8") as f:
        f.write(build_html(a.hero, a.backdrop, place))
    big = os.path.splitext(a.out)[0] + "@2x.png"
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--hide-scrollbars",
            "--force-color-profile=srgb",
            "--font-render-hinting=none",
            "--virtual-time-budget=8000",
            "--force-device-scale-factor=2",
            "--window-size=1500,500",
            f"--screenshot={big}",
            "--allow-file-access-from-files",
            f"file://{page}",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    Image.open(big).resize((1500, 500), Image.LANCZOS).save(a.out)
    meta = {
        "hero": os.path.relpath(a.hero, BRAND),
        "backdrop": os.path.relpath(a.backdrop, BRAND),
        "moon_img_css": {
            "left": round(place["left"] - MOON[0], 2),
            "top": round(place["top"] - MOON[1], 2),
            "width": round(place["width"], 2),
            "height": round(place["height"], 2),
        },
        "header_placement": {k: (round(v, 3) if isinstance(v, float) else [round(x, 1) for x in v]) for k, v in place.items()},
    }
    with open(os.path.splitext(a.out)[0] + ".json", "w") as f:
        json.dump(meta, f, indent=2)
    print("[preview]", a.out, json.dumps(meta["moon_img_css"]))


if __name__ == "__main__":
    main()
