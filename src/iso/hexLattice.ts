// §5 промпта — гексагональная сетка навигации. Определена в ЭКРАННЫХ
// координатах (осознанно, см. §5) относительно origin комнаты, а не в мировых.
// Импортирует только projection.ts (§2, §11) — никакой зависимости от
// квадратной сетки размещения/мебели.

import { projX, projY, unproject } from "./projection";

export interface HexCell {
  c: number;
  r: number; // индекс в решётке
  sx: number;
  sy: number; // центр в экранных координатах (относительно origin комнаты)
  wx: number;
  wy: number; // центр в мировых координатах
  blocked: boolean;
  nb: HexCell[]; // проходимые соседи, кэш — заполняется мостом (§6)
}

// Вершины клетки относительно центра, экранные пиксели (§5.1). Габарит 48×16.
export const HEX_VERTS: [number, number][] = [
  [-24, 0],
  [-8, -8],
  [8, -8],
  [24, 0],
  [8, 8],
  [-8, 8],
];

// Центр гекса (c, r) в экранных координатах относительно origin комнаты (§5.2).
export const hexCenter = (c: number, r: number) => ({
  sx: 32 * c,
  sy: 16 * r + (c & 1 ? 8 : 0),
});

// Шесть соседей, odd-q offset (§5.3) — копировать буквально.
export function hexNeighbors(c: number, r: number): [number, number][] {
  const odd = c & 1;
  return [
    [c, r - 1],
    [c, r + 1],
    [c + 1, odd ? r : r - 1],
    [c + 1, odd ? r + 1 : r],
    [c - 1, odd ? r : r - 1],
    [c - 1, odd ? r + 1 : r],
  ];
}

// Генерация решётки под комнату (§5.4). floorW/floorD — размер пола в МИРОВЫХ
// единицах (S*W, S*D) — считает вызывающая сторона, чтобы этот модуль не
// зависел от squareGrid.ts (правило §11: hexLattice.ts импортирует только
// projection.ts).
export function buildHexLattice(floorW: number, floorD: number): HexCell[] {
  const cells: HexCell[] = [];
  const corners: [number, number][] = [
    [0, 0],
    [floorW, 0],
    [floorW, floorD],
    [0, floorD],
  ];
  const xs = corners.map(([a, b]) => projX(a, b));
  const ys = corners.map(([a, b]) => projY(a, b));
  const c0 = Math.floor(Math.min(...xs) / 32) - 1;
  const c1 = Math.ceil(Math.max(...xs) / 32) + 1;
  const r0 = Math.floor(Math.min(...ys) / 16) - 1;
  const r1 = Math.ceil(Math.max(...ys) / 16) + 1;

  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) {
      const { sx, sy } = hexCenter(c, r);
      const { wx, wy } = unproject(sx, sy);
      // клетка входит в решётку, только если её ЦЕНТР внутри пола
      if (wx < 0 || wy < 0 || wx > floorW || wy > floorD) continue;
      cells.push({ c, r, sx, sy, wx, wy, blocked: false, nb: [] });
    }
  }
  return cells;
}

// Ближайшая по экранным координатам клетка — для тапа игрока (не часть §5,
// но той же геометрической природы: экранная решётка → клетка).
export function nearestCell(cells: HexCell[], sx: number, sy: number): HexCell | undefined {
  let best: HexCell | undefined;
  let bestD = Infinity;
  for (const c of cells) {
    const d = (c.sx - sx) ** 2 + (c.sy - sy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// §10 — интерфейс Lattice: at/fromWorld/fromScreen. Держим как свободные
// функции над HexCell[] (не класс), чтобы не тянуть в этот файл ничего, кроме
// projection.ts. Для правильной гекс-мостовки «ближайший центр» и есть точный
// ответ на «в какой клетке эта точка» — ячейка Вороного вокруг центра гекса
// в этой мостовке в точности совпадает с самим шестиугольником.
export function at(cells: HexCell[], c: number, r: number): HexCell | undefined {
  return cells.find((cell) => cell.c === c && cell.r === r);
}

export function fromScreen(cells: HexCell[], sx: number, sy: number): HexCell | undefined {
  return nearestCell(cells, sx, sy);
}

export function fromWorld(cells: HexCell[], wx: number, wy: number): HexCell | undefined {
  return nearestCell(cells, projX(wx, wy), projY(wx, wy, 0));
}
