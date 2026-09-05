/* ============================================================================
   room/itemsRender.js — предметы: подсветка пустых легальных зон при драге,
   пул Graphics/Text по занятой зоне, отрисовка мебели и потолочного подвеса.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { WALL } = I;
  const { COL, FONT, TEXT_DEPTH, CEIL_DEPTH, SHADOW_DEPTH } = root.RCFG;
  const FS = root.FURN_SPRITES;

  // Плоские напольные покрытия (ковёр и т.п., высота < 0.2 — тот же порог,
  // что и у навигационных «solid»-препятствий в iso.js) лежат НА полу, а не
  // «среди» мебели: обычный I.floorDepth(pos) по центру их большого
  // footprint'а иначе то и дело перекрывал бы стоящую на них мебель (порядок
  // по x+y у центра ковра ничего не говорит о том, что физически ближе к
  // камере — сам ковёр всегда должен быть ПОД любым другим предметом).
  // Рисуем их сразу над полом/тенью, ниже абсолютно любой настоящей мебели и
  // кота (у которых floorDepth/cat.x+cat.y всегда ≥ 0). +pos*1e-4 — не для
  // сортировки относительно мебели (она и так всегда «выше»), а только чтобы
  // несколько плоских покрытий, если их когда-нибудь станет больше одного и
  // они пересекутся, сортировались стабильно и детерминированно между собой.
  function floorRenderDepth(it, pos) {
    if (it && it.s && it.s[2] < 0.2) return SHADOW_DEPTH + 0.05 + (pos.x + pos.y) * 0.0001;
    return I.floorDepth(pos);
  }

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
          if (entry.img) entry.img.destroy();
          this.itemGfx.delete(key);
        }
      }
      for (const zid of Object.keys(this.st.place)) {
        if (zid !== 'CEIL' && !this.zmap[zid]) continue;
        let entry = this.itemGfx.get(zid);
        if (!entry) { entry = { g: this.add.graphics(), t: null, img: null, kind: 'wall' }; this.itemGfx.set(zid, entry); }
        entry.g.clear();
        if (zid === 'CEIL') {
          entry.g.setDepth(CEIL_DEPTH);
          entry.t = this.drawCeilInto(entry.g, entry.t);
        } else {
          // +0.001: маркер/подпись (g) поверх спрайта (img) той же зоны, если
          // они на одной глубине — см. drawWallItemInto.
          entry.g.setDepth(I.depth(this.zmap, zid) + 0.001);
          entry.t = this.drawWallItemInto(entry.g, entry.t, zid, this.st.place[zid]);
        }
      }
      for (const iid of Object.keys(this.st.floor)) {
        let entry = this.itemGfx.get(iid);
        if (!entry) { entry = { g: this.add.graphics(), t: null, img: null, kind: 'floor' }; this.itemGfx.set(iid, entry); }
        entry.g.clear();
        const pos = this.st.floor[iid];
        // +0.001 — та же причина, что и у стенных предметов чуть выше.
        // floorRenderDepth, не «голый» I.floorDepth — см. комментарий над
        // функцией: плоские покрытия (ковёр) всегда должны быть ниже мебели.
        entry.g.setDepth(floorRenderDepth(D.ITEMS[iid], pos) + 0.001);
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

    // Стена/потолочная область/поверхность — вписанный внутрь зоны
    // прямоугольник (геометрия по-прежнему из dynamicZones/zmap), либо —
    // если включён спрайтовый режим и для предмета есть вырезанная картинка
    // (сейчас только curtain, см. Furniture/manifest.json) — сама картинка.
    drawWallItemInto(g, text, zid, iid) {
      const z = this.zmap[zid], it = D.ITEMS[iid], F = I.PROJ.F;
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
      const pts = I.zonePoly(z, F), c = I.centroid(pts);
      const entry = this.itemGfx.get(zid);
      const state = this.furnitureSprites && FS && FS.pickState(iid, 'new');
      if (state) {
        const key = FS.textureKey(iid, state);
        if (!entry.img) entry.img = this.add.image(0, 0, key).setOrigin(0.5, 0.5);
        const src = this.textures.get(key).getSourceImage();
        // curtain изображает окно целиком (карниз + штора до пола) — это
        // куда крупнее декоративной зоны, в которую его формально поставили
        // (WIN_ROD/WIN_FRAME/OVERDOOR — тонкие полоски под конкретное
        // крепление, не габарит самой шторы: вписать картинку в них значило
        // бы сжать её до полоски). Меряем и ставим её по фактическому окну
        // (curtainPoly, room/shell.js), а зона (pts/c) нужна только чтобы
        // понять, ЧТО тут висит, и куда положить подпись.
        // Только у самого окна (WIN_ROD/WIN_FRAME) — если штору всё же
        // утащили на произвольную стену (curtain принимает любую 'wall'-зону,
        // см. ACCEPTS в iso.js), хват-зона (для «взять переставить»,
        // input.js) остаётся там, где её реально поставили, и картинка
        // должна остаться там же, а не телепортироваться к окну.
        const isCurtain = iid === 'curtain' && (zid === 'WIN_ROD' || zid === 'WIN_FRAME');
        const fitPts = isCurtain ? this.curtainPoly() : pts;
        const fitC = isCurtain ? I.centroid(fitPts) : c;
        const xs = fitPts.map(p => p[0]), ys = fitPts.map(p => p[1]);
        const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
        const scale = Math.min(bw / src.width, bh / src.height) * (isCurtain ? 1 : 0.96);
        entry.img.setTexture(key).setVisible(true).setScale(scale)
          .setPosition(fitC[0], fitC[1]).setDepth(I.depth(this.zmap, zid));
        // Разворот при переезде окна/шторы на примыкающий передний край
        // (win.side==='frontRight', см. dragOpening в shell.js) — то же
        // зеркало, что и у floor-мебели при перестановке, картинка одна на
        // обе стороны.
        entry.img.setFlipX(isCurtain && this.st.win.side === 'frontRight');
      } else {
        if (entry.img) entry.img.setVisible(false);
        const ins = pts.map(p => [c[0] + (p[0] - c[0]) * 0.78, c[1] + (p[1] - c[1]) * 0.78]);
        poly(ins, COL.chalk, 0.16, COL.chalk, 1.2);
      }
      return this.showLabels ? this.setLabel(text, c[0], c[1] + 3, it.ru) : this.hideLabel(text);
    },

    // Floor-мебель — свободная расстановка: позиция и ориентация прямо из
    // st.floor[iid] + I.floorOrient (та же эвристика, что у призрака в руке,
    // см. drawGhost в ui/hud.js), никакой зоны тут больше нет.
    //
    // Два взаимоисключающих способа нарисовать сам предмет — процедурный
    // силуэт (itemShapes.js, ITEM_SHAPES) или вырезанная из
    // Documentation/References/furniture.png картинка (room/furnitureSprites.js,
    // FURN_SPRITES) — переключаются тумблером «Мебель: спрайты» в настройках
    // (this.furnitureSprites, drawSettings/onDown). Глубина в обоих случаях —
    // I.floorDepth(pos) = pos.x+pos.y, ТА ЖЕ шкала, что и у кота
    // (cat.x+cat.y, см. catAppearance.updateCatVisual) — поэтому свойство
    // «мебель перекрывает кота, если он проходит за ней» не завязано на
    // способ отрисовки и не нуждается в отдельной поддержке для спрайтов:
    // Phaser сортирует оба GameObject'а (Graphics и Image) по единому depth.
    drawFloorItemInto(g, text, iid, pos) {
      const it = D.ITEMS[iid];
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
      const cx = pos.x, cy = pos.y;
      const [w, d] = I.floorOrient(it, cx, cy), h = it.s[2];
      const entry = this.itemGfx.get(iid);
      const state = this.furnitureSprites && FS && FS.pickState(iid, pos.state);
      if (state) {
        const key = FS.textureKey(iid, state);
        if (!entry.img) entry.img = this.add.image(0, 0, key).setOrigin(0.5, 1);
        const src = this.textures.get(key).getSourceImage();
        // Габарит силуэта в экранных пикселях — не «квадрат w×h», а точный
        // размер тени, которую в ЭТОЙ изометрии (P(x,y,z)=[OX+(x-y)*TW,
        // OY+(x+y)*TH-z*ZH]) отбрасывает бокс w×d×h: по ширине это диагональ
        // (w+d)*TW (ширина/глубина одинаково растягивают экранный X), по
        // высоте — и рост от d/w*TH (та же диагональ, но по вертикали), И
        // высота h*ZH. Раньше вместо (w+d)*TH+h*ZH бралось только h*ZH — для
        // низких широких предметов (диван) почти не отличалось, а для узких
        // высоких (стеллаж — фасад втрое уже шкафа при похожей высоте)
        // разница огромная: ширина по факту доминировала над высотой,
        // масштаб задирался по ширине и раздувал картинку по высоте вместе с
        // ней (тянем и w, и h ОДНИМ scale, чтобы не исказить перспективу
        // самого рисунка). min() — картинка вписывается в габарит, не
        // растягивается ни по одной оси сверх него.
        const targetW = (w + d) * I.PROJ.TW;
        const targetH = (w + d) * I.PROJ.TH + h * I.PROJ.ZH;
        const scale = Math.min(targetW / src.width, targetH / src.height);
        // Точка опоры — не геометрический центр footprint'а (cx,cy), а
        // середина его ПЕРЕДНЕГО (обращённого в комнату) края: референсная
        // картинка снята с фасада — низ кадра это перед предмета, не его
        // центр. front/back определяет та же связка, что и в itemShapes.js
        // (frame()/pt()): rot решает, какая мировая ось сейчас «глубина»
        // (depFull), а фасад сдвинут от центра на depFull/2 в сторону от
        // ближайшей стены (та же завязка на cx<=cy, что у I.floorOrient —
        // предмет у ЛЕВОЙ стены (cx<=cy) развёрнут длинной стороной вдоль
        // неё, и тогда «глубина» (расстояние от стены до фасада) — это w). Без
        // этого сдвига предмет у стены рисуется наполовину «в стене»: пол
        // видимого силуэта против собственного footprint'а уходит назад, за
        // заднюю грань, вместо того чтобы остаться перед ней.
        const rot = cx <= cy, depFull = rot ? w : d;
        const front = rot ? [cx + depFull / 2, cy] : [cx, cy + depFull / 2];
        const anchor = I.P(front[0], front[1], 0);
        entry.img.setTexture(key).setVisible(true).setScale(scale)
          .setPosition(anchor[0], anchor[1]).setDepth(floorRenderDepth(it, pos));
        // Разворот при перестановке: раз картинка не может повернуться на
        // 90°, как процедурный силуэт (см. frame()/orientation() в
        // itemShapes.js), отражаем её по той же стороне, что решает
        // ориентацию силуэта (I.floorOrient/floorSnap: cx<=cy — ближе к левой
        // стене, иначе — к дальней) — та же логика, просто зеркало вместо
        // поворота.
        entry.img.setFlipX(!rot);
      } else if (entry.img) {
        entry.img.setVisible(false);
      }
      if (!state) {
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
      }
      // Торшер включён/выключен тапом по подставке (input.js) — тёплая точка
      // у абажура, поверх силуэта ИЛИ поверх спрайта одинаково (g рисуется с
      // depth чуть выше, см. rebuildItemGfx) — та же условность, что и у
      // потолочного светильника (drawCeilInto).
      if (iid === 'lamp') {
        const tip = I.P(cx, cy, h * 0.92);
        g.fillStyle(this.lampOn ? COL.amber : COL.chalk, this.lampOn ? 0.8 : 0.25);
        g.fillCircle(tip[0], tip[1], 3.5);
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
      // Выключен выключателем у двери (this.lightsOn) — тусклый, без
      // собственного свечения (см. room/lighting.js: collectLights его в
      // этом случае просто пропускает).
      const col = this.lightsOn ? COL.amber : COL.chalk;
      const fillA = this.lightsOn ? 0.3 : 0.12, lineA = this.lightsOn ? 1 : 0.4;
      // шнур обязателен: без него высота подвеса не читается
      g.lineStyle(1.2, col, lineA); g.lineBetween(t[0], t[1], b[0], b[1]);
      g.fillStyle(col, fillA); g.fillCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
      g.lineStyle(1.2, col, lineA); g.strokeCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
      return this.showLabels ? this.setLabel(text, b[0], b[1] + 28, D.ITEMS[iid].ru) : this.hideLabel(text);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
