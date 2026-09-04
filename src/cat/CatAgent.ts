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
// СОСТОЯНИЯ КОТА (idle/sit/lie/eat/dig/jump/walk) и автономное блуждание —
// перенос поведения из старого app.js (idleCycle/decideNext/afterRest/wander/
// feedHand/feedBowl/feedFloor/playHand). Раньше это был единственный способ
// коту двигаться; здесь он работает НАД тап-навигацией (§7.2): пока игрок не
// тапнул по полу, кот сам решает, куда идти/сесть/лечь, а любой тап (goTo)
// перехватывает управление и по прибытии возвращает кота в автономный цикл.

import { HexCell } from "../iso/hexLattice";
import { findPath } from "../nav/astar";
import {
  SIAMESE_PLAY_FED_FRAMES,
  SIAMESE_PLAY_FRAME_MS,
  SIAMESE_PLAY_IDLE_FRAMES,
  SIAMESE_PLAY_TOY1_FRAMES,
  SIAMESE_PLAY_TOY2_FRAMES,
} from "./catSprites";

// Скорость — экранные px/с, до масштабирования (§7.3, §15).
export const CAT_SPEED = { redfat: 34, siamese: 52 } as const;

// Длительности состояний "fidget"/"jump"(toy1/toy2)/"eat"(с руки) равны
// длине соответствующих анимаций siamese_play_full.gif (см. catSprites.ts) —
// у redfat таких кадров нет, но темп поведения (когда меняется настроение,
// когда отпускает bubble) один и тот же для обоих скинов, различается
// только картинка (RoomScene.updateCatSprite рисует redfat generic-заглушкой).
const FIDGET_S = (SIAMESE_PLAY_IDLE_FRAMES.length * SIAMESE_PLAY_FRAME_MS) / 1000;
const TOY1_S = (SIAMESE_PLAY_TOY1_FRAMES.length * SIAMESE_PLAY_FRAME_MS) / 1000;
const TOY2_S = (SIAMESE_PLAY_TOY2_FRAMES.length * SIAMESE_PLAY_FRAME_MS) / 1000;
const FED_S = (SIAMESE_PLAY_FED_FRAMES.length * SIAMESE_PLAY_FRAME_MS) / 1000;
const REPEAT_PLAY_WINDOW_MS = 5000; // «второе взаимодействие в течение 5с после первого»
const LONG_SIT_THRESHOLD_S = 4.5; // порог «долго сидел» — заметно выше середины rnd(2.5,6)
const FIDGET_CHANCE = 0.4; // вероятность случайного события после долгого sit

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

export type CatState = "idle" | "walk" | "sit" | "lie" | "eat" | "dig" | "jump" | "fidget";

