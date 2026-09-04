import sys
import os
import numpy as np
from PIL import Image

# GIF-транспарентность (info['transparency']) тут не читается честно —
# индекс объявлен в палитре, но ни разу не встречается в реальных пикселях
# кадра; фон запечён как обычный непрозрачный чёрный (0,0,0). Альфу считаем
# по порогу яркости (max(R,G,B) < 15) — под этим порогом только фон и
# антиалиасинг на его границе, самый тёмный цвет самого кота (тёмно-
# коричневый [76,59,47] и темнее) заметно светлее, не задевается.
#
# 151 кадр разложены по 4 сегментам под конкретные триггеры (заказчик задал
# диапазоны по номерам кадров, 1-индексация, границы включительно):
#   1..38   (0..37)   — play_idle  — редкое случайное событие после долгого "sit"
#   39..91  (38..90)  — play_toy1  — первое взаимодействие с игрушкой
#   92..128 (91..127) — play_toy2  — второе взаимодействие в течение 5с после первого
#   129..151(128..150)— play_fed   — покормили "с руки" (перетащили еду на кота)

SEGMENTS = [
    ("play_idle", 0, 38),
    ("play_toy1", 38, 91),
    ("play_toy2", 91, 128),
    ("play_fed", 128, 151),
]

gif_path = sys.argv[1]
out_dir = sys.argv[2]
os.makedirs(out_dir, exist_ok=True)

im = Image.open(gif_path)
frames = []
for i in range(im.n_frames):
    im.seek(i)
    frames.append(np.array(im.convert("RGB")))

print("total frames:", len(frames))

for prefix, start, end in SEGMENTS:
    for k, idx in enumerate(range(start, end)):
        rgb = frames[idx]
        is_bg = rgb.max(axis=2) < 15
        alpha = np.where(is_bg, 0, 255).astype(np.uint8)
        rgba = np.dstack([rgb, alpha])
        ys, xs = np.where(alpha > 0)
        pad = 4
        x0, x1 = max(0, xs.min() - pad), min(rgba.shape[1] - 1, xs.max() + pad)
        y0, y1 = max(0, ys.min() - pad), min(rgba.shape[0] - 1, ys.max() + pad)
        crop = rgba[y0 : y1 + 1, x0 : x1 + 1]
        out = Image.fromarray(crop, mode="RGBA")
        out.save(os.path.join(out_dir, f"{prefix}_{k}.png"))
    print(prefix, "frames:", end - start, f"(gif index {start}..{end-1})")
