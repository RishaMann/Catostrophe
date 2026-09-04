// §6 промпта — единственная точка связи двух сеток. Гекс блокируется, если
// его ЦЕНТР попадает в занятую квадратную клетку (не «пересекается» —
// иначе мебель отгрызает вокруг себя лишнюю полосу и проходы исчезают).
//
// Пересборка — только по событиям (постановка/снятие мебели, смена
// состояния «после кота», открытие зоны), НЕ в update().

import { HexCell, hexNeighbors } from "./hexLattice";
import { FurnitureInstance, S } from "./squareGrid";

// Кэш проходимых соседей (HexCell.nb, §10) — граф для A* (§7.2). Пересобирать
// вместе с markBlocked, тем же не-в-update() правилом: соседство зависит от
// блокировки, поэтому порядок вызова — сначала markBlocked, потом это.
export function buildNeighbors(cells: HexCell[]) {
  const index = new Map<string, HexCell>();
  for (const cell of cells) index.set(cell.c + "," + cell.r, cell);
  for (const cell of cells) {
    cell.nb = hexNeighbors(cell.c, cell.r)
      .map(([c, r]) => index.get(c + "," + r))
      .filter((n): n is HexCell => !!n && !n.blocked);
  }
}

export function markBlocked(hex: HexCell[], furniture: FurnitureInstance[]) {
  for (const h of hex) {
    const i = Math.floor(h.wx / S);
    const j = Math.floor(h.wy / S);
    h.blocked = furniture.some(
      (f) =>
        f.blocksFloor &&
        i >= f.cell[0] &&
        i < f.cell[0] + f.footprint[0] &&
        j >= f.cell[1] &&
        j < f.cell[1] + f.footprint[1]
    );
  }
}
