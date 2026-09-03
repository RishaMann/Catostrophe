import Phaser from "phaser";
import { projX, projY } from "../iso/projection";
import { HEX_VERTS, HexCell } from "../iso/hexLattice";
import { depthOf } from "../iso/depth";
import { S, furnitureDepthPoint } from "../iso/squareGrid";
import { DEFAULT_ROOM } from "../room/RoomSpec";
import { TEXT_RESOLUTION, applyRenderScale } from "../room/RoomScene";
import type { RoomScene } from "../room/RoomScene";

// §9.3 промпта — отдельная сцена-оверлей, полностью отключаемая, вырезается
// из продакшн-сборки по флагу бандлера (см. main.ts — динамический импорт
// только в dev). Включение: ?debug=1 в URL. («Четыре тапа по счётчику
// валюты» из документа не реализованы — в этом прототипе нет HUD/валюты,
// прикрепить их не к чему.)
const qs = new URLSearchParams(location.search);
export const DEBUG_ON = qs.get("debug") === "1";

type LayerKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
const ALL_LAYERS: LayerKey[] = ["1", "2", "3", "4", "5", "6", "7", "8"];
const STORAGE_KEY = "sadLittleCat.debugLayers";

function loadLayers(): Record<LayerKey, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* localStorage недоступен — используем дефолт */
  }
  // по умолчанию как было до раздельных тумблеров: гекс-решётка + блокировки
  return { "1": false, "2": true, "3": true, "4": false, "5": false, "6": false, "7": false, "8": false };
}

function saveLayers(l: Record<LayerKey, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
  } catch {
    /* тихо игнорируем — debug-удобство, не критичная функция */
  }
}

// ================= настройки сцены (панель) =================
// Аналог "Настройки сцены" старого прототипа (app.js: params/SLIDERS/tg[]),
// но перенесён СЮДА, в debug-инструмент, а не в игровое UI: в старом
// прототипе это тоже была design-time панель (`?mode=design`), скрытая от
// игрока в обычном режиме (`body.mode-game .side{display:none}`). Слайдер
// "Наклон сцены" НЕ переносим — в новой архитектуре проекция (projection.ts)
// зафиксирована навсегда (§3 промпта), tilt там не параметр. "Зум" —
// не формула проекции, а честный Phaser camera.zoom поверх неё, это можно.
const SETTINGS_KEY = "sadLittleCat.settings";
const FLOOR_MIN = 5,
  FLOOR_MAX = 10;
const ZOOM_MIN = 0.7,
  ZOOM_MAX = 1.6;

interface SettingsState {
  panelOpen: boolean;
  floorSize: number;
  zoom: number;
  catOn: boolean;
  showWalkable: boolean;
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    /* localStorage недоступен — используем дефолт */
  }
  return defaultSettings();
}

function defaultSettings(): SettingsState {
  return { panelOpen: false, floorSize: DEFAULT_ROOM.size[0], zoom: 1, catOn: true, showWalkable: false };
}

