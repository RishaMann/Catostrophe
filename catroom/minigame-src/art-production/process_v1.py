from pathlib import Path
from collections import deque


from PIL import Image


ROOT = Path(__file__).resolve().parent / "v1"
MASTERS = ROOT / "masters"
RUNTIME_1X = ROOT / "runtime-1x"
RUNTIME_2X = ROOT / "runtime-2x"
STORYBOARD_FRAMES = ROOT / "storyboard-frames"

SCREEN_SIZE_1X = (540, 960)
HEADER_HEIGHT_1X = 112
ROOM_HEIGHT_1X = 793
FOOTER_HEIGHT_1X = 55


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
    "okno-right.png": (34, 150),
    "hozyain.png": (200, 48),
    "lyustra.png": (64, 40),
    "ryba.png": (30, 22),
    "podushka.png": (46, 30),
    "kover.png": (540, 110),
}

OWNER_STATIC_STATES = ("hozyain-breathe-up.png", "hozyain-awake.png")
OWNER_THROW_STATES = (
    "hozyain-throw-01.png",
    "hozyain-throw-02.png",
    "hozyain-throw-03.png",
)


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
        # Generated checkerboards often contain dark grid seams and compression
        # noise. Treat the whole neutral connected field as background while the
        # colored/near-black character outline keeps the sprite isolated.
        return max(red, green, blue) - min(red, green, blue) <= 32 and (red + green + blue) >= 120

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


