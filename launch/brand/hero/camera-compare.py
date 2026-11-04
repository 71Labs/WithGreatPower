"""Before over after for every frame strip the camera pass shot (game-shots/camera/{before,after}/<name>.png), into game-shots/camera/compare/.

    python3 launch/brand/hero/camera-compare.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game-shots", "camera")
out = os.path.join(HERE, "compare")
os.makedirs(out, exist_ok=True)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 24)
except OSError:
    font = ImageFont.load_default()
for name in sorted(f for f in os.listdir(os.path.join(HERE, "after")) if f.endswith(".png") and "hud" not in f):
    pair = [os.path.join(HERE, label, name) for label in ("before", "after")]
    if not all(os.path.exists(p) for p in pair):
        continue
    ims = [Image.open(p).convert("RGB") for p in pair]
    w = max(i.width for i in ims)
    bar = 40
    sheet = Image.new("RGB", (w, sum(i.height for i in ims) + 2 * bar), (8, 9, 16))
    d = ImageDraw.Draw(sheet)
    y = 0
    for label, colour, im in zip(("BEFORE", "AFTER"), ((235, 120, 110), (120, 225, 150)), ims):
        d.text((12, y + 8), label, fill=colour, font=font)
        sheet.paste(im, (0, y + bar))
        y += bar + im.height
    sheet.save(os.path.join(out, name))
    print(os.path.join(out, name))
