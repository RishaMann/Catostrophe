"""
extract_play_frames.py — режет анимационный GIF кота (игра/кормление и т.п.)
на именованные PNG-кадры с альфой, без "гуляния" тела между кадрами.

Использование:
    py scripts/extract_play_frames.py <путь к GIF> <папка вывода>
    py scripts/extract_play_frames.py <путь к GIF> <папка вывода> --segment play_idle:0:30 --segment play_toy:30:80

Без --segment режет по границам из SEGMENTS ниже — они под конкретный уже
подготовленный GIF сиамского кота (151 кадр, 4 сегмента под конкретные
игровые триггеры, см. комментарий у SEGMENTS в конце файла). Для ДРУГОГО
кота/GIF передай свои сегменты явно через --segment (можно сколько угодно
раз) — имя:start:end, полуинтервал, как срез Python (end не включён).

Кадры сохраняются как <имя_сегмента>_<номер_в_сегменте>.png, начиная с 0 —
формат имён, который читает game.js/config.json персонажа (см.
catroom/Cats/<Имя>/config.json, поле sprites.play* — frames+count).

---------------------------------------------------------------------------
Что этот скрипт делает НЕ так, как первая версия (и почему это было видно
на сиамском коте) — держать в голове при повторном запуске на новом GIF:

1. АЛЬФА ПО СВЯЗНОСТИ С РАМКОЙ КАДРА, НЕ ПО ОДНОМУ ПОРОГУ ЯРКОСТИ.

   Раньше: пиксель считался фоном, если он темнее порога (max(R,G,B) < 15) —
   и точка. У сиамского кота "пойнты" (морда, уши, лапы, хвост) — САМИ ПО
   СЕБЕ тёмно-коричневые до почти чёрных, ничем не светлее фона по этой
   метрике. Их вырезало точно так же, как настоящий фон — получались
   прозрачные дыры прямо в шерсти и на морде.

   Теперь: тёмные пиксели сперва помечаются только КАНДИДАТАМИ в фон, а
   реальным фоном считаются лишь те из них, что связаны заливкой
   (scipy.ndimage.label) С РАМКОЙ КАДРА. Тёмное пятно на хвосте, со всех
   сторон окружённое более светлой шерстью, к рамке не подключено — значит
   это не фон, остаётся непрозрачным. Работает, только если тёмная область
   кота НИГДЕ не касается вплотную самого края кадра — при исходном
   разрешении с полями вокруг персонажа так и есть; если после кропа
   какой-то кадр внезапно снова дырявый по контуру — первым делом проверить
   именно это (см. --pad, можно увеличить отступ).

2. ОДНА ОБЩАЯ РАМКА КРОПА НА ВЕСЬ GIF, НЕ СВОЯ У КАЖДОГО КАДРА.

   Раньше: каждый кадр обрезался по границе СВОИХ СОБСТВЕННЫХ непрозрачных
   пикселей. Кадр, где кот вытянул хвост шире обычного, становился шире
   остальных — а Phaser, центрируя спрайт по ширине ЕГО ТЕКУЩЕЙ картинки
   (setOrigin(0.5,1) в game.js), каждый раз сдвигал видимый "центр" туда-
   сюда — тело кота шаталось на месте, хотя в кадрах само не двигалось.

   Теперь: сперва считается альфа ВСЕХ кадров ВСЕГО GIF (не по сегментам —
   так тело не дёргается и НА СТЫКЕ между сегментами тоже, если в игре они
   идут подряд, как playToy1→playToy2), берётся ОБЪЕДИНЕНИЕ их непрозрачных
   границ (самый широкий/высокий охват на всю анимацию), и КАЖДЫЙ кадр
   обрезается по этой ОДНОЙ общей рамке. У всех кадров теперь одинаковый
   размер, один и тот же пиксель координаты всегда означает одно и то же
   место на кадре — тело не гуляет.
---------------------------------------------------------------------------
"""

import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

DARK_THRESH = 15  # яркость (max(R,G,B)) — ниже неё пиксель считается КАНДИДАТОМ в фон


def parse_segment(s):
    name, start, end = s.split(":")
    return (name, int(start), int(end))


def load_gif_frames(path):
    im = Image.open(path)
    frames = []
    for i in range(im.n_frames):
        im.seek(i)
        frames.append(np.array(im.convert("RGB")))
    return frames


def alpha_mask(rgb):
    """Альфа по связности тёмных пикселей с рамкой кадра — см. пункт 1 в докстринге модуля."""
    dark = rgb.max(axis=2) < DARK_THRESH
    labels, _ = ndimage.label(dark, structure=np.ones((3, 3), dtype=bool))
    border_labels = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    border_labels.discard(0)
    bg = np.isin(labels, list(border_labels))
    return np.where(bg, 0, 255).astype(np.uint8)


def union_bbox(masks, w, h, pad):
    """Общая рамка непрозрачных пикселей по ВСЕМ маскам сразу — см. пункт 2."""
    x0 = y0 = x1 = y1 = None
    for m in masks:
        ys, xs = np.where(m > 0)
        if len(xs) == 0:
            continue
        fx0, fx1, fy0, fy1 = xs.min(), xs.max(), ys.min(), ys.max()
        x0 = fx0 if x0 is None else min(x0, fx0)
        x1 = fx1 if x1 is None else max(x1, fx1)
        y0 = fy0 if y0 is None else min(y0, fy0)
        y1 = fy1 if y1 is None else max(y1, fy1)
    if x0 is None:
        raise ValueError("во всех кадрах пусто после отсева фона — проверь DARK_THRESH")
    return (max(0, x0 - pad), max(0, y0 - pad), min(w - 1, x1 + pad), min(h - 1, y1 + pad))


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("gif_path")
    ap.add_argument("out_dir")
    ap.add_argument(
        "--segment", action="append", type=parse_segment, dest="segments",
        help="имя:start:end (полуинтервал, как срез Python) — можно указывать несколько раз",
    )
    ap.add_argument("--pad", type=int, default=4, help="запас в пикселях вокруг общей рамки (по умолчанию 4)")
    args = ap.parse_args()
    segments = args.segments or SEGMENTS

    os.makedirs(args.out_dir, exist_ok=True)
    frames = load_gif_frames(args.gif_path)
    print("total frames:", len(frames))

    masks = [alpha_mask(f) for f in frames]
    h, w = frames[0].shape[:2]
    x0, y0, x1, y1 = union_bbox(masks, w, h, args.pad)
    print("общая рамка кропа:", (x0, y0, x1, y1), "размер кадра:", (x1 - x0 + 1, y1 - y0 + 1))

    for name, start, end in segments:
        for k, idx in enumerate(range(start, end)):
            rgba = np.dstack([frames[idx], masks[idx]])
            crop = rgba[y0 : y1 + 1, x0 : x1 + 1]
            Image.fromarray(crop, mode="RGBA").save(os.path.join(args.out_dir, f"{name}_{k}.png"))
        print(name, "frames:", end - start, f"(gif index {start}..{end - 1})")


# 151 кадр исходного siamese_play_full.gif разложены по 4 сегментам под
# конкретные игровые триггеры (заказчик задавал диапазоны по номерам кадров,
# 1-индексация, границы включительно) — см. Cats/Siamese/config.json,
# sprites.playIdle/playToy1/playToy2/playFed и game.js (playHand/feedHand):
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

if __name__ == "__main__":
    main()
