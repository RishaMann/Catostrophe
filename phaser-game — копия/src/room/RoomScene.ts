import Phaser from "phaser";
import { projX, projY, unproject } from "../iso/projection";
import { HexCell, nearestCell } from "../iso/hexLattice";
import { FurnitureInstance, S, furnitureDepthPoint } from "../iso/squareGrid";
import { depthOf } from "../iso/depth";
import { CatAgent } from "../cat/CatAgent";
import { CAT_FRAME_NAMES, CatSkin, DIR_SPRITES, textureKey } from "../cat/catSprites";
import { buildFloorPatch, NavPatch } from "../nav/navPatch";
import { buildSlots, nearestSlot, Slot } from "./placementMode";
import { DEFAULT_ROOM, RoomSpec } from "./RoomSpec";
import { buildFurniture } from "./furniture";

// §12, шаг 1: пустая комната — пол, две задние стены, сетка стен.
// Проверка глазами: ромб пола симметричен; стены сходятся в дальнем углу
// без щели в один пиксель (обеспечено тем, что обе стены и пол используют
// одну и ту же вычисленную точку дальнего угла).

const FLOOR_FILL = 0x2e2833;
const WALL_R_FILL = 0x342d3b;
const WALL_L_FILL = 0x282330;
const LINE = 0xebe2d5;

// Было 0.14 (~35-45px) — визуально влезал в стены/мебель на соседних клетках
// (шаг колонки решётки — 32px, а якорь спрайта одна точка «ноги», сам спрайт
// тянется вверх от неё). Меньше — меньше ложных «сквозь стену»/«сквозь мебель».
const CAT_ART_SCALE = 0.075; // исходники ~250-330px, коту на сцене место ~19-25px
const WALK_FRAME_DIST = 10; // экранных px пройденного пути на один кадр анимации ходьбы

type Pt = { x: number; y: number };

export class RoomScene extends Phaser.Scene {
  room: RoomSpec = DEFAULT_ROOM;
  origin = { x: 135, y: 120 }; // экранное смещение origin комнаты — хранится камерой/сценой, не проекцией
  furniture: FurnitureInstance[] = []; // текущая расстановка — источник для моста §6 и debug
  patch!: NavPatch; // §7.5 — навигационный патч пола (решётка + блокировки)
  cat!: CatAgent;
  catSkin: CatSkin = "baton";
  catEnabled = true; // §«настройки сцены» — тумблер «кот в комнате», debug-панель
  private g!: Phaser.GameObjects.Graphics; // статичный слой: пол + стены
  private dynG!: Phaser.GameObjects.Graphics; // §8: рябь от тапа поверх сцены
  private catImg!: Phaser.GameObjects.Image; // спрайт кота (art/cats/) — на своём depth, не в dynG
  // §8 — каждый предмет мебели теперь отдельный GameObject со своим .depth,
  // а не один общий Graphics: коту (тоже отдельный GameObject, спрайт) нужно
  // уметь оказаться и выше, и ниже любого предмета в зависимости от кадра —
  // Phaser сам сортирует объекты по .depth, вручную порядок рисования не нужен.
  private furnitureGfx = new Map<FurnitureInstance, Phaser.GameObjects.Graphics>();
  private placementG!: Phaser.GameObjects.Graphics; // §9.2 — единственный контейнер оверлеев расстановки
  private placement: { item: FurnitureInstance; slots: Slot[]; ghost: [number, number] | null } | null = null;

  get isPlacementActive(): boolean {
    return this.placement !== null;
  }
  private ripples: { x: number; y: number; born: number }[] = []; // §9.1 — единственная обратная связь на тап

  constructor() {
    super("RoomScene");
  }

  preload() {
    for (const name of CAT_FRAME_NAMES) {
      this.load.image(textureKey(this.catSkin, name), `/art/cats/${this.catSkin}/${name}.png`);
    }
  }

