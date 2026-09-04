import sys
import os
import shutil

src_dir = sys.argv[1]  # scripts/out/<skin>
prefix = sys.argv[2]   # redfat / siamese
out_dir = sys.argv[3]  # public/art/cats/<skin>
os.makedirs(out_dir, exist_ok=True)

NAMES = {
    (0, 0): "sit_front_a",
    (0, 1): "sit_front_b",
    (0, 2): "sit_back_a",
    (0, 3): "sit_back_b",
    (1, 0): "lie_front_a",
    (1, 1): "lie_front_b",
    (1, 2): "lie_back_a",
    (1, 3): "lie_back_b",
}
for c in range(6):
    NAMES[(2, c)] = f"walk_frontleft_{c}"
    NAMES[(3, c)] = f"walk_backleft_{c}"
    NAMES[(4, c)] = f"walk_away_{c}"
    NAMES[(5, c)] = f"walk_frontleft_alt_{c}"

count = 0
for (r, c), name in NAMES.items():
    src = os.path.join(src_dir, f"{prefix}_r{r}_c{c}.png")
    if not os.path.exists(src):
        print("MISSING", src)
        continue
    dst = os.path.join(out_dir, f"{name}.png")
    shutil.copyfile(src, dst)
    count += 1
print("copied", count, "frames to", out_dir)
