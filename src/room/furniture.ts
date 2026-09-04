// Стартовая раскладка мебели — якорные позиции по умолчанию (аналог DEFAULT
// в старом app.js). Сами предметы (размер/высота/проходимость) теперь берутся
// из каталога (itemCatalog.ts), а не хардкодятся здесь — эта раскладка лишь
// подбирает 5 предметов из каталога и расставляет их по углам/центру, чтобы
// при старте игры комната не была пустой. Остальной каталог доступен через
// инвентарь (UIScene) — игрок доставляет его сам.

import { FurnitureInstance } from "../iso/squareGrid";
import { RoomSpec } from "./RoomSpec";
import { CATALOG_BY_ID } from "./itemCatalog";

type Anchor = "backLeftCorner" | "backRightCorner" | "frontCenter" | "center";

interface DefaultPlacement {
  id: string;
  anchor: Anchor;
  offset: [number, number]; // отступ от угла-якоря, в клетках
}

const DEFAULT_LAYOUT: DefaultPlacement[] = [
  { id: "wardrobe", anchor: "backLeftCorner", offset: [0, 0] },
  { id: "bookshelf", anchor: "backRightCorner", offset: [0, 0] },
  { id: "table", anchor: "frontCenter", offset: [0, 0] },
  { id: "bowls", anchor: "frontCenter", offset: [2, 0] },
  // отдельно стоящий высокий предмет посреди пола, со всех сторон обходной —
  // для проверки §8.4 (1/2/4: подход с дальней/ближней стороны, стояние в линию)
  { id: "lamp", anchor: "center", offset: [0, 0] },
];

function anchorCell(
  anchor: Anchor,
  room: RoomSpec,
  footprint: [number, number],
  offset: [number, number]
): [number, number] {
  const [W, D] = room.size;
  const [fw, fd] = footprint;
  if (anchor === "backLeftCorner") return [offset[0], offset[1]];
  if (anchor === "backRightCorner") return [W - fw - offset[0], offset[1]];
  if (anchor === "center") return [Math.floor((W - fw) / 2) + offset[0], Math.floor((D - fd) / 2) + offset[1]];
  // frontCenter
  return [Math.floor((W - fw) / 2) + offset[0], D - fd - offset[1]];
}

export function buildFurniture(room: RoomSpec): FurnitureInstance[] {
  return DEFAULT_LAYOUT.map((p) => {
    const item = CATALOG_BY_ID[p.id];
    return {
      id: item.id,
      cell: anchorCell(p.anchor, room, item.footprint, p.offset),
      footprint: item.footprint,
      height: item.height,
      blocksFloor: item.blocksFloor,
    };
  });
}
