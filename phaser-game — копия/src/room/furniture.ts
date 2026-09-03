// Тестовые данные мебели для шага 2 (§12): проверяем, что при изменении
// RoomSpec.size мебель переезжает по якорным правилам и не съезжает за пол.
// Постоянного каталога предметов в этом промпте нет — это временный набор
// для проверки квадратной сетки, не финальный контент игры.

import { FurnitureInstance } from "../iso/squareGrid";
import { RoomSpec } from "./RoomSpec";

type Anchor = "backLeftCorner" | "backRightCorner" | "frontCenter" | "center";

interface AnchoredFurniture {
  id: string;
  footprint: [number, number];
  height: number;
  blocksFloor: boolean;
  anchor: Anchor;
  offset: [number, number]; // отступ от угла-якоря, в клетках
}

const CATALOG: AnchoredFurniture[] = [
  { id: "wardrobe", footprint: [1, 1], height: 3, blocksFloor: true, anchor: "backLeftCorner", offset: [0, 0] },
  { id: "shelf", footprint: [1, 1], height: 2, blocksFloor: true, anchor: "backRightCorner", offset: [0, 0] },
  { id: "table", footprint: [2, 1], height: 1, blocksFloor: true, anchor: "frontCenter", offset: [0, 0] },
  // отдельно стоящий высокий предмет посреди пола, со всех сторон обходной —
  // для проверки §8.4 (1/2/4: подход с дальней/ближней стороны, стояние в линию)
  { id: "lamp", footprint: [1, 1], height: 3, blocksFloor: true, anchor: "center", offset: [0, 0] },
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
  return CATALOG.map((it) => ({
    id: it.id,
    cell: anchorCell(it.anchor, room, it.footprint, it.offset),
    footprint: it.footprint,
    height: it.height,
    blocksFloor: it.blocksFloor,
  }));
}
