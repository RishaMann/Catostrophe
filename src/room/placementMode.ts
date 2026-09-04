// §9.2 промпта — режим расстановки. Единственный режим, где вообще
// появляются оверлеи, и только квадратные (гекс-решётка тут не показывается
// никогда — игрок расставляет мебель по квадратам и о гексах не знает).

import { buildHexLattice } from "../iso/hexLattice";
import { buildNeighbors, markBlocked } from "../iso/latticeBridge";
import { FurnitureInstance, S } from "../iso/squareGrid";
import { countFreeComponents } from "../nav/astar";
import { RoomSpec } from "./RoomSpec";

export interface Slot {
  cell: [number, number];
  breaksConnectivity: boolean;
}

// Все позиции footprint-а предмета, которые физически помещаются в комнату и
// не пересекаются с ДРУГОЙ мебелью (сам перемещаемый предмет исключён —
// он не мешает сам себе). Занятые/за-пределами клетки просто не попадают в
// список — «нелегальные — не подсвечиваются вовсе».
export function candidateSlots(room: RoomSpec, item: FurnitureInstance, others: FurnitureInstance[]): [number, number][] {
  const [W, D] = room.size;
  const [fw, fd] = item.footprint;
  const slots: [number, number][] = [];
  for (let i = 0; i <= W - fw; i++) {
    for (let j = 0; j <= D - fd; j++) {
      const overlaps = others.some((f) => {
        const [ow, od] = f.footprint;
        return i < f.cell[0] + ow && f.cell[0] < i + fw && j < f.cell[1] + od && f.cell[1] < j + fd;
      });
      if (!overlaps) slots.push([i, j]);
    }
  }
  return slots;
}

// Пересобирает решётку целиком для гипотетической расстановки — только по
// событию «вошли в режим расстановки / двигаем призрак», не в update() (§6).
function wouldBreakConnectivity(room: RoomSpec, furnitureAfterMove: FurnitureInstance[]): boolean {
  const [W, D] = room.size;
  const lattice = buildHexLattice(S * W, S * D);
  markBlocked(lattice, furnitureAfterMove);
  buildNeighbors(lattice);
  return countFreeComponents(lattice) > 1;
}

export function buildSlots(room: RoomSpec, item: FurnitureInstance, others: FurnitureInstance[]): Slot[] {
  return candidateSlots(room, item, others).map((cell) => {
    const hypothetical = [...others, { ...item, cell }];
    return { cell, breaksConnectivity: wouldBreakConnectivity(room, hypothetical) };
  });
}

// Ближайший слот к мировой точке в радиусе полуклетки (S/2) — снап призрака.
export function nearestSlot(slots: Slot[], item: FurnitureInstance, wx: number, wy: number): Slot | null {
  const [fw, fd] = item.footprint;
  let best: Slot | null = null;
  let bestD = Infinity;
  for (const s of slots) {
    const cx = S * (s.cell[0] + fw / 2);
    const cy = S * (s.cell[1] + fd / 2);
    const d = Math.hypot(cx - wx, cy - wy);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best && bestD <= S / 2 ? best : null;
}
