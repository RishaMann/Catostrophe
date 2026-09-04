// §4 промпта — квадратная сетка размещения: мебель, слоты, стены, потолок.

import { DepthPoint } from "./depth";

export const S = 32; // сторона клетки, мировые единицы

export interface FurnitureInstance {
  id: string;
  cell: [number, number]; // origin, квадратные координаты
  footprint: [number, number]; // [w, d] в клетках
  height: number; // в клетках
  blocksFloor: boolean; // true → пол под предметом непроходим
  sortAnchor?: [number, number]; // см. §8.3
}

export const cellCenter = (i: number, j: number) => ({
  wx: S * i + S / 2,
  wy: S * j + S / 2,
});

// §8.2 — точка сортировки предмета: ближний к зрителю угол футпринта
// (для 1×1 это ровно (S*(i+1), S*(j+1)) из документа), либо sortAnchor,
// если он задан вручную (§8.3, вариант 1 — длинные предметы у стены).
export function furnitureDepthPoint(f: FurnitureInstance): DepthPoint {
  const [i, j] = f.sortAnchor ?? [f.cell[0] + f.footprint[0], f.cell[1] + f.footprint[1]];
  return { facet: "floorItem", wx: S * i, wy: S * j, wz: 0 };
}
