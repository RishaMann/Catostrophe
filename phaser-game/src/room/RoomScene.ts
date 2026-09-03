import Phaser from "phaser";
import { projX, projY, unproject } from "../iso/projection";
import { HexCell, nearestCell } from "../iso/hexLattice";
import { FurnitureInstance, S, furnitureDepthPoint } from "../iso/squareGrid";
import { depthOf } from "../iso/depth";
import { CatAgent, CAT_SPEED } from "../cat/CatAgent";
import { CAT_FRAME_NAMES, CAT_SKINS, CatSkin, DIR_SPRITES, SIAMESE_PLAY_FRAMES, textureKey } from "../cat/catSprites";
import { buildFloorPatch, NavPatch } from "../nav/navPatch";
import { buildSlots, nearestSlot, Slot } from "./placementMode";
import { DEFAULT_ROOM, RoomSpec } from "./RoomSpec";
import { buildFurniture } from "./furniture";
import { CATALOG_BY_ID, SUPPLY_BY_ID } from "./itemCatalog";

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
const PLAY_FRAME_DIST_MS = 90; // мс реального времени на один кадр siamese_play.gif

// Дверь/окно — перенос door/window из старого app.js: дверь на левой задней
// стене (плоскость wx=0), окно на правой (wy=0), таскаются drag'ом прямо по
// стене. pos — доля 0..1 вдоль стены (в старом прототипе — метры, тут проще
// держать долей длины стены, чтобы не зависеть от размера комнаты).
const DOOR_W_CELLS = 1.2, DOOR_H_CELLS = 2.4;
const WIN_W_CELLS = 1.5, WIN_Z0_CELLS = 1.0, WIN_Z1_CELLS = 2.3;
const DOOR_FILL = 0x4a4152;
const WIN_FILL = 0x5a7a9a;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Холст маленький (270×480, §15) — в отличие от старого SVG-прототипа
// (viewBox 540×960, вектор, не размывается никогда в принципе), тут растровый
// WebGL-канвас, и он же растягивается CSS почти втрое на реальный вьюпорт —
// отсюда «кашеобразный» текст и тонкие линии панелей.
//
// TEXT_RESOLUTION — плотность именно текстовых битмапов (Text.resolution):
// текст готовится заранее в несколько раз детальнее логического кегля.
//
// RENDER_SCALE — плотность ВСЕГО остального рендера (Graphics/Image): у
// канваса в main.ts бэкбуфер в RENDER_SCALE раз больше, а camera.zoom того же
// значения компенсирует это, чтобы сценические координаты (origin, §3/§5
// формулы, вся раскладка UI) остались как есть — просто рисуются в
// RENDER_SCALE раз детальнее. Формула компенсации scroll — не «на глаз»,
// взята из исходника Phaser (Camera.preRender, node_modules/phaser/dist/
// phaser.js): `worldView.x = scrollX + width/2*(1-1/zoom)`, поэтому чтобы
// исходная область (0,0)…(width/zoom,height/zoom) осталась видна как раньше,
// нужен именно applyRenderScale() ниже, а не «просто setZoom».
// §15 промпта («Зафиксированные константы»): «Логический холст — 270×480,
// масштаб ×4». В реализации до этой сессии холст был взят, а масштаб ×4 —
// потерян: канвас рендерился буквально в 270×480 физических пикселей и
// растягивался CSS почти втрое — отсюда и блюр текста/панелей. RENDER_SCALE=4
// возвращает именно то значение, что зафиксировано в спеке, не произвольное.
export const TEXT_RESOLUTION = 4;
export const RENDER_SCALE = 4;

export function applyRenderScale(camera: Phaser.Cameras.Scene2D.Camera, userZoom = 1) {
  const zoom = RENDER_SCALE * userZoom;
  camera.setZoom(zoom);
  camera.setScroll(-(camera.width / 2) * (1 - 1 / zoom), -(camera.height / 2) * (1 - 1 / zoom));
}

type Pt = { x: number; y: number };

