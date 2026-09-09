from pathlib import Path
from collections import deque


from PIL import Image


ROOT = Path(__file__).resolve().parent / "v1"
MASTERS = ROOT / "masters"
RUNTIME_1X = ROOT / "runtime-1x"
RUNTIME_2X = ROOT / "runtime-2x"
STORYBOARD_FRAMES = ROOT / "storyboard-frames"


SIZES_1X = {
    "tumba.png": (70, 56),
    "lampa.png": (32, 50),
    "krovat.png": (250, 60),
    "komod.png": (84, 130),
    "tv.png": (60, 40),
    "stol.png": (130, 82),
    "shkaf.png": (150, 130),
    "akvarium.png": (122, 78),
    "okno.png": (34, 150),
    "hozyain.png": (200, 48),
    "lyustra.png": (64, 40),
    "ryba.png": (30, 22),
    "podushka.png": (46, 30),
    "kover.png": (540, 110),
}


def alpha_bbox(image: Image.Image):
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    return alpha.point(lambda value: 255 if value > 3 else 0).getbbox()


def remove_checkerboard(image: Image.Image) -> Image.Image:
    """Remove a neutral checkerboard connected to the canvas boundary."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited = bytearray(width * height)
    queue = deque()

    def candidate(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        return max(red, green, blue) - min(red, green, blue) <= 20 and (red + green + blue) >= 330

    def add(x: int, y: int):
        index = y * width + x
        if not visited[index] and candidate(x, y):
            visited[index] = 1
            queue.append((x, y))

    for x in range(width):
        add(x, 0)
        add(x, height - 1)
    for y in range(height):
        add(0, y)
        add(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x:
            add(x - 1, y)
        if x + 1 < width:
            add(x + 1, y)
        if y:
            add(x, y - 1)
        if y + 1 < height:
            add(x, y + 1)

    for y in range(height):
        offset = y * width
        for x in range(width):
            if visited[offset + x]:
                red, green, blue, _ = pixels[x, y]
                pixels[x, y] = (red, green, blue, 0)
    return rgba


def fit_sprite(source: Path, size: tuple[int, int], destination: Path):
    original = Image.open(source)
    if "A" in original.getbands() and original.getchannel("A").getextrema()[0] < 255:
        image = original.convert("RGBA")
    else:
        image = remove_checkerboard(original)
    bbox = alpha_bbox(image)
    if bbox:
        image = image.crop(bbox)

    width, height = size
    padding = max(1, round(min(width, height) * 0.02))
    max_width = max(1, width - padding * 2)
    max_height = max(1, height - padding * 2)
    scale = min(max_width / image.width, max_height / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )

    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (width - resized.width) // 2
    y = height - padding - resized.height
    canvas.alpha_composite(resized, (x, y))
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, optimize=True)


def save_backgrounds():
    source = Image.open(MASTERS / "background-empty.png").convert("RGB")
    RUNTIME_2X.mkdir(parents=True, exist_ok=True)
    RUNTIME_1X.mkdir(parents=True, exist_ok=True)
    source.resize((1080, 1920), Image.Resampling.LANCZOS).save(
        RUNTIME_2X / "background.png", optimize=True
    )
    source.resize((540, 960), Image.Resampling.LANCZOS).save(
        RUNTIME_1X / "background.png", optimize=True
    )


def save_props():
    for filename, size_1x in SIZES_1X.items():
        source = MASTERS / filename
        fit_sprite(source, size_1x, RUNTIME_1X / filename)
        size_2x = (size_1x[0] * 2, size_1x[1] * 2)
        fit_sprite(source, size_2x, RUNTIME_2X / filename)


def save_cat_frames():
    sheet = Image.open(MASTERS / "siamese-movement-storyboard.png").convert("RGBA")
    cell_w = sheet.width // 4
    cell_h = sheet.height // 3
    STORYBOARD_FRAMES.mkdir(parents=True, exist_ok=True)

    frames = []
    for index in range(12):
        col = index % 4
        row = index // 4
        frame = sheet.crop(
            (col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h)
        )
        bbox = alpha_bbox(frame)
        if bbox:
            frame = frame.crop(bbox)
        frame_path = STORYBOARD_FRAMES / f"cat-key-{index + 1:02d}.png"
        frame.save(frame_path, optimize=True)
        frames.append(frame_path)

    # Current game contract: pose 1 is the regular cat; pose 10 hangs by one paw.
    fit_sprite(frames[0], (56, 38), RUNTIME_1X / "cat.png")
    fit_sprite(frames[0], (112, 76), RUNTIME_2X / "cat.png")
    fit_sprite(frames[9], (34, 54), RUNTIME_1X / "cat-hang.png")
    fit_sprite(frames[9], (68, 108), RUNTIME_2X / "cat-hang.png")


def composite_center(canvas: Image.Image, filename: str, x: float, y: float):
    sprite = Image.open(RUNTIME_1X / filename).convert("RGBA")
    left = round(x - sprite.width / 2)
    top = round(y - sprite.height / 2)
    canvas.alpha_composite(sprite, (left, top))


def save_preview():
    canvas = Image.open(RUNTIME_1X / "background.png").convert("RGBA")

    composite_center(canvas, "kover.png", 270, 905)
    composite_center(canvas, "okno.png", 18, 384)
    composite_center(canvas, "lyustra.png", 270, 208)
    composite_center(canvas, "shkaf.png", 440, 250)
    composite_center(canvas, "stol.png", 225, 372)
    composite_center(canvas, "krovat.png", 160, 566)
    composite_center(canvas, "hozyain.png", 160, 540)
    composite_center(canvas, "komod.png", 470, 575)
    composite_center(canvas, "tv.png", 470, 490)
    composite_center(canvas, "tumba.png", 72, 690)
    composite_center(canvas, "lampa.png", 72, 637)
    composite_center(canvas, "akvarium.png", 330, 811)
    composite_center(canvas, "cat.png", 100, 831)

    canvas.convert("RGB").save(ROOT / "scene-preview-1x.jpg", quality=92, optimize=True)


def main():
    save_backgrounds()
    save_props()
    save_cat_frames()
    save_preview()


if __name__ == "__main__":
    main()
