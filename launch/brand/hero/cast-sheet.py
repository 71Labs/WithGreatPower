"""
Before / after proof sheets for the cast, from cast-shoot.mjs's runs.

    python3 launch/brand/hero/cast-sheet.py [--before game-shots/cast/before] [--after game-shots/cast/after] [--out game-shots/cast/compare]

Per character, one JPEG: the turntable (eight angles), the head close-ups and every state,
the procedural body ("before") over the MPFB one ("after"). Characters without a before run
get the after rows only.
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "game-shots", "cast")
INK = (20, 20, 20)
PAPER = (250, 246, 236)
ALLY_STATES = ["idle", "wave", "talk"]
VILLAIN_STATES = ["idle", "windup", "attack", "hit", "stunned", "guard", "open", "webbed"]


def font(size):
    for path in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def opt(name, default):
    a = sys.argv
    return a[a.index(name) + 1] if name in a else default


def tile(path, w, h, crop=(0.5, 0.5), frac=0.62):
    im = Image.open(path).convert("RGB")
    sw, sh = im.size
    cw, ch = int(sw * frac * w / h * sh / sw), int(sh * frac)
    cw = min(cw, sw)
    x = int(sw * crop[0] - cw / 2)
    y = int(sh * crop[1] - ch / 2)
    x = max(0, min(sw - cw, x))
    y = max(0, min(sh - ch, y))
    return im.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS)


def found(p):
    """A shot as PNG, or as the JPEG it was tidied into."""
    if p and not os.path.exists(p) and p.endswith(".png") and os.path.exists(p[:-4] + ".jpg"):
        return p[:-4] + ".jpg"
    return p


def row(paths, labels, w, h, frac):
    out = Image.new("RGB", (w * len(paths), h), PAPER)
    d = ImageDraw.Draw(out)
    f = font(13)
    for i, (p, lab) in enumerate(zip(paths, labels)):
        p = found(p)
        if p and os.path.exists(p):
            out.paste(tile(p, w, h, frac=frac), (i * w, 0))
        d.rectangle((i * w + 4, 4, i * w + 8 + d.textlength(lab, font=f), 22), fill=PAPER)
        d.text((i * w + 6, 5), lab, fill=INK, font=f)
    return out


def sheet(who, before, after, out):
    ally = who in ("aunt-mainnet", "uncle-gen", "mary-jpeg", "bearson", "gwei")
    states = ALLY_STATES if ally else VILLAIN_STATES
    blocks = []
    for tag, base in (("before", before), ("after", after)):
        d = os.path.join(base, who)
        if not os.path.isdir(d):
            continue
        turn = row([os.path.join(d, f"turn-{i}.png") for i in range(8)], [f"{tag} · turn {i * 45}°" for i in range(8)], 200, 300, 0.7)
        heads = row([os.path.join(d, f"head-{i}.png") for i in range(2)], [f"{tag} · head", f"{tag} · head ¾"], 300, 300, 0.75)
        st = row([os.path.join(d, f"{s}.png") for s in states], [f"{tag} · {s}" for s in states], 200, 300, 0.62 if ally else 0.8)
        blocks.append((tag, [turn, heads, st]))
    if not blocks:
        return None
    width = max(im.width for _t, ims in blocks for im in ims)
    height = 40 + sum(sum(im.height + 6 for im in ims) + 10 for _t, ims in blocks)
    img = Image.new("RGB", (width, height), PAPER)
    dr = ImageDraw.Draw(img)
    dr.text((10, 10), f"{who}: the procedural body (before) and the MPFB body with motion capture (after), /lab/cast", fill=INK, font=font(18))
    y = 40
    for _tag, ims in blocks:
        for im in ims:
            img.paste(im, (0, y))
            y += im.height + 6
        y += 10
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f"{who}.jpg")
    img.save(path, quality=86)
    return path


def moments(src, out, name):
    """A night's in-game moments (cast-moments.mjs): one strip of frames per fight, errand and
    Gwei's assist."""
    if not os.path.isdir(src):
        return None
    groups = {}
    for f in sorted(os.listdir(src)):
        if f.endswith((".png", ".jpg")):
            groups.setdefault(f.rsplit("-", 1)[0], []).append(os.path.join(src, f))
    rows = []
    for key, files in groups.items():
        pick = files[:: max(1, len(files) // 5)][:5]
        rows.append(row(pick, [key.replace("-", " ", 1)] + [""] * (len(pick) - 1), 384, 240, 1.0))
    width = max(r.width for r in rows)
    img = Image.new("RGB", (width, 40 + sum(r.height + 6 for r in rows)), PAPER)
    ImageDraw.Draw(img).text((10, 10), f"{name}: the cast in a full autopilot night (fights, errands, Gwei's assist)", fill=INK, font=font(18))
    y = 40
    for r in rows:
        img.paste(r, (0, y))
        y += r.height + 6
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f"{name}.jpg")
    img.save(path, quality=84)
    return path


def main():
    before = opt("--before", os.path.join(SHOTS, "before"))
    after = opt("--after", os.path.join(SHOTS, "after"))
    out = opt("--out", os.path.join(SHOTS, "compare"))
    whos = sorted({n for base in (before, after) if os.path.isdir(base) for n in os.listdir(base) if os.path.isdir(os.path.join(base, n))})
    for who in whos:
        p = sheet(who, before, after, out)
        if p:
            print("wrote", p)
    for night in ("a", "b"):
        p = moments(os.path.join(SHOTS, f"moments-{night}"), out, f"in-game-night-{night}")
        if p:
            print("wrote", p)


if __name__ == "__main__":
    main()
