"""
Before / after proof sheets for the in-game hero, from shoot.mjs's captures.

    python3 launch/brand/hero/compare.py

Reads game-shots/before/... and game-shots/after/... (frames as JPEG) and writes game-shots/compare/:
  - lab-states.jpg: every hero state in /lab/cast, the old procedural body over the MPFB one;
  - seq-<name>.jpg: each lab sequence as a strip of frames, before over after;
  - game-swing-chain.jpg and game-fight.jpg: a real swing chain and fight from an autopilot night;
  - night-<mode>.jpg: the same moments of an autopilot night (travel, fight, errand).
"""

import glob
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "game-shots")
OUT = os.path.join(SHOTS, "compare")
STATES = ["idle", "stride", "run", "swing", "air", "land", "climb", "dash", "slam", "held", "hurt", "ko"]
INK = (20, 20, 20)
PAPER = (250, 246, 236)


def font(size):
    for path in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def tile(path, w, h, label=None):
    im = Image.open(path).convert("RGB")
    sw, sh = im.size
    # Centre-crop to the tile's aspect, then scale.
    k = max(w / sw, h / sh)
    im = im.resize((round(sw * k), round(sh * k)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    im = im.crop((x, y, x + w, y + h))
    if label:
        d = ImageDraw.Draw(im)
        f = font(max(14, h // 16))
        pad = 6
        box = d.textbbox((0, 0), label, font=f)
        d.rectangle((0, 0, box[2] + pad * 2, box[3] + pad * 2), fill=PAPER)
        d.text((pad, pad), label, font=f, fill=INK)
    return im


def sheet(rows, w, h, title, out):
    """rows: [(row label, [(path, tile label)])]."""
    cols = max(len(r[1]) for r in rows)
    head = 56
    gutter = 150
    W = gutter + cols * w
    H = head + len(rows) * h
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    d.text((16, 14), title, font=font(28), fill=INK)
    for r, (label, cells) in enumerate(rows):
        y = head + r * h
        d.text((16, y + h // 2 - 14), label, font=font(24), fill=INK)
        for c, (path, tl) in enumerate(cells):
            if path and os.path.exists(path):
                img.paste(tile(path, w, h, tl), (gutter + c * w, y))
    img.save(out, quality=88, optimize=True)
    print("wrote", os.path.relpath(out, HERE))


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for which in ("before", "after"):
        rows.append((which, [(os.path.join(SHOTS, which, "lab", f"hero-{s}.jpg"), s) for s in STATES]))
    sheet(rows, 384, 300, "/lab/cast, every hero state: the procedural mannequin (before) and the MPFB body (after)", os.path.join(OUT, "lab-states.jpg"))

    for seq in sorted(glob.glob(os.path.join(SHOTS, "after", "seq", "*"))):
        name = os.path.basename(seq)
        rows = []
        for which in ("before", "after"):
            frames = sorted(glob.glob(os.path.join(SHOTS, which, "seq", name, "hero-*", "*.jpg")))
            step = max(1, len(frames) // 12)
            rows.append((which, [(f, str(i * step)) for i, f in enumerate(frames[::step][:12])]))
        sheet(rows, 320, 220, f"/lab/cast sequence: {name}", os.path.join(OUT, f"seq-{name}.jpg"))

    for name, title in (("game-fight", "In the game: the first fight (every other frame, 150 ms apart)"),):
        rows = []
        for which in ("before", "after"):
            frames = sorted(glob.glob(os.path.join(SHOTS, which, name, "*.jpg")))
            rows.append((which, [(f, str(i * 2)) for i, f in enumerate(frames[::2][:10])]))
        sheet(rows, 384, 240, title, os.path.join(OUT, f"{name}.jpg"))

    rows = []
    for which in ("before", "after"):
        frames = sorted(glob.glob(os.path.join(SHOTS, which, "game-swing", "*.jpg")))
        rows.append((which, [(f, str(i * 3)) for i, f in enumerate(frames[::3][:10])]))
    sheet(rows, 384, 240, "In the game: the autopilot's first swing chain (every third frame, 120 ms apart)", os.path.join(OUT, "game-swing-chain.jpg"))

    for mode in ("travel", "fight", "errand"):
        rows = []
        for which in ("before", "after"):
            night = os.path.join(SHOTS, which, "night-high")
            if mode == "travel":
                frames = sorted(glob.glob(os.path.join(night, "n-*-travel.jpg")))[:6]
            else:
                frames = sorted(glob.glob(os.path.join(night, f"{mode}-1-*.jpg")))[:6]
            rows.append((which, [(f, os.path.basename(f)[:-4]) for f in frames]))
        sheet(rows, 400, 250, f"Autopilot night (high, 1440×900): {mode}", os.path.join(OUT, f"night-{mode}.jpg"))


main()
