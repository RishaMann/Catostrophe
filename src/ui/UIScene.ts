import Phaser from "phaser";
import { TEXT_RESOLUTION, applyRenderScale } from "../room/RoomScene";
import type { RoomScene } from "../room/RoomScene";
import { ITEM_CATALOG, SUPPLIES, ItemCategory } from "../room/itemCatalog";
import { CAT_SKINS, CAT_SKIN_LABELS, CatSkin } from "../cat/catSprites";

// Перенос нижнего меню и обвязки старого app.js (LBTN/RBTN + drawSettings +
// drawList + drawHUD) — но как отдельная, ВСЕГДА активная игровая сцена
// (не debug-инструмент, в отличие от DebugGridScene): в старом прототипе
// эти кнопки рисовались прямо на canvas сцены и не скрывались в игровом
// режиме (скрывался только HTML-сайдбар с дверью/окном/текстовым промптом —
// то была отдельная design-time панель, см. README старого проекта).
//
// Каталог мебели ограничен напольными предметами (см. room/itemCatalog.ts —
// нет геометрии для настенных/потолочных слотов). «Задания»/«Магазин» —
// как и в старом прототипе, кнопки существуют и подсвечиваются, но без
// содержимого (в исходнике тоже не было ни одного drawQuests/drawShop).
// Кормление — тап по предмету в «Корм» вместо drag старого прототипа (нет
// естественного жеста «перетащить на кота» в тач-интерфейсе тапов).

type Mode = "view" | "settings" | "inventory" | "supplies" | "quests" | "shop" | "spare";

const LBTN: { id: Mode; label: string }[] = [
  { id: "settings", label: "Настройки" },
  { id: "inventory", label: "Инвентарь" },
  { id: "supplies", label: "Корм" },
];
const RBTN: { id: Mode; label: string }[] = [
  { id: "quests", label: "Задания" },
  { id: "shop", label: "Магазин" },
  { id: "spare", label: "—" },
];
const ALL_BTN = [...LBTN, ...RBTN];

const BAR_Y = 452;
const BAR_H = 26;
const BTN_W = 45;
const PANEL = { x: 4, y: 296, w: 262, h: 152 };
const FLOOR_MIN = 5,
  FLOOR_MAX = 10;
const ZOOM_MIN = 0.7,
  ZOOM_MAX = 1.6;

