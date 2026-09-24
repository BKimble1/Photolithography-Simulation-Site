"""Contact sheet: python3 sheet.py <dir> <out.jpg> [cols] [thumb_width] [title]
Tiles every PNG in <dir> (sorted), labelled with its file name."""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
tw = int(sys.argv[4]) if len(sys.argv) > 4 else 320
title = sys.argv[5] if len(sys.argv) > 5 else ''
files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
ims = [Image.open(os.path.join(d, f)).convert('RGB') for f in files]
if not ims:
    sys.exit('no frames')
w0, h0 = ims[0].size
th = round(h0 * tw / w0)
rows = (len(ims) + cols - 1) // cols
pad, lab, top = 6, 16, (24 if title else 0)
sheet = Image.new('RGB', (cols * (tw + pad) + pad, top + rows * (th + lab + pad) + pad), (250, 250, 248))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    tfont = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
except OSError:
    font = tfont = ImageFont.load_default()
if title:
    draw.text((pad, 5), title, fill=(30, 30, 30), font=tfont)
for i, (im, f) in enumerate(zip(ims, files)):
    r, c = divmod(i, cols)
    x = pad + c * (tw + pad)
    y = top + pad + r * (th + lab + pad)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + lab))
    draw.text((x + 2, y + 1), os.path.splitext(f)[0], fill=(60, 60, 60), font=font)
sheet.save(out, quality=86)
print(out, sheet.size)
