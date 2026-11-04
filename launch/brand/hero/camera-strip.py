"""A frame strip: every JPEG or PNG in a folder (named NNN_<seconds>.jpg) side by side in rows of four, labelled with its time, under a title.

    python3 camera-strip.py <frames dir> <out.png> <title>
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

src, dst, title = sys.argv[1], sys.argv[2], sys.argv[3]
files = sorted(f for f in os.listdir(src) if f.endswith((".png", ".jpg")))
if not files:
    sys.exit(0)
W, H = Image.open(os.path.join(src, files[0])).size
cols = 4 if W > H else 8
scale = (1600 / cols) / W
tw, th = int(W * scale), int(H * scale)
rows = (len(files) + cols - 1) // cols
bar = 40
sheet = Image.new("RGB", (cols * tw, rows * th + bar), (14, 16, 28))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
    small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 16)
except OSError:
    font = small = ImageFont.load_default()
d.text((12, 9), title, fill=(255, 230, 90), font=font)
for i, f in enumerate(files):
    im = Image.open(os.path.join(src, f)).convert("RGB").resize((tw, th))
    x, y = (i % cols) * tw, bar + (i // cols) * th
    sheet.paste(im, (x, y))
    t = f.split("_", 1)[1].rsplit(".", 1)[0] if "_" in f else str(i)
    d.rectangle((x + 4, y + 4, x + 70, y + 26), fill=(14, 16, 28))
    d.text((x + 9, y + 6), f"{float(t):+.2f}s", fill=(255, 230, 90), font=small)
sheet.save(dst)
