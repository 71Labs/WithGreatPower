"""
Makes launch/brand/art/city-backdrop.png: a real frame of the game, reframed so the game's
own (old) hero falls outside the header's moon window.

    python3 launch/brand/hero/backdrop.py <frame.png> [--keep right|left] [--zoom Z] [--y Y]
        [--out launch/brand/art/city-backdrop.png]

Frames come from launch/brand/capture.mjs (3280 × 2000, i.e. 1640 × 1000 CSS px at 2×):

    node launch/brand/capture.mjs --save launch/out/saves/night-a.json \
        --url "/play/patrol?autopilot=1&tier=high" --count 60 --every 500 --wait 7000 --out <dir>

The chase camera keeps the game's hero near the middle of every frame, and the header shows
the frame's CSS x 258–1500 (inside the moon circle). So the backdrop is a crop of the frame,
zoomed by Z, keeping the side away from the hero: the hero lands left of x 258 (or right of
1500) and is never seen. The output keeps the frame's 3280 × 2000 size, so it drops into
x-header.html in place of the old frame with the same CSS.
"""

import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
VISIBLE_X = (258.0, 1500.0)  # frame CSS px the moon window shows
W, H = 3280, 2000


def old_hero_box(frame):
    """The game's hero: the largest blob of suit red (image px)."""
    a = np.asarray(frame.convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 140) & (g < 0.33 * r) & (b < 0.33 * r)
    lab, n = ndimage.label(ndimage.binary_closing(red, iterations=4))
    sizes = ndimage.sum(red, lab, range(1, n + 1))
    sl = ndimage.find_objects(lab)[int(np.argmax(sizes))]
    return sl[1].start, sl[0].start, sl[1].stop, sl[0].stop


def reframe(frame, keep="right", zoom=None, y_frac=0.5, margin=40):
    x1, y1, x2, y2 = old_hero_box(frame)
    hidden_left = VISIBLE_X[0] * 2 - margin  # backdrop image px left of the window
    hidden_right = VISIBLE_X[1] * 2 + margin
    if keep == "right":
        # (x2 - x0) * z <= hidden_left and x0 + W / z <= W
        z_min = (W - hidden_left) / (W - x2)
        z = max(zoom or 0, z_min)
        x0 = W - W / z
    else:
        # (x1 - x0) * z >= hidden_right with x0 = 0
        z_min = hidden_right / x1
        z = max(zoom or 0, z_min)
        x0 = 0.0
    ch = H / z
    y0 = (H - ch) * y_frac
    box = (x0, y0, x0 + W / z, y0 + ch)
    out = frame.crop(tuple(round(v) for v in box)).resize((W, H), Image.LANCZOS)
    return out, {"zoom": z, "crop": [round(v) for v in box], "old_hero": [x1, y1, x2, y2]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frame")
    ap.add_argument("--keep", default="right", choices=("right", "left"))
    ap.add_argument("--zoom", type=float, default=None)
    ap.add_argument("--y", type=float, default=0.5, help="0 keeps the top of the frame, 1 the bottom")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "art", "city-backdrop.png"))
    a = ap.parse_args()
    img, info = reframe(Image.open(a.frame), a.keep, a.zoom, a.y)
    img.convert("RGB").save(a.out)
    print("[backdrop]", os.path.abspath(a.out), info)


if __name__ == "__main__":
    main()
