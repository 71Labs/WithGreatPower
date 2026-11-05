"""
Case file 001's two textures for the game (apps/wgp/public/media/chapters/), from our own art:

  case-001-poster.webp      the MISSING poster (launch/out/x-missing/missing-mary-jpeg.png),
                            straightened and cropped to the paper; the clue on the roof pole
                            uses its body, and one of its tear-off tabs for the torn strips
  case-001-hero-cutout.webp The Node standing three-quarter (render.py --pose rest34), die-cut
                            on a card border with an ink rim: the Right-Clicker's paper copies

    blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/render.py -- \
        --pose rest34 --out launch/brand/hero/build/hero-rest34.png --height 900 --no-web
    python3 launch/brand/hero/case001_textures.py [path/to/missing-mary-jpeg.png]

Needs numpy, Pillow and scipy (like backdrop.py).
"""

import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "apps", "wgp", "public", "media", "chapters")
POSTER = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "launch", "out", "x-missing", "missing-mary-jpeg.png")
HERO = os.path.join(HERE, "build", "hero-rest34.png")

# The poster's top corners in the 3200 × 1800 art (it hangs a little askew), and the paper's
# box once straightened.
TOP_LEFT = (360.0, 80.0)
TOP_RIGHT = (1472.0, 44.8)
PAPER = (372, 72, 1482, 1696)
POSTER_SIZE = (512, 750)

INK = (0x14, 0x14, 0x14)
CARD = (0xE8, 0xDF, 0xCC)


def poster():
    im = Image.open(POSTER).convert("RGB")
    ang = math.degrees(math.atan2(TOP_RIGHT[1] - TOP_LEFT[1], TOP_RIGHT[0] - TOP_LEFT[0]))
    r = im.rotate(ang, resample=Image.BICUBIC, center=TOP_LEFT, fillcolor=(20, 20, 40))
    c = r.crop(PAPER).resize(POSTER_SIZE, Image.LANCZOS)
    path = os.path.join(OUT, "case-001-poster.webp")
    c.save(path, quality=84, method=6)
    print("wrote", path, os.path.getsize(path), "bytes")


def disk(r):
    yy, xx = np.mgrid[-r : r + 1, -r : r + 1]
    return (xx * xx + yy * yy) <= r * r


def cutout(width=256, pad=30, card=14, ink=6):
    a = np.asarray(Image.open(HERO).convert("RGBA")).astype(np.float32) / 255
    a = np.pad(a, ((pad, pad), (pad, pad), (0, 0)))
    body = a[..., 3] > 0.4
    border = ndimage.binary_closing(ndimage.binary_dilation(body, structure=disk(card)), structure=np.ones((25, 25)))
    rim = ndimage.binary_dilation(border, structure=disk(ink))
    out = np.zeros(body.shape + (4,), np.float32)
    out[rim, :3] = np.array(INK) / 255
    out[rim, 3] = 1
    out[border, :3] = np.array(CARD) / 255
    out[border, 3] = 1
    alpha = a[..., 3:4]
    out[..., :3] = out[..., :3] * (1 - alpha) + a[..., :3] * alpha
    img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
    img = img.crop(img.getbbox())
    img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    path = os.path.join(OUT, "case-001-hero-cutout.webp")
    img.save(path, quality=86, method=6)
    print("wrote", path, img.size, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    poster()
    cutout()
