import sys
import numpy as np
from PIL import Image
from scipy import ndimage

path = sys.argv[1]
im = Image.open(path).convert("RGB")
arr = np.asarray(im).astype(np.int16)
r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
sat = arr.max(axis=2) - arr.min(axis=2)
dark = arr.min(axis=2) < 60
mask = (sat > 18) | dark

# небольшая дилатация, чтобы слить в одно пятно детали одного кота
# (глаза/усы/лапы), разделённые тонкими белыми полосками меха
struct = np.ones((9, 9), dtype=bool)
mask_d = ndimage.binary_dilation(mask, structure=struct)

labels, n = ndimage.label(mask_d, structure=np.ones((3, 3), dtype=bool))
print("blobs found:", n)

boxes = []
for i in range(1, n + 1):
    ys, xs = np.where(labels == i)
    if len(xs) < 400:  # шум
        continue
    boxes.append((xs.min(), ys.min(), xs.max(), ys.max(), len(xs)))

boxes.sort(key=lambda bb: (bb[1] // 150, bb[0]))  # грубая сортировка по строкам, потом по x
print("significant boxes:", len(boxes))
for bb in boxes:
    print(f"  x[{bb[0]:4d},{bb[2]:4d}] y[{bb[1]:4d},{bb[3]:4d}] w={bb[2]-bb[0]+1:4d} h={bb[3]-bb[1]+1:4d} area={bb[4]}")