const STORAGE_KEY = "sadLittleCat.playerSettings";
interface PlayerSettings {
  floorSize: number;
  zoom: number;
  skin: CatSkin;
}
function loadSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    /* localStorage недоступен — используем дефолт */
  }
  return defaultSettings();
}
function defaultSettings(): PlayerSettings {
  return { floorSize: 8, zoom: 1, skin: "redfat" };
}
function saveSettings(s: PlayerSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* тихо игнорируем */
  }
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class UIScene extends Phaser.Scene {
  private mode: Mode = "view";
  private settings: PlayerSettings = loadSettings();
  private g!: Phaser.GameObjects.Graphics;
  private labelPool: Phaser.GameObjects.Text[] = [];
  private labelsUsed = 0;

  private draggingSlider: "floor" | "zoom" | null = null;
  private pendingFloorSize: number | null = null;

  private cellBtns: Phaser.GameObjects.Rectangle[] = []; // инвентарь/корм — переиспользуемый пул хит-зон
  private pageInv = 0;
  private pageSup = 0;
  private prevPageBtn!: Phaser.GameObjects.Rectangle;
  private nextPageBtn!: Phaser.GameObjects.Rectangle;
  private floorTrack!: Phaser.GameObjects.Rectangle;
  private zoomTrack!: Phaser.GameObjects.Rectangle;
  private skinBtns: Partial<Record<CatSkin, Phaser.GameObjects.Rectangle>> = {};
  private resetBtn!: Phaser.GameObjects.Rectangle;
  private clearBtn!: Phaser.GameObjects.Rectangle;
  private fullscreenBtn!: Phaser.GameObjects.Rectangle;

  constructor() {
    super("UIScene");
  }

  private room(): RoomScene {
    return this.scene.get("RoomScene") as RoomScene;
  }

  create() {
    // Тот же RENDER_SCALE, что у RoomScene/DebugGridScene — иначе HUD/меню/
    // панели рисовались бы поверх комнаты в другом масштабе.
    applyRenderScale(this.cameras.main);
    this.g = this.add.graphics().setDepth(2000);

    for (let i = 0; i < ALL_BTN.length; i++) {
      const b = ALL_BTN[i];
      const x = i * BTN_W;
      const r = this.add.rectangle(x + BTN_W / 2, BAR_Y + BAR_H / 2, BTN_W - 2, BAR_H - 2, 0x000000, 0).setDepth(2001);
      r.setInteractive({ useHandCursor: true });
      r.on("pointerdown", (p: Phaser.Input.Pointer) => {
        p.event?.stopPropagation();
        this.mode = this.mode === b.id ? "view" : b.id;
      });
    }

    this.prevPageBtn = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setDepth(2002);
    this.nextPageBtn = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setDepth(2002);

    this.floorTrack = this.makeSliderZone(96, PANEL.y + 26, 250, () => (this.draggingSlider = "floor"));
    this.zoomTrack = this.makeSliderZone(96, PANEL.y + 46, 250, () => (this.draggingSlider = "zoom"));
    // «Кот в комнате» — раньше один тумблер вкл/выкл, теперь выбор
    // персонажа: две кнопки-переключателя, активная подсвечена, клик
    // переключает скин (и текстуру, и скорость — CatAgent.speed по CAT_SPEED).
    CAT_SKINS.forEach((skin, i) => {
      this.skinBtns[skin] = this.makeButton(PANEL.x + 8 + i * 123, PANEL.y + 66, 119, 18, () => {
        this.settings.skin = skin;
        saveSettings(this.settings);
        this.room().setCatSkin(skin);
      });
    });
    this.resetBtn = this.makeButton(PANEL.x + 8, PANEL.y + 90, 78, 18, () => this.room().resetToDefaultFurniture());
    this.clearBtn = this.makeButton(PANEL.x + 92, PANEL.y + 90, 78, 18, () => this.room().clearFurniture());
    this.fullscreenBtn = this.makeButton(PANEL.x + 176, PANEL.y + 90, 78, 18, () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.draggingSlider) return;
      const f = clamp((p.worldX - 96) / (250 - 96), 0, 1);
      if (this.draggingSlider === "floor") {
        this.pendingFloorSize = Math.round(FLOOR_MIN + f * (FLOOR_MAX - FLOOR_MIN));
      } else {
        this.settings.zoom = Math.round((ZOOM_MIN + f * (ZOOM_MAX - ZOOM_MIN)) * 20) / 20;
        this.applyZoom();
      }
    });
    this.input.on("pointerup", () => {
      if (this.draggingSlider === "floor" && this.pendingFloorSize !== null) {
        this.settings.floorSize = this.pendingFloorSize;
        this.pendingFloorSize = null;
        const room = this.room();
        room.setRoom({ ...room.room, size: [this.settings.floorSize, this.settings.floorSize] });
      }
      if (this.draggingSlider) saveSettings(this.settings);
      this.draggingSlider = null;
    });

    // Стартовые значения применяем следующим тиком — RoomScene уже успела
    // отрисовать первый кадр со своими дефолтами к этому моменту.
    this.time.delayedCall(0, () => {
      this.room().setCatSkin(this.settings.skin);
      this.applyZoom();
    });
  }

  // Зум — только сцена (комната), не весь интерфейс: HUD/меню/панели у
  // UIScene держат свой собственный camera.zoom = RENDER_SCALE неизменным.
  private applyZoom() {
    applyRenderScale(this.room().cameras.main, this.settings.zoom);
  }

  update() {
    this.g.clear();
    this.labelsUsed = 0;
    const room = this.room();
    if (!room.cat) return; // ещё не заспавнился в первый кадр

    this.drawHUD(room);
    this.drawBottomBar();
    this.setPanelInteractive(this.mode === "settings", [
      this.floorTrack,
      this.zoomTrack,
      ...(Object.values(this.skinBtns) as Phaser.GameObjects.Rectangle[]),
      this.resetBtn,
      this.clearBtn,
      this.fullscreenBtn,
    ]);
    this.setCellButtonsInteractive(this.mode === "inventory" || this.mode === "supplies");

    if (this.mode === "settings") this.drawSettingsPanel(room);
    else if (this.mode === "inventory") this.drawInventoryPanel(room);
    else if (this.mode === "supplies") this.drawSuppliesPanel(room);

    for (let i = this.labelsUsed; i < this.labelPool.length; i++) this.labelPool[i].setVisible(false);
  }

  // ---- HUD (перенос drawHUD — без catFace-мордочки, чтобы не плодить свою
  // векторную отрисовку кота ещё и здесь; настроение показываем баром + числом) ----
  private drawHUD(room: RoomScene) {
    const g = this.g;
    const mood = room.cat.mood;
    g.fillStyle(0x2e2833, 0.85);
    g.fillRoundedRect(6, 4, 258, 16, 6);
    g.fillStyle(0x2e2833, 0.9);
    g.fillRoundedRect(10, 7, 130, 10, 5);
    const w = 124 * clamp(mood, 0, 100) / 100;
    g.fillStyle(mood < 40 ? 0xd79a9a : mood < 70 ? 0xd9c08e : 0x9fc4c0, 1);
    g.fillRoundedRect(13, 9, Math.max(4, w), 6, 3);
    this.addLabel(148, 12, Math.round(mood) + "%", "#ebe2d5");
    this.addLabel(200, 12, "🐟 1247", "#ebe2d5");
    this.addLabel(250, 12, "◆", "#c9b8d8");
  }

  private drawBottomBar() {
    const g = this.g;
    g.fillStyle(0x2e2833, 0.94);
    g.fillRect(0, BAR_Y, 270, BAR_H);
    g.lineStyle(1, 0xebe2d5, 0.15);
    g.lineBetween(0, BAR_Y, 270, BAR_Y);
    for (let i = 0; i < ALL_BTN.length; i++) {
      const b = ALL_BTN[i];
      const x = i * BTN_W;
      const on = this.mode === b.id;
      if (i === 3) g.lineBetween(x, BAR_Y + 3, x, BAR_Y + BAR_H - 3); // разделитель между группами
      g.fillStyle(0xe8a33d, on ? 0.18 : 0);
      g.fillRoundedRect(x + 2, BAR_Y + 2, BTN_W - 4, BAR_H - 4, 4);
      if (on) {
        g.lineStyle(1, 0xe8a33d, 0.8);
        g.strokeRoundedRect(x + 2, BAR_Y + 2, BTN_W - 4, BAR_H - 4, 4);
      }
      this.addLabel(x + BTN_W / 2, BAR_Y + BAR_H / 2, b.label, on ? "#e8a33d" : "#ebe2d5", "center", 7);
    }
  }

  // ---- Настройки сцены (перенос params/SLIDERS/tg[] — «наклон» не
  // переносится, проекция зафиксирована навсегда, §3; «показать
  // проходимость»/нумерованные debug-слои — инженерный инструмент, остаётся
  // только в DebugGridScene) ----
  private drawSettingsPanel(room: RoomScene) {
    const g = this.g;
    g.fillStyle(0x2e2833, 0.96);
    g.fillRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 6);
    g.lineStyle(1, 0xe8a33d, 0.5);
    g.strokeRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 6);

    const floorShown = this.pendingFloorSize ?? room.room.size[0];
    this.addLabel(PANEL.x + 8, PANEL.y + 12, "Настройки сцены", "#ebe2d5", "left");
    this.drawSlider(g, PANEL.y + 26, floorShown, FLOOR_MIN, FLOOR_MAX, "Комната: " + floorShown + "×" + floorShown);
    this.drawSlider(g, PANEL.y + 46, this.settings.zoom, ZOOM_MIN, ZOOM_MAX, "Зум: " + Math.round(this.settings.zoom * 100) + "%");
    CAT_SKINS.forEach((skin, i) => {
      this.drawToggle(g, PANEL.x + 8 + i * 123, PANEL.y + 66, 119, 18, this.settings.skin === skin, CAT_SKIN_LABELS[skin]);
    });
    this.drawToggle(g, PANEL.x + 8, PANEL.y + 90, 78, 18, false, "Сброс");
    this.drawToggle(g, PANEL.x + 92, PANEL.y + 90, 78, 18, false, "Очистить");
    this.drawToggle(g, PANEL.x + 176, PANEL.y + 90, 78, 18, this.scale.isFullscreen, this.scale.isFullscreen ? "Свернуть" : "Экран");
  }

  private drawSlider(g: Phaser.GameObjects.Graphics, y: number, value: number, min: number, max: number, label: string) {
    const x0 = 96, x1 = 250;
    g.lineStyle(2, 0xebe2d5, 0.25);
    g.lineBetween(x0, y, x1, y);
    const f = clamp((value - min) / (max - min), 0, 1);
    g.lineStyle(2, 0xe8a33d, 0.9);
    g.lineBetween(x0, y, x0 + f * (x1 - x0), y);
    g.fillStyle(0xe8a33d, 1);
    g.fillCircle(x0 + f * (x1 - x0), y, 3.5);
    this.addLabel(PANEL.x + 8, y, label, "#ebe2d5", "left");
  }

  private drawToggle(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, on: boolean, label: string) {
    g.fillStyle(0xe8a33d, on ? 0.2 : 0.06);
    g.fillRoundedRect(x, y, w, h, 4);
    g.lineStyle(1, on ? 0xe8a33d : 0xebe2d5, on ? 0.8 : 0.3);
    g.strokeRoundedRect(x, y, w, h, 4);
    this.addLabel(x + w / 2, y + h / 2, label, "#ebe2d5");
  }

  // ---- Инвентарь (перенос drawList для mode==="inventory") ----
  private drawInventoryPanel(room: RoomScene) {
    const placed = new Set(room.furniture.map((f) => f.id));
    const items = ITEM_CATALOG.filter((it) => !placed.has(it.id));
    this.drawGrid(
      "Инвентарь",
      items.map((it) => ({ id: it.id, label: it.ru, color: categoryColor(it.category) })),
      (id) => {
        room.enterPlacementForNew(id);
        this.mode = "view";
      },
      this.pageInv,
      (p) => (this.pageInv = p)
    );
  }

  // ---- Корм (перенос drawList для mode==="supplies" + feedHand/feedBowl/feedFloor/playHand) ----
  private drawSuppliesPanel(room: RoomScene) {
    this.drawGrid(
      "Корм",
      SUPPLIES.map((s) => ({ id: s.id, label: s.ru, color: s.food ? 0xd9c08e : 0x9fc4c0 })),
      (id) => {
        room.startSupplyDrag(id);
        this.mode = "view";
      },
      this.pageSup,
      (p) => (this.pageSup = p)
    );
  }

  // Пагинация — перенос page/pages из старого drawList (там 3 предмета на
  // страницу под трапецию, тут 12 — под прямоугольную сетку 4×3).
  private static readonly PER_PAGE = 12;

  private drawGrid(
    title: string,
    items: { id: string; label: string; color: number }[],
    onPick: (id: string) => void,
    page: number,
    setPage: (p: number) => void
  ) {
    const g = this.g;
    g.fillStyle(0x2e2833, 0.96);
    g.fillRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 6);
    g.lineStyle(1, 0xe8a33d, 0.5);
    g.strokeRoundedRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 6);
    this.addLabel(PANEL.x + 8, PANEL.y + 12, title, "#ebe2d5", "left");

    const pages = Math.max(1, Math.ceil(items.length / UIScene.PER_PAGE));
    const clamped = clamp(page, 0, pages - 1);
    if (clamped !== page) setPage(clamped);
    const pageItems = items.slice(clamped * UIScene.PER_PAGE, clamped * UIScene.PER_PAGE + UIScene.PER_PAGE);

    const cols = 4;
    const cellW = (PANEL.w - 16) / cols;
    const cellH = 36;
    if (!items.length) {
      this.addLabel(PANEL.x + PANEL.w / 2, PANEL.y + 70, "Пусто", "#ebe2d5");
    }
    pageItems.forEach((it, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = PANEL.x + 8 + col * cellW, y = PANEL.y + 26 + row * cellH;
      g.fillStyle(it.color, 0.22);
      g.fillRoundedRect(x + 2, y, cellW - 4, cellH - 6, 5);
      g.lineStyle(1, it.color, 0.6);
      g.strokeRoundedRect(x + 2, y, cellW - 4, cellH - 6, 5);
      this.addLabel(x + cellW / 2, y + cellH / 2 - 3, it.label.length > 10 ? it.label.slice(0, 9) + "…" : it.label, "#ebe2d5");
      const btn = this.cellButton(i);
      btn.setPosition(x + cellW / 2, y + (cellH - 6) / 2).setSize(cellW - 4, cellH - 6);
      btn.removeAllListeners("pointerdown");
      btn.on("pointerdown", (p: Phaser.Input.Pointer) => {
        p.event?.stopPropagation();
        onPick(it.id);
      });
    });
    // спрятать неиспользованные ячейки пула в этом кадре
    for (let i = pageItems.length; i < this.cellBtns.length; i++) this.cellBtns[i].disableInteractive().setVisible(false);
    for (let i = 0; i < Math.min(pageItems.length, this.cellBtns.length); i++) this.cellBtns[i].setVisible(true);

    if (pages > 1) {
      this.addLabel(PANEL.x + PANEL.w - 8, PANEL.y + 12, clamped + 1 + "/" + pages, "#e8a33d", "left");
      this.prevPageBtn.setPosition(PANEL.x + 14, PANEL.y + PANEL.h - 10).setSize(20, 20).setInteractive({ useHandCursor: true });
      this.nextPageBtn
        .setPosition(PANEL.x + PANEL.w - 14, PANEL.y + PANEL.h - 10)
        .setSize(20, 20)
        .setInteractive({ useHandCursor: true });
      this.prevPageBtn.removeAllListeners("pointerdown");
      this.nextPageBtn.removeAllListeners("pointerdown");
      this.prevPageBtn.on("pointerdown", (p: Phaser.Input.Pointer) => {
        p.event?.stopPropagation();
        setPage(clamp(clamped - 1, 0, pages - 1));
      });
      this.nextPageBtn.on("pointerdown", (p: Phaser.Input.Pointer) => {
        p.event?.stopPropagation();
        setPage(clamp(clamped + 1, 0, pages - 1));
      });
      this.addLabel(PANEL.x + 14, PANEL.y + PANEL.h - 10, "‹", "#ebe2d5");
      this.addLabel(PANEL.x + PANEL.w - 14, PANEL.y + PANEL.h - 10, "›", "#ebe2d5");
    } else {
      this.prevPageBtn.disableInteractive();
      this.nextPageBtn.disableInteractive();
    }
  }

  private cellButton(i: number): Phaser.GameObjects.Rectangle {
    let r = this.cellBtns[i];
    if (!r) {
      r = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setDepth(2002);
      this.cellBtns.push(r);
    }
    r.setInteractive({ useHandCursor: true });
    return r;
  }

  private setCellButtonsInteractive(on: boolean) {
    if (on) return; // включаются точечно в drawGrid на актуальный набор ячеек
    for (const r of this.cellBtns) r.disableInteractive().setVisible(false);
  }

  private setPanelInteractive(on: boolean, rects: Phaser.GameObjects.Rectangle[]) {
    for (const r of rects) {
      const enabled = !!r.input?.enabled;
      if (on && !enabled) r.setInteractive({ useHandCursor: true });
      else if (!on && enabled) r.disableInteractive();
    }
  }

  private makeSliderZone(x0: number, y: number, x1: number, onDown: () => void): Phaser.GameObjects.Rectangle {
    const w = x1 - x0;
    const r = this.add.rectangle(x0 + w / 2, y, w, 14, 0x000000, 0).setDepth(2001);
    r.on("pointerdown", (p: Phaser.Input.Pointer) => {
      p.event?.stopPropagation();
      onDown();
    });
    return r;
  }

  private makeButton(x: number, y: number, w: number, h: number, onClick: () => void): Phaser.GameObjects.Rectangle {
    const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0).setDepth(2001);
    r.on("pointerdown", (p: Phaser.Input.Pointer) => {
      p.event?.stopPropagation();
      onClick();
    });
    return r;
  }

  private addLabel(x: number, y: number, text: string, color: string, align: "center" | "left" = "center", size = 9) {
    let t = this.labelPool[this.labelsUsed];
    if (!t) {
      t = this.add.text(0, 0, "", { fontSize: "9px", resolution: TEXT_RESOLUTION }).setDepth(2003);
      this.labelPool.push(t);
    }
    t.setFontSize(size)
      .setOrigin(align === "center" ? 0.5 : 0, 0.5)
      .setPosition(x, y)
      .setText(text)
      .setColor(color)
      .setVisible(true);
    this.labelsUsed++;
  }
}

function categoryColor(cat: ItemCategory): number {
  switch (cat) {
    case "tall":
      return 0xc9b8d8;
    case "mid":
      return 0x9fc4c0;
    case "wall":
      return 0xd76a6a;
    case "ceil":
      return 0xe8a33d;
    case "surface":
      return 0xa8b98c;
    default:
      return 0xd9c08e; // low
  }
}
