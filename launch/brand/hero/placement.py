"""
Where a hero render sits on the 1500 × 500 X header (plain Python: numpy + Pillow).

The header (launch/brand/x-header.html) shows a 1640 × 1000 CSS-px game frame inside a
circular "moon window", scaled 0.62 and placed at (570, -107). The hero's web runs along
y = 7.5 + 0.25 x and the gripping fist sits at (930, 240). The hero is scaled so the whole
figure fits roughly within x 760–1180 and y 180–520 (the legs may crop at the bottom).
"""

import json
import os

import numpy as np
from PIL import Image, ImageFilter

FIST = (930.0, 240.0)
BOX = (760.0, 180.0, 1180.0, 520.0)  # left, top, right, bottom (bottom may crop)
TARGET_HEIGHT = 330.0  # header px, the figure's height when nothing else limits it
MOON_CENTRE = (1290.0, 250.0)
MOON_RADIUS = 560.0
FRAME_ORIGIN = (570.0, -107.0)
FRAME_SCALE = 0.62  # header px per frame CSS px (the frame PNG is 2 image px per CSS px)


def figure_alpha(png):
    """The render's alpha with the thin web strand removed (morphological opening)."""
    im = Image.open(png)
    a = im.getchannel("A")
    small = a.resize((a.width // 4, a.height // 4), Image.BILINEAR)
    opened = small.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7))
    return np.asarray(opened.resize(a.size, Image.BILINEAR)) > 127, im.size


def placement(png):
    """Scale and offset (header px) for a render, from its JSON sidecar and silhouette."""
    meta = json.load(open(os.path.splitext(png)[0] + ".json"))
    fx, fy = meta["fist_px"]
    mask, (w, h) = figure_alpha(png)
    ys, xs = np.nonzero(mask)
    left, top, right, bottom = xs.min(), ys.min(), xs.max(), ys.max()
    s = TARGET_HEIGHT / (bottom - top)
    if right > fx:
        s = min(s, (BOX[2] - FIST[0]) / (right - fx))
    if top < fy:
        s = min(s, (FIST[1] - BOX[1]) / (fy - top))
    if left < fx:
        s = min(s, (FIST[0] - BOX[0]) / (fx - left))
    x0 = FIST[0] - fx * s
    y0 = FIST[1] - fy * s
    return {
        "scale": float(s),
        "left": float(x0),
        "top": float(y0),
        "width": float(w * s),
        "height": float(h * s),
        "figure_box": [float(x0 + left * s), float(y0 + top * s), float(x0 + right * s), float(y0 + bottom * s)],
        "fist_px": [float(fx), float(fy)],
    }


def header_mask(png, place, size=(1500, 500)):
    """The figure's silhouette in header px."""
    mask, _ = figure_alpha(png)
    im = Image.fromarray((mask * 255).astype(np.uint8))
    im = im.resize((max(1, round(place["width"])), max(1, round(place["height"]))), Image.BILINEAR)
    canvas = Image.new("L", size, 0)
    canvas.paste(im, (round(place["left"]), round(place["top"])))
    return np.asarray(canvas) > 100


def frame_to_header(xp, yp):
    """Frame image px (3280 × 2000) to header px."""
    return FRAME_ORIGIN[0] + xp / 2 * FRAME_SCALE, FRAME_ORIGIN[1] + yp / 2 * FRAME_SCALE
