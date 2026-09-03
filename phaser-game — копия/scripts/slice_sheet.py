import sys
import os
import numpy as np
from PIL import Image
from scipy import ndimage

path = sys.argv[1]
out_dir = sys.argv[2]
prefix = sys.argv[3]
os.makedirs(out_dir, exist_ok=True)

im = Image.open(path).convert("RGB")
arr = np.asarray(im).astype(np.int16)
sat = arr.max(axis=2) - arr.min(axis=2)
dark = arr.min(axis=2) < 60
mask = (sat > 18) | dark  # НЕ дилатированная — это финальная альфа-маска содержимого

struct = np.ones((9, 9), dtype=bool)
mask_d = ndimage.binary_dilation(mask, structure=struct)
labels, n = ndimage.label(mask_d, structure=np.ones((3, 3), dtype=bool))

boxes = []
for i in range(1, n + 1):
    ys, xs = np.where(labels == i)
    if len(xs) < 400:
        continue
    boxes.append((xs.min(), ys.min(), xs.max(), ys.max()))

# группируем в строки по y (с допуском), сортируем строки по y, внутри строки по x
boxes.sort(key=lambda bb: bb[1])
rows = []
for bb in boxes:
    placed = False
    for row in rows:
        if abs(row[0][1] - bb[1]) < 120:
            row.append(bb)
            placed = True
            break
    if not placed:
        rows.append([bb])
rows.sort(key=lambda row: row[0][1])
for row in rows:
    row.sort(key=lambda bb: bb[0])

PAD = 6
alpha_full = (mask * 255).astype(np.uint8)
rgba = np.dstack([np.asarray(im), alpha_full])

manifest = []
for ri, row in enumerate(rows):
    for ci, (x0, y0, x1, y1) in enumerate(row):
        xa, ya = max(0, x0 - PAD), max(0, y0 - PAD)
        xb, yb = min(rgba.shape[1] - 1, x1 + PAD), min(rgba.shape[0] - 1, y1 + PAD)
        crop = rgba[ya:yb + 1, xa:xb + 1]
        out = Image.fromarray(crop, mode="RGBA")
        name = f"{prefix}_r{ri}_c{ci}.png"
        out.save(os.path.join(out_dir, name))
        manifest.append((ri, ci, name, out.size[0], out.size[1]))

print("rows:", len(rows), "cols per row:", [len(r) for r in rows])
for m in manifest:
    print(m)
