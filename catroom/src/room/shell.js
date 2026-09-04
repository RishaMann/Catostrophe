/* ============================================================================
   room/shell.js — геометрия и отрисовка оболочки сцены: пол, стены, проёмы
   двери/окна, крепление лампы, debug-проходимость. Пересборка сцены/навигации
   (rebuild) тоже тут — она реагирует на любое изменение геометрии/расстановки.

   TODO(location-editor): будущие элементы управления геометрией комнаты
   (стены/зоны/сетка) войдут сюда и будут открываться через mode==='settings',
   как сейчас debug-тумблеры (showWalk/showLabels/showEmpty) в drawSettings
   (ui/hud.js).
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { OX, WALL, DOOR_H, WIN_W, WIN_Z0, WIN_Z1, STUB, STEP, DOOR_W } = I;
  const { COL } = root.RCFG;
  const { clamp, inPoly, RANGE, nearestOnSeg } = root.GUTIL;

  root.MIXIN_SHELL = {

    /* ---------- пересборка сцены и навигации ---------- */
    // Единственная точка входа при постановке/снятии предмета и при старте.
    // Помечает оболочку «грязной» (дверь/окно/проходимость не двигаются в
    // игре, но проходимость debug-слоя зависит от NAV, который тут же
    // пересчитан) и пересобирает пул предметов — не в update(), только тут.
    rebuild() {
      const r = I.buildScene(this.params, this.st, D.ITEMS);
      this.zones = r.zones; this.zmap = r.zmap; this.LAY = r.LAY;
      this.NAV = I.buildNav(D.ITEMS, this.st.floor, this.cat);

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
    },

    /* ---------- общий помощник отрисовки многоугольника на произвольный Graphics ---------- */
    polyOn(g, pts, fill, fa, stroke, sw, close) {
      const p = pts.map(a => ({ x: a[0], y: a[1] }));
      if (fill !== null && fill !== undefined) { g.fillStyle(fill, fa); g.fillPoints(p, true); }
      if (stroke !== null && stroke !== undefined) { g.lineStyle(sw || 1.2, stroke, 1); g.strokePoints(p, close !== false); }
    },

    // Заливка стены + обводка ТРЁХ рёбер (пол, ближний и дальний вертикальные
    // края) без верхнего. Верх стены раньше рисовался тоже — на переднем
    // плане линия проходила прямо по высоким предметам (шкаф, стеллаж) и
    // визуально их перекрывала (полупрозрачные боксы, линия за ними всё
    // равно просвечивала). Заливка стены (без обводки) сама по себе
    // предметы не загораживает — убрана только сама линия.
    wallFace(g, pts, fillAlpha) {
      if (fillAlpha) this.polyOn(g, pts, COL.chalk, fillAlpha, null);
      g.lineStyle(1.2, COL.chalk, 1);
      g.lineBetween(pts[0][0], pts[0][1], pts[1][0], pts[1][1]); // низ, по полу
      g.lineBetween(pts[1][0], pts[1][1], pts[2][0], pts[2][1]); // ближний вертикальный край
      g.lineBetween(pts[3][0], pts[3][1], pts[0][0], pts[0][1]); // дальний край (угол комнаты)
    },

    // Геометрия проёмов — общая для отрисовки (drawShell) и хит-теста
    // (hitDoor/hitWindow), чтобы клик и рисунок никогда не разошлись.
    doorPoly() {
      const F = I.PROJ.F, d0 = this.st.door.pos, d1 = d0 + DOOR_W;
      return this.st.door.side === 'left'
        ? [I.P(0, d0), I.P(0, d1), I.P(0, d1, DOOR_H), I.P(0, d0, DOOR_H)]
        : [I.P(d0, F), I.P(d1, F), I.P(d1, F, DOOR_H), I.P(d0, F, DOOR_H)];
    },
    winPoly() {
      const F = I.PROJ.F, w0 = this.st.win.pos, w1 = w0 + WIN_W;
      return this.st.win.side === 'right'
        ? [I.P(w0, 0, WIN_Z0), I.P(w1, 0, WIN_Z0), I.P(w1, 0, WIN_Z1), I.P(w0, 0, WIN_Z1)]
        : [I.P(F, w0, 0.08), I.P(F, w1, 0.08), I.P(F, w1, STUB), I.P(F, w0, STUB)];
    },
    hitDoor(x, y) { return inPoly([x, y], this.doorPoly()); },
    hitWindow(x, y) { return inPoly([x, y], this.winPoly()); },

    // Точка крепления лампы/люстры на потолке — тот же квадрат-подсказка,
    // что уже рисовался в drawZoneOverlay (амбер-рамка вокруг this.st.light),
    // теперь ещё и хватается/двигается, как дверь/окно.
    lightPoly() {
      const L = this.st.light;
      return [I.P(L.x - .5, L.y - .5, WALL), I.P(L.x + .5, L.y - .5, WALL),
      I.P(L.x + .5, L.y + .5, WALL), I.P(L.x - .5, L.y + .5, WALL)];
    },
    hitLight(x, y) { return inPoly([x, y], this.lightPoly()); },
    // Обратная проекция для точки НА ПОТОЛКЕ (z=WALL), не на полу (z=0) —
    // I.unP этого не умеет (только пол), поэтому та же поправка на WALL*ZH,
    // что была в light-ветке startMove() исходного app.js.
    unProjectCeil(sx, sy) {
      const u = (sx - OX) / I.PROJ.TW, v = (sy - I.PROJ.OY + WALL * I.PROJ.ZH) / I.PROJ.TH;
      return [(u + v) / 2, (v - u) / 2];
    },

    /* ==================== ДВЕРЬ/ОКНО — ПЕРЕТАСКИВАНИЕ ====================
       Раньше двигались только по своей задней стене; на самом деле в
       исходном app.js (и уже в zone-логике iso.js — dynamicZones давно умеет
       door.side==='frontLeft'/win.side==='frontRight') дверь/окно едут ЗА
       УГОЛ на примыкающий передний (открытый) край тоже. Не хватало только
       самого перетаскивания в движке — вот оно, один в один RANGE/nearestOnSeg
       из app.js. Доступно только при открытом инвентаре — как и вся
       остальная перестановка. */
    dragOpening(x, y) {
      const F = I.PROJ.F;
      if (this.openingDrag === 'door') {
        const e1 = Math.min(RANGE.left[1], this.LAY.Wend - DOOR_W);
        const e2 = Math.min(RANGE.frontLeft[1], F - DOOR_W - 0.3);
        const A = nearestOnSeg(x, y, I.P(0, RANGE.left[0]), I.P(0, e1));
        const B = nearestOnSeg(x, y, I.P(RANGE.frontLeft[0], F), I.P(e2, F));
        if (A.d <= B.d + 18) { this.st.door.side = 'left'; this.st.door.pos = RANGE.left[0] + A.t * (e1 - RANGE.left[0]); }
        else { this.st.door.side = 'frontLeft'; this.st.door.pos = RANGE.frontLeft[0] + B.t * (e2 - RANGE.frontLeft[0]); }
        this.st.door.pos = Math.round(this.st.door.pos * 10) / 10;
      } else if (this.openingDrag === 'window') {
        const e1 = Math.min(RANGE.right[1], this.LAY.Wend - WIN_W);
        const e2 = Math.min(RANGE.frontRight[1], F - WIN_W - 0.3);
        const A = nearestOnSeg(x, y, I.P(RANGE.right[0], 0), I.P(e1, 0));
        const B = nearestOnSeg(x, y, I.P(F, RANGE.frontRight[0]), I.P(F, e2));
        if (A.d <= B.d + 18) { this.st.win.side = 'right'; this.st.win.pos = RANGE.right[0] + A.t * (e1 - RANGE.right[0]); }
        else { this.st.win.side = 'frontRight'; this.st.win.pos = RANGE.frontRight[0] + B.t * (e2 - RANGE.frontRight[0]); }
        this.st.win.pos = Math.round(this.st.win.pos * 10) / 10;
      } else if (this.openingDrag === 'light') {
        const [lx, ly] = this.unProjectCeil(x, y);
        this.st.light.x = Math.round(clamp(lx, 1, F - 1) * 10) / 10;
        this.st.light.y = Math.round(clamp(ly, 1, F - 1) * 10) / 10;
      }
      this.rebuild();
    },

    /* ==================== ОБОЛОЧКА СЦЕНЫ (пол/стены/проёмы/debug-проходимость) ====================
       Перерисовывается только когда this.shellDirty — взводится в rebuild()
       (проходимость зависит от NAV) и при переключении «Проходимость» в
       настройках. Дверь/окно в игре не двигаются (геометрия сцены фиксирована
       редактором уровней), так что событий на самом деле мало. */
    drawShell() {
      const g = this.gShell, F = I.PROJ.F;
      g.clear(); this.tShell.begin();
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);

      // --- пол и две стены (без верхней линии — см. wallFace) ---
      // Серой заливки на стенах больше нет — вместо неё сквозь контур видна
      // фоновая панорама (BG_DEPTH, под gShell). Обводка граней и пол остаются.
      poly([I.P(0, 0), I.P(F, 0), I.P(F, F), I.P(0, F)], COL.chalk, 0.045, COL.chalk, 1.2);
      this.wallFace(g, [I.P(0, 0), I.P(F, 0), I.P(F, 0, WALL), I.P(0, 0, WALL)], 0);
      this.wallFace(g, [I.P(0, 0), I.P(0, F), I.P(0, F, WALL), I.P(0, 0, WALL)], 0);

      g.lineStyle(1, COL.chalk, 0.07);
      for (let i = 1; i < F; i++) {
        let a = I.P(i, 0), b = I.P(i, F); g.lineBetween(a[0], a[1], b[0], b[1]);
        a = I.P(0, i); b = I.P(F, i); g.lineBetween(a[0], a[1], b[0], b[1]);
      }
      // Бортики ближних рёбер (низкий декоративный "поребрик" вдоль открытых
      // передних краёв пола) убраны — та же жалоба, что и на верх стены:
      // лишняя линия поверх сцены, предметам ближнего плана мешала.

      // --- проём двери и окна (геометрия — doorPoly()/winPoly(), общая с
      // хит-тестом hitDoor()/hitWindow(), чтобы клик и рисунок не разошлись) ---
      const dp = this.doorPoly();
      poly(dp, 0x000000, 0.30, COL.chalk, 1.1);
      let c = I.centroid(dp);
      this.tShell.put(c[0], c[1], 'дверь', 10, '#E8A33Dcc', 'center');

      const wp = this.winPoly();
      poly(wp, 0x7896BE, 0.22, COL.chalk, 1.1);
      c = I.centroid(wp);
      this.tShell.put(c[0], c[1], 'окно', 10, '#E8A33Dcc', 'center');

      // --- точка крепления лампы/люстры — двигается, как дверь/окно (см.
      // hitLight/dragOpening), только пока открыт инвентарь: это средство
      // редактирования, а не часть неизменной геометрии комнаты. ---
      if (this.mode === 'inventory') {
        const lp = this.lightPoly();
        poly(lp, COL.amber, 0.10, COL.amber, 1);
        c = I.centroid(lp);
        this.tShell.put(c[0], c[1], 'крепление', 9, '#E8A33Dcc', 'center');
      }

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
  };
})(typeof window !== 'undefined' ? window : globalThis);
