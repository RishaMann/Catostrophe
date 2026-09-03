// §7.5 промпта — решётка навигации создаётся не для комнаты, а для
// навигационного патча. Сейчас патч один (пол), links пустой. Верх дивана,
// полка, подоконник позже станут такими же патчами со своей гекс-решёткой,
// а links — рёбрами прыжка/лазания; интерфейс уже на это рассчитан.

import { buildHexLattice, HexCell } from "../iso/hexLattice";
import { buildNeighbors, markBlocked } from "../iso/latticeBridge";
import { FurnitureInstance, S } from "../iso/squareGrid";
import { RoomSpec } from "../room/RoomSpec";

export interface PatchLink {
  from: HexCell;
  to: HexCell;
  kind: "jump" | "climb";
}

export interface NavPatch {
  id: string;
  z: number; // высота патча в клетках
  bounds: { w: number; d: number }; // в квадратных клетках
  lattice: HexCell[];
  links: PatchLink[];
}

// У решётки (§5.4) нет запаса от стен — критерий включения «центр внутри
// пола» без буфера, так что центр гекса может лечь прямо на линию стены
// (wx=0 или wy=0). Кот — не точка, у его спрайта есть ширина, так что на
// такой клетке он визуально вылезал бы за стену («заходит на стенку»).
// Это НЕ часть формулы решётки из §5 (её не трогаем, см. README про уже
// найденное и принятое расхождение) — чисто навигационное ограничение
// поверх уже готовых клеток, стены есть только у wx=0 и wy=0 (см. RoomScene).
const WALL_MARGIN = 10; // мировые единицы, ~треть клетки (S=32)

function markWallMargin(lattice: HexCell[], margin: number) {
  for (const cell of lattice) {
    if (cell.wx < margin || cell.wy < margin) cell.blocked = true;
  }
}

// Тот же приём, что WALL_MARGIN выше, но вокруг мебели: markBlocked (§6,
// latticeBridge.ts) блокирует гекс только если его ЦЕНТР попал в занятую
// квадратную клетку — этого специально не трогаем (правило из спеки, «иначе
// мебель отгрызает лишнюю полосу и проходы исчезают»). Но у соседней
// РАЗБЛОКИРОВАННОЙ клетки центр может лежать вплотную к границе футпринта —
// с шириной спрайта кот на ней визуально влезает в коробку («проходит сквозь
// объекты»). Добавляем такой же навигационный запас, что и у стен, только
// считаем расстояние до прямоугольника футпринта, а не до линии стены.
// 16, не 10 (как у стены) — у мебели, в отличие от стены, запас нужен со
// всех сторон футпринта сразу, и на практике 10 всё ещё давало видимый
// заход спрайта в угол (клетка с центром в 6 мировых единицах за кромкой
// margin=10 всё ещё визуально перекрывалась соседним предметом).
const FURNITURE_MARGIN = 16;

function markFurnitureMargin(lattice: HexCell[], furniture: FurnitureInstance[], margin: number) {
  const boxes = furniture
    .filter((f) => f.blocksFloor)
    .map((f) => ({
      minX: f.cell[0] * S - margin,
      maxX: (f.cell[0] + f.footprint[0]) * S + margin,
      minY: f.cell[1] * S - margin,
      maxY: (f.cell[1] + f.footprint[1]) * S + margin,
    }));
  for (const cell of lattice) {
    if (cell.blocked) continue;
    if (boxes.some((b) => cell.wx >= b.minX && cell.wx < b.maxX && cell.wy >= b.minY && cell.wy < b.maxY)) {
      cell.blocked = true;
    }
  }
}

// Пересборка — только по событиям (постановка/снятие мебели и т.п.), не в update() (§6).
export function buildFloorPatch(room: RoomSpec, furniture: FurnitureInstance[]): NavPatch {
  const [W, D] = room.size;
  const lattice = buildHexLattice(S * W, S * D);
  markBlocked(lattice, furniture);
  markWallMargin(lattice, WALL_MARGIN);
  markFurnitureMargin(lattice, furniture, FURNITURE_MARGIN);
  buildNeighbors(lattice);
  return { id: "floor", z: 0, bounds: { w: W, d: D }, lattice, links: [] };
}