export class RoomScene extends Phaser.Scene {
  room: RoomSpec = DEFAULT_ROOM;
  origin = { x: 135, y: 120 }; // экранное смещение origin комнаты — хранится камерой/сценой, не проекцией
  furniture: FurnitureInstance[] = []; // текущая расстановка — источник для моста §6 и debug
  patch!: NavPatch; // §7.5 — навигационный патч пола (решётка + блокировки)
  cat!: CatAgent;
  catSkin: CatSkin = "redfat";
  catEnabled = true; // §«настройки сцены» — тумблер «кот в комнате», debug-панель
  private supplyDragId: string | null = null; // id из itemCatalog.SUPPLIES, если сейчас тащат корм/игрушку из UIScene
  door = { pos: 0.35 }; // доля 0..1 вдоль левой задней стены (wx=0)
  win = { pos: 0.5 }; // доля 0..1 вдоль правой задней стены (wy=0)
  private openingDrag: "door" | "window" | null = null;
  private g!: Phaser.GameObjects.Graphics; // статичный слой: пол + стены
  private dynG!: Phaser.GameObjects.Graphics; // §8: рябь от тапа поверх сцены
  private catImg!: Phaser.GameObjects.Image; // спрайт кота (art/cats/) — на своём depth, не в dynG
  // §8 — каждый предмет мебели теперь отдельный GameObject со своим .depth,
  // а не один общий Graphics: коту (тоже отдельный GameObject, спрайт) нужно
  // уметь оказаться и выше, и ниже любого предмета в зависимости от кадра —
  // Phaser сам сортирует объекты по .depth, вручную порядок рисования не нужен.
  private furnitureGfx = new Map<FurnitureInstance, Phaser.GameObjects.Graphics>();
  private placementG!: Phaser.GameObjects.Graphics; // §9.2 — единственный контейнер оверлеев расстановки
  private placement: { item: FurnitureInstance; slots: Slot[]; ghost: [number, number] | null; isNew: boolean } | null =
    null;
  private bubbleText!: Phaser.GameObjects.Text; // реплика кота (SAY.*) — над спрайтом

  get isPlacementActive(): boolean {
    return this.placement !== null;
  }
  private ripples: { x: number; y: number; born: number }[] = []; // §9.1 — единственная обратная связь на тап

  constructor() {
    super("RoomScene");
  }

