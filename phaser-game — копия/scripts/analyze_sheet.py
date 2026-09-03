import sys
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert("RGB")
w, h = im.size
print("size", w, h)
px = im.load()

# Картинка полностью непрозрачна (alpha=255 везде) — "прозрачность" нарисована
# шахматкой из двух серых оттенков. Ищем содержимое кота по НАСЫЩЕННОСТИ
# цвета: мех/контуры явно небелые/цветные, шахматка — почти нейтральный серый.
SAT_THRESHOLD = 18

col_has_content = [False] * w
row_has_content = [False] * h
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        sat = max(r, g, b) - min(r, g, b)
        dark = min(r, g, b) < 60  # чёрные контуры — тоже содержимое, но низкая насыщенность
        if sat > SAT_THRESHOLD or dark:
            col_has_content[x] = True
            row_has_content[y] = True

def runs(flags, min_gap=3):
    # схлопываем разрывы короче min_gap (антиалиасинг на границах шахматки)
    out = []
    start = None
    gap = 0
    for i, f in enumerate(flags):
        if f:
            if start is None:
                start = i
            gap = 0
        else:
            if start is not None:
                gap += 1
                if gap > min_gap:
                    out.append((start, i - gap))
                    start = None
    if start is not None:
        out.append((start, len(flags) - 1))
    return out

col_runs = runs(col_has_content, min_gap=4)
row_runs = runs(row_has_content, min_gap=4)
print("col runs:", len(col_runs))
for r in col_runs:
    print("  x", r, "width", r[1] - r[0] + 1)
print("row runs:", len(row_runs))
for r in row_runs:
    print("  y", r, "height", r[1] - r[0] + 1)