function saveSettings(s: SettingsState) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* тихо игнорируем */
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class DebugGridScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private panel!: Phaser.GameObjects.Text;
  private layers: Record<LayerKey, boolean> = loadLayers();
  // Текстовые лейблы (индексы клеток, номера шагов, depth) пересоздаются
  // каждый кадр — пул, чтобы не плодить GameObject'ы без очистки.
  private labelPool: Phaser.GameObjects.Text[] = [];
  private labelsUsed = 0;

  // ---- настройки сцены (панель) ----
  private settings: SettingsState = loadSettings();
  private settingsG!: Phaser.GameObjects.Graphics;
  private settingsText!: Phaser.GameObjects.Text;
  private floorTrack!: Phaser.GameObjects.Rectangle;
  private zoomTrack!: Phaser.GameObjects.Rectangle;
  private catBtn!: Phaser.GameObjects.Rectangle;
  private walkableBtn!: Phaser.GameObjects.Rectangle;
  private resetBtn!: Phaser.GameObjects.Rectangle;
  private clearBtn!: Phaser.GameObjects.Rectangle;
  private fullscreenBtn!: Phaser.GameObjects.Rectangle;
  private draggingSlider: "floor" | "zoom" | null = null;
  private pendingFloorSize: number | null = null; // применяется по отпусканию — не пересобирать патч на каждый px
  private lastPanelOpen = false;

  static readonly PANEL = { x: 4, y: 302, w: 262, h: 122 };
  static readonly TRACK_X0 = 96;
  static readonly TRACK_X1 = 250;

  constructor() {
    super("DebugGridScene");
  }

  create() {
    if (!DEBUG_ON) return;
    // Тот же RENDER_SCALE, что у RoomScene — иначе оверлей (сетка, футпринты,
    // панель настроек) рисовался бы поверх комнаты в другом масштабе.
    applyRenderScale(this.cameras.main);
    this.g = this.add.graphics();
    this.panel = this.add.text(4, 4, "", {
      fontSize: "8px",
      color: "#ebe2d5",
      backgroundColor: "#2e2833cc",
      padding: { x: 3, y: 2 },
      resolution: TEXT_RESOLUTION,
    });

    // Переключатели независимые — 1..8 тумблер конкретного слоя, 0 — всё выключить.
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      if ((ALL_LAYERS as string[]).includes(e.key)) {
        const k = e.key as LayerKey;
        this.layers[k] = !this.layers[k];
        saveLayers(this.layers);
      } else if (e.key === "0") {
        ALL_LAYERS.forEach((k) => (this.layers[k] = false));
        saveLayers(this.layers);
      } else if (e.key.toLowerCase() === "s") {
        this.settings.panelOpen = !this.settings.panelOpen;
        saveSettings(this.settings);
      }
    });

    this.createSettingsUI();
    // Применить сохранённые настройки к RoomScene сразу при запуске (зум,
    // тумблер кота) — до этого момента RoomScene уже отрисовала первый кадр
    // со своими дефолтами.
    this.time.delayedCall(0, () => this.applyPersistentSettings());
  }

  update() {
    if (!DEBUG_ON) return;
    this.g.clear();
    this.labelsUsed = 0;
    const room = this.scene.get("RoomScene") as RoomScene;
    if (!room.patch) return; // ещё не готово в первый кадр

    const cells = room.patch.lattice; // тот же патч, что использует навигация — не пересобираем свою копию
    const origin = room.origin;

    if (this.layers["1"]) this.drawSquareGrid(room);
    if (this.layers["2"]) this.drawHexOutlines(cells, origin);
    if (this.layers["3"]) this.drawBlockedHexes(cells, origin);
    if (this.layers["4"]) this.drawNavEdges(cells, origin);
    if (this.layers["5"]) this.drawCatPath(room, origin);
    if (this.layers["6"]) this.drawDepthPoints(room, origin);
    if (this.layers["7"]) this.drawFootprints(room);
    if (this.layers["8"]) this.drawCameraFrame();
    if (this.settings.showWalkable) this.drawWalkableOverlay(room, cells);

    this.drawPanel(room, cells);
    this.drawSettingsPanel();
    // скрыть неиспользованные в этом кадре лейблы из пула, а не плодить новые
    for (let i = this.labelsUsed; i < this.labelPool.length; i++) this.labelPool[i].setVisible(false);
  }

  // Слой 1 — квадратная сетка размещения + индексы (i, j).
  private drawSquareGrid(room: RoomScene) {
    const [W, D] = room.room.size;
    const toScreen = (i: number, j: number) => ({
      x: room.origin.x + projX(i * S, j * S),
      y: room.origin.y + projY(i * S, j * S, 0),
    });
    this.g.lineStyle(1, 0x9fc4c0, 0.5);
    for (let i = 0; i <= W; i++) {
      const a = toScreen(i, 0), b = toScreen(i, D);
      this.g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let j = 0; j <= D; j++) {
      const a = toScreen(0, j), b = toScreen(W, j);
      this.g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < D; j++) {
        const c = toScreen(i + 0.5, j + 0.5);
        this.addTinyText(c.x, c.y, i + "," + j, "#9fc4c0");
      }
    }
  }

  // Слой 2 — контуры гекс-решётки навигации.
  private drawHexOutlines(cells: HexCell[], origin: { x: number; y: number }) {
    this.g.lineStyle(1, 0xe8a33d, 0.55);
    for (const cell of cells) this.strokeHex(cell, origin);
  }

  // Слой 3 — заблокированные гексы, заливкой.
  private drawBlockedHexes(cells: HexCell[], origin: { x: number; y: number }) {
    for (const cell of cells) if (cell.blocked) this.fillHex(cell, origin, 0xd76a6a, 0.32);
  }

  // Слой 4 — рёбра графа навигации (HexCell.nb).
  private drawNavEdges(cells: HexCell[], origin: { x: number; y: number }) {
    this.g.lineStyle(1, 0x9fc4c0, 0.4);
    for (const cell of cells) {
      const cx = origin.x + cell.sx, cy = origin.y + cell.sy;
      for (const n of cell.nb) {
        const nx = origin.x + n.sx, ny = origin.y + n.sy;
        this.g.lineBetween(cx, cy, nx, ny);
      }
    }
  }

  // Слой 5 — текущий путь кота + номера шагов.
  private drawCatPath(room: RoomScene, origin: { x: number; y: number }) {
    const cat = room.cat;
    if (!cat.path.length) return;
    const pts = [cat.cell, ...cat.path];
    this.g.lineStyle(2, 0x9fc4c0, 0.85);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      this.g.lineBetween(origin.x + a.sx, origin.y + a.sy, origin.x + b.sx, origin.y + b.sy);
    }
    cat.path.forEach((c, i) => this.addTinyText(origin.x + c.sx, origin.y + c.sy - 8, String(i + 1), "#9fc4c0"));
  }

  // Слой 6 — точки и значения depth у всех объектов.
  private drawDepthPoints(room: RoomScene, origin: { x: number; y: number }) {
    const mark = (wx: number, wy: number, wz: number, label: string, color: number) => {
      const x = origin.x + projX(wx, wy), y = origin.y + projY(wx, wy, wz);
      this.g.fillStyle(color, 1);
      this.g.fillCircle(x, y, 2.5);
      this.addTinyText(x, y - 9, label, "#e8a33d");
    };
    for (const f of room.furniture) {
      const p = furnitureDepthPoint(f);
      mark(p.wx, p.wy, p.wz, String(Math.round(depthOf(p))), 0xe8a33d);
    }
    const cp = { facet: "cat" as const, wx: room.cat.cell.wx, wy: room.cat.cell.wy, wz: 0 };
    mark(cp.wx, cp.wy, cp.wz, String(Math.round(depthOf(cp))), 0x9fc4c0);
  }

  // Слой 7 — футпринты и sortAnchor мебели.
  private drawFootprints(room: RoomScene) {
    const toScreen = (wx: number, wy: number) => ({
      x: room.origin.x + projX(wx, wy),
      y: room.origin.y + projY(wx, wy, 0),
    });
    this.g.lineStyle(1, 0xc9b8d8, 0.7);
    for (const f of room.furniture) {
      const [i, j] = f.cell, [fw, fd] = f.footprint;
      const pts = [
        toScreen(i * S, j * S),
        toScreen((i + fw) * S, j * S),
        toScreen((i + fw) * S, (j + fd) * S),
        toScreen(i * S, (j + fd) * S),
      ];
      this.g.beginPath();
      this.g.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) this.g.lineTo(pts[k].x, pts[k].y);
      this.g.closePath();
      this.g.strokePath();
      const p = furnitureDepthPoint(f);
      const anchorPt = toScreen(p.wx, p.wy);
      this.g.fillStyle(0xc9b8d8, 1);
      this.g.fillTriangle(anchorPt.x, anchorPt.y - 4, anchorPt.x - 4, anchorPt.y + 3, anchorPt.x + 4, anchorPt.y + 3);
    }
  }

  // Слой 8 — кадр камеры (логический холст §15) и условная безопасная зона UI.
  private drawCameraFrame() {
    this.g.lineStyle(1, 0xd9c08e, 0.6);
    this.g.strokeRect(0, 0, 270, 480);
    this.g.lineStyle(1, 0xd9c08e, 0.3);
    this.g.strokeRect(12, 12, 270 - 24, 480 - 24);
  }

  private drawPanel(room: RoomScene, cells: HexCell[]) {
    const free = cells.filter((c) => !c.blocked).length;
    const mode = room.isPlacementActive ? "placement" : "normal";
    const fps = Math.round(this.game.loop.actualFps);
    const lines = [
      "FPS " + fps,
      "hex " + cells.length + " (free " + free + ")",
      "path " + room.cat.path.length + " kinks " + countKinks(room),
      "mode " + mode,
      "layers " + ALL_LAYERS.filter((k) => this.layers[k]).join("") || "layers —",
    ];
    this.panel.setText(lines.join("\n"));
  }

  // ---- настройки сцены (панель) ----

  private applyPersistentSettings() {
    const room = this.scene.get("RoomScene") as RoomScene;
    room.catEnabled = this.settings.catOn;
    applyRenderScale(room.cameras.main, this.settings.zoom);
    applyRenderScale(this.cameras.main, this.settings.zoom); // держим оверлеи (сетка, панель) в одном масштабе с комнатой
  }

  private createSettingsUI() {
    const P = DebugGridScene.PANEL;
    this.settingsG = this.add.graphics().setDepth(999);
    this.settingsText = this.add
      .text(P.x + 8, P.y + 6, "", { fontSize: "8px", color: "#ebe2d5", resolution: TEXT_RESOLUTION })
      .setDepth(1000);

    this.makeButton(248, 4, 18, 12, () => {
      this.settings.panelOpen = !this.settings.panelOpen;
      saveSettings(this.settings);
    });

    this.floorTrack = this.makeSliderZone(DebugGridScene.TRACK_X0, P.y + 26, DebugGridScene.TRACK_X1, () => {
      this.draggingSlider = "floor";
    });
    this.zoomTrack = this.makeSliderZone(DebugGridScene.TRACK_X0, P.y + 46, DebugGridScene.TRACK_X1, () => {
      this.draggingSlider = "zoom";
    });

    this.catBtn = this.makeButton(P.x + 8, P.y + 66, 120, 18, () => {
      this.settings.catOn = !this.settings.catOn;
      saveSettings(this.settings);
      (this.scene.get("RoomScene") as RoomScene).catEnabled = this.settings.catOn;
    });
    this.walkableBtn = this.makeButton(P.x + 134, P.y + 66, 120, 18, () => {
      this.settings.showWalkable = !this.settings.showWalkable;
      saveSettings(this.settings);
    });
    this.resetBtn = this.makeButton(P.x + 8, P.y + 90, 78, 18, () => {
      (this.scene.get("RoomScene") as RoomScene).resetToDefaultFurniture();
    });
    this.clearBtn = this.makeButton(P.x + 92, P.y + 90, 78, 18, () => {
      (this.scene.get("RoomScene") as RoomScene).clearFurniture();
    });
    this.fullscreenBtn = this.makeButton(P.x + 176, P.y + 90, 78, 18, () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    });
    // Пока панель закрыта, интерактивны только шестерёнка (открыть) — иначе
    // невидимые хит-зоны слайдеров/кнопок перехватывали бы тапы по комнате,
    // которые обрабатывает RoomScene (тап-ходьба, §7.2).
    for (const r of [this.floorTrack, this.zoomTrack, this.catBtn, this.walkableBtn, this.resetBtn, this.clearBtn, this.fullscreenBtn]) {
      r.disableInteractive();
    }

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.draggingSlider) return;
      const f = clamp((p.worldX - DebugGridScene.TRACK_X0) / (DebugGridScene.TRACK_X1 - DebugGridScene.TRACK_X0), 0, 1);
      if (this.draggingSlider === "floor") {
        const v = Math.round(FLOOR_MIN + f * (FLOOR_MAX - FLOOR_MIN));
        this.pendingFloorSize = v;
      } else {
        const v = Math.round((ZOOM_MIN + f * (ZOOM_MAX - ZOOM_MIN)) * 20) / 20;
        this.settings.zoom = v;
        this.applyPersistentSettings();
      }
    });
    this.input.on("pointerup", () => {
      if (this.draggingSlider === "floor" && this.pendingFloorSize !== null) {
        this.settings.floorSize = this.pendingFloorSize;
        this.pendingFloorSize = null;
        const room = this.scene.get("RoomScene") as RoomScene;
        room.setRoom({ ...room.room, size: [this.settings.floorSize, this.settings.floorSize] });
      }
      if (this.draggingSlider) saveSettings(this.settings);
      this.draggingSlider = null;
    });
  }

  // Хит-зона слайдера — сам трек рисуется в drawSettingsPanel() каждый кадр,
  // это только интерактивная область под ним (высота с запасом под палец/курсор).
  private makeSliderZone(x0: number, y: number, x1: number, onDown: () => void): Phaser.GameObjects.Rectangle {
    const w = x1 - x0;
    const r = this.add.rectangle(x0 + w / 2, y, w, 14, 0x000000, 0).setDepth(1001);
    r.setInteractive({ useHandCursor: true });
    r.on("pointerdown", (p: Phaser.Input.Pointer) => {
      p.event?.stopPropagation();
      onDown();
    });
    return r;
  }

  private makeButton(x: number, y: number, w: number, h: number, onClick: () => void): Phaser.GameObjects.Rectangle {
    const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0).setDepth(1001);
    r.setInteractive({ useHandCursor: true });
    r.on("pointerdown", (p: Phaser.Input.Pointer) => {
      p.event?.stopPropagation();
      onClick();
    });
    return r;
  }

  // Оверлей проходимости — компонента связности из ТЕКУЩЕЙ клетки кота (BFS
  // по HexCell.nb), а не просто «не заблокировано» (§ layer 3 уже показывает
  // блокировки отдельно) — так видно именно то, что старый прототип называл
  // showWalk: докуда кот реально может дойти прямо сейчас, а не только что
  // формально свободно.
  private drawWalkableOverlay(room: RoomScene, cells: HexCell[]) {
    const reachable = new Set<HexCell>();
    if (room.cat?.cell && !room.cat.cell.blocked) {
      const queue = [room.cat.cell];
      reachable.add(room.cat.cell);
      while (queue.length) {
        const c = queue.pop()!;
        for (const n of c.nb) {
          if (!reachable.has(n)) {
            reachable.add(n);
            queue.push(n);
          }
        }
      }
    }
    for (const cell of cells) {
      if (cell.blocked) continue;
      const color = reachable.has(cell) ? 0x9fc4c0 : 0xe8a33d;
      this.fillHex(cell, room.origin, color, reachable.has(cell) ? 0.16 : 0.28);
    }
  }

  private drawSettingsPanel() {
    const g = this.settingsG;
    g.clear();
    const open = this.settings.panelOpen;
    if (open !== this.lastPanelOpen) {
      this.lastPanelOpen = open;
      const rects = [this.floorTrack, this.zoomTrack, this.catBtn, this.walkableBtn, this.resetBtn, this.clearBtn, this.fullscreenBtn];
      for (const r of rects) {
        if (open) r.setInteractive({ useHandCursor: true });
        else r.disableInteractive();
      }
    }
    // шестерёнка-кнопка видна всегда (пока DEBUG_ON), панель — только когда открыта
    g.fillStyle(0x2e2833, 0.9);
    g.fillRoundedRect(248, 4, 18, 12, 3);
    g.lineStyle(1, open ? 0xe8a33d : 0xebe2d5, open ? 0.9 : 0.4);
    g.strokeRoundedRect(248, 4, 18, 12, 3);
    if (!open) {
      this.settingsText.setText("");
      return;
    }

    const P = DebugGridScene.PANEL;
    g.fillStyle(0x2e2833, 0.94);
    g.fillRoundedRect(P.x, P.y, P.w, P.h, 6);
    g.lineStyle(1, 0xebe2d5, 0.3);
    g.strokeRoundedRect(P.x, P.y, P.w, P.h, 6);

    const floorShown = this.pendingFloorSize ?? this.settings.floorSize;
    this.drawSliderTrack(g, P.y + 26, floorShown, FLOOR_MIN, FLOOR_MAX);
    this.drawSliderTrack(g, P.y + 46, this.settings.zoom, ZOOM_MIN, ZOOM_MAX);

    this.drawToggleBtn(g, P.x + 8, P.y + 66, 120, 18, this.settings.catOn, "Кот: " + (this.settings.catOn ? "в комнате" : "нет"));
    this.drawToggleBtn(g, P.x + 134, P.y + 66, 120, 18, this.settings.showWalkable, "Проходимость");
    this.drawToggleBtn(g, P.x + 8, P.y + 90, 78, 18, false, "Сброс");
    this.drawToggleBtn(g, P.x + 92, P.y + 90, 78, 18, false, "Очистить");
    this.drawToggleBtn(g, P.x + 176, P.y + 90, 78, 18, this.scale.isFullscreen, this.scale.isFullscreen ? "Свернуть" : "Экран");

    this.settingsText.setText(
      [
        "Настройки сцены (S)",
        "Комната: " + floorShown + "×" + floorShown + " кл.",
        "Zoom: " + Math.round(this.settings.zoom * 100) + "%",
      ].join("\n")
    );
  }

  private drawSliderTrack(g: Phaser.GameObjects.Graphics, y: number, value: number, min: number, max: number) {
    const x0 = DebugGridScene.TRACK_X0,
      x1 = DebugGridScene.TRACK_X1;
    g.lineStyle(2, 0xebe2d5, 0.25);
    g.lineBetween(x0, y, x1, y);
    const f = clamp((value - min) / (max - min), 0, 1);
    g.lineStyle(2, 0xe8a33d, 0.9);
    g.lineBetween(x0, y, x0 + f * (x1 - x0), y);
    g.fillStyle(0xe8a33d, 1);
    g.fillCircle(x0 + f * (x1 - x0), y, 3.5);
  }

  private drawToggleBtn(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    on: boolean,
    label: string
  ) {
    g.fillStyle(0xe8a33d, on ? 0.2 : 0.06);
    g.fillRoundedRect(x, y, w, h, 4);
    g.lineStyle(1, on ? 0xe8a33d : 0xebe2d5, on ? 0.8 : 0.3);
    g.strokeRoundedRect(x, y, w, h, 4);
    let t = this.labelPool[this.labelsUsed];
    if (!t) {
      t = this.add.text(0, 0, "", { fontSize: "7px", resolution: TEXT_RESOLUTION }).setOrigin(0.5).setDepth(1002);
      this.labelPool.push(t);
    }
    t.setPosition(x + w / 2, y + h / 2).setText(label).setColor("#ebe2d5").setVisible(true);
    this.labelsUsed++;
  }

  private addTinyText(x: number, y: number, text: string, color: string) {
    let t = this.labelPool[this.labelsUsed];
    if (!t) {
      t = this.add.text(0, 0, "", { fontSize: "7px", resolution: TEXT_RESOLUTION }).setOrigin(0.5).setDepth(1000);
      this.labelPool.push(t);
    }
    t.setPosition(x, y).setText(text).setColor(color).setVisible(true);
    this.labelsUsed++;
  }

  private hexPoints(cell: HexCell, origin: { x: number; y: number }) {
    const cx = origin.x + cell.sx;
    const cy = origin.y + cell.sy;
    return HEX_VERTS.map(([dx, dy]) => ({ x: cx + dx, y: cy + dy }));
  }

  private strokeHex(cell: HexCell, origin: { x: number; y: number }) {
    const pts = this.hexPoints(cell, origin);
    const g = this.g;
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.strokePath();
  }

  private fillHex(cell: HexCell, origin: { x: number; y: number }, color: number, alpha: number) {
    const pts = this.hexPoints(cell, origin);
    const g = this.g;
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fillPath();
  }
}

// «Изломы пути» — метрика качества: число смен направления на маршруте (§9.3).
function countKinks(room: RoomScene): number {
  const pts: HexCell[] = [room.cat.cell, ...room.cat.path];
  if (pts.length < 3) return 0;
  let kinks = 0;
  let prevDir: [number, number] | null = null;
  for (let i = 1; i < pts.length; i++) {
    const dir: [number, number] = [pts[i].c - pts[i - 1].c, pts[i].r - pts[i - 1].r];
    if (prevDir && (dir[0] !== prevDir[0] || dir[1] !== prevDir[1])) kinks++;
    prevDir = dir;
  }
  return kinks;
}