  preload() {
    // Грузим кадры ОБОИХ скинов сразу (не только текущего) — переключение
    // персонажа в настройках (UIScene) должно быть мгновенным, без повторной
    // загрузки текстур.
    for (const skin of CAT_SKINS) {
      for (const name of CAT_FRAME_NAMES) {
        this.load.image(textureKey(skin, name), `/art/cats/${skin}/${name}.png`);
      }
    }
    for (const name of SIAMESE_PLAY_FRAMES) {
      this.load.image(textureKey("siamese", name), `/art/cats/siamese/${name}.png`);
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
    this.bubbleText = this.add
      .text(0, 0, "", {
        fontSize: "8px",
        color: "#2e2833",
        backgroundColor: "#ebe2d5",
        padding: { x: 5, y: 3 },
        resolution: TEXT_RESOLUTION,
      })
      .setOrigin(0.5, 1)
      .setDepth(1e6 + 3)
      .setVisible(false);
    applyRenderScale(this.cameras.main);
    this.redraw();
    this.spawnCat();

    // Перенос из старого app.js: расстановка мебели и кормление/игра — это
    // drag (pointerdown → pointermove → pointerup), а не «тап-тап», как было
    // раньше в этом промпте. Тап по полу вне drag'а — по-прежнему тап-ходьба
    // (§7.2, это не из старого прототипа, а часть текущей спеки навигации).
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const sx = p.worldX - this.origin.x, sy = p.worldY - this.origin.y;

      if (this.placement) {
        // Защита от «застрявшего» состояния — при drag-модели pointerdown
        // посреди активной расстановки в норме не происходит (pointerup уже
        // её завершил); если всё же случилось — тихо отменяем и продолжаем.
        this.cancelPlacement();
        return;
      }
      // Дверь/окно — drag прямо по стене (перенос startMove("door"/"window")).
      if (this.hitDoor(sx, sy)) {
        this.openingDrag = "door";
        return;
      }
      if (this.hitWindow(sx, sy)) {
        this.openingDrag = "window";
        return;
      }
      // Тап-и-потяни по уже стоящему предмету — «взять в руку» (§9.2, как
      // startDrag(kind:"item") в старом прототипе).
      const hit = this.furnitureAt(sx, sy);
      if (hit) {
        this.enterPlacement(hit);
        this.updateGhost(sx, sy); // тап без последующего движения тоже даёт валидный призрак
        return;
      }
      // Тап по полу — идти в ближайшую клетку под курсором (§7.2, §13: тап в
      // недостижимую точку или под мебелью не двигает кота и не ломает состояние).
      const cell = nearestCell(this.patch.lattice, sx, sy);
      if (cell) this.cat.goTo(cell);
      this.spawnRipple(sx, sy);
    });

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const sx = p.worldX - this.origin.x, sy = p.worldY - this.origin.y;
      if (this.openingDrag) {
        this.dragOpening(sx, sy);
        return;
      }
      if (!this.placement) return;
      this.updateGhost(sx, sy);
    });

    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const sx = p.worldX - this.origin.x, sy = p.worldY - this.origin.y;
      if (this.openingDrag) {
        this.openingDrag = null;
        return;
      }
      if (this.placement) {
        this.confirmOrCancelPlacement();
        return;
      }
      if (this.supplyDragId) {
        this.resolveSupplyDrop(sx, sy);
      }
    });

    this.input.keyboard?.on("keydown-ESC", () => this.cancelPlacement());

    // DebugGridScene/UIScene не запускаются автоматически — Phaser стартует
    // только первую сцену из конфига; параллельные оверлеи нужно запускать
    // явно. DebugGridScene-ключа может не быть вовсе (prod-сборка, §9.3 —
    // сцена вырезана бандлером), UIScene — всегда игровая, не debug.
    if (this.scene.manager.keys["DebugGridScene"]) this.scene.launch("DebugGridScene");
    this.scene.launch("UIScene");
  }

  update(time: number, delta: number) {
    if (this.catEnabled) {
      this.cat.update(delta / 1000, time, this.patch.lattice);
      this.updateCatSprite();
      this.updateBubble();
    }
    this.catImg.setVisible(this.catEnabled);
    this.bubbleText.setVisible(this.catEnabled && !!this.cat.bubble);
    this.dynG.clear();
    this.drawRipples();
    this.drawSupplyGhost();
    if (this.placement) this.drawPlacement();
  }

  // §8 — перекрытие: и мебель, и кот теперь отдельные GameObject'ы со своим
  // .depth = depthOf(...) — Phaser сам рисует их в порядке по depth, вручную
  // сортировать/перерисовывать на каждый кадр не нужно. У мебели depth
  // выставляется один раз при перестановке (rebuildFurnitureGfx), у кота —
  // каждый кадр здесь, потому что его клетка (и с ней depth) меняется на ходу.
  // Кадры sit/lie/eat/dig/jump — своих ракурсов в исходном арте нет (только
  // idle-сидение, лёж и ходьба, см. README «Арт кота»), поэтому eat/dig
  // визуально используют тот же кадр, что sit (лёгкое покачивание вместо
  // отдельной анимации), а jump — первый кадр ходьбы с вертикальным подскоком
  // (та же идея, что jumpY в старом app.js).
  private updateCatSprite() {
    const img = this.catImg;
    const cat = this.cat;
    const dirSprite = DIR_SPRITES[cat.dir];
    let frameName: string;
    let bobY = 0;
    switch (cat.state) {
      case "walk":
        frameName = dirSprite.frames[Math.floor(cat.walkPhase / WALK_FRAME_DIST) % dirSprite.frames.length];
        break;
      case "sit":
        frameName = dirSprite.sitAlt;
        break;
      case "lie":
        frameName = dirSprite.lie;
        break;
      case "eat":
      case "dig":
        frameName = dirSprite.sitAlt;
        bobY = Math.sin(performance.now() / 90) * 1.5;
        break;
      case "jump":
        frameName = dirSprite.frames[0];
        bobY = -Math.abs(Math.sin(performance.now() / 140)) * 6;
        break;
      default:
        frameName = dirSprite.idle;
    }

    // Игра с игрушкой у сиамского кота — отдельная раскладка кадров
    // (siamese_play.gif, без ракурсов/флипа, см. catSprites.ts) вместо
    // общего bounce-приёма выше.
    if (cat.state === "jump" && this.catSkin === "siamese") {
      const idx = Math.floor(performance.now() / PLAY_FRAME_DIST_MS) % SIAMESE_PLAY_FRAMES.length;
      img.setTexture(textureKey("siamese", SIAMESE_PLAY_FRAMES[idx]));
      img.setFlipX(false);
    } else {
      img.setTexture(textureKey(this.catSkin, frameName));
      img.setFlipX(dirSprite.flip);
    }
    img.setPosition(this.origin.x + cat.sx, this.origin.y + cat.sy + bobY);
    img.setTint(cat.earTwitchMs > 0 ? 0xffb0b0 : 0xffffff);
    img.setDepth(
      depthOf({
        // §8.2 — точка сортировки кота: мировой центр ТЕКУЩЕЙ клетки, не
        // непрерывная позиция — иначе порядок мог бы дёргаться внутри шага.
        facet: "cat",
        wx: cat.cell.wx,
        wy: cat.cell.wy,
        wz: 0,
      })
    );
  }

  private updateBubble() {
    if (!this.cat.bubble) return;
    this.bubbleText.setText(this.cat.bubble).setPosition(this.origin.x + this.cat.sx, this.origin.y + this.cat.sy - 22);
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
    this.placement = { item, slots, ghost: null, isNew: false };
    // на старом месте предмет, взятый «в руку», больше не рисуется — его
    // представляет только призрак в drawPlacement()
    this.furnitureGfx.get(item)?.setVisible(false);
  }

  // Инвентарь (UIScene) — предмет из каталога, которого ещё нет в комнате.
  // Та же механика расстановки (§9.2), просто по подтверждению добавляется
  // новая запись в this.furniture, а не заменяется существующая.
  enterPlacementForNew(catalogId: string) {
    if (this.placement) return;
    const catalog = CATALOG_BY_ID[catalogId];
    if (!catalog) return;
    const placeholder: FurnitureInstance = {
      id: catalog.id,
      cell: [0, 0],
      footprint: catalog.footprint,
      height: catalog.height,
      blocksFloor: catalog.blocksFloor,
    };
    const slots = buildSlots(this.room, placeholder, this.furniture);
    this.placement = { item: placeholder, slots, ghost: null, isNew: true };
  }

  private cancelPlacement() {
    if (this.placement && !this.placement.isNew) this.furnitureGfx.get(this.placement.item)?.setVisible(true);
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
      if (pl && !pl.isNew) this.furnitureGfx.get(pl.item)?.setVisible(true); // тап без снапа — отмена, вернуть видимость
      return;
    }
    if (pl.isNew) {
      this.furniture.push({ ...pl.item, cell: pl.ghost });
    } else {
      const idx = this.furniture.indexOf(pl.item);
      if (idx >= 0) this.furniture[idx] = { ...pl.item, cell: pl.ghost };
    }
    this.patch = buildFloorPatch(this.room, this.furniture);
    this.rebuildFurnitureGfx();
    this.relocateCatIfStranded();
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

  // Корм/игрушки из UIScene (§«Корм» нижнего меню) — перенос drag'а из
  // старого app.js (startDrag(kind:"supply")/endDrag): pointerdown на ячейке
  // в UIScene вызывает startSupplyDrag(), дальше ведёт общий pointermove/up
  // в create(). endDrag там же проверял: отпустили на коте → кормление «с
  // руки»/игра, на мисках → feedBowl, на полу → feedFloor (закопать), мимо
  // всего — ничего не происходит.
  startSupplyDrag(id: string) {
    this.supplyDragId = id;
  }

  cancelSupplyDrag() {
    this.supplyDragId = null;
  }

  private resolveSupplyDrop(sx: number, sy: number) {
    const id = this.supplyDragId;
    this.supplyDragId = null;
    const sup = SUPPLY_BY_ID[id ?? ""];
    if (!sup) return;

    // Отпустили рядом с котом — «покормить с руки»/поиграть, независимо от
    // того, стоят ли миски (как onCat-ветка старого endDrag).
    if (Math.hypot(sx - this.cat.sx, sy - this.cat.sy) < 28) {
      if (sup.food) this.cat.feedHand();
      else this.cat.playHand();
      return;
    }
    if (!sup.food) {
      this.cat.playHand();
      return;
    }
    const target = this.nearestFreeCellTo(sx, sy);
    if (!target || Math.hypot(target.sx - sx, target.sy - sy) > 60) return; // отпустили мимо пола — отмена

    const bowl = this.furniture.find((f) => f.id === "bowls");
    if (bowl) {
      const [i, j] = bowl.cell;
      const [fw, fd] = bowl.footprint;
      const cx = (i + fw / 2) * S, cy = (j + fd / 2) * S;
      const bsx = projX(cx, cy), bsy = projY(cx, cy, 0);
      if (Math.hypot(sx - bsx, sy - bsy) < 24) {
        const bowlCell = this.nearestFreeCellTo(bsx, bsy);
        if (bowlCell) {
          this.cat.feedBowl(bowlCell);
          return;
        }
      }
    }
    this.cat.feedFloor(target);
  }

  private drawSupplyGhost() {
    if (!this.supplyDragId) return;
    const p = this.input.activePointer;
    const x = p.worldX, y = p.worldY;
    this.dynG.fillStyle(0xe8a33d, 0.28);
    this.dynG.fillCircle(x, y, 16);
    this.dynG.lineStyle(1.5, 0xe8a33d, 0.9);
    this.dynG.strokeCircle(x, y, 16);
  }

  private nearestFreeCellTo(sx: number, sy: number): HexCell | null {
    const free = this.patch.lattice.filter((c) => !c.blocked);
    if (!free.length) return null;
    let best = free[0], bestD = Infinity;
    for (const c of free) {
      const d = (c.sx - sx) ** 2 + (c.sy - sy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // Дверь/окно — центр в родных (относительно origin) координатах, для
  // хит-теста и драга. Как и furnitureAt(), это плоский хит-тест по
  // расстоянию до центра, а не честная 3D-геометрия — тот же уровень
  // упрощения, что уже принят в проекте для §9.2.
  private doorCenterRel(): Pt {
    const [, D] = this.room.size;
    const wFrac = DOOR_W_CELLS / D;
    const pos = clamp(this.door.pos, 0, 1 - wFrac);
    const ymid = (pos + wFrac / 2) * D * S;
    return { x: projX(0, ymid), y: projY(0, ymid, (DOOR_H_CELLS * S) / 2) };
  }

  private winCenterRel(): Pt {
    const [W] = this.room.size;
    const wFrac = WIN_W_CELLS / W;
    const pos = clamp(this.win.pos, 0, 1 - wFrac);
    const xmid = (pos + wFrac / 2) * W * S;
    const zmid = ((WIN_Z0_CELLS + WIN_Z1_CELLS) / 2) * S;
    return { x: projX(xmid, 0), y: projY(xmid, 0, zmid) };
  }

  private hitDoor(sx: number, sy: number): boolean {
    const c = this.doorCenterRel();
    return Math.hypot(sx - c.x, sy - c.y) < 16;
  }

  private hitWindow(sx: number, sy: number): boolean {
    const c = this.winCenterRel();
    return Math.hypot(sx - c.x, sy - c.y) < 16;
  }

  private dragOpening(sx: number, sy: number) {
    // unproject считает на плоскости wz=0 — для драга вдоль стены этого
    // достаточно (та же точность допущения, что и в furnitureAt/hit-тестах).
    if (this.openingDrag === "door") {
      const { wy } = unproject(sx, sy);
      const [, D] = this.room.size;
      this.door.pos = clamp(wy / (D * S), 0, 1);
    } else if (this.openingDrag === "window") {
      const { wx } = unproject(sx, sy);
      const [W] = this.room.size;
      this.win.pos = clamp(wx / (W * S), 0, 1);
    }
    this.drawShell();
  }

  private drawDoor() {
    const [, D] = this.room.size;
    const wFrac = DOOR_W_CELLS / D;
    const pos = clamp(this.door.pos, 0, 1 - wFrac);
    const y0 = pos * D * S, y1 = (pos + wFrac) * D * S;
    const h = DOOR_H_CELLS * S;
    this.fillPoly(
      this.g,
      [this.toScreen(0, y0, 0), this.toScreen(0, y1, 0), this.toScreen(0, y1, h), this.toScreen(0, y0, h)],
      DOOR_FILL,
      0.6
    );
  }

  private drawWindow() {
    const [W] = this.room.size;
    const wFrac = WIN_W_CELLS / W;
    const pos = clamp(this.win.pos, 0, 1 - wFrac);
    const x0 = pos * W * S, x1 = (pos + wFrac) * W * S;
    const z0 = WIN_Z0_CELLS * S, z1 = WIN_Z1_CELLS * S;
    this.fillPoly(
      this.g,
      [this.toScreen(x0, 0, z0), this.toScreen(x1, 0, z0), this.toScreen(x1, 0, z1), this.toScreen(x0, 0, z1)],
      WIN_FILL,
      0.5
    );
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
    this.cat = new CatAgent(start, CAT_SPEED[this.catSkin]);
  }

  // Настройки (UIScene) — переключение персонажа («Рыжий кот»/«Сиамский
  // кот»): текстура берётся из this.catSkin каждый кадр в updateCatSprite(),
  // так что смены достаточно тут; скорость у CatAgent меняем отдельно —
  // разные кошки ходят с разной скоростью (CAT_SPEED).
  setCatSkin(skin: CatSkin) {
    this.catSkin = skin;
    if (this.cat) this.cat.speed = CAT_SPEED[skin];
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

    this.drawDoor();
    this.drawWindow();
  }
}

function pickStartCell(lattice: HexCell[]): HexCell {
  const free = lattice.filter((c) => !c.blocked);
  const pool = free.length ? free : lattice;
  return pool[Math.floor(pool.length / 2)];
}