  create() {
    // Явные depth на слоях, которые не участвуют в §8-сортировке: пол/стены
    // всегда в самом низу, рябь от тапа и оверлей расстановки — всегда сверху
    // (depthOf() мебели/кота лежит примерно в [0, 4096] для 8×8 комнаты, но
    // это не гарантия на будущее — берём с большим запасом).
    this.g = this.add.graphics().setDepth(-1e6);
    this.dynG = this.add.graphics().setDepth(1e6);
    this.placementG = this.add.graphics().setDepth(1e6 + 1);
    this.catImg = this.add.image(0, 0, textureKey(this.catSkin, DIR_SPRITES[0].idle)).setScale(CAT_ART_SCALE).setOrigin(0.5, 1);
    this.redraw();
    this.spawnCat();

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const sx = p.x - this.origin.x, sy = p.y - this.origin.y;

      if (this.placement) {
        this.confirmOrCancelPlacement();
        return;
      }
      // Тап по уже стоящему предмету — «взять в руку», войти в режим
      // расстановки (§9.2). Настоящего магазина/инвентаря в этом промпте нет,
      // это временная замена входной точки.
      const hit = this.furnitureAt(sx, sy);
      if (hit) {
        this.enterPlacement(hit);
        return;
      }
      // Тап по полу — идти в ближайшую клетку под курсором (§7.2, §13: тап в
      // недостижимую точку или под мебелью не двигает кота и не ломает состояние).
      const cell = nearestCell(this.patch.lattice, sx, sy);
      if (cell) this.cat.goTo(cell);
      this.spawnRipple(sx, sy);
    });

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.placement) return;
      const sx = p.x - this.origin.x, sy = p.y - this.origin.y;
      this.updateGhost(sx, sy);
    });

    this.input.keyboard?.on("keydown-ESC", () => this.cancelPlacement());

    // DebugGridScene не запускается автоматически — Phaser стартует только
    // первую сцену из конфига; параллельные оверлеи нужно запускать явно.
    // Ключа может не быть вовсе (prod-сборка, §9.3 — сцена вырезана бандлером).
    if (this.scene.manager.keys["DebugGridScene"]) this.scene.launch("DebugGridScene");
  }

  update(time: number, delta: number) {
    if (this.catEnabled) {
      this.cat.update(delta / 1000, time);
      this.updateCatSprite();
    }
    this.catImg.setVisible(this.catEnabled);
    this.dynG.clear();
    this.drawRipples();
    if (this.placement) this.drawPlacement();
  }

  // §8 — перекрытие: и мебель, и кот теперь отдельные GameObject'ы со своим
  // .depth = depthOf(...) — Phaser сам рисует их в порядке по depth, вручную
  // сортировать/перерисовывать на каждый кадр не нужно. У мебели depth
  // выставляется один раз при перестановке (rebuildFurnitureGfx), у кота —
  // каждый кадр здесь, потому что его клетка (и с ней depth) меняется на ходу.
  private updateCatSprite() {
    const img = this.catImg;
    const dirSprite = DIR_SPRITES[this.cat.dir];
    const frames = dirSprite.frames;
    const frameName = this.cat.isWalking
      ? frames[Math.floor(this.cat.walkPhase / WALK_FRAME_DIST) % frames.length]
      : dirSprite.idle;
    img.setTexture(textureKey(this.catSkin, frameName));
    img.setFlipX(dirSprite.flip);
    img.setPosition(this.origin.x + this.cat.sx, this.origin.y + this.cat.sy);
    img.setTint(this.cat.earTwitchMs > 0 ? 0xffb0b0 : 0xffffff);
    img.setDepth(
      depthOf({
        // §8.2 — точка сортировки кота: мировой центр ТЕКУЩЕЙ клетки, не
        // непрерывная позиция — иначе порядок мог бы дёргаться внутри шага.
        facet: "cat",
        wx: this.cat.cell.wx,
        wy: this.cat.cell.wy,
        wz: 0,
      })
    );
  }

  // §9.1 — единственная допустимая обратная связь на тап в обычном режиме:
  // короткая круговая волна 200 мс, не привязанная к форме/сетке клетки.
  private spawnRipple(sx: number, sy: number) {
    this.ripples.push({ x: sx, y: sy, born: performance.now() });
  }

  private drawRipples() {
    const now = performance.now();
    this.ripples = this.ripples.filter((r) => now - r.born < 200);
    for (const r of this.ripples) {
      const t = (now - r.born) / 200;
      const cx = this.origin.x + r.x, cy = this.origin.y + r.y;
      this.dynG.lineStyle(1.5, 0xebe2d5, 1 - t);
      this.dynG.strokeCircle(cx, cy, 3 + t * 14);
    }
  }

  // §9.2 — режим расстановки. Подбор предмета «в руку»: упрощённое
  // хит-тестирование по клетке пола на wz=0 (тап по верху высокого предмета
  // мимо его напольной footprint-клетки не сработает — акт для теста/демо,
  // без полноценного 3D-хиттеста).
  private furnitureAt(sx: number, sy: number): FurnitureInstance | null {
    const { wx, wy } = unproject(sx, sy);
    const i = Math.floor(wx / S), j = Math.floor(wy / S);
    return (
      this.furniture.find(
        (f) => i >= f.cell[0] && i < f.cell[0] + f.footprint[0] && j >= f.cell[1] && j < f.cell[1] + f.footprint[1]
      ) ?? null
    );
  }

  private enterPlacement(item: FurnitureInstance) {
    const others = this.furniture.filter((f) => f !== item);
    const slots = buildSlots(this.room, item, others);
    this.placement = { item, slots, ghost: null };
    // на старом месте предмет, взятый «в руку», больше не рисуется — его
    // представляет только призрак в drawPlacement()
    this.furnitureGfx.get(item)?.setVisible(false);
  }

  private cancelPlacement() {
    if (this.placement) this.furnitureGfx.get(this.placement.item)?.setVisible(true);
    this.placement = null;
    this.placementG.clear();
  }

  private updateGhost(sx: number, sy: number) {
    if (!this.placement) return;
    const { wx, wy } = unproject(sx, sy);
    const slot = nearestSlot(this.placement.slots, this.placement.item, wx, wy);
    this.placement.ghost = slot ? slot.cell : null;
  }

  // Тап без валидного снапа (мимо всех слотов) — отмена, ничего не меняется.
  // Тап на снапнутый слот — подтверждение: раскладка меняется и патч
  // пересобирается по этому событию (§6), не в update().
  private confirmOrCancelPlacement() {
    const pl = this.placement;
    this.placement = null;
    this.placementG.clear();
    if (!pl || !pl.ghost) {
      if (pl) this.furnitureGfx.get(pl.item)?.setVisible(true); // тап без снапа — отмена, вернуть видимость
      return;
    }
    const idx = this.furniture.indexOf(pl.item);
    if (idx >= 0) this.furniture[idx] = { ...pl.item, cell: pl.ghost };
    this.patch = buildFloorPatch(this.room, this.furniture);
    this.rebuildFurnitureGfx();
  }

  // Единственный контейнер оверлеев расстановки — целиком очищается на
  // выходе из режима (cancelPlacement/confirmOrCancelPlacement), не по
  // объекту (§9.2).
  private drawPlacement() {
    if (!this.placement) return;
    const { item, slots, ghost } = this.placement;
    const g = this.placementG;
    g.clear();
    for (const s of slots) {
      const pts = this.footprintFloorPts(s.cell, item.footprint);
      // легальные — подсветка; слот, ломающий связность пола, — красная рамка.
      if (s.breaksConnectivity) this.fillPoly(g, pts, 0xd76a6a, 0.7);
      else this.fillPoly(g, pts, 0xe8a33d, 0.3);
    }
    if (ghost) this.drawFurnitureGhost(g, { ...item, cell: ghost });
  }

  private footprintFloorPts(cell: [number, number], footprint: [number, number]): Pt[] {
    const [i, j] = cell, [fw, fd] = footprint;
    return [
      this.toScreen(i * S, j * S),
      this.toScreen((i + fw) * S, j * S),
      this.toScreen((i + fw) * S, (j + fd) * S),
      this.toScreen(i * S, (j + fd) * S),
    ];
  }

  private drawFurnitureGhost(g: Phaser.GameObjects.Graphics, f: FurnitureInstance) {
    const [i, j] = f.cell;
    const [fw, fd] = f.footprint;
    const x0 = i * S, x1 = (i + fw) * S;
    const y0 = j * S, y1 = (j + fd) * S;
    const h = f.height * S;
    const B = this.toScreen(x1, y0, 0), C = this.toScreen(x1, y1, 0), D = this.toScreen(x0, y1, 0);
    const B2 = this.toScreen(x1, y0, h), C2 = this.toScreen(x1, y1, h), D2 = this.toScreen(x0, y1, h);
    const A2 = this.toScreen(x0, y0, h);
    this.fillPoly(g, [B, C, C2, B2], 0xe8a33d, 0.6);
    this.fillPoly(g, [D, C, C2, D2], 0xe8a33d, 0.6);
    this.fillPoly(g, [A2, B2, C2, D2], 0xe8a33d, 0.6);
  }

  // Позволяет менять RoomSpec (слайдер размера пола в debug-панели настроек)
  // и пересобирать сцену — §12, шаг 2.
  setRoom(room: RoomSpec) {
    this.room = room;
    this.redraw();
    this.relocateCatIfStranded();
  }

  // Debug-панель настроек — «Сброс»: вернуть мебель к якорным позициям по
  // умолчанию (buildFurniture), без изменения размера комнаты.
  resetToDefaultFurniture() {
    this.cancelPlacement();
    this.furniture = buildFurniture(this.room);
    this.patch = buildFloorPatch(this.room, this.furniture);
    this.rebuildFurnitureGfx();
    this.relocateCatIfStranded();
  }

  // Debug-панель настроек — «Очистить»: убрать всю мебель, оставить пустой пол.
  clearFurniture() {
    this.cancelPlacement();
    this.furniture = [];
    this.patch = buildFloorPatch(this.room, this.furniture);
    this.rebuildFurnitureGfx();
    this.relocateCatIfStranded();
  }

  private redraw() {
    this.drawShell();
    this.furniture = buildFurniture(this.room);
    this.patch = buildFloorPatch(this.room, this.furniture);
    this.rebuildFurnitureGfx();
  }

  // После пересборки патча (смена размера пола, очистка/сброс мебели) старая
  // клетка кота может не существовать в новой решётке или стать заблокированной —
  // снапаем на ближайшую свободную, путь сбрасываем (та же идея, что nearSpot
  // в старом прототипе при saveLayout()).
  private relocateCatIfStranded() {
    if (!this.cat) return;
    const stillValid = this.patch.lattice.find((c) => c === this.cat.cell && !c.blocked);
    if (stillValid) return;
    const free = this.patch.lattice.filter((c) => !c.blocked);
    const pool = free.length ? free : this.patch.lattice;
    if (!pool.length) return;
    let best = pool[0];
    let bestD = Infinity;
    for (const c of pool) {
      const d = (c.sx - this.cat.sx) ** 2 + (c.sy - this.cat.sy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    this.cat.cell = best;
    this.cat.sx = best.sx;
    this.cat.sy = best.sy;
    this.cat.path = [];
  }

  private spawnCat() {
    const start = pickStartCell(this.patch.lattice);
    this.cat = new CatAgent(start);
  }

  // §8 — каждый предмет получает свой Graphics + .depth = depthOf(...), один
  // раз при перестановке (не в update() — правило §6 в равной мере относится
  // и к пересборке визуала расстановки). Полная пересборка вместо точечного
  // обновления одного предмета — на масштабе в единицы-десятки предметов
  // это дешевле, чем городить инкрементальный дифф.
  private rebuildFurnitureGfx() {
    for (const g of this.furnitureGfx.values()) g.destroy();
    this.furnitureGfx.clear();
    for (const f of this.furniture) {
      const g = this.add.graphics();
      this.drawFurnitureInto(g, f);
      g.setDepth(depthOf(furnitureDepthPoint(f)));
      this.furnitureGfx.set(f, g);
    }
  }

  private drawFurnitureInto(g: Phaser.GameObjects.Graphics, f: FurnitureInstance) {
    const [i, j] = f.cell;
    const [fw, fd] = f.footprint;
    const x0 = i * S, x1 = (i + fw) * S;
    const y0 = j * S, y1 = (j + fd) * S;
    const h = f.height * S;

    const B = this.toScreen(x1, y0, 0), C = this.toScreen(x1, y1, 0), D = this.toScreen(x0, y1, 0);
    const B2 = this.toScreen(x1, y0, h), C2 = this.toScreen(x1, y1, h), D2 = this.toScreen(x0, y1, h);
    const A2 = this.toScreen(x0, y0, h);

    this.fillPoly(g, [B, C, C2, B2], 0x4a4152, 0.4); // правая грань (x = x1)
    this.fillPoly(g, [D, C, C2, D2], 0x3c3444, 0.4); // передняя грань (y = y1)
    this.fillPoly(g, [A2, B2, C2, D2], 0x5c5266, 0.4); // верх
  }

  private toScreen(wx: number, wy: number, wz = 0): Pt {
    return { x: this.origin.x + projX(wx, wy), y: this.origin.y + projY(wx, wy, wz) };
  }

  private fillPoly(g: Phaser.GameObjects.Graphics, pts: Pt[], fill: number, lineAlpha: number) {
    g.fillStyle(fill, 1);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fillPath();
    g.lineStyle(1, LINE, lineAlpha);
    g.strokePath();
  }

  private drawShell() {
    const { room, g } = this;
    const [W, D] = room.size;
    const floorW = W * S;
    const floorD = D * S;
    const H = room.wallHeight * S;
    g.clear();

    // пол
    this.fillPoly(
      g,
      [this.toScreen(0, 0), this.toScreen(floorW, 0), this.toScreen(floorW, floorD), this.toScreen(0, floorD)],
      FLOOR_FILL,
      0.35
    );
    g.lineStyle(1, LINE, 0.12);
    for (let i = 1; i < W; i++) {
      const a = this.toScreen(i * S, 0), b = this.toScreen(i * S, floorD);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let j = 1; j < D; j++) {
      const a = this.toScreen(0, j * S), b = this.toScreen(floorW, j * S);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }

    // правая задняя стена (плоскость wy = 0)
    this.fillPoly(
      g,
      [this.toScreen(0, 0, 0), this.toScreen(floorW, 0, 0), this.toScreen(floorW, 0, H), this.toScreen(0, 0, H)],
      WALL_R_FILL,
      0.28
    );
    g.lineStyle(1, LINE, 0.1);
    for (let i = 1; i < W; i++) {
      const a = this.toScreen(i * S, 0, 0), b = this.toScreen(i * S, 0, H);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let k = 1; k < room.wallHeight; k++) {
      const a = this.toScreen(0, 0, k * S), b = this.toScreen(floorW, 0, k * S);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }

    // левая задняя стена (плоскость wx = 0)
    this.fillPoly(
      g,
      [this.toScreen(0, 0, 0), this.toScreen(0, floorD, 0), this.toScreen(0, floorD, H), this.toScreen(0, 0, H)],
      WALL_L_FILL,
      0.28
    );
    g.lineStyle(1, LINE, 0.1);
    for (let j = 1; j < D; j++) {
      const a = this.toScreen(0, j * S, 0), b = this.toScreen(0, j * S, H);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let k = 1; k < room.wallHeight; k++) {
      const a = this.toScreen(0, 0, k * S), b = this.toScreen(0, floorD, k * S);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }
}

function pickStartCell(lattice: HexCell[]): HexCell {
  const free = lattice.filter((c) => !c.blocked);
  const pool = free.length ? free : lattice;
  return pool[Math.floor(pool.length / 2)];
}