// Реплики кота — дословный перенос SAY из старого app.js.
export const SAY = {
  hand: ["Вот это другое дело.", "Приемлемо. Ещё.", "Наконец-то сервис."],
  bowl: ["Ладно, засчитано.", "Я как раз проходил мимо.", "Не потому что ты позвал."],
  floor: ["Это. На полу. Серьёзно?", "Я вам не голубь.", "Придётся это закопать."],
  buried: ["Похороны состоялись.", "Больше никто не пострадает."],
  toy: ["Оно живое!", "Поймал. Оно мертво.", "Кинь ещё раз, я подумаю."],
} as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class CatAgent {
  cell: HexCell;
  sx: number;
  sy: number; // экранная позиция относительно origin комнаты, float — снапа к решётке в визуале нет
  path: HexCell[] = [];
  speed: number;
  dir = 0; // индекс в SPRITE_DIRS — текущий ракурс
  earTwitchMs = 0; // >0 — играть анимацию «дёрнул ухом» (путь не найден)
  walkPhase = 0; // накопленная пройденная дистанция, px — драйвер кадра анимации ходьбы (не время)

  state: CatState = "idle";
  mood = 62; // 0..100, как в старом прототипе
  bubble: string | null = null;
  bubbleMs = 0;
  playVariant: "toy1" | "toy2" = "toy1"; // для state==="jump" — RoomScene выбирает по этому набор кадров
  eatVariant: "hand" | "bowl" = "bowl"; // для state==="eat" — «с руки» (feedHand) даёт отдельную анимацию у siamese
  stateElapsedMs = 0; // время с начала текущего состояния — RoomScene гонит по нему кадр «play-once» анимаций (fidget/jump/eat-с-руки)

  private stateTimer = 0;
  private afterState: (() => void) | null = null;
  private lattice: HexCell[] = []; // свежая решётка патча — обновляется каждый update(), нужна для wander()
  private legTarget: HexCell | null = null;
  private lastDirChangeAt = -Infinity;
  private lastSitDuration = 0; // для «долго сидел» → случайный fidget в afterRest()
  private lastPlayAt = -Infinity; // performance.now() последнего playHand() — для toy1/toy2

  constructor(start: HexCell, speed: number = CAT_SPEED.redfat) {
    this.cell = start;
    this.sx = start.sx;
    this.sy = start.sy;
    this.speed = speed;
    // как старый setSt("idle",1.5,idleCycle) — короткая пауза перед первым
    // самостоятельным решением, чтобы кот не срывался с места сразу на споне
    this.setState("idle", 1.5, () => this.idleCycle());
  }

  get isWalking() {
    return this.state === "walk";
  }

  // Тап игрока по полу (§7.2) — перехватывает любое текущее автономное
  // поведение; по прибытии кот возвращается в автономный цикл.
  goTo(target: HexCell) {
    if (target.blocked) {
      this.earTwitchMs = EAR_TWITCH_MS;
      return;
    }
    this.walkTo(target, () => this.idleCycle());
  }

  // §7.5/расширение — кормление рукой (сейчас не подключено ни к какому
  // жесту в UI: старому drag-на-кота нет прямого аналога в тап-интерфейсе,
  // оставлено для полноты переноса и на будущее).
  feedHand() {
    this.path = [];
    this.bubble = pick(SAY.hand);
    this.bubbleMs = 3200;
    this.eatVariant = "hand";
    this.setState("eat", FED_S, () => {
      this.mood = clamp(this.mood + 8, 0, 100);
      this.idleCycle();
    });
  }

  playHand() {
    this.path = [];
    this.bubble = null;
    const now = performance.now();
    this.playVariant = now - this.lastPlayAt < REPEAT_PLAY_WINDOW_MS ? "toy2" : "toy1";
    this.lastPlayAt = now;
    const duration = this.playVariant === "toy2" ? TOY2_S : TOY1_S;
    this.setState("jump", duration, () => {
      this.bubble = pick(SAY.toy);
      this.bubbleMs = 3200;
      this.mood = clamp(this.mood + 5, 0, 100);
      this.idleCycle();
    });
  }

  // bowlCell — ближайшая свободная гекс-клетка у мисок (ищет RoomScene, у
  // CatAgent нет знания о расставленной мебели, только о решётке). null —
  // миски не поставлены, кормим на полу там, где кот стоит сейчас.
  feedBowl(bowlCell: HexCell | null) {
    if (!bowlCell) {
      this.feedFloor(this.cell);
      return;
    }
    this.path = [];
    this.setState("sit", rnd(2, 4), () => {
      this.walkTo(bowlCell, () => {
        this.bubble = pick(SAY.bowl);
        this.bubbleMs = 3200;
        this.eatVariant = "bowl";
        this.setState("eat", 2, () => {
          this.mood = clamp(this.mood + 10, 0, 100);
          this.idleCycle();
        });
      });
    });
  }

  feedFloor(target: HexCell) {
    this.bubble = pick(SAY.floor);
    this.bubbleMs = 3200;
    this.walkTo(target, () => {
      this.setState("dig", 2.2, () => {
        this.bubble = pick(SAY.buried);
        this.bubbleMs = 3200;
        this.mood = clamp(this.mood - 6, 0, 100);
        this.idleCycle();
      });
    });
  }

  update(dtSec: number, nowMs: number, lattice: HexCell[]) {
    this.lattice = lattice;
    if (this.earTwitchMs > 0) this.earTwitchMs = Math.max(0, this.earTwitchMs - dtSec * 1000);
    if (this.bubbleMs > 0) {
      this.bubbleMs -= dtSec * 1000;
      if (this.bubbleMs <= 0) this.bubble = null;
    }

    if (this.state === "walk") {
      this.updateWalk(dtSec, nowMs);
      return;
    }

    this.stateTimer -= dtSec;
    this.stateElapsedMs += dtSec * 1000;
    if (this.stateTimer <= 0) this.resolveAfterState();
  }

  private updateWalk(dtSec: number, nowMs: number) {
    if (!this.path.length) {
      this.resolveAfterState();
      return;
    }
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

  private resolveAfterState() {
    const after = this.afterState;
    this.afterState = null;
    this.state = "idle";
    if (after) after();
    else this.idleCycle();
  }

  private setState(state: CatState, duration: number, after: (() => void) | null) {
    this.state = state;
    this.stateTimer = duration;
    this.stateElapsedMs = 0;
    this.afterState = after;
  }

  private walkTo(target: HexCell, after: (() => void) | null) {
    if (target === this.cell) {
      this.setState("idle", 0.4, after);
      return;
    }
    const p = findPath(this.cell, target);
    if (!p.length) {
      this.setState("idle", 1.2, after);
      return;
    }
    this.path = p;
    this.state = "walk";
    this.afterState = after;
  }

  // IDLE стоит некоторое время, затем decideNext решает: чаще всего сразу
  // WALK, иногда SIT, реже LIE. После SIT/LIE (afterRest) — обычно снова
  // WALK, иногда назад в IDLE. Все ветки в итоге приходят в wander() (WALK),
  // так что кот никогда не застревает в одном состоянии навсегда.
  private idleCycle() {
    this.setState("idle", rnd(1.2, 3), () => this.decideNext());
  }

  private decideNext() {
    const r = Math.random();
    if (r < 0.55) this.wander();
    else if (r < 0.85) {
      const dur = rnd(2.5, 6);
      this.lastSitDuration = dur;
      this.setState("sit", dur, () => this.afterRest());
    } else {
      this.lastSitDuration = 0; // fidget — только после sit, не после lie
      this.setState("lie", rnd(4, 9), () => this.afterRest());
    }
  }

  private afterRest() {
    // «Кот долго сидит» — редкое самостоятельное событие (fidget), только
    // если предыдущий sit был заметно длиннее среднего.
    if (this.lastSitDuration > LONG_SIT_THRESHOLD_S && Math.random() < FIDGET_CHANCE) {
      this.lastSitDuration = 0;
      this.setState("fidget", FIDGET_S, () => (Math.random() < 0.7 ? this.wander() : this.idleCycle()));
      return;
    }
    if (Math.random() < 0.7) this.wander();
    else this.idleCycle();
  }

  private wander() {
    const target = this.randomReachableCell(38); // ~1.2 старых "клетки" (S=32) в экранных px
    if (!target) {
      this.setState("idle", 2, () => this.idleCycle());
      return;
    }
    this.walkTo(target, () => this.idleCycle());
  }

  private randomReachableCell(minDist: number): HexCell | null {
    const free = this.lattice.filter((c) => !c.blocked);
    if (!free.length) return null;
    for (let n = 0; n < 40; n++) {
      const c = free[Math.floor(Math.random() * free.length)];
      if (Math.hypot(c.sx - this.cell.sx, c.sy - this.cell.sy) >= minDist) return c;
    }
    return free[Math.floor(Math.random() * free.length)];
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
