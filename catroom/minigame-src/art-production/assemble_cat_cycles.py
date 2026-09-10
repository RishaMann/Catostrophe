from pathlib import Path

from PIL import Image

from process_v1 import alpha_bbox, remove_checkerboard


ROOT = Path(__file__).resolve().parent / "v1"
MASTERS = ROOT / "masters"
RUNTIME_1X = ROOT / "runtime-1x"
RUNTIME_2X = ROOT / "runtime-2x"

MASTER_CELL = (512, 384)
RUNTIME_CELL_1X = (72, 56)


def crop_visible(image: Image.Image) -> Image.Image:
    bbox = alpha_bbox(image)
    return image.crop(bbox) if bbox else image


def generated_frames(filename: str) -> list[Image.Image]:
    strip = remove_checkerboard(Image.open(MASTERS / filename))
    frames = []
    for index in range(4):
        left = round(index * strip.width / 4)
        right = round((index + 1) * strip.width / 4)
        frames.append(crop_visible(strip.crop((left, 0, right, strip.height))))
    return frames


def place_frame(frame: Image.Image, cell_size: tuple[int, int]) -> Image.Image:
    width, height = cell_size
    max_width = round(width * 0.94)
    max_height = round(height * 0.88)
    # Normalize each pose to a common visible height; width remains constrained.
    scale = min(max_height / frame.height, max_width / frame.width)
    resized = frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.LANCZOS,
    )
    cell = Image.new("RGBA", cell_size, (0, 0, 0, 0))
    x = (width - resized.width) // 2
    y = height - resized.height - round(height * 0.04)
    cell.alpha_composite(resized, (x, y))
    return cell


def save_row(prefix: str, source_name: str, generated_name: str) -> list[Image.Image]:
    source = crop_visible(Image.open(MASTERS / source_name).convert("RGBA"))
    raw_frames = [source, *generated_frames(generated_name)]
    cells = [place_frame(frame, MASTER_CELL) for frame in raw_frames]
    for index, cell in enumerate(cells):
        cell.save(MASTERS / f"{prefix}-{index:02d}.png", optimize=True)
    return cells


def save_sheet(
    rows: list[list[Image.Image]],
    directory: Path,
    cell_size: tuple[int, int],
    filename: str,
):
    sheet = Image.new(
        "RGBA",
        (cell_size[0] * 5, cell_size[1] * len(rows)),
        (0, 0, 0, 0),
    )
    for row_index, row in enumerate(rows):
        for column_index, source_cell in enumerate(row):
            cell = source_cell.resize(cell_size, Image.Resampling.LANCZOS)
            sheet.alpha_composite(
                cell,
                (column_index * cell_size[0], row_index * cell_size[1]),
            )
    directory.mkdir(parents=True, exist_ok=True)
    sheet.save(directory / filename, optimize=True)


def main():
    walk = save_row(
        "cat-walk",
        "cat-walk-source.png",
        "cat-walk-generated-strip.png",
    )
    crawl = save_row(
        "cat-crawl",
        "cat-crawl-source.png",
        "cat-crawl-generated-strip.png",
    )
    flat_crawl = save_row(
        "cat-flat-crawl",
        "cat-crawl-source.png",
        "cat-flat-crawl-generated-strip.png",
    )
    original_rows = [walk, crawl]
    all_rows = [walk, crawl, flat_crawl]
    for directory, cell_size in (
        (MASTERS, MASTER_CELL),
        (RUNTIME_1X, RUNTIME_CELL_1X),
        (RUNTIME_2X, (RUNTIME_CELL_1X[0] * 2, RUNTIME_CELL_1X[1] * 2)),
    ):
        save_sheet(original_rows, directory, cell_size, "cat-walk-crawl-cycles.png")
        save_sheet([flat_crawl], directory, cell_size, "cat-flat-crawl-cycle.png")
        save_sheet(all_rows, directory, cell_size, "cat-movement-cycles-all.png")


if __name__ == "__main__":
    main()
