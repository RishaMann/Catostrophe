/* ============================================================================
   room/itemsRender.js — предметы: подсветка пустых легальных зон при драге,
   пул Graphics/Text по занятой зоне, отрисовка мебели и потолочного подвеса.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { WALL, DOOR_W } = I;
  const { COL, FONT, TEXT_DEPTH, CEIL_DEPTH, SHADOW_DEPTH, SHELL_DEPTH } = root.RCFG;
  const FS = root.FURN_SPRITES;

  // Какие floor-предметы уже переведены на room/assetGeometry.js (авто по
  // альфа-контенту + ручная правка через AssetGeometryEditor) — техническое
  // ограничение ЭТАПА внедрения (см. переписку с продюсером/аудитором), не
  // самого модуля: AssetGeometry сам по себе общий (entityId+state, никакого
  // «if box» внутри него), просто пока подключён не ко всем 14 предметам —
  // остальные держатся на прежней формуле (масштаб по src.width/height), пока
  // не появится причина (кривые PNG у конкретного предмета) её тоже завести
  // сюда. Список общий с ui/hud.js (drawGhost) — см. AssetGeometry.
  // FURNITURE_ITEMS: предмет в руке и предмет на полу обязаны совпадать по
  // геометрии, иначе в момент захвата картинка «съезжает» от жёлтой точки.
  const ASSET_GEOMETRY_ITEMS = root.AssetGeometry.FURNITURE_ITEMS;

  // Напольные покрытия (сейчас — ковёр, it.floorCovering в data.js) лежат НА
  // полу, а не «среди» мебели: обычный I.floorDepth(pos) по центру их
  // большого footprint'а иначе то и дело перекрывал бы стоящую на них мебель
  // (порядок по x+y у центра ковра ничего не говорит о том, что физически
  // ближе к камере — сам ковёр всегда должен быть ПОД любым другим
  // предметом). Раньше это решалось по высоте (s[2] < 0.2) — тот же порог,
  // что у навигационных «solid»-препятствий в iso.js, — но под него попадали
  // и обычные низкие предметы (миски, весы, пылесос), которые никакого
  // отношения к «лежит на полу вместо мебели» не имеют и должны
  // сортироваться как всегда; явный флаг точнее и не завязан на числовой
  // порог, придуманный для другой задачи (навигация). underCovering —
  // симметричный флаг на будущее (предмет ПОД ковром по сюжету) — ещё ниже.
  // +pos*1e-4 — не для сортировки относительно мебели (она и так всегда
  // «выше»), а только чтобы несколько покрытий, если их станет больше
  // одного и они пересекутся, сортировались стабильно между собой.
  function floorRenderDepth(it, pos) {
    if (it && it.underCovering) return SHADOW_DEPTH - 0.05 + (pos.x + pos.y) * 0.0001;
    if (it && it.floorCovering) return SHADOW_DEPTH + 0.05 + (pos.x + pos.y) * 0.0001;
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
      this.updateWindowSprite();
      this.updateDoorSprite();
    },

    // Голое окно (Furniture/window/new.png) — не предмет каталога, нельзя
    // взять или переставить, оно часть комнаты и всегда «на месте окна»;
    // видно только пока туда не повесили штору (curtainZid, room/shell.js) —
    // как только штора появилась, её собственный спрайт уже показывает окно
    // (см. curtain/new.png — она снята вместе с ним), рисовать голое окно
    // под ней незачем и оно бы всё равно не было видно (штора непрозрачна).
    updateWindowSprite() {
      const show = this.furnitureSprites && FS && FS.has('window') && !this.curtainZid();
      if (!show) { if (this.windowImg) this.windowImg.setVisible(false); return; }
      const state = FS.pickState('window', 'new');
      const key = FS.textureKey('window', state);
      if (!this.windowImg) this.windowImg = this.add.image(0, 0, key).setOrigin(0.5, 0.5);
      const src = this.textures.get(key).getSourceImage();
      const pts = this.curtainPoly(), c = I.centroid(pts);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      const AG = root.AssetGeometry;
      const auto = AG.autoFurniture(key, src);
      const override = AG.effectiveOverride('furn:window', state);
      const geo = AG.resolve(auto, override);
      const contentW = geo.contentW || src.width, contentH = geo.contentH || src.height;
      const scale = Math.min(bw / contentW, bh / contentH) * geo.scaleMul;
      this.windowImg.setOrigin(geo.originX, geo.originY);
      this.windowImg.setTexture(key).setVisible(true).setScale(scale)
        .setPosition(c[0] + geo.offsetX, c[1] + geo.offsetY).setDepth(SHELL_DEPTH + 0.1 + geo.sortBias)
        .setFlipX(this.st.win.side === 'frontRight');
    },

    // Дверь (Furniture/door/{left,frontLeft}.png) — как окно, часть комнаты,
    // не предмет каталога (нельзя взять/переставить). Два кроя картинки —
    // не смена состояния одного и того же вида, а РАЗНЫЕ фасады: дверь на
    // левой стене (side==='left', плоскость x=0) и та же дверь, уехавшая за
    // угол на открытый передний край (side==='frontLeft', плоскость y=F, см.
    // dragOpening в room/shell.js) — это разные грани комнаты, зеркалом
    // одну в другую не превратить (та же причина, что у 8-directional
    // спрайтов кота). Ключ манифеста — 'left'/'frontLeft' совпадает с
    // st.door.side один в один, отдельного маппинга не нужно.
    updateDoorSprite() {
      const show = this.furnitureSprites && FS && FS.has('door');
      if (!show) { if (this.doorImg) this.doorImg.setVisible(false); return; }
      const state = FS.pickState('door', this.st.door.side);
      if (!state) { if (this.doorImg) this.doorImg.setVisible(false); return; }
      const key = FS.textureKey('door', state);
      if (!this.doorImg) this.doorImg = this.add.image(0, 0, key).setOrigin(0.5, 1);
      const src = this.textures.get(key).getSourceImage();
      const F = I.PROJ.F, d0 = this.st.door.pos, d1 = d0 + DOOR_W, mid = (d0 + d1) / 2;
      // Опора — низ проёма (порог/пол), не центр decor-квада doorPoly(): у
      // двери коврик лежит на полу, как и у floor-мебели, а не «висит»
      // посередине высоты проёма.
      const floorPt = this.st.door.side === 'left' ? I.P(0, mid, 0) : I.P(mid, F, 0);
      const pts = this.doorPoly();
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      const AG = root.AssetGeometry;
      const auto = AG.autoFurniture(key, src);
      const override = AG.effectiveOverride('furn:door', state);
      const geo = AG.resolve(auto, override);
      const contentW = geo.contentW || src.width, contentH = geo.contentH || src.height;
      const scale = Math.min(bw / contentW, bh / contentH) * geo.scaleMul;
      this.doorImg.setOrigin(geo.originX, geo.originY);
      this.doorImg.setTexture(key).setVisible(true).setScale(scale)
        .setPosition(floorPt[0] + geo.offsetX, floorPt[1] + geo.offsetY)
        .setDepth(SHELL_DEPTH + 0.1 + geo.sortBias);
    },

    // Точка захвата — маленький кружок с крестиком, куда именно тыкать,
    // чтобы взять предмет в руку и переставить (см. вызовы в
    // drawFloorItemInto/drawWallItemInto/drawCeilInto). Нужна в первую
    // очередь спрайтам: у вырезанной картинки неровный силуэт по альфе, и
    // без явной точки непонятно, где именно её реальный (прямоугольный)
    // hit-box — см. rejectFloor/floorPoly в iso.js, они ничего общего с
    // силуэтом картинки не имеют. Рисуется только пока открыт инвентарь —
    // это подсказка для перестановки, не постоянная деталь сцены.
    drawGrabPoint(g, x, y) {
      g.fillStyle(COL.amber, 0.85); g.fillCircle(x, y, 5);
      g.lineStyle(1.3, COL.amber, 1); g.strokeCircle(x, y, 5);
      g.lineStyle(1.3, COL.chalk, 0.9);
      g.lineBetween(x - 2.2, y, x + 2.2, y);
      g.lineBetween(x, y - 2.2, x, y + 2.2);
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
    // Точка на полу у подножия стены, вдоль которой висит настенный
    // предмет (та же along-wall координата z.r, только z=0 вместо
    // диапазона высот) — используется и для «упавшего» портрета
    // (drawWallItemInto), и для его же хит-теста в input.js: одна формула,
    // чтобы место тапа и место рисунка не разошлись.
    wallFloorAnchor(zid) {
      const z = this.zmap[zid], F = I.PROJ.F;
      const mid = (z.r[0] + z.r[2]) / 2;
      if (z.wall === 'right') return I.P(mid, 0, 0);
      if (z.wall === 'frontRight') return I.P(F, mid, 0);
      return I.P(0, mid, 0); // 'left' — тоже дефолт для LF_*/OVERDOOR (band:'back', wall не задан)
    },

    drawWallItemInto(g, text, zid, iid) {
      const z = this.zmap[zid], it = D.ITEMS[iid], F = I.PROJ.F;
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
      const pts = I.zonePoly(z, F), c = I.centroid(pts);
      const entry = this.itemGfx.get(zid);
      const wanted = (this.st.placeState || {})[zid];
      const state = this.furnitureSprites && FS && FS.pickState(iid, wanted);
      // Портрет тапом «падает» вдоль стены до пола и остаётся наискось (см.
      // input.js) — это НЕ смена картинки (в манифесте одна-единственная
      // 'new', pickState тихо откатится на неё и для 'fallen'), а смена
      // ТРАНСФОРМА поверх той же текстуры: другая точка (пол у стены, не
      // середина decor-зоны), другой origin (низ рамки, а не альфа-anchor)
      // и поворот. Мгновенно, без анимации падения — тот же уровень
      // проработки, что у гэга коробки/шторы (тоже мгновенный toggle).
      const fallen = iid === 'portrait' && wanted === 'fallen';
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
        // room/assetGeometry.js — тот же честный anchor/scale по альфа-
        // контенту картинки, что у floor-мебели (drawFloorItemInto) и
        // призрака (ui/hud.js drawGhost), не «квадратный fit по всему PNG»:
        // у стеновых предметов ровно та же уязвимость при нескольких
        // состояниях (штора open/closed — разный кроп, разный паддинг).
        const AG = root.AssetGeometry;
        const auto = AG.autoFurniture(key, src);
        const override = AG.effectiveOverride('furn:' + iid, state);
        const geo = AG.resolve(auto, override);
        const contentW = geo.contentW || src.width, contentH = geo.contentH || src.height;
        const baseScale = Math.min(bw / contentW, bh / contentH) * (isCurtain ? 1 : 0.96);
        if (fallen) {
          const fp = this.wallFloorAnchor(zid);
          // Лежит на полу — глубина должна сравниваться с реальной floor-
          // мебелью (I.floorDepth = x+y мировых координат), а не с
          // «глубиной» стенной decor-зоны (та вообще не про позицию: у
          // wall-band r[1]/r[3] — диапазон ВЫСОТЫ на стене, не y на полу, и
          // могла случайно давать то похожую, то совсем чужую шкалу).
          const mid = (z.r[0] + z.r[2]) / 2;
          const fallDepth = z.wall === 'right' ? mid : z.wall === 'frontRight' ? F + mid : mid;
          entry.img.setOrigin(0.5, 1);
          entry.img.setTexture(key).setVisible(true)
            .setScale(baseScale * geo.scaleMul)
            .setPosition(fp[0], fp[1])
            .setAngle(z.wall === 'right' ? -65 : 65)
            .setDepth(fallDepth + 0.001)
            .setFlipX(false);
        } else {
          entry.img.setAngle(0);
          entry.img.setOrigin(geo.originX, geo.originY);
          entry.img.setTexture(key).setVisible(true).setScale(baseScale * geo.scaleMul)
            .setPosition(fitC[0] + geo.offsetX, fitC[1] + geo.offsetY)
            .setDepth(I.depth(this.zmap, zid) + geo.sortBias)
            // Разворот при переезде окна/шторы на примыкающий передний край
            // (win.side==='frontRight', см. dragOpening в shell.js) — то же
            // зеркало, что и у floor-мебели при перестановке, картинка одна
            // на обе стороны.
            .setFlipX(isCurtain && this.st.win.side === 'frontRight');
        }
      } else if (!this.furnitureSprites || this.mode === 'inventory') {
        if (entry.img) entry.img.setVisible(false);
        const ins = pts.map(p => [c[0] + (p[0] - c[0]) * 0.78, c[1] + (p[1] - c[1]) * 0.78]);
        poly(ins, COL.chalk, 0.16, COL.chalk, 1.2);
      } else if (entry.img) {
        entry.img.setVisible(false);
      }
      // Точка захвата — только пока открыт инвентарь (см. drawGrabPoint):
      // в спрайтовом режиме вне инвентаря вся разметка, включая её, скрыта —
      // это подсказка для перестановки, не часть отделанной комнаты. У
      // упавшего портрета — на полу у стены, там же, где хват для
      // «переставить», а не в decor-зоне на стене (там уже ничего нет).
      const grabAt = fallen ? this.wallFloorAnchor(zid) : [c[0], c[1]];
      if (this.mode === 'inventory') this.drawGrabPoint(g, grabAt[0], grabAt[1]);
      return this.showLabels ? this.setLabel(text, grabAt[0], grabAt[1] + 3, it.ru) : this.hideLabel(text);
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
        // заднюю грань, вместо того чтобы остаться перед ней. Это ЛОГИЧЕСКАЯ
        // точка (из footprint'а, данные), не зависит от картинки — общая для
        // обеих веток ниже.
        const rot = cx <= cy, depFull = rot ? w : d;
        const front = rot ? [cx + depFull / 2, cy] : [cx, cy + depFull / 2];
        // Предметы на AssetGeometry (сейчас — box) якорятся на ЦЕНТР
        // footprint'а (cx,cy), не на «передний край»: itemShapes.js рисует
        // процедурный силуэт как раз вокруг центра (см. box() там же —
        // faceBlock от cx±w/2, cy±d/2), и без этого коробка в спрайтовом
        // режиме и коробка из линий стояли на разных мировых точках —
        // предмет визуально «съезжал» при переключении режима отрисовки,
        // хотя логическая позиция (st.floor.box) не менялась вовсе.
        // «Передний край» остаётся дефолтом для остальных предметов —
        // референсные фото сняты с фасада (см. комментарий выше), там
        // смещение осознанное, не баг.
        const anchorPoint = ASSET_GEOMETRY_ITEMS.has(iid) ? [cx, cy] : front;
        const anchor = I.P(anchorPoint[0], anchorPoint[1], 0);
        if (ASSET_GEOMETRY_ITEMS.has(iid)) {
          // room/assetGeometry.js: масштаб — по альфа-контенту картинки, не
          // по полному canvas (padding между состояниями одного предмета не
          // обязан совпадать, см. аудит: box/new.png 169×175 vs
          // box/afterGag.png 217×186 — разные пропорции), origin — тоже по
          // альфа-контенту (низ силуэта), если нет ручной правки. Логическая
          // anchor-точка (anchorPoint, выше) не меняется НИКОГДА — геометрия
          // влияет только на то, куда на спрайте она попадёт, и на мелкий offset.
          const AG = root.AssetGeometry;
          const auto = AG.autoFurniture(key, src);
          const override = AG.effectiveOverride('furn:' + iid, state);
          const geo = AG.resolve(auto, override);
          const contentW = geo.contentW || src.width, contentH = geo.contentH || src.height;
          const targetW = (w + d) * I.PROJ.TW, targetH = (w + d) * I.PROJ.TH + h * I.PROJ.ZH;
          // scaleMul — ручная поправка размера (тянуть за угол в
          // AssetGeometryEditor) поверх автоматического fit-масштаба, не
          // вместо него.
          const scale = Math.min(targetW / contentW, targetH / contentH) * geo.scaleMul;
          entry.img.setOrigin(geo.originX, geo.originY);
          entry.img.setTexture(key).setVisible(true).setScale(scale)
            .setPosition(anchor[0] + geo.offsetX, anchor[1] + geo.offsetY)
            .setDepth(floorRenderDepth(it, pos) + geo.sortBias);
        } else {
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
          entry.img.setOrigin(0.5, 1);
          entry.img.setTexture(key).setVisible(true).setScale(scale)
            .setPosition(anchor[0], anchor[1]).setDepth(floorRenderDepth(it, pos));
        }
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
      // Процедурный силуэт — только пока нет спрайта ИЛИ пока открыт
      // инвентарь: в спрайтовом режиме вне инвентаря комната должна
      // выглядеть отделанной, а не наполовину blockout'ом из линий поверх
      // картинок (см. showLines в room/shell.js — тот же принцип). У
      // предметов без спрайта совсем это единственная видимая форма — она
      // просто скрывается вместе с остальной разметкой, когда инвентарь
      // закрыт (тот же trade-off, что и у стенных предметов без картинки).
      if (!state && (!this.furnitureSprites || this.mode === 'inventory')) {
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
      // потолочного светильника (drawCeilInto). Настоящий прибор, не
      // разметка — виден в любом режиме, как выключатель у двери.
      if (iid === 'lamp') {
        const tip = I.P(cx, cy, h * 0.92);
        g.fillStyle(this.lampOn ? COL.amber : COL.chalk, this.lampOn ? 0.8 : 0.25);
        g.fillCircle(tip[0], tip[1], 3.5);
      }
      // Точка захвата — см. drawWallItemInto/drawGrabPoint; на переднем
      // (обращённом в комнату) крае footprint'а, том же, что и опора
      // спрайта, — не в геометрическом центре, чтобы не тонуть внутри
      // высокой мебели на экране.
      if (this.mode === 'inventory') {
        const rot = cx <= cy, depFull = rot ? w : d;
        const front = rot ? [cx + depFull / 2, cy] : [cx, cy + depFull / 2];
        const gp = I.P(front[0], front[1], h * 0.5);
        this.drawGrabPoint(g, gp[0], gp[1]);
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
      const entry = this.itemGfx.get('CEIL');
      const state = this.furnitureSprites && FS && FS.pickState(iid, null);
      if (state) {
        // Картинка (сейчас — только «люстра», см. Furniture/manifest.json)
        // вместо процедурного шнур+кружок. Нет формального footprint'а —
        // потолочный предмет не стоит на полу, (w+d)*TW тут взять неоткуда
        // — целевой габарит фиксированный, подогнать под конкретную
        // картинку — дело geo.scaleMul (ручная правка в
        // AssetGeometryEditor), не автоматики. Origin по умолчанию (0.5,1,
        // низ силуэта) для висящего сверху предмета неверен — сюда почти
        // всегда нужна ручная правка anchor (крепление — ВЕРХ картинки, не
        // низ), это ожидаемо, не баг пайплайна.
        const key = FS.textureKey(iid, state);
        if (!entry.img) entry.img = this.add.image(0, 0, key).setOrigin(0.5, 0);
        const src = this.textures.get(key).getSourceImage();
        const AG = root.AssetGeometry;
        const auto = AG.autoFurniture(key, src);
        const override = AG.effectiveOverride('furn:' + iid, state);
        const geo = AG.resolve(auto, override);
        const contentW = geo.contentW || src.width, contentH = geo.contentH || src.height;
        const targetW = 1.7 * I.PROJ.TW, targetH = 1.7 * I.PROJ.TW;
        const scale = Math.min(targetW / contentW, targetH / contentH) * geo.scaleMul;
        entry.img.setOrigin(geo.originX, geo.originY);
        entry.img.setTexture(key).setVisible(true).setScale(scale)
          .setPosition(t[0] + geo.offsetX, t[1] + geo.offsetY)
          // Тонировка вместо отдельного «выключенного» силуэта — свечение
          // всё равно рисует room/lighting.js отдельным слоем (GLOW_DEPTH),
          // тут нужно только показать «прибор потушен», как раньше делал
          // тусклый col у процедурного кружка.
          .setTint(this.lightsOn ? 0xffffff : 0xAFA89C).setAlpha(this.lightsOn ? 1 : 0.8)
          .setDepth(CEIL_DEPTH + 0.001 + geo.sortBias);
      } else {
        if (entry.img) entry.img.setVisible(false);
        // шнур обязателен: без него высота подвеса не читается
        g.lineStyle(1.2, col, lineA); g.lineBetween(t[0], t[1], b[0], b[1]);
        g.fillStyle(col, fillA); g.fillCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
        g.lineStyle(1.2, col, lineA); g.strokeCircle(b[0], b[1] + 5, iid === 'chandelier' ? 10 : 5);
      }
      if (this.mode === 'inventory') {
        this.drawGrabPoint(g, b[0], b[1] + 5);
        // «Крепление» (зона перетаскивания точки подвеса, lightPoly/
        // dragOpening в room/shell.js) — раньше рисовалась в drawShell() на
        // gShell (SHELL_DEPTH = -1), т.е. ПОД любой мебелью на полу (depth
        // 0..~12): у задней стены с высокой мебелью зона пряталась под ней.
        // Тут, на графике самого потолочного предмета (CEIL_DEPTH = 900),
        // она гарантированно поверх всего — потолок и должен быть выше
        // всего в комнате, как и сам светильник чуть выше.
        this.polyOn(g, this.lightPoly(), COL.amber, 0.10, COL.amber, 1);
      }
      return this.showLabels ? this.setLabel(text, b[0], b[1] + 28, D.ITEMS[iid].ru) : this.hideLabel(text);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
