import sys
import os
import numpy as np
from PIL import Image, ImageSequence

# GIF-транспарентность (info['transparency']) тут не читалась честно — индекс
# объявлен, но ни разу не встречается в реальных пикселях кадра; фон
# запечён как обычный непрозрачный чёрный (0,0,0) в палитре. Поэтому альфу
# считаем по порогу яркости (max(R,G,B) < 15 — под этим порогом только фон
# и антиалиасинг на его границе, самый тёмный цвет самого кота — коричневый
# [76,59,47], заметно светлее).

gif_path = sys.argv[1]
out_dir = sys.argv[2]
count = int(sys.argv[3]) if len(sys.argv) > 3 else 6
os.makedirs(out_dir, exist_ok=True)

im = Image.open(gif_path)
frames = []
for i in range(im.n_frames):
    im.seek(i)
    frames.append(im.convert("RGB").copy())

n = len(frames)
idxs = [round(i * (n - 1) / (count - 1)) for i in range(count)]
print("picked frame indices:", idxs)

for k, idx in enumerate(idxs):
    rgb = np.array(frames[idx])
    is_bg = rgb.max(axis=2) < 15
    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    ys, xs = np.where(alpha > 0)
    pad = 4
    x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1] - 1, xs.max() + pad)
    y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0] - 1, ys.max() + pad)
    crop = rgba[y0 : y1 + 1, x0 : x1 + 1]
    out = Image.fromarray(crop, mode="RGBA")
    out.save(os.path.join(out_dir, f"play_{k}.png"))
    print(k, idx, crop.shape)
