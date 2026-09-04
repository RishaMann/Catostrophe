/* ============================================================================
   game.js — движок. Читает сцену, рисует комнату, водит кота, показывает меню.
   Геометрию не считает: вся математика в iso.js, который общий с редактором.
   ========================================================================== */
(function () {
  'use strict';

  const D = window.GAMEDATA, I = window.ISO, IC = window.ICONS;
  const { SCREEN_W, SCREEN_H, OX, WALL, DOOR_H, WIN_W, WIN_Z0, WIN_Z1, STUB, STEP, DOOR_W } = I;

  const COL = {
    deep: 0x332C39, panel: 0x2E2833, chalk: 0xEBE2D5,
    amber: 0xE8A33D, cat: 0x9FC4C0, ink: 0x2E2833
  };
  const FONT = '"Avenir Next","Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

  // Слои сцены больше не делят один Graphics — у каждого своя Phaser-глубина,
  // Phaser сам сортирует GameObject'ы по ней, интерливинг предмет/кот вручную
  // (как раньше drawCatOnce между отсортированными предметами) не нужен: и
  // предметы (I.depth(zmap,zid), диапазон примерно 0..2*floor), и кот
  // (cat.x+cat.y — та же шкала) просто получают Phaser .depth и рисуются в
  // правильном порядке автоматически.
  const SHELL_DEPTH = -1;   // пол, стены, проёмы, проходимость (debug)
  const ZONE_DEPTH = -0.5;  // подсветка пустых зон при драге — под предметами,
                             // но взаимоисключающе с ними (заняты либо зона, либо предмет)
  const TEXT_DEPTH = 1000;  // все надписи комнаты — всегда поверх боксов предметов
  const CEIL_DEPTH = 900;   // потолочный подвес — выше обычных предметов
  const UI_DEPTH = 10000;   // нижние панели/HUD — всегда поверх сцены
  const UI_TEXT_DEPTH = 10001;

  const clamp = I.clamp;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function inPoly(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }

  /* ---------- пул текстов: переиспользуем, а не пересоздаём каждый кадр ---------- */
  class TextPool {
    constructor(scene, depth) { this.s = scene; this.d = depth; this.a = []; this.i = 0; }
    begin() { this.i = 0; }
    put(x, y, str, size, color, align, weight) {
      let t = this.a[this.i];
      if (!t) {
        t = this.s.add.text(0, 0, '', {}).setDepth(this.d);
        this.a.push(t);
      }
      t.setStyle({
        fontFamily: FONT, fontSize: (size || 11) + 'px',
        color: color || '#EBE2D5', fontStyle: weight || 'normal'
      });
      t.setText(str);
      t.setOrigin(align === 'center' ? 0.5 : align === 'right' ? 1 : 0, 0.5);
      t.setPosition(x, y).setVisible(true);
      this.i++;
      return t;
    }
    end() { for (let k = this.i; k < this.a.length; k++) this.a[k].setVisible(false); }
  }

  /* ======================================================================== */
  class RoomScene extends Phaser.Scene {
    constructor() { super('room'); }

    // Имя сцены — параметр запуска (this.scene.start('room',{name:'scene2'})
    // потом, когда появится вторая сцена за дверью); без параметра (обычный
    // старт игры) Phaser зовёт init() с {} — падаем на 'scene1'.
    init(data) {
      this.sceneName = (data && data.name) || 'scene1';
    }

    preload() {
      // Путь резолвится от index.html (корень catroom/), не от game.js —
      // сцены лежат в src/scenes/, а не в scenes/ рядом с index.html.
      this.load.json(this.sceneName, 'src/scenes/' + this.sceneName + '.json');
    }

    create() {
      // состояние сцены — копия конфига, чтобы не портить загруженный JSON
      const s = this.cache.json.get(this.sceneName);
      this.st = {
        door: { ...s.door }, win: { ...s.win },
        light: { ...s.light }, place: { ...s.place }
      };
      this.params = { ...s.params };
      this.cat = {
        x: s.cat.x, y: s.cat.y, st: 'idle', t: 1, ph: 0, dir: 1,
        path: [], after: null, bubble: null, bt: 0, jump: 0
      };
      this.mood = 62; this.fish = 1247; this.gems = 12;
      this.mode = 'view';
      this.pageInv = 0; this.pageSup = 0;
      this.showWalk = false; this.showLabels = DEBUG; this.showEmpty = DEBUG; this.catOn = true;
      this.drag = null;
      this.uiDirty = true;
      this.shellDirty = true;

      // --- слои: оболочка сцены, подсветка пустых зон при драге, кот, пул
      // предметов (по одному Graphics+Text на занятую зону), UI поверх всего ---
      this.gShell = this.add.graphics().setDepth(SHELL_DEPTH);
      this.tShell = new TextPool(this, TEXT_DEPTH);
      this.zoneGfx = this.add.graphics().setDepth(ZONE_DEPTH);
      this.tZones = new TextPool(this, TEXT_DEPTH);
      this.gCat = this.add.graphics().setDepth(0);
      this.tBubble = null;
      this.itemGfx = new Map(); // zid -> { g: Graphics, t: Text|null }
      this.gUI = this.add.graphics().setDepth(UI_DEPTH);
      this.tUI = new TextPool(this, UI_TEXT_DEPTH);

      this.rebuild();

      this.input.on('pointerdown', p => this.onDown(p));
      this.input.on('pointermove', p => { if (this.drag) { this.drag.p = [p.worldX, p.worldY]; } });
      this.input.on('pointerup', p => this.onUp(p));

      this.idleCycle();
    }

    /* ---------- пересборка сцены и навигации ---------- */
    // Единственная точка входа при постановке/снятии предмета и при старте.
    // Помечает оболочку «грязной» (дверь/окно/проходимость не двигаются в
    // игре, но проходимость debug-слоя зависит от NAV, который тут же
    // пересчитан) и пересобирает пул предметов — не в update(), только тут.
    rebuild() {
      const r = I.buildScene(this.params, this.st, D.ITEMS);
      this.zones = r.zones; this.zmap = r.zmap; this.LAY = r.LAY;
      this.NAV = I.buildNav(this.zmap, D.ITEMS, this.st.place, this.cat);

      // Защитный респавн: если кот по любой причине оказался вне проходимой
      // области (перестановка мебели, кривой конфиг сцены), возвращаем его на
      // ближайшую свободную клетку вместо того, чтобы он застрял навсегда.
      const N = this.NAV;
      const ci = clamp(Math.round(this.cat.x / STEP), 0, N.GN - 1);
      const cj = clamp(Math.round(this.cat.y / STEP), 0, N.GN - 1);
      if (N.comp[N.idx(ci, cj)] !== N.home) {
        const s = I.nearSpot(N, this.cat.x, this.cat.y);
        this.cat.x = s[0]; this.cat.y = s[1]; this.cat.path = [];
      }
      this.ui = this.panelGeo();
      this.shellDirty = true;
      this.rebuildItemGfx();
    }

    /* ---------- геометрия панелей: трапеции в мёртвых углах кадра ---------- */
    // Верхняя кромка каждой панели параллельна ближнему ребру пола и лежит ниже
    // него. Панель обрезана самой геометрией ромба, поэтому сцену не перекрывает
    // ни при каком размере комнаты.
    panelGeo() {
      const F = I.PROJ.F, sl = I.PROJ.TH / I.PROJ.TW, corner = I.P(F, F);
      const bot = SCREEN_H - 8, bw = 68, bh0 = 64, footer = 28, gap = 8;
      const padBtn = 8, padList = 36;
      const iconH = bh0 * 0.30 * 1.6;
      const fit = min => clamp(bot - footer - (corner[1] + gap), min, bh0);
      const listOnR = this.mode === 'inventory' || this.mode === 'supplies';
      const bhL = fit(iconH / 2), bhR = fit(listOnR ? iconH : iconH / 2);
      const byL = bot - footer - bhL, byR = bot - footer - bhR;
      const topL = byL - padBtn, topR = byR - (listOnR ? padList : padBtn);
      const yL = x => topL - (OX - x) * sl, yR = x => topR - (x - OX) * sl;
      const L = { poly: [[8, Math.max(yL(8), 20)], [OX - 8, topL], [OX - 8, bot], [8, bot]], btn: [], iconS: bh0 * 0.30 };
      const R = { poly: [[OX + 8, topR], [532, Math.max(yR(532), 20)], [532, bot], [OX + 8, bot]], btn: [], iconS: bh0 * 0.30 };
      for (let i = 0; i < 3; i++) {
        L.btn.push({ x: 22 + i * 78, y: byL, w: bw, h: bhL });
        R.btn.push({ x: OX + 22 + i * 78, y: byR, w: bw, h: bhR });
      }
      L.labelY = bot - 14; R.labelY = bot - 14; L.bot = bot; R.bot = bot;
      return { L, R };
    }

    /* ---------- общий помощник отрисовки многоугольника на произвольный Graphics ---------- */
    polyOn(g, pts, fill, fa, stroke, sw, close) {
      const p = pts.map(a => ({ x: a[0], y: a[1] }));
      if (fill !== null && fill !== undefined) { g.fillStyle(fill, fa); g.fillPoints(p, true); }
      if (stroke !== null && stroke !== undefined) { g.lineStyle(sw || 1.2, stroke, 1); g.strokePoints(p, close !== false); }
    }

    /* ==================== ОБОЛОЧКА СЦЕНЫ (пол/стены/проёмы/debug-проходимость) ====================
       Перерисовывается только когда this.shellDirty — взводится в rebuild()
       (проходимость зависит от NAV) и при переключении «Проходимость» в
       настройках. Дверь/окно в игре не двигаются (геометрия сцены фиксирована
       редактором уровней), так что событий на самом деле мало. */
    drawShell() {
      const g = this.gShell, F = I.PROJ.F;
      g.clear(); this.tShell.begin();
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);

      // --- пол и две стены ---
      poly([I.P(0, 0), I.P(F, 0), I.P(F, F), I.P(0, F)], COL.chalk, 0.045, COL.chalk, 1.2);
      poly([I.P(0, 0), I.P(F, 0), I.P(F, 0, WALL), I.P(0, 0, WALL)], COL.chalk, 0.03, COL.chalk, 1.2);
      poly([I.P(0, 0), I.P(0, F), I.P(0, F, WALL), I.P(0, 0, WALL)], COL.chalk, 0.055, COL.chalk, 1.2);

      g.lineStyle(1, COL.chalk, 0.07);
      for (let i = 1; i < F; i++) {
        let a = I.P(i, 0), b = I.P(i, F); g.lineBetween(a[0], a[1], b[0], b[1]);
        a = I.P(0, i); b = I.P(F, i); g.lineBetween(a[0], a[1], b[0], b[1]);
      }
      // бортики ближних рёбер
      [[[0, F], [F, F]], [[F, 0], [F, F]]].forEach(([a, b]) => {
        poly([I.P(a[0], a[1]), I.P(b[0], b[1]), I.P(b[0], b[1], STUB), I.P(a[0], a[1], STUB)],
          null, 0, COL.chalk, 1);
      });

      // --- проём двери ---
      const d0 = this.st.door.pos, d1 = d0 + DOOR_W;
      const dp = this.st.door.side === 'left'
        ? [I.P(0, d0), I.P(0, d1), I.P(0, d1, DOOR_H), I.P(0, d0, DOOR_H)]
        : [I.P(d0, F), I.P(d1, F), I.P(d1, F, DOOR_H), I.P(d0, F, DOOR_H)];
      poly(dp, 0x000000, 0.30, COL.chalk, 1.1);
      let c = I.centroid(dp);
      this.tShell.put(c[0], c[1], 'дверь', 10, '#E8A33Dcc', 'center');

      // --- проём окна ---
      const w0 = this.st.win.pos, w1 = w0 + WIN_W;
      const wp = this.st.win.side === 'right'
        ? [I.P(w0, 0, WIN_Z0), I.P(w1, 0, WIN_Z0), I.P(w1, 0, WIN_Z1), I.P(w0, 0, WIN_Z1)]
        : [I.P(F, w0, 0.08), I.P(F, w1, 0.08), I.P(F, w1, STUB), I.P(F, w0, STUB)];
      poly(wp, 0x7896BE, 0.22, COL.chalk, 1.1);
      c = I.centroid(wp);
      this.tShell.put(c[0], c[1], 'окно', 10, '#E8A33Dcc', 'center');

      // --- проходимость (debug) ---
      if (this.showWalk && this.NAV) {
        const h = STEP * 0.42, N = this.NAV;
        for (let i = 0; i < N.GN; i++) for (let j = 0; j < N.GN; j++) {
          const k = N.comp[N.idx(i, j)]; if (k < 0) continue;
          const x = i * STEP, y = j * STEP;
          poly([I.P(x - h, y), I.P(x, y - h), I.P(x + h, y), I.P(x, y + h)],
            k === N.home ? COL.cat : COL.amber, k === N.home ? 0.16 : 0.28, null);
        }
      }

      this.tShell.end();
    }

    /* ==================== ПОДСВЕТКА ПУСТЫХ ЗОН ПРИ ДРАГЕ ====================
       Единственный слой, который по-прежнему перерисовывается каждый кадр —
       но это лёгкая операция (пара десятков контуров зон, без стен/предметов),
       и раньше она уже была условной (showEmpty || placing). Показывается
       ТОЛЬКО когда предмет уже взят в руку (или включён debug-тумблер);
       открытие инвентаря само по себе ничего не подсвечивает — легальность
       зависит от предмета, а не от факта открытия меню. */
    drawZoneOverlay() {
      const g = this.zoneGfx, F = I.PROJ.F;
      g.clear();
      const placing = !!this.drag;
      const active = this.showEmpty || placing;
      this.tZones.begin();
      if (active) {
        const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
        this.zones.forEach(z => {
          if (this.st.place[z.id]) return;
          const legal = placing ? !I.reject(z, D.ITEMS[this.drag.iid]) : false;
          const pts = I.zonePoly(z, F);
          poly(pts, legal ? COL.amber : COL.chalk, legal ? 0.18 : 0.05,
            legal ? COL.amber : COL.chalk, legal ? 1.4 : 0.8);
          if (this.showLabels) {
            const cc = I.centroid(pts);
            this.tZones.put(cc[0], cc[1], z.ru, 9, '#EBE2D555', 'center');
          }
        });
        // точка света на потолке — та же условная подсказка, что и у пустых зон
        const L = this.st.light;
        poly([I.P(L.x - .5, L.y - .5, WALL), I.P(L.x + .5, L.y - .5, WALL),
        I.P(L.x + .5, L.y + .5, WALL), I.P(L.x - .5, L.y + .5, WALL)],
          COL.amber, 0.10, COL.amber, 1);
      }
      this.tZones.end();
    }

    /* ==================== ПУЛ ПРЕДМЕТОВ ====================
       По одному Graphics(+Text) на занятую зону (включая CEIL — потолочный
       подвес). Пересобирается только из rebuild() — по событию постановки/
       снятия предмета, не в update(). Глубина = I.depth(zmap,zid) — тот же
       ключ сортировки, что использует редактор уровней; Phaser сам сортирует
       GameObject'ы по .depth, ручной интерливинг с котом не нужен. */
    rebuildItemGfx() {
      const keep = new Set(Object.keys(this.st.place));
      for (const [zid, entry] of this.itemGfx) {
        if (!keep.has(zid) || (zid !== 'CEIL' && !this.zmap[zid])) {
          entry.g.destroy();
          if (entry.t) entry.t.destroy();
          this.itemGfx.delete(zid);
        }
      }
      for (const zid of Object.keys(this.st.place)) {
        if (zid !== 'CEIL' && !this.zmap[zid]) continue;
        let entry = this.itemGfx.get(zid);
        if (!entry) { entry = { g: this.add.graphics(), t: null }; this.itemGfx.set(zid, entry); }
        entry.g.clear();
        if (zid === 'CEIL') {
          entry.g.setDepth(CEIL_DEPTH);
          entry.t = this.drawCeilInto(entry.g, entry.t);
        } else {
          entry.g.setDepth(I.depth(this.zmap, zid));
          entry.t = this.drawItemInto(entry.g, entry.t, zid, this.st.place[zid]);
        }
      }
    }

    setLabel(text, x, y, str) {
      if (!text) text = this.add.text(0, 0, '', {}).setDepth(TEXT_DEPTH);
      text.setStyle({ fontFamily: FONT, fontSize: '11px', color: '#EBE2D5' });
      text.setText(str).setOrigin(0.5, 0.5).setPosition(x, y).setVisible(true);
      return text;
    }
    hideLabel(text) { if (text) text.setVisible(false); return text; }

    drawItemInto(g, text, zid, iid) {
      const z = this.zmap[zid], it = D.ITEMS[iid], F = I.PROJ.F;
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
      if (z.band === 'wall' || z.band === 'surface') {
        const pts = I.zonePoly(z, F), c = I.centroid(pts);
        const ins = pts.map(p => [c[0] + (p[0] - c[0]) * 0.78, c[1] + (p[1] - c[1]) * 0.78]);
        poly(ins, COL.chalk, 0.16, COL.chalk, 1.2);
        return this.showLabels ? this.setLabel(text, c[0], c[1] + 3, it.ru) : this.hideLabel(text);
      }
      const cx = (z.r[0] + z.r[2]) / 2, cy = (z.r[1] + z.r[3]) / 2;
      const [w, d] = I.fit(it, z), h = it.s[2];
      const A = [cx - w / 2, cy - d / 2], B = [cx + w / 2, cy - d / 2];
      const C = [cx + w / 2, cy + d / 2], E = [cx - w / 2, cy + d / 2];
      poly([I.P(B[0], B[1]), I.P(C[0], C[1]), I.P(C[0], C[1], h), I.P(B[0], B[1], h)], COL.chalk, 0.10, COL.chalk, 1);
      poly([I.P(E[0], E[1]), I.P(C[0], C[1]), I.P(C[0], C[1], h), I.P(E[0], E[1], h)], COL.chalk, 0.05, COL.chalk, 1);
      poly([I.P(A[0], A[1], h), I.P(B[0], B[1], h), I.P(C[0], C[1], h), I.P(E[0], E[1], h)], COL.chalk, 0.17, COL.chalk, 1);
      if (this.showLabels) {
        const t = I.P(cx, cy, h);
        return this.setLabel(text, t[0], t[1] - 7, it.ru);
      }
      return this.hideLabel(text);
    }

    drawCeilInto(g, text) {
      const iid = this.st.place.CEIL, L = this.st.light;
      const t = I.P(L.x, L.y, WALL), b = I.P(L.x, L.y, WALL - 0.7);
      // шнур обязателен: без него высота подвеса не читается
      g.lineStyle(1.2, COL.amber, 1); g.lineBetween(t[0], t[1], b[0], b[1]);
      g.fillStyle(COL.amber, 0.3); g.fillCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
      g.lineStyle(1.2, COL.amber, 1); g.strokeCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
      return this.showLabels ? this.setLabel(text, b[0], b[1] + 28, D.ITEMS[iid].ru) : this.hideLabel(text);
    }

    /* ==================== КОТ ====================
       Единственный слой, который честно перерисовывается каждый кадр — это
       нормально: одна маленькая фигура, а не вся сцена. Глубина — cat.x+cat.y,
       та же шкала, что и I.depth() у предметов, так что Phaser сам вставляет
       кота в правильное место между их GameObject'ами. */
    drawCatGfx() {
      const g = this.gCat;
      g.clear();
      if (!this.catOn) { if (this.tBubble) this.tBubble.setVisible(false); return; }
      const cat = this.cat;
      g.setDepth(cat.x + cat.y);
      const b = I.P(cat.x, cat.y);
      const u = I.PROJ.TW / 60 * 1.85, S = v => v * u, d = cat.dir;
      const st = cat.st, ph = cat.ph;
      const jy = st === 'jump' ? -Math.abs(Math.sin(ph * 2.2)) * S(16) : 0;
      const X = lx => b[0] + d * lx, Y = ly => b[1] + jy + ly;

      // тень
      g.fillStyle(0x000000, 0.32);
      g.fillEllipse(b[0], b[1], S(28), S(28) * (I.PROJ.tilt || 0.5));

      const LW = 1.5 * u;
      const low = st === 'lie', sit = st === 'sit', eat = st === 'eat' || st === 'dig';
      const bodyY = low ? -S(6) : sit ? -S(11) : -S(13);
      const bRX = low ? S(18) : sit ? S(11) : S(15);
      const bRY = low ? S(6) : sit ? S(11) : S(9);

      // хвост
      const w = Math.sin(ph * (low ? 0.6 : 1)) * S(low ? 3 : 5);
      const tx = -bRX * 0.85;
      const from = { x: tx, y: low ? bodyY + S(2) : bodyY };
      const cp = low ? { x: tx - S(14), y: from.y + S(4) } : { x: tx - S(12), y: from.y - S(10) + w };
      const to = low ? { x: tx - S(20), y: from.y + w * 0.4 } : { x: tx - S(6), y: from.y - S(22) + w };
      const tail = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, q = 1 - t;
        tail.push({
          x: X(q * q * from.x + 2 * q * t * cp.x + t * t * to.x),
          y: Y(q * q * from.y + 2 * q * t * cp.y + t * t * to.y)
        });
      }
      g.lineStyle(LW, COL.cat, 1); g.strokePoints(tail, false);

      // лапы
      if (!low) {
        const legs = sit ? [[-S(5), 0], [S(7), 0]] : [[-S(9), 0], [-S(3), 0], [S(4), 0], [S(9), 0]];
        legs.forEach((Lg, i) => {
          const sw = st === 'walk' ? Math.sin(ph + i * 1.6) * S(3.5) : 0;
          const y0 = bodyY + bRY * 0.6, y1 = (sit && i === 0) ? bodyY + bRY * 0.4 : 0;
          g.lineStyle(1.6 * u, COL.cat, 1);
          g.lineBetween(X(Lg[0]), Y(y0), X(Lg[0] + sw), Y(y1));
        });
      }

      // тело
      g.fillStyle(COL.cat, 0.28); g.fillEllipse(X(0), Y(bodyY), bRX * 2, bRY * 2);
      g.lineStyle(LW, COL.cat, 1); g.strokeEllipse(X(0), Y(bodyY), bRX * 2, bRY * 2);

      // голова
      const hx = low ? bRX * 0.72 : sit ? S(8) : S(12);
      const hy = low ? bodyY - S(2) : sit ? bodyY - S(11) : bodyY - S(8) + (eat ? S(5) : 0);
      g.fillStyle(COL.cat, 0.28); g.fillCircle(X(hx), Y(hy), S(7.5));
      g.lineStyle(LW, COL.cat, 1); g.strokeCircle(X(hx), Y(hy), S(7.5));

      const ear = pts => {
        const p = pts.map(a => ({ x: X(a[0]), y: Y(a[1]) }));
        g.fillStyle(COL.cat, 0.28); g.fillPoints(p, true);
        g.lineStyle(LW, COL.cat, 1); g.strokePoints(p, true);
      };
      ear([[hx - S(5), hy - S(5)], [hx - S(1.5), hy - S(11)], [hx + S(1), hy - S(5.5)]]);
      ear([[hx + S(2.5), hy - S(5.5)], [hx + S(6), hy - S(10.5)], [hx + S(7), hy - S(4)]]);

      g.fillStyle(COL.chalk, 1);
      g.fillCircle(X(hx + S(4)), Y(hy - S(0.5)), S(1.1));
      g.fillCircle(X(hx + S(7)), Y(hy - S(0.5)), S(1.1));

      // реплика — своя надпись (не пул: ровно один экземпляр, всегда поверх боксов)
      if (cat.bubble) {
        const tw = cat.bubble.length * 5.6 + 18, bx = b[0] - tw / 2, by = b[1] - S(46) + jy;
        g.fillStyle(COL.chalk, 0.93);
        g.fillRoundedRect(bx, by - 20, tw, 26, 9);
        g.fillPoints([{ x: b[0] - 5, y: by + 6 }, { x: b[0] + 5, y: by + 6 }, { x: b[0], y: by + 13 }], true);
        if (!this.tBubble) this.tBubble = this.add.text(0, 0, '', {}).setDepth(TEXT_DEPTH);
        this.tBubble.setStyle({ fontFamily: FONT, fontSize: '10.5px', color: '#2E2833' });
        this.tBubble.setText(cat.bubble).setOrigin(0.5, 0.5).setPosition(b[0], by - 7).setVisible(true);
      } else if (this.tBubble) {
        this.tBubble.setVisible(false);
      }
    }

    /* ==================== ИНТЕРФЕЙС ==================== */
    drawUI() {
      const g = this.gUI; g.clear(); this.tUI.begin();
      this.drawHUD(g);

      const listOnR = this.mode === 'inventory' || this.mode === 'supplies';
      this.drawButtons(g, this.ui.L, [
        { id: 'settings', l: 'Настройки' }, { id: 'inventory', l: 'Инвентарь' }, { id: 'supplies', l: 'Корм' }
      ]);
      if (listOnR) this.drawList(g, this.ui.R);
      else this.drawButtons(g, this.ui.R, [
        { id: 'quests', l: 'Задания' }, { id: 'shop', l: 'Магазин' }, { id: 'spare', l: '—' }
      ]);

      if (this.mode === 'settings') this.drawSettings(g);
      if (this.mode === 'quests') this.drawPlaceholderPanel(g, 'Задания');
      if (this.mode === 'shop') this.drawPlaceholderPanel(g, 'Магазин');
      if (this.drag) this.drawGhost(g);
      this.tUI.end();
    }

    drawHUD(g) {
      // Верхняя полоса: аватар, настроение, рыбки, самоцветы.
      // Всё выше TOPM=112, где начинается комната, — HUD сцену не задевает.
      const cy = 56;

      g.fillStyle(COL.cat, 0.3); g.fillCircle(40, cy, 18);
      g.fillPoints([{ x: 29, y: cy - 10 }, { x: 32, y: cy - 20 }, { x: 38, y: cy - 11 }], true);
      g.fillPoints([{ x: 42, y: cy - 11 }, { x: 48, y: cy - 20 }, { x: 51, y: cy - 10 }], true);
      g.lineStyle(1.4, COL.cat, 1); g.strokeCircle(40, cy, 18);
      g.fillStyle(COL.chalk, 1);
      g.fillCircle(34, cy + 1, 2); g.fillCircle(46, cy + 1, 2);

      const x0 = 66, x1 = 248, y = cy - 9, h = 18;
      g.fillStyle(COL.chalk, 0.08); g.fillRoundedRect(x0, y, x1 - x0, h, 9);
      g.lineStyle(1.2, COL.chalk, 0.35); g.strokeRoundedRect(x0, y, x1 - x0, h, 9);
      g.fillStyle(COL.amber, 0.55);
      g.fillRoundedRect(x0 + 2, y + 2, Math.max(8, (x1 - x0 - 4) * this.mood / 100), h - 4, 7);
      this.tUI.put(x1 + 10, cy, String(Math.round(this.mood)), 11, '#EBE2D5aa');

      g.fillStyle(COL.chalk, 0.18); g.lineStyle(1.3, COL.chalk, 0.8);
      g.fillEllipse(310, cy, 26, 14); g.strokeEllipse(310, cy, 26, 14);
      g.fillStyle(COL.chalk, 0.18);
      g.fillPoints([{ x: 322, y: cy }, { x: 331, y: cy - 6 }, { x: 331, y: cy + 6 }], true);
      this.tUI.put(340, cy, String(this.fish), 12, '#EBE2D5', 'left', 'bold');

      g.fillStyle(0xC9B8D8, 0.4);
      g.fillPoints([{ x: 440, y: cy }, { x: 450, y: cy - 11 }, { x: 460, y: cy }, { x: 450, y: cy + 11 }], true);
      this.tUI.put(470, cy, String(this.gems), 12, '#EBE2D5', 'left', 'bold');
    }

    drawPanel(g, pn, active) {
      const p = pn.poly.map(a => ({ x: a[0], y: a[1] }));
      g.fillStyle(COL.panel, 0.93); g.fillPoints(p, true);
      g.lineStyle(1.2, active ? COL.amber : COL.chalk, active ? 1 : 0.26); g.strokePoints(p, true);
    }

    drawButtons(g, pn, list) {
      this.drawPanel(g, pn, false);
      list.forEach((b, i) => {
        const r = pn.btn[i], on = this.mode === b.id;
        g.fillStyle(on ? COL.amber : COL.chalk, on ? 0.18 : 0.06);
        g.fillRoundedRect(r.x, r.y, r.w, r.h, 10);
        g.lineStyle(1.2, on ? COL.amber : COL.chalk, on ? 1 : 0.3);
        g.strokeRoundedRect(r.x, r.y, r.w, r.h, 10);
        this.tUI.put(r.x + r.w / 2, pn.labelY, b.l, 10, on ? '#E8A33D' : '#EBE2D5aa', 'center');
      });
    }

    listSource() {
      if (this.mode !== 'inventory') return D.SUPPLIES_LIST;
      const used = new Set(Object.values(this.st.place));
      return D.ITEMS_LIST.filter(i => !used.has(i.id));
    }

    drawList(g, pn) {
      const src = this.listSource(), per = 3;
      const pages = Math.max(1, Math.ceil(src.length / per));
      let page = clamp(this.mode === 'inventory' ? this.pageInv : this.pageSup, 0, pages - 1);
      if (this.mode === 'inventory') this.pageInv = page; else this.pageSup = page;

      this.drawPanel(g, pn, true);
      this.tUI.put(pn.btn[0].x, pn.btn[0].y - 16, this.mode === 'inventory' ? 'Инвентарь' : 'Запасы', 10, '#EBE2D5aa');
      this.tUI.put(pn.btn[2].x + pn.btn[2].w - 4, pn.btn[0].y - 14, '× закрыть', 10, '#E8A33Dcc', 'right');

      this.listRects = [];
      for (let i = 0; i < per; i++) {
        const r = pn.btn[i], it = src[page * per + i];
        g.fillStyle(COL.chalk, 0.06); g.fillRoundedRect(r.x, r.y, r.w, r.h, 10);
        g.lineStyle(1.1, COL.chalk, 0.42); g.strokeRoundedRect(r.x, r.y, r.w, r.h, 10);
        if (!it) { this.listRects.push(null); continue; }
        IC.drawIcon(g, it.id, r.x + r.w / 2, r.y + r.h / 2 - 4, pn.iconS);
        this.tUI.put(r.x + r.w / 2, pn.labelY, it.ru, 10, '#EBE2D5aa', 'center');
        this.listRects.push({ r, id: it.id });
      }
      if (pages > 1) {
        for (let i = 0; i < pages; i++) {
          g.fillStyle(i === page ? COL.amber : COL.chalk, i === page ? 1 : 0.3);
          g.fillCircle(pn.btn[1].x + 34 - (pages - 1) * 6 + i * 12, pn.bot - 4, 3);
        }
        [[-1, pn.btn[0].x - 16], [1, pn.btn[2].x + pn.btn[2].w + 2]].forEach(([dir, x]) => {
          g.fillStyle(COL.chalk, 0.06); g.fillRoundedRect(x, pn.btn[0].y + 8, 16, 48, 5);
          this.tUI.put(x + 8, pn.btn[0].y + 32, dir < 0 ? '‹' : '›', 12, '#E8A33Dcc', 'center');
        });
        this.pageBtns = [
          { x: pn.btn[0].x - 16, y: pn.btn[0].y + 8, w: 16, h: 48, d: -1 },
          { x: pn.btn[2].x + pn.btn[2].w + 2, y: pn.btn[0].y + 8, w: 16, h: 48, d: 1 }
        ];
      } else this.pageBtns = [];
    }

    drawSettings(g) {
      const S = { x: 24, y: 300, w: 492, h: 300 };
      g.fillStyle(COL.panel, 0.97); g.fillRoundedRect(S.x, S.y, S.w, S.h, 14);
      g.lineStyle(1.2, COL.chalk, 0.3); g.strokeRoundedRect(S.x, S.y, S.w, S.h, 14);
      this.tUI.put(S.x + 20, S.y + 28, 'Настройки', 11, '#EBE2D5');
      this.tUI.put(S.x + S.w - 20, S.y + 28, '× закрыть', 10, '#E8A33Dcc', 'right');

      // Геометрия сцены (пол, наклон, зум) — только в редакторе уровней.
      // В игре сцена приходит готовой и не пересчитывается.
      this.tUI.put(S.x + 20, S.y + 58, 'Геометрия сцены задаётся в редакторе уровней', 10, '#EBE2D566');

      this.setBtns = [];
      const toggles = [
        ['catOn', 'Кот в комнате'], ['showLabels', 'Подписи'],
        ['showEmpty', 'Пустые зоны'], ['showWalk', 'Проходимость']
      ];
      toggles.forEach(([k, l], i) => {
        const r = i % 2, c = Math.floor(i / 2);
        const x = S.x + 20 + r * 236, y = S.y + 90 + c * 46;
        const on = this[k];
        g.fillStyle(on ? COL.amber : COL.chalk, on ? 0.2 : 0.05);
        g.fillRoundedRect(x, y, 216, 36, 9);
        g.lineStyle(1.1, on ? COL.amber : COL.chalk, on ? 1 : 0.28);
        g.strokeRoundedRect(x, y, 216, 36, 9);
        this.tUI.put(x + 108, y + 18, l, 10, on ? '#E8A33D' : '#EBE2D5aa', 'center');
        this.setBtns.push({ x, y, w: 216, h: 36, k });
      });

      const N = this.NAV;
      const msg = !N ? '' : N.unreachable.length
        ? 'Коту не подойти: ' + N.unreachable.join(', ')
        : 'Ко всем предметам есть подход · пол свободен на ' + N.area + '%';
      this.tUI.put(S.x + 20, S.y + S.h - 34, msg, 10,
        N && N.unreachable.length ? '#E8A33D' : '#EBE2D566');
    }

    // «Задания»/«Магазин» — заказчик не описал содержимое, брифу нужно было
    // только перестать быть «ничего не делает». Тот же вид, что drawSettings
    // (панель/заголовок/закрыть), без выдуманного контента — реальное
    // наполнение содержательно другая задача.
    drawPlaceholderPanel(g, title) {
      const S = { x: 24, y: 300, w: 492, h: 180 };
      g.fillStyle(COL.panel, 0.97); g.fillRoundedRect(S.x, S.y, S.w, S.h, 14);
      g.lineStyle(1.2, COL.chalk, 0.3); g.strokeRoundedRect(S.x, S.y, S.w, S.h, 14);
      this.tUI.put(S.x + 20, S.y + 28, title, 11, '#EBE2D5');
      this.tUI.put(S.x + S.w - 20, S.y + 28, '× закрыть', 10, '#E8A33Dcc', 'right');
      this.tUI.put(S.x + S.w / 2, S.y + S.h / 2 + 10, 'Скоро', 13, '#EBE2D566', 'center');
      this.placeholderRect = S;
    }

    drawGhost(g) {
      const p = this.drag.p;
      if (!p) return;
      const x = p[0], y = p[1] - 48;
      g.fillStyle(COL.panel, 0.9); g.fillRoundedRect(x - 30, y - 30, 60, 60, 10);
      g.lineStyle(1.4, COL.amber, 1); g.strokeRoundedRect(x - 30, y - 30, 60, 60, 10);
      IC.drawIcon(g, this.drag.iid, x, y, 19);
      g.lineStyle(1.2, COL.amber, 0.9);
      g.lineBetween(x - 7, p[1], x + 7, p[1]);
      g.lineBetween(x, p[1] - 7, x, p[1] + 7);

      // Причина отказа / след подхода — для зоны прямо под призраком сейчас.
      // I.reject уже считался для подсветки зон (drawZoneOverlay), тут просто
      // берём его результат для ОДНОЙ конкретной наведённой зоны и показываем.
      const it = D.ITEMS[this.drag.iid], F = I.PROJ.F;
      const hover = this.zones.find(z => !this.st.place[z.id] && inPoly([p[0], p[1]], I.zonePoly(z, F)));
      if (hover) {
        const reason = I.reject(hover, it);
        if (reason) {
          this.tUI.put(x, y - 42, reason, 9, '#E8A33D', 'center');
        } else if (it.touch) {
          // след лапы — где коту стоять, чтобы дотянуться до предмета на этой зоне
          const cx = (hover.r[0] + hover.r[2]) / 2, cy = (hover.r[1] + hover.r[3]) / 2;
          const [ax, ay] = I.nearSpot(this.NAV, cx, cy);
          const pp = I.P(ax, ay);
          g.fillStyle(COL.amber, 0.5); g.fillCircle(pp[0], pp[1], 4);
          g.lineStyle(1, COL.amber, 0.9); g.strokeCircle(pp[0], pp[1], 4);
        }
      }
    }

    /* ==================== ВВОД ==================== */
    hitBtn(rects, x, y) {
      for (const b of rects) if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      return null;
    }

    onDown(p) {
      const x = p.worldX, y = p.worldY;
      const listOnR = this.mode === 'inventory' || this.mode === 'supplies';

      // закрыть список
      if (listOnR) {
        const b = this.ui.R.btn[2];
        if (x >= b.x && x <= b.x + b.w + 4 && y >= b.y - 30 && y <= b.y - 6) { this.setMode('view'); return; }
        const pg = this.hitBtn(this.pageBtns || [], x, y);
        if (pg) {
          const src = this.listSource(), pages = Math.max(1, Math.ceil(src.length / 3));
          if (this.mode === 'inventory') this.pageInv = clamp(this.pageInv + pg.d, 0, pages - 1);
          else this.pageSup = clamp(this.pageSup + pg.d, 0, pages - 1);
          this.uiDirty = true; return;
        }
        const cell = (this.listRects || []).find(c => c && x >= c.r.x && x <= c.r.x + c.r.w && y >= c.r.y && y <= c.r.y + c.r.h);
        if (cell) {
          if (this.mode === 'inventory') { this.drag = { iid: cell.id, p: [x, y] }; this.uiDirty = true; }
          else this.useSupply(cell.id);
          return;
        }
      }

      // настройки
      if (this.mode === 'settings') {
        const S = { x: 24, y: 300, w: 492, h: 300 };
        if (x >= S.x + S.w - 80 && x <= S.x + S.w - 6 && y >= S.y + 10 && y <= S.y + 36) { this.setMode('view'); return; }
        const t = this.hitBtn(this.setBtns || [], x, y);
        if (t) {
          this[t.k] = !this[t.k];
          if (t.k === 'showWalk') this.shellDirty = true;
          if (t.k === 'showLabels') this.rebuildItemGfx();
          this.uiDirty = true;
          return;
        }
        if (x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h) return;
      }

      // «Задания»/«Магазин» — та же геометрия панели, что у настроек
      if (this.mode === 'quests' || this.mode === 'shop') {
        const S = this.placeholderRect || { x: 24, y: 300, w: 492, h: 180 };
        if (x >= S.x + S.w - 80 && x <= S.x + S.w - 6 && y >= S.y + 10 && y <= S.y + 36) { this.setMode('view'); return; }
        if (x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h) return;
      }

      // кнопки панелей
      const L = this.ui.L, R = this.ui.R;
      const ids = ['settings', 'inventory', 'supplies'];
      for (let i = 0; i < 3; i++) {
        const b = L.btn[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          this.setMode(this.mode === ids[i] ? 'view' : ids[i]); return;
        }
      }
      if (!listOnR) {
        const idsR = ['quests', 'shop', 'spare'];
        for (let i = 0; i < 3; i++) {
          const b = R.btn[i];
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            if (idsR[i] === 'spare') return; // «—» — по брифу так и остаётся ничем
            this.setMode(this.mode === idsR[i] ? 'view' : idsR[i]);
            return;
          }
        }
      }

      // панель поглощает тап целиком, до сцены он не доходит
      if (inPoly([x, y], L.poly) || inPoly([x, y], R.poly)) return;

      // снятие предмета обратно в инвентарь — только при открытом инвентаре,
      // перебор от ближних к зрителю, чтобы попадать в то, что сверху
      if (this.mode === 'inventory' && !this.drag) {
        const placed = Object.keys(this.st.place)
          .filter(k => k !== 'CEIL' && this.zmap[k])
          .sort((a, b) => I.depth(this.zmap, b) - I.depth(this.zmap, a));
        for (const zid of placed) {
          if (inPoly([x, y], I.zonePoly(this.zmap[zid], I.PROJ.F))) {
            delete this.st.place[zid]; this.rebuild(); this.uiDirty = true; return;
          }
        }
      }

      // тап по коту
      const cp = I.P(this.cat.x, this.cat.y);
      if (Math.hypot(x - cp[0], y - cp[1] + 20) < 34) { this.playHand(); return; }

      // тап по полу — идём
      const [gx, gy] = I.unP(x, y);
      const F = I.PROJ.F;
      if (gx >= 0 && gy >= 0 && gx <= F && gy <= F) this.walkTo(gx, gy, () => this.idleCycle());
    }

    onUp(p) {
      if (!this.drag) return;
      const x = p.worldX, y = p.worldY, F = I.PROJ.F, it = D.ITEMS[this.drag.iid];
      let hit = null;
      // ближайшая по глубине легальная зона под пальцем
      const cands = this.zones.filter(z => !this.st.place[z.id] && !I.reject(z, it));
      for (const z of cands) {
        if (inPoly([x, y], I.zonePoly(z, F))) { hit = z; break; }
      }
      if (hit) {
        this.st.place[hit.id] = this.drag.iid;
        this.rebuild();
        // если постановка отрезала подход — откатываем
        if (this.NAV.unreachable.length) {
          delete this.st.place[hit.id];
          this.rebuild();
          this.bubble('Так к нему не подойти.');
        }
      }
      this.drag = null; this.uiDirty = true;
    }

    setMode(m) { this.mode = m; this.drag = null; this.ui = this.panelGeo(); this.uiDirty = true; }

    /* ==================== ПОВЕДЕНИЕ КОТА ==================== */
    setSt(st, t, after) { this.cat.st = st; this.cat.t = t; this.cat.after = after || null; }
    bubble(txt, dur) { this.cat.bubble = txt; this.cat.bt = dur || 3.2; }

    walkTo(x, y, after) {
      const p = I.findPath(this.NAV, this.cat.x, this.cat.y, x, y);
      if (!p.length) { this.setSt('idle', 1.2, after); return; }
      this.cat.path = p; this.setSt('walk', 99, after);
    }
    idleCycle() { this.setSt('idle', rnd(1.2, 3), () => this.decideNext()); }
    decideNext() {
      const r = Math.random();
      if (r < 0.55) this.wander();
      else if (r < 0.85) this.setSt('sit', rnd(2.5, 6), () => this.afterRest());
      else this.setSt('lie', rnd(4, 9), () => this.afterRest());
    }
    afterRest() { if (Math.random() < 0.7) this.wander(); else this.idleCycle(); }
    wander() {
      const s = I.randomSpot(this.NAV, this.cat, 1.2);
      if (!s) { this.setSt('idle', 2, () => this.idleCycle()); return; }
      this.walkTo(s[0], s[1], () => this.idleCycle());
    }
    playHand() {
      this.cat.path = []; this.cat.jump = 3;
      this.setSt('jump', 1.6, () => {
        this.bubble(pick(D.SAY.toy)); this.mood = clamp(this.mood + 5, 0, 100);
        this.uiDirty = true; this.idleCycle();
      });
    }
    useSupply(id) {
      const s = D.SUPPLIES[id];
      if (s && s.food) {
        const zid = Object.keys(this.st.place).find(k => this.st.place[k] === 'bowls');
        const f = zid ? I.footprint(this.zmap, D.ITEMS, zid, 'bowls') : null;
        if (!f) { this.bubble(pick(D.SAY.floor)); return; }
        const sp = I.nearSpot(this.NAV, f.c[0], f.c[1]);
        this.setMode('view');
        this.walkTo(sp[0], sp[1], () => {
          this.bubble(pick(D.SAY.bowl));
          this.setSt('eat', 2, () => {
            this.mood = clamp(this.mood + 10, 0, 100); this.uiDirty = true; this.idleCycle();
          });
        });
      } else { this.setMode('view'); this.playHand(); }
    }

    tick(dt) {
      const cat = this.cat;
      if (cat.bt > 0) { cat.bt -= dt; if (cat.bt <= 0) cat.bubble = null; }
      if (!this.catOn) return;
      cat.ph += dt * (cat.st === 'walk' ? 9 : cat.st === 'dig' ? 14 : 2);

      if (cat.st === 'walk') {
        if (!cat.path.length) {
          const f = cat.after; cat.after = null;
          if (f) f(); else this.idleCycle();
          return;
        }
        const [tx, ty] = cat.path[0];
        const dx = tx - cat.x, dy = ty - cat.y, dist = Math.hypot(dx, dy);
        const sp = 1.15 * dt;
        if (dist <= sp || dist < 1e-6) { cat.x = tx; cat.y = ty; cat.path.shift(); }
        else { cat.x += dx / dist * sp; cat.y += dy / dist * sp; }
        const sdx = dx - dy;                       // направление в экранных координатах
        if (Math.abs(sdx) > 0.002) cat.dir = sdx > 0 ? 1 : -1;
      } else {
        cat.t -= dt;
        if (cat.t <= 0) { const f = cat.after; cat.after = null; if (f) f(); else this.idleCycle(); }
      }
    }

    update(time, delta) {
      const dt = Math.min(delta, 60) / 1000;
      this.tick(dt);
      if (this.shellDirty) { this.drawShell(); this.shellDirty = false; }
      this.drawZoneOverlay();
      this.drawCatGfx();
      if (this.uiDirty === undefined) this.uiDirty = true;
      if (this.uiDirty || this.drag) { this.drawUI(); this.uiDirty = false; }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: '#332C39',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [RoomScene]
  });
  window.__game = game; // отладка в консоли — та же договорённость, что в phaser-game/
})();