def remove_dark_background(image: Image.Image) -> Image.Image:
    """Remove a near-black canvas connected to the boundary of a generated asset."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited = bytearray(width * height)
    queue = deque()

    def candidate(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        return max(red, green, blue) <= 18

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
        corners = [
            original.convert("RGB").getpixel((0, 0)),
            original.convert("RGB").getpixel((original.width - 1, 0)),
            original.convert("RGB").getpixel((0, original.height - 1)),
            original.convert("RGB").getpixel((original.width - 1, original.height - 1)),
        ]
        if all(max(pixel) <= 18 for pixel in corners):
            image = remove_dark_background(original)
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


def fill_sprite(source: Path, size: tuple[int, int], destination: Path):
    """Fill an exact gameplay box; used when the visible edge is the collider edge."""
    image = Image.open(source).convert("RGBA")
    bbox = alpha_bbox(image)
    if bbox:
        image = image.crop(bbox)
    image = image.resize(size, Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def stretch_sprite(source: Path, size: tuple[int, int], destination: Path):
    """Use the full gameplay box for tiny silhouettes designed to that exact contract."""
    original = Image.open(source)
    if "A" in original.getbands() and original.getchannel("A").getextrema()[0] < 255:
        image = original.convert("RGBA")
    else:
        rgb = original.convert("RGB")
        corners = [
            rgb.getpixel((0, 0)),
            rgb.getpixel((rgb.width - 1, 0)),
            rgb.getpixel((0, rgb.height - 1)),
            rgb.getpixel((rgb.width - 1, rgb.height - 1)),
        ]
        image = (
            remove_dark_background(original)
            if all(max(pixel) <= 18 for pixel in corners)
            else remove_checkerboard(original)
        )
    bbox = alpha_bbox(image)
    if bbox:
        image = image.crop(bbox)
    padding = max(1, round(min(size) * 0.02))
    inner = (max(1, size[0] - padding * 2), max(1, size[1] - padding * 2))
    image = image.resize(inner, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(image, (padding, padding))
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


def crop_to_aspect(image: Image.Image, aspect: float, center_y: float = 0.5) -> Image.Image:
    """Crop around a selected vertical center without stretching ornament proportions."""
    target_height = round(image.width / aspect)
    if target_height <= image.height:
        center = round(image.height * center_y)
        top = max(0, min(image.height - target_height, center - target_height // 2))
        return image.crop((0, top, image.width, top + target_height))

    target_width = round(image.height * aspect)
    left = max(0, (image.width - target_width) // 2)
    return image.crop((left, 0, left + target_width, image.height))


def save_ui_panels():
    header = Image.open(MASTERS / "hud-header.png").convert("RGB")
    header = crop_to_aspect(header, 540 / HEADER_HEIGHT_1X, 0.49)
    header.resize((540, HEADER_HEIGHT_1X), Image.Resampling.LANCZOS).save(
        RUNTIME_1X / "hud-header.png", optimize=True
    )
    header.resize((1080, HEADER_HEIGHT_1X * 2), Image.Resampling.LANCZOS).save(
        RUNTIME_2X / "hud-header.png", optimize=True
    )

    # The lower panel is only half the 110 px carpet height. Rebuild it as a
    # compact nine-slice-like strip, retaining thin edges without crushing them.
    source = Image.open(MASTERS / "hud-footer.png").convert("RGB")
    panel_bottom = min(source.height, round(source.height * 0.46))
    panel = source.crop((0, 0, source.width, panel_bottom))
    top_end = max(1, round(panel.height * 0.14))
    bottom_start = max(top_end + 1, round(panel.height * 0.84))
    strip_height = round(source.width / (540 / FOOTER_HEIGHT_1X))
    edge_height = max(8, round(strip_height * 0.18))
    middle_height = strip_height - edge_height * 2
    compact = Image.new("RGB", (source.width, strip_height))
    compact.paste(
        panel.crop((0, 0, panel.width, top_end)).resize(
            (source.width, edge_height), Image.Resampling.LANCZOS
        ),
        (0, 0),
    )
    compact.paste(
        panel.crop((0, top_end, panel.width, bottom_start)).resize(
            (source.width, middle_height), Image.Resampling.LANCZOS
        ),
        (0, edge_height),
    )
    compact.paste(
        panel.crop((0, bottom_start, panel.width, panel.height)).resize(
            (source.width, edge_height), Image.Resampling.LANCZOS
        ),
        (0, edge_height + middle_height),
    )
    compact.resize((540, FOOTER_HEIGHT_1X), Image.Resampling.LANCZOS).save(
        RUNTIME_1X / "hud-footer.png", optimize=True
    )
    compact.resize((1080, FOOTER_HEIGHT_1X * 2), Image.Resampling.LANCZOS).save(
        RUNTIME_2X / "hud-footer.png", optimize=True
    )


def save_props():
    for filename, size_1x in SIZES_1X.items():
        source = MASTERS / filename
        size_2x = (size_1x[0] * 2, size_1x[1] * 2)
        if filename == "kover.png":
            fill_sprite(source, size_1x, RUNTIME_1X / filename)
            fill_sprite(source, size_2x, RUNTIME_2X / filename)
        elif filename == "lyustra.png":
            stretch_sprite(source, size_1x, RUNTIME_1X / filename)
            stretch_sprite(source, size_2x, RUNTIME_2X / filename)
        else:
            fit_sprite(source, size_1x, RUNTIME_1X / filename)
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


def visible_top(filename: str, center_y: float) -> float:
    sprite = Image.open(RUNTIME_1X / filename).convert("RGBA")
    bbox = alpha_bbox(sprite)
    return center_y - sprite.height / 2 + (bbox[1] if bbox else 0)


def center_on_surface(child: str, surface: str, surface_y: float, overlap: float = 0) -> float:
    sprite = Image.open(RUNTIME_1X / child).convert("RGBA")
    bbox = alpha_bbox(sprite)
    visible_bottom = bbox[3] if bbox else sprite.height
    return visible_top(surface, surface_y) + overlap + sprite.height / 2 - visible_bottom


def save_preview():
    canvas = Image.open(RUNTIME_1X / "background.png").convert("RGBA")

    rug_y = 905
    composite_center(canvas, "kover.png", 270, rug_y)
    composite_center(canvas, "okno.png", 18, 384)
    composite_center(canvas, "lyustra.png", 270, 208)
    composite_center(canvas, "shkaf.png", 440, 250)
    composite_center(canvas, "stol.png", 225, 372)
    bed_y = 566
    composite_center(canvas, "krovat.png", 160, bed_y)
    composite_center(
        canvas, "hozyain.png", 125,
        center_on_surface("hozyain.png", "krovat.png", bed_y, overlap=20),
    )
    dresser_y = 575
    composite_center(canvas, "komod.png", 470, dresser_y)
    composite_center(
        canvas, "tv.png", 470,
        center_on_surface("tv.png", "komod.png", dresser_y, overlap=1),
    )
    nightstand_y = 690
    composite_center(canvas, "tumba.png", 72, nightstand_y)
    composite_center(
        canvas, "lampa.png", 72,
        center_on_surface("lampa.png", "tumba.png", nightstand_y, overlap=1),
    )
    composite_center(
        canvas, "akvarium.png", 330,
        center_on_surface("akvarium.png", "kover.png", rug_y, overlap=3),
    )
    composite_center(
        canvas, "cat.png", 100,
        center_on_surface("cat.png", "kover.png", rug_y, overlap=3),
    )

    canvas.convert("RGB").save(ROOT / "scene-preview-1x.jpg", quality=92, optimize=True)


def load_ui_font(size: int, bold: bool = False):
    from PIL import ImageFont

    candidates = [
        Path("C:/Windows/Fonts/seguisb.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def save_screen_layout_preview():
    from PIL import ImageDraw

    canvas = Image.new("RGBA", SCREEN_SIZE_1X, (20, 14, 22, 255))
    header = Image.open(RUNTIME_1X / "hud-header.png").convert("RGBA")
    footer = Image.open(RUNTIME_1X / "hud-footer.png").convert("RGBA")

    room_source = Image.open(RUNTIME_1X / "background.png").convert("RGBA")
    # Crop the room rather than stretching it: wallpaper and floor geometry stay intact.
    room = room_source.crop((0, 128, 540, 128 + ROOM_HEIGHT_1X))

    canvas.alpha_composite(header, (0, 0))
    canvas.alpha_composite(room, (0, HEADER_HEIGHT_1X))

    # Example gameplay arrangement inside the middle zone. These are preview coordinates,
    # deliberately separate from the current Phaser level coordinates.
    placements = [
        ("okno.png", 18, 384),
        ("lyustra.png", 270, 208),
        ("shkaf.png", 440, 250),
        ("stol.png", 225, 372),
    ]
    for filename, x, y in placements:
        composite_center(canvas, filename, x, y)

    bed_y = 566
    composite_center(canvas, "krovat.png", 160, bed_y)
    composite_center(
        canvas, "hozyain.png", 125,
        center_on_surface("hozyain.png", "krovat.png", bed_y, overlap=20),
    )
    dresser_y = 575
    composite_center(canvas, "komod.png", 470, dresser_y)
    composite_center(
        canvas, "tv.png", 470,
        center_on_surface("tv.png", "komod.png", dresser_y, overlap=1),
    )
    nightstand_y = 690
    composite_center(canvas, "tumba.png", 72, nightstand_y)
    composite_center(
        canvas, "lampa.png", 72,
        center_on_surface("lampa.png", "tumba.png", nightstand_y, overlap=1),
    )
    rug_y = 905
    composite_center(canvas, "kover.png", 270, rug_y)
    composite_center(
        canvas, "akvarium.png", 330,
        center_on_surface("akvarium.png", "kover.png", rug_y, overlap=3),
    )
    composite_center(
        canvas, "cat.png", 100,
        center_on_surface("cat.png", "kover.png", rug_y, overlap=3),
    )

    # The existing promotion/hint component overlays the lower half of the rug.
    footer_top = HEADER_HEIGHT_1X + ROOM_HEIGHT_1X
    canvas.alpha_composite(footer, (0, footer_top))

    draw = ImageDraw.Draw(canvas)
    cream = (255, 238, 204, 255)
    muted = (218, 191, 158, 255)
    dark = (56, 31, 25, 255)
    gold = (238, 177, 69, 255)

    draw.text((18, 14), "ЗАДАНИЕ", font=load_ui_font(13, bold=True), fill=gold)
    draw.text((18, 35), "Соберите 3 рыбки и доберитесь до выхода", font=load_ui_font(15, bold=True), fill=cream)
    draw.rounded_rectangle((18, 72, 372, 84), radius=6, fill=(50, 31, 32, 230), outline=(143, 88, 45, 255), width=1)
    draw.rounded_rectangle((19, 73, 135, 83), radius=5, fill=gold)
    draw.text((402, 20), "РЫБКИ", font=load_ui_font(11, bold=True), fill=muted)
    draw.text((430, 48), "0 / 3", font=load_ui_font(24, bold=True), fill=cream)

    draw.text((18, footer_top + 9), "УПРАВЛЕНИЕ КОТОМ", font=load_ui_font(9, bold=True), fill=gold)
    draw.text(
        (18, footer_top + 27),
        "← → / A D — идти   ·   ПРОБЕЛ — прыжок",
        font=load_ui_font(12, bold=True),
        fill=cream,
    )

    canvas.convert("RGB").save(ROOT / "screen-layout-preview-1x.jpg", quality=94, optimize=True)


def main():
    save_backgrounds()
    save_ui_panels()
    save_props()
    save_cat_frames()
    save_preview()
    save_screen_layout_preview()


if __name__ == "__main__":
    main()
