// §7.3, §7.4 промпта — агент кота: непрерывная (float) позиция в экранных
// координатах, интерполяция между центрами гексов по уже найденному пути,
// выбор спрайтового направления по 6 гекс-направлениям.
//
// ОТКЛОНЕНИЕ ОТ §7.4 ДОКУМЕНТА (по просьбе заказчика): там 4 спрайтовых
// направления (2 ракурса + отзеркаливание), а два гекс-направления «строго
// вглубь»/«строго к зрителю» лежат точно между ними и потому сохраняют
// предыдущий ракурс (защита от дребезга). Тут добавлены ещё 2 направления —
// «строго от зрителя» и «строго на зрителя», под них нужны отдельные
// ракурсы кота в арте. Раз направлений теперь 6 и совпадают с 6
// гекс-направлениями один в один, никакой ровно-посередине ситуации больше
// не возникает — правило «сохранить предыдущий ракурс» стало не нужно и убрано.
//
// Графики тут нет: реального арта в этом промпте нет (см. §14 родительской
// задачи — новую графику ходьбы пока не добавляем), рисует RoomScene плейсхолдером.

import { HexCell } from "../iso/hexLattice";
import { findPath } from "../nav/astar";

// Скорость — экранные px/с, до масштабирования (§7.3, §15).
export const CAT_SPEED = { baton: 34, shilo: 52 } as const;

// Шесть спрайтовых направлений в экранных углах: 4 из §7.4 плюс «строго от
// зрителя» (-90°) и «строго на зрителя» (90°) — ровно то, что дают
// вертикальные гекс-шаги (0, ±16).
export const SPRITE_DIRS = [26.57, 90, 153.43, -153.43, -90, -26.57] as const;
export const SPRITE_DIR_NAMES = [
  "front-right",
  "toward-viewer",
  "front-left",
  "back-left",
  "away-from-viewer",
  "back-right",
] as const;

const DIR_COOLDOWN_MS = 150;
const EAR_TWITCH_MS = 400;

export class CatAgent {
  cell: HexCell;
  sx: number;
  sy: number; // экранная позиция относительно origin комнаты, float — снапа к решётке в визуале нет
  path: HexCell[] = [];
  speed: number;
  dir = 0; // индекс в SPRITE_DIRS — текущий ракурс
  earTwitchMs = 0; // >0 — играть анимацию «дёрнул ухом» (путь не найден)
  walkPhase = 0; // накопленная пройденная дистанция, px — драйвер кадра анимации ходьбы (не время)

  private legTarget: HexCell | null = null;
  private lastDirChangeAt = -Infinity;

  constructor(start: HexCell, speed: number = CAT_SPEED.baton) {
    this.cell = start;
    this.sx = start.sx;
    this.sy = start.sy;
    this.speed = speed;
  }

  get isWalking() {
    return this.path.length > 0;
  }

  goTo(target: HexCell) {
    if (target.blocked) {
      this.earTwitchMs = EAR_TWITCH_MS;
      return;
    }
    const p = findPath(this.cell, target);
    if (!p.length) {
      // недостижимо — кот не идёт, играет «дёрнул ухом», состояние не ломается (§7.2, §13)
      this.earTwitchMs = EAR_TWITCH_MS;
      return;
    }
    this.path = p;
  }

  update(dtSec: number, nowMs: number) {
    if (this.earTwitchMs > 0) this.earTwitchMs = Math.max(0, this.earTwitchMs - dtSec * 1000);
    if (!this.path.length) return;

    const target = this.path[0];
    if (this.legTarget !== target) {
      this.legTarget = target;
      this.applyFacing(target, nowMs);
    }

    const jitter = cellJitter(target);
    const tx = target.sx + jitter.x;
    const ty = target.sy + jitter.y;
    const dx = tx - this.sx;
    const dy = ty - this.sy;
    const distLeft = Math.hypot(dx, dy);
    const step = this.speed * dtSec;

    if (distLeft <= step) {
      this.sx = tx;
      this.sy = ty;
      this.cell = target;
      this.path.shift();
      this.legTarget = null;
    } else {
      this.sx += (dx / distLeft) * step;
      this.sy += (dy / distLeft) * step;
      this.walkPhase += step;
    }
  }

  // Направление шага в ЭКРАННЫХ координатах между центрами клеток (без джиттера —
  // он про визуальный шум внутри клетки, а не про то, куда кот фактически идёт).
  // При 6 направлениях на 6 гекс-соседей особого случая «ровно посередине»
  // больше нет (см. комментарий в шапке файла) — просто берём ближайшее.
  private applyFacing(target: HexCell, nowMs: number) {
    const dx = target.sx - this.cell.sx;
    const dy = target.sy - this.cell.sy;
    if (dx === 0 && dy === 0) return;

    if (nowMs - this.lastDirChangeAt < DIR_COOLDOWN_MS) return;

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < SPRITE_DIRS.length; i++) {
      let diff = Math.abs(angle - SPRITE_DIRS[i]);
      if (diff > 180) diff = 360 - diff;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    if (best !== this.dir) {
      this.dir = best;
      this.lastDirChangeAt = nowMs;
    }
  }
}

// Детерминированное псевдослучайное смещение внутри клетки, до ±3px, сид от
// (c, r) — постоянно для клетки, не дрожит от кадра к кадру (§7.3).
function cellJitter(cell: HexCell) {
  const hx = Math.sin(cell.c * 127.1 + cell.r * 311.7) * 43758.5453;
  const hy = Math.sin(cell.c * 269.5 + cell.r * 183.3 + 91.7) * 43758.5453;
  const fx = hx - Math.floor(hx);
  const fy = hy - Math.floor(hy);
  return { x: (fx * 2 - 1) * 3, y: (fy * 2 - 1) * 3 };
}
