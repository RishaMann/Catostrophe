// §7.2 промпта — обычный A* по графу гексов. Эвристика — мировое расстояние
// между центрами. Стоимость всех рёбер одинакова (гекс — в этом весь смысл).
//
// Приоритетная очередь — сортировка массива на каждой итерации. Работает на
// 30–40 клетках (наш размер комнаты), но документ прямо требует заменить на
// бинарную кучу до релиза — TODO.

import { HexCell } from "../iso/hexLattice";

const dist = (a: HexCell, b: HexCell) => Math.hypot(a.wx - b.wx, a.wy - b.wy);

// Граф уже зашит в HexCell.nb (см. latticeBridge.buildNeighbors) — отдельный
// список клеток findPath-у не нужен.
export function findPath(from: HexCell, to: HexCell): HexCell[] {
  if (from === to || to.blocked) return [];

  const open: HexCell[] = [from];
  const inOpen = new Set<HexCell>([from]);
  const cameFrom = new Map<HexCell, HexCell>();
  const gScore = new Map<HexCell, number>([[from, 0]]);
  const fScore = new Map<HexCell, number>([[from, dist(from, to)]]);

  while (open.length) {
    open.sort((a, b) => fScore.get(a)! - fScore.get(b)!);
    const current = open.shift()!;
    inOpen.delete(current);

    if (current === to) return reconstruct(cameFrom, current);

    const g = gScore.get(current)!;
    for (const n of current.nb) {
      const tentative = g + dist(current, n);
      if (tentative < (gScore.get(n) ?? Infinity)) {
        cameFrom.set(n, current);
        gScore.set(n, tentative);
        fScore.set(n, tentative + dist(n, to));
        if (!inOpen.has(n)) {
          open.push(n);
          inOpen.add(n);
        }
      }
    }
  }
  return []; // путь не найден — вызывающая сторона не идёт, играет «дёрнул ухом» (§7.2)
}

function reconstruct(cameFrom: Map<HexCell, HexCell>, end: HexCell): HexCell[] {
  const path = [end];
  let current = end;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.push(current);
  }
  path.reverse();
  path.shift(); // стартовая клетка — кот уже там, идти «в себя» не нужно
  return path;
}

// Число связных компонент свободного пола по графу HexCell.nb — используется
// режимом расстановки (§9.2), чтобы определить, ломает ли слот связность
// («слот, ломающий связность пола, — красная рамка»).
export function countFreeComponents(cells: HexCell[]): number {
  const seen = new Set<HexCell>();
  let count = 0;
  for (const start of cells) {
    if (start.blocked || seen.has(start)) continue;
    count++;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const c = queue.pop()!;
      for (const n of c.nb) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }
  return count;
}
