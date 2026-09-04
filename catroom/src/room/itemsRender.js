/* ============================================================================
   room/itemsRender.js — предметы: подсветка пустых легальных зон при драге,
   пул Graphics/Text по занятой зоне, отрисовка мебели и потолочного подвеса.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { WALL } = I;
  const { COL, FONT, TEXT_DEPTH, CEIL_DEPTH } = root.RCFG;

  root.MIXIN_ITEMS = {

    /* ==================== ПОДСВЕТКА ПУСТЫХ ЗОН ПРИ ДРАГЕ ====================
       Свободная расстановка убрала список floor-зон — подсвечивать тут
       можно только оставшийся конечный список (стены/потолок/поверхности,
       dynamicZones). Легальность floor-позиции под пальцем показывает сам
       призрак (drawGhost, ui/hud.js — силуэт + причина отказа), отдельная
       подсветка «всех легальных клеток» для непрерывного пола не имеет
       смысла: клеток нет, есть только точка под курсором. */
    drawZoneOverlay() {
      const g = this.zoneGfx, F = I.PROJ.F;
      g.clear();
      // Драг корма/игрушки (kind:'supply') целится в кота/миску/пол, а не в
      // зону по I.reject — подсветка «легальных зон» тут смысла не имеет и
      // D.ITEMS[iid] для него не существует (это D.SUPPLIES), поэтому не
      // считаем legal вовсе. Floor-предмет (it.s) в руке тоже сюда не идёт —
      // у него нет конечного списка зон для подсветки, см. комментарий выше.
      const dragIt = this.drag && this.drag.kind !== 'supply' ? D.ITEMS[this.drag.iid] : null;
      const placing = !!dragIt && !dragIt.s;
      const active = this.showEmpty || placing;
      this.tZones.begin();
      if (active) {
        const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
        this.zones.forEach(z => {
          if (this.st.place[z.id]) return;
          const legal = placing ? !I.reject(z, dragIt) : false;
          const pts = I.zonePoly(z, F);
          poly(pts, legal ? COL.amber : COL.chalk, legal ? 0.18 : 0.05,
            legal ? COL.amber : COL.chalk, legal ? 1.4 : 0.8);
          if (this.showLabels) {
            const cc = I.centroid(pts);
            this.tZones.put(cc[0], cc[1], z.ru, 9, '#EBE2D555', 'center');
          }
        });
        // Точка крепления лампы больше не рисуется тут — переехала в
        // drawShell() (lightPoly()), т.к. теперь она ещё и двигается, как
        // дверь/окно (см. hitLight/dragOpening), и должна быть видна не
        // только при showEmpty/драге, а всегда, пока открыт инвентарь.
      }
      this.tZones.end();
    },

    /* ==================== ПУЛ ПРЕДМЕТОВ ====================
       По одному Graphics(+Text) на занятую зону (включая CEIL — потолочный
       подвес). Пересобирается только из rebuild() — по событию постановки/
       снятия предмета, не в update(). Глубина = I.depth(zmap,zid) — тот же
       ключ сортировки, что использует редактор уровней; Phaser сам сортирует
       GameObject'ы по .depth, ручной интерливинг с котом не нужен. */
    // itemGfx хранит ДВА рода записей под общим Map (ключи из разных
    // пространств имён никогда не пересекаются: id зоны типа 'WL_A'/'CEIL' —
    // заглавными, iid предмета типа 'sofa' — строчными): стены/потолок/
    // поверхности по-прежнему по id зоны (st.place, конечный список), а
    // floor-мебель (свободная расстановка) — прямо по iid (st.floor).
    // entry.kind различает их для очистки устаревших записей.
    rebuildItemGfx() {
      const keepWall = new Set(Object.keys(this.st.place));
      const keepFloor = new Set(Object.keys(this.st.floor));
      for (const [key, entry] of this.itemGfx) {
        const stale = entry.kind === 'floor'
          ? !keepFloor.has(key)
          : (!keepWall.has(key) || (key !== 'CEIL' && !this.zmap[key]));
        if (stale) {
          entry.g.destroy();
          if (entry.t) entry.t.destroy();
          this.itemGfx.delete(key);
        }
      }
      for (const zid of Object.keys(this.st.place)) {
        if (zid !== 'CEIL' && !this.zmap[zid]) continue;
        let entry = this.itemGfx.get(zid);
        if (!entry) { entry = { g: this.add.graphics(), t: null, kind: 'wall' }; this.itemGfx.set(zid, entry); }
        entry.g.clear();
        if (zid === 'CEIL') {
          entry.g.setDepth(CEIL_DEPTH);
          entry.t = this.drawCeilInto(entry.g, entry.t);
        } else {
          entry.g.setDepth(I.depth(this.zmap, zid));
          entry.t = this.drawWallItemInto(entry.g, entry.t, zid, this.st.place[zid]);
        }
      }
      for (const iid of Object.keys(this.st.floor)) {
        let entry = this.itemGfx.get(iid);
        if (!entry) { entry = { g: this.add.graphics(), t: null, kind: 'floor' }; this.itemGfx.set(iid, entry); }
        entry.g.clear();
        const pos = this.st.floor[iid];
        entry.g.setDepth(I.floorDepth(pos));
        entry.t = this.drawFloorItemInto(entry.g, entry.t, iid, pos);
      }
    },

    setLabel(text, x, y, str) {
      if (!text) text = this.add.text(0, 0, '', {}).setDepth(TEXT_DEPTH);
      text.setStyle({ fontFamily: FONT, fontSize: '11px', color: '#EBE2D5' });
      text.setText(str).setOrigin(0.5, 0.5).setPosition(x, y).setVisible(true);
      return text;
    },
    hideLabel(text) { if (text) text.setVisible(false); return text; },

    // Стена/потолочная область/поверхность — прежний вид (вписанный внутрь
    // зоны прямоугольник), геометрия по-прежнему из dynamicZones/zmap.
    drawWallItemInto(g, text, zid, iid) {
      const z = this.zmap[zid], it = D.ITEMS[iid], F = I.PROJ.F;
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
      const pts = I.zonePoly(z, F), c = I.centroid(pts);
      const ins = pts.map(p => [c[0] + (p[0] - c[0]) * 0.78, c[1] + (p[1] - c[1]) * 0.78]);
      poly(ins, COL.chalk, 0.16, COL.chalk, 1.2);
      return this.showLabels ? this.setLabel(text, c[0], c[1] + 3, it.ru) : this.hideLabel(text);
    },

    // Floor-мебель — свободная расстановка: позиция и ориентация прямо из
    // st.floor[iid] + I.floorOrient (та же эвристика, что у призрака в руке,
    // см. drawGhost в ui/hud.js), никакой зоны тут больше нет.
    drawFloorItemInto(g, text, iid, pos) {
      const it = D.ITEMS[iid];
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
      const cx = pos.x, cy = pos.y;
      const [w, d] = I.floorOrient(it, cx, cy), h = it.s[2];
      const shapes = root.ITEM_SHAPES;
      if (shapes && shapes.has(iid)) {
        shapes.draw(iid, { g, poly, cx, cy, w, d, h, it, I, COL });
      } else {
        // запасной вариант для предмета без своего силуэта в itemShapes.js —
        // прежний обезличенный бокс по габаритам.
        const A = [cx - w / 2, cy - d / 2], B = [cx + w / 2, cy - d / 2];
        const C = [cx + w / 2, cy + d / 2], E = [cx - w / 2, cy + d / 2];
        poly([I.P(B[0], B[1]), I.P(C[0], C[1]), I.P(C[0], C[1], h), I.P(B[0], B[1], h)], COL.chalk, 0.10, COL.chalk, 1);
        poly([I.P(E[0], E[1]), I.P(C[0], C[1]), I.P(C[0], C[1], h), I.P(E[0], E[1], h)], COL.chalk, 0.05, COL.chalk, 1);
        poly([I.P(A[0], A[1], h), I.P(B[0], B[1], h), I.P(C[0], C[1], h), I.P(E[0], E[1], h)], COL.chalk, 0.17, COL.chalk, 1);
      }
      if (this.showLabels) {
        const t = I.P(cx, cy, h);
        return this.setLabel(text, t[0], t[1] - 7, it.ru);
      }
      return this.hideLabel(text);
    },

    drawCeilInto(g, text) {
      const iid = this.st.place.CEIL, L = this.st.light;
      const t = I.P(L.x, L.y, WALL), b = I.P(L.x, L.y, WALL - 0.7);
      // шнур обязателен: без него высота подвеса не читается
      g.lineStyle(1.2, COL.amber, 1); g.lineBetween(t[0], t[1], b[0], b[1]);
      g.fillStyle(COL.amber, 0.3); g.fillCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
      g.lineStyle(1.2, COL.amber, 1); g.strokeCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
      return this.showLabels ? this.setLabel(text, b[0], b[1] + 28, D.ITEMS[iid].ru) : this.hideLabel(text);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
