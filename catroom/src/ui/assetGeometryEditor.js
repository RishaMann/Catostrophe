/* ============================================================================
   ui/assetGeometryEditor.js — «Отладка предметов» (Настройки → assetDebug):
   технический слой ручной коррекции геометрии поверх room/assetGeometry.js.
   Автоматика (альфа-анализ) — первое приближение, не всегда надёжна для
   генеративного арта; этот файл даёт руками подвинуть anchor/sortAnchor
   прямо поверх реального ассета и сохранить правку как metadata (localStorage,
   см. assetGeometry.js), не как правку игрового кода.

   Пайплайн: auto (assetGeometry.js) → live-правка тут (перетаскивание,
   AssetGeometry.setLive) → Save коммитит live в постоянный override
   (AssetGeometry.setOverride) → рендер (catAppearance.js/itemsRender.js)
   всегда читает effectiveOverride() = override + live поверх auto.

   Масштаб этого этапа — только кот и коробка (см. geoTargets): сам механизм
   ниже общий (entityId/state строками, никакого «if box» в самой логике
   выбора/перетаскивания/сохранения) — расширить на другой предмет означает
   дописать его в geoTargets()/geoLogicalWorldPoint()/geoFootprintPoly(), не
   переписывать этот файл.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { COL } = root.RCFG;
  const { clamp, catFrameNames } = root.GUTIL;

  root.MIXIN_ASSET_GEO_EDITOR = {

    // Что вообще можно выбрать для редактирования прямо сейчас — кот (пока в
    // комнате) и коробка (если она поставлена). Список пуст, если предмета
    // сейчас нет в сцене — тогда его просто нечего показывать/тапать.
    geoTargets() {
      const out = [];
      if (this.cat && this.catOn) {
        out.push({ kind: 'cat', entityId: 'cat:' + this.catCharacter, iid: null, screen: I.P(this.cat.x, this.cat.y) });
      }
      if (this.st.floor.box) {
        const pos = this.st.floor.box;
        out.push({ kind: 'furniture', entityId: 'furn:box', iid: 'box', screen: I.P(pos.x, pos.y) });
      }
      return out;
    },

    // state/frame, который сейчас реально отрисован — ключ в assetGeometry.
    // geoCatFrameOverride (переключатель кадров, см. geoCycleCatFrame) —
    // насильно выбранный кадр побеждает над тем, что реально играет
    // поведение (catAppearance.js делает ту же подмену для рендера, см. его
    // updateCatVisual) — иначе после переключения кадра тут читалось бы
    // старое значение _lastCatFrame ещё один кадр, до следующего updateCatVisual.
    geoCurrentState(t) {
      if (t.kind === 'cat') return this.geoCatFrameOverride || this._lastCatFrame || this.activeCatConfig().sprites.idle;
      const pos = this.st.floor[t.iid];
      const FS = root.FURN_SPRITES;
      return (this.furnitureSprites && FS && FS.pickState(t.iid, pos.state)) || pos.state || 'new';
    },

    // Живой Phaser Image текущего ассета — источник фактических visual bounds
    // (getBounds()), не пересчитываем их тут заново.
    geoImageObject(t) {
      if (t.kind === 'cat') return this.catImg;
      const entry = this.itemGfx.get(t.iid);
      return (entry && entry.img) || null;
    },

    // Логическая мировая точка (НЕ visual anchor) — та, что реально
    // используется движком для позиционирования/depth и НИКОГДА не должна
    // сдвигаться от правок в этом редакторе. У кота это cat.x/cat.y. У
    // мебели — та же точка, что и в drawFloorItemInto (room/itemsRender.js):
    // центр footprint'а (cx,cy) для предметов на AssetGeometry (сейчас —
    // box, совпадает с тем, где itemShapes.js рисует процедурный силуэт), у
    // остальных — середина переднего края (референсные фото сняты с
    // фасада). Сознательно не вынесена в общую функцию с itemsRender.js: это
    // чисто рендер-геометрия, не логика игры/пола (та остаётся в iso.js).
    geoLogicalWorldPoint(t) {
      if (t.kind === 'cat') return I.P(this.cat.x, this.cat.y);
      const pos = this.st.floor[t.iid], it = D.ITEMS[t.iid];
      if (root.AssetGeometry.FURNITURE_ITEMS.has(t.iid)) return I.P(pos.x, pos.y, 0);
      const [w, d] = I.floorOrient(it, pos.x, pos.y);
      const rot = pos.x <= pos.y, depFull = rot ? w : d;
      const front = rot ? [pos.x + depFull / 2, pos.y] : [pos.x, pos.y + depFull / 2];
      return I.P(front[0], front[1], 0);
    },

    // Контур footprint'а (логика, не картинка) — только у мебели, у кота
    // отдельного footprint'а как у предмета нет (см. технический аудит).
    geoFootprintPoly(t) {
      if (t.kind === 'cat') return null;
      const pos = this.st.floor[t.iid], it = D.ITEMS[t.iid];
      return I.floorPoly(I.floorRect(it, pos.x, pos.y));
    },

    selectGeoTarget(t) {
      this.geoSelected = { kind: t.kind, entityId: t.entityId, iid: t.iid };
      root.AssetGeometry.clearLive();
      this.geoDragTarget = null;
      this.geoCatFrameOverride = null;
      this.uiDirty = true;
    },

    // Все имена кадров текущего кота (см. game.js — тот же catFrameNames,
    // которым каскадно грузятся PNG) — источник для переключателя кадров
    // (geoCycleCatFrame), симметрично geoAvailableStates() у мебели.
    geoAvailableCatFrames() {
      return catFrameNames(this.activeCatConfig());
    },
    geoCycleCatFrame() {
      const frames = this.geoAvailableCatFrames();
      if (frames.length < 2) return;
      const cur = this.geoCurrentState(this.geoSelected);
      const idx = frames.indexOf(cur);
      this.geoCatFrameOverride = frames[(idx + 1) % frames.length];
      root.AssetGeometry.clearLive();
      this.geoDragTarget = null;
      this.uiDirty = true;
    },
    // Общий список ключей state/кадров текущего target'а — нужен и для
    // «Изменить все» (geoSaveCurrent ниже), и для решения, показывать ли
    // вообще переключатель/чекбокс (нечего переключать/распространять на
    // предмете с одним-единственным кадром).
    geoAllStateKeys(sel) {
      if (!sel) return [];
      return sel.kind === 'cat' ? this.geoAvailableCatFrames() : this.geoAvailableStates(sel);
    },

    // Экранные координаты draggable-хэндлов текущего выбранного ассета —
    // одна функция для отрисовки И для хит-теста (см. onDown, input.js),
    // чтобы кружок на экране и область тапа никогда не разошлись. scale —
    // за угол visual bounds (см. geoUpdateDrag): тянешь дальше от anchor —
    // крупнее, ближе — мельче, пропорции те же (один множитель на оба
    // измерения, картинку не перекашивает).
    geoHandles() {
      const sel = this.geoSelected;
      if (!sel) return [];
      const img = this.geoImageObject(sel);
      if (!img || !img.visible) return [];
      const b = img.getBounds();
      return [
        { kind: 'anchor', x: img.x, y: img.y },
        { kind: 'sort', x: img.x + 28, y: img.y - 28 },
        { kind: 'scale', x: b.x + b.width, y: b.y }
      ];
    },

    geoHitHandle(x, y) {
      for (const h of this.geoHandles()) if (Math.hypot(x - h.x, y - h.y) < 11) return h.kind;
      return null;
    },

    geoStartDrag(kind) {
      const sel = this.geoSelected;
      const img = this.geoImageObject(sel);
      this.geoDragTarget = kind;
      this.geoDragBounds = img ? img.getBounds() : null;
      this.geoDragImgPos = img ? { x: img.x, y: img.y } : null;
      if (kind === 'scale' && img && this.geoDragBounds) {
        const state = this.geoCurrentState(sel);
        const eff = root.AssetGeometry.effectiveOverride(sel.entityId, state);
        this.geoScaleStartMul = (eff && typeof eff.scaleMul === 'number') ? eff.scaleMul : 1;
        const corner = { x: this.geoDragBounds.x + this.geoDragBounds.width, y: this.geoDragBounds.y };
        this.geoScaleStartDist = Math.max(4, Math.hypot(corner.x - img.x, corner.y - img.y));
      }
    },

    // Тащим anchor — пересчитываем origin-долю относительно bounding box'а,
    // ЗАФИКСИРОВАННОГО в момент начала перетаскивания (geoDragBounds): и
    // мировая точка (front/cat.x,y), и footprint при этом не меняются вообще
    // — двигается только то, КУДА на спрайте эта точка попадает.
    // Тащим sortAnchor — не свободная 2D-точка (глубина в этой игре всегда
    // скаляр, x+y, см. iso.js floorDepth), а маленькая ручная поправка
    // (sortBias) поверх него: вертикальное перетаскивание от исходной
    // позиции хэндла задаёт знак/величину, тот же приём, что уже решает
    // похожие конфликты по месту (+0.001 в itemsRender.js), просто явно и
    // настраиваемо, а не захардкожено на конкретную пару предметов.
    geoUpdateDrag(x, y) {
      if (!this.geoDragTarget || !this.geoSelected) return;
      const sel = this.geoSelected, state = this.geoCurrentState(sel);
      if (this.geoDragTarget === 'anchor' && this.geoDragBounds) {
        const b = this.geoDragBounds;
        const ox = clamp((x - b.x) / Math.max(1, b.width), -0.5, 1.5);
        const oy = clamp((y - b.y) / Math.max(1, b.height), -0.5, 1.5);
        root.AssetGeometry.setLive(sel.entityId, state, { anchor: { x: ox, y: oy } });
      } else if (this.geoDragTarget === 'sort' && this.geoDragImgPos) {
        const dy = y - this.geoDragImgPos.y;
        root.AssetGeometry.setLive(sel.entityId, state, { sortBias: clamp(-dy / 16, -6, 6) });
      } else if (this.geoDragTarget === 'scale' && this.geoDragImgPos) {
        // Дальше от anchor, чем была стартовая точка хвата, — крупнее;
        // ближе — мельче. Один множитель на оба измерения (не тянет вкось).
        const dist = Math.hypot(x - this.geoDragImgPos.x, y - this.geoDragImgPos.y);
        const mul = clamp((dist / this.geoScaleStartDist) * this.geoScaleStartMul, 0.2, 4);
        root.AssetGeometry.setLive(sel.entityId, state, { scaleMul: mul });
      }
      this.uiDirty = true;
      if (sel.kind === 'furniture') this.rebuildItemGfx();
    },

    geoEndDrag() {
      this.geoDragTarget = null; this.geoDragBounds = null; this.geoDragImgPos = null;
      this.geoScaleStartMul = null; this.geoScaleStartDist = null;
    },

    geoSaveCurrent() {
      const sel = this.geoSelected; if (!sel) return;
      const state = this.geoCurrentState(sel);
      const eff = root.AssetGeometry.effectiveOverride(sel.entityId, state);
      if (!eff) return; // нечего сохранять — кнопка и так серая, но на всякий случай
      // «Изменить все» (geoApplyAll, чекбокс в drawGeoPanel) — та же правка
      // (anchor/offset/scaleMul/sortBias) пишется под ВСЕ кадры/state этого
      // entity, не только под тот, что сейчас на экране: у большинства
      // кадров кота (и обоих состояний коробки) правильная поправка на глаз
      // одна и та же, и без этого пришлось бы вручную повторять один и тот
      // же Drag+Save на каждом кадре по отдельности.
      if (this.geoApplyAll) {
        this.geoAllStateKeys(sel).forEach(key => root.AssetGeometry.setOverride(sel.entityId, key, eff));
      } else {
        root.AssetGeometry.setOverride(sel.entityId, state, eff);
      }
      // Флеш подтверждения на кнопке Save (drawGeoPanel) — виден факт
      // сохранения, не только исчезновение «грязного» состояния.
      this.geoSaveFlashUntil = (this.time ? this.time.now : 0) + 380;
      root.AssetGeometry.clearLive();
      this.uiDirty = true;
    },
    // Reset и «Auto» — одно и то же действие (откатить к автоматическому
    // анализу): отдельной сохранённой «авто-геометрии» не существует, авто
    // всегда пересчитывается на лету (resolveCatGeometry/autoFurniture),
    // поэтому «вернуться к авто» и «стереть ручную правку» — один вызов.
    geoResetCurrent() {
      const sel = this.geoSelected; if (!sel) return;
      // «Изменить все» действует на Reset/Auto точно так же, как на Save
      // (см. geoSaveCurrent) — это одна и та же галочка «на весь предмет
      // разом», а не отдельная настройка только для сохранения.
      if (this.geoApplyAll) {
        this.geoAllStateKeys(sel).forEach(key => root.AssetGeometry.resetOverride(sel.entityId, key));
      } else {
        root.AssetGeometry.resetOverride(sel.entityId, this.geoCurrentState(sel));
      }
      root.AssetGeometry.clearLive();
      this.uiDirty = true;
      if (sel.kind === 'furniture') this.rebuildItemGfx();
    },

    // Переключение между ВСЕМИ картинками-состояниями предмета (не только
    // «new»/«afterGag» по тапу в обычном режиме, см. input.js — тот же
    // st.floor[iid].state, просто перебор по кругу через полный список из
    // Furniture/manifest.json, а не жёстко зашитая пара). Нужно, чтобы можно
    // было поправить геометрию КАЖДОГО состояния отдельно — у них разные
    // силуэты и, следовательно, разный auto-anchor/override.
    geoAvailableStates(t) {
      if (!t || t.kind !== 'furniture') return [];
      const FS = root.FURN_SPRITES;
      const states = FS && FS.states(t.iid);
      return states ? Object.keys(states) : [];
    },
    geoCycleState() {
      const sel = this.geoSelected;
      const keys = this.geoAvailableStates(sel);
      if (keys.length < 2) return;
      const pos = this.st.floor[sel.iid];
      const idx = keys.indexOf(this.geoCurrentState(sel));
      pos.state = keys[(idx + 1) % keys.length];
      root.AssetGeometry.clearLive();
      this.geoDragTarget = null;
      this.rebuildItemGfx();
      this.uiDirty = true;
    },

    drawAssetGeometryOverlay(g) {
      if (!this.assetDebug) { this.geoOnionImgs.forEach(im => im.setVisible(false)); return; }

      const targets = this.geoTargets();
      targets.forEach(t => {
        const on = this.geoSelected && this.geoSelected.entityId === t.entityId;
        g.lineStyle(1.4, on ? COL.amber : COL.chalk, on ? 0.9 : 0.45);
        g.strokeCircle(t.screen[0], t.screen[1], 8);
      });

      if (!this.geoSelected || !targets.some(t => t.entityId === this.geoSelected.entityId)) {
        this.geoOnionImgs.forEach(im => im.setVisible(false));
        this.drawGeoPanel(g, null);
        return;
      }
      const sel = this.geoSelected;
      const img = this.geoImageObject(sel);
      const footprint = this.geoFootprintPoly(sel);
      const worldPt = this.geoLogicalWorldPoint(sel);

      if (footprint) {
        g.lineStyle(1.2, 0x7AD6C4, 0.9);
        g.strokePoints(footprint.map(p => ({ x: p[0], y: p[1] })), true);
      }
      // Логический root — крестик отдельного цвета: пока anchor/offset
      // двигаются, этот крестик должен стоять на месте намертво (в этом и
      // смысл всей системы, см. технический аудит).
      g.lineStyle(1.6, 0x7AD6C4, 1);
      g.lineBetween(worldPt[0] - 9, worldPt[1], worldPt[0] + 9, worldPt[1]);
      g.lineBetween(worldPt[0], worldPt[1] - 9, worldPt[0], worldPt[1] + 9);

      if (img && img.visible) {
        const b = img.getBounds();
        g.lineStyle(1, COL.amber, 0.6);
        g.strokeRect(b.x, b.y, b.width, b.height);
      }
      // scale — квадратный хэндл (в отличие от круглых anchor/sort): другое
      // действие (тянуть за угол), должен читаться визуально иначе.
      this.geoHandles().forEach(h => {
        if (h.kind === 'scale') {
          g.fillStyle(0x8FD16A, 0.92);
          g.fillRect(h.x - 6, h.y - 6, 12, 12);
          g.lineStyle(1.2, COL.chalk, 0.9); g.strokeRect(h.x - 6, h.y - 6, 12, 12);
          return;
        }
        g.fillStyle(h.kind === 'anchor' ? COL.amber : 0xE07BD0, 0.92);
        g.fillCircle(h.x, h.y, 6.5);
        g.lineStyle(1.2, COL.chalk, 0.9); g.strokeCircle(h.x, h.y, 6.5);
        // sortBias — не видимая на глаз геометрия (это скаляр для depth-
        // сортировки, а не координата на спрайте), поэтому пока тащат
        // розовую точку, рядом печатаем текущее число: без этого эффект
        // заметен, только когда предмет реально с кем-то перекрывается на
        // экране, и хэндл выглядит нерабочим.
        if (h.kind === 'sort' && this.geoDragTarget === 'sort') {
          const eff = root.AssetGeometry.effectiveOverride(sel.entityId, this.geoCurrentState(sel));
          const v = eff && typeof eff.sortBias === 'number' ? eff.sortBias : 0;
          this.tUI.put(h.x + 12, h.y - 2, 'sort ' + (v >= 0 ? '+' : '') + v.toFixed(2), 9.5, '#E07BD0', 'left');
        }
      });

      if (sel.kind === 'cat' && this.geoShowFrames) this.drawGeoOnionSkin();
      else this.geoOnionImgs.forEach(im => im.setVisible(false));

      this.drawGeoPanel(g, sel);
    },

    // Онион-скин: все кадры цикла ходьбы поверх текущего, полупрозрачные,
    // каждый со своей (авто или ручной) геометрией — но выровненные по ОДНОЙ
    // мировой точке b. Если геометрия честная, кадры визуально «стоят на
    // одном месте», а не скачут — ровно то, что нужно проверить глазами.
    drawGeoOnionSkin() {
      const sprites = this.activeCatConfig().sprites;
      const frameName = this.geoCatFrameOverride || this._lastCatFrame || sprites.idle;
      const seq = this.catSequenceFor(sprites, frameName);
      const frames = seq ? seq.frames : [frameName];
      const b = I.P(this.cat.x, this.cat.y);
      frames.forEach((fn, i) => {
        const im = this.geoOnionImgs[i];
        if (!im) return;
        const geo = this.resolveCatGeometry(fn);
        im.setTexture(this.catFrameKey(fn)).setOrigin(geo.originX, geo.originY)
          .setScale(this.catImg.scaleX, this.catImg.scaleY)
          .setPosition(b[0] + geo.offsetX, b[1] + geo.offsetY)
          .setAlpha(0.4).setDepth((this.catImg.depth || 0) + 0.01 + i * 0.0001).setVisible(true);
      });
      for (let i = frames.length; i < this.geoOnionImgs.length; i++) this.geoOnionImgs[i].setVisible(false);
    },

    drawGeoPanel(g, sel) {
      // Высота — по факту того, что ниже реально нарисуется: ряд Save/
      // Reset/Auto есть только при выбранном target'е; дальше — по условию —
      // переключатель кадра/state, у кота ещё и «Показать все кадры»,
      // чекбоксы «Движение»/«Изменить все», и в конце короткая легенда
      // (только когда есть хэндлы, которые она объясняет, т.е. есть sel).
      const allKeys0 = this.geoAllStateKeys(sel);
      let rows = 0;
      if (sel && sel.kind === 'cat') { rows += allKeys0.length > 1 ? 1 : 0; rows += 1; /* frames toggle */ }
      else if (allKeys0.length > 1) { rows += 1; /* state cycle */ }
      const hasChkRow = sel && ((sel.kind === 'cat') || allKeys0.length > 1);
      const S = { x: 24, y: 108, w: 300, h: !sel ? 60 : 96 + rows * 38 + (hasChkRow ? 34 : 0) + 64 };
      g.fillStyle(COL.panel, 0.95); g.fillRoundedRect(S.x, S.y, S.w, S.h, 10);
      g.lineStyle(1.1, COL.amber, 0.75); g.strokeRoundedRect(S.x, S.y, S.w, S.h, 10);
      this.tUI.put(S.x + 12, S.y + 16, 'Отладка предметов', 10, '#E8A33D');

      // Крестик — закрыть окно, полностью выключив режим (не просто снять
      // выбор): та же кнопка, что и тумблер в Настройках, для симметрии с
      // остальными панелями (у них тоже «× закрыть» в углу).
      const cs = 22;
      this.geoCloseBtn = { x: S.x + S.w - cs - 8, y: S.y + 7, w: cs, h: cs };
      g.fillStyle(COL.chalk, 0.08); g.fillRoundedRect(this.geoCloseBtn.x, this.geoCloseBtn.y, cs, cs, 6);
      g.lineStyle(1, COL.chalk, 0.32); g.strokeRoundedRect(this.geoCloseBtn.x, this.geoCloseBtn.y, cs, cs, 6);
      this.tUI.put(this.geoCloseBtn.x + cs / 2, this.geoCloseBtn.y + cs / 2, '×', 13, '#E8A33Dcc', 'center');

      if (!sel) {
        this.tUI.put(S.x + 12, S.y + 38, 'Тапните кота или коробку', 9.5, '#EBE2D5aa');
        this.geoBtns = []; this.geoFramesBtn = null; this.geoStateBtn = null;
        this.geoCatFrameBtn = null; this.geoMoveChk = null; this.geoApplyAllChk = null;
        return;
      }
      const state = this.geoCurrentState(sel);
      this.tUI.put(S.x + 12, S.y + 36, sel.entityId, 9.5, '#EBE2D5cc');
      this.tUI.put(S.x + 12, S.y + 52, 'state: ' + state, 9, '#EBE2D588');

      const by = S.y + 66, bw = 84, bh = 30, gap = 8;

      // Save — единственная кнопка с переменным видом: серая и «неактивная»
      // на вид, если сохранять нечего, янтарная (как остальные активные
      // элементы UI), пока есть несохранённая правка (live, см.
      // geoUpdateDrag), и коротко вспыхивает зелёным сразу после нажатия —
      // подтверждение факта записи, отдельно от «есть/нет правок».
      const saveX = S.x + 12;
      const dirty = !!root.AssetGeometry.getLive(sel.entityId, state);
      const flashT = this.geoSaveFlashUntil ? Math.max(0, (this.geoSaveFlashUntil - (this.time ? this.time.now : 0)) / 380) : 0;
      let saveCol = COL.chalk, saveFillA = 0.05, saveLineA = 0.28, saveTextCol = '#EBE2D566';
      if (flashT > 0) { saveCol = 0x8FD16A; saveFillA = 0.15 + 0.35 * flashT; saveLineA = 1; saveTextCol = '#EBE2D5'; }
      else if (dirty) { saveCol = COL.amber; saveFillA = 0.22; saveLineA = 1; saveTextCol = '#E8A33D'; }
      g.fillStyle(saveCol, saveFillA); g.fillRoundedRect(saveX, by, bw, bh, 8);
      g.lineStyle(1.2, saveCol, saveLineA); g.strokeRoundedRect(saveX, by, bw, bh, 8);
      this.tUI.put(saveX + bw / 2, by + bh / 2, 'Save', 10, saveTextCol, 'center');

      const resetX = saveX + bw + gap, autoX = resetX + bw + gap;
      [['Reset', resetX], ['Auto', autoX]].forEach(([l, x]) => {
        g.fillStyle(COL.chalk, 0.08); g.fillRoundedRect(x, by, bw, bh, 8);
        g.lineStyle(1, COL.chalk, 0.32); g.strokeRoundedRect(x, by, bw, bh, 8);
        this.tUI.put(x + bw / 2, by + bh / 2, l, 10, '#EBE2D5', 'center');
      });
      this.geoBtns = [
        { id: 'geoSave', x: saveX, y: by, w: bw, h: bh },
        { id: 'geoReset', x: resetX, y: by, w: bw, h: bh },
        { id: 'geoAuto', x: autoX, y: by, w: bw, h: bh }
      ];

      let extraBottom = by + bh;
      this.geoFramesBtn = null; this.geoStateBtn = null; this.geoCatFrameBtn = null;
      this.geoMoveChk = null; this.geoApplyAllChk = null;
      const allKeys = this.geoAllStateKeys(sel);

      if (sel.kind === 'cat') {
        if (allKeys.length > 1) {
          // Переключатель кадра — как «Состояние» у мебели, но по полному
          // списку кадров персонажа (geoAvailableCatFrames): насильно ставит
          // konkретную позу (geoCatFrameOverride, см. catAppearance.js), чтобы
          // её можно было прицельно поправить, не дожидаясь, пока кот сам
          // её примет.
          const cfb = { x: S.x + 12, y: extraBottom + 10, w: S.w - 24, h: 28 };
          g.fillStyle(COL.chalk, 0.08); g.fillRoundedRect(cfb.x, cfb.y, cfb.w, cfb.h, 7);
          g.lineStyle(1, COL.chalk, 0.32); g.strokeRoundedRect(cfb.x, cfb.y, cfb.w, cfb.h, 7);
          this.tUI.put(cfb.x + cfb.w / 2, cfb.y + cfb.h / 2, 'Кадр: ' + state + '  →', 9.5, '#EBE2D5', 'center');
          this.geoCatFrameBtn = cfb;
          extraBottom = cfb.y + cfb.h;
        }
        const fb = { x: S.x + 12, y: extraBottom + 10, w: S.w - 24, h: 28 };
        const on = this.geoShowFrames;
        g.fillStyle(on ? COL.amber : COL.chalk, on ? 0.2 : 0.08);
        g.fillRoundedRect(fb.x, fb.y, fb.w, fb.h, 7);
        g.lineStyle(1, on ? COL.amber : COL.chalk, on ? 1 : 0.3);
        g.strokeRoundedRect(fb.x, fb.y, fb.w, fb.h, 7);
        this.tUI.put(fb.x + fb.w / 2, fb.y + fb.h / 2, 'Показать все кадры', 9.5, on ? '#E8A33D' : '#EBE2D5aa', 'center');
        this.geoFramesBtn = fb;
        extraBottom = fb.y + fb.h;
      } else if (allKeys.length > 1) {
        // Переключатель state — только у мебели с больше чем одной картинкой
        // (см. geoAvailableStates/geoCycleState выше): та же мутация
        // st.floor[iid].state, что и тап по предмету в обычном режиме, но
        // перебирает ВСЕ ключи манифеста, а не жёстко «new ⇄ afterGag».
        const sb = { x: S.x + 12, y: extraBottom + 10, w: S.w - 24, h: 28 };
        g.fillStyle(COL.chalk, 0.08); g.fillRoundedRect(sb.x, sb.y, sb.w, sb.h, 7);
        g.lineStyle(1, COL.chalk, 0.32); g.strokeRoundedRect(sb.x, sb.y, sb.w, sb.h, 7);
        this.tUI.put(sb.x + sb.w / 2, sb.y + sb.h / 2, 'Состояние: ' + state + '  →', 9.5, '#EBE2D5', 'center');
        this.geoStateBtn = sb;
        extraBottom = sb.y + sb.h;
      }

      // Чекбоксы: «Движение» (только у кота — по умолчанию выключено, кот
      // замирает на время правки geometry, см. catBehavior.tick) и «Изменить
      // все» (у любого target'а с больше чем одним state/кадром — Save
      // пишет текущую правку сразу под все ключи, см. geoSaveCurrent).
      // Половина ширины на чекбокс, если оба есть, иначе один на всю ширину.
      const showMove = sel.kind === 'cat';
      const showApplyAll = allKeys.length > 1;
      if (showMove || showApplyAll) {
        const cy0 = extraBottom + 10, ch = 24;
        const drawChk = (cx, cw, on, label) => {
          g.fillStyle(on ? COL.amber : COL.chalk, on ? 0.18 : 0.07);
          g.fillRoundedRect(cx, cy0, cw, ch, 6);
          g.lineStyle(1, on ? COL.amber : COL.chalk, on ? 0.9 : 0.3);
          g.strokeRoundedRect(cx, cy0, cw, ch, 6);
          this.tUI.put(cx + 9, cy0 + ch / 2, (on ? '☑' : '☐') + ' ' + label, 9, on ? '#E8A33D' : '#EBE2D5aa');
          return { x: cx, y: cy0, w: cw, h: ch };
        };
        if (showMove && showApplyAll) {
          const half = (S.w - 24 - 8) / 2;
          this.geoMoveChk = drawChk(S.x + 12, half, this.geoCatMove, 'Движение');
          this.geoApplyAllChk = drawChk(S.x + 12 + half + 8, half, this.geoApplyAll, 'Изменить все');
        } else if (showMove) {
          this.geoMoveChk = drawChk(S.x + 12, S.w - 24, this.geoCatMove, 'Движение');
        } else {
          this.geoApplyAllChk = drawChk(S.x + 12, S.w - 24, this.geoApplyAll, 'Изменить все');
        }
        extraBottom = cy0 + ch;
      }

      // Очень краткая легенда — что каждый элемент оверлея значит (см.
      // отчёт пользователю: розовый кружок без пояснения выглядел нерабочим,
      // хотя реально просто не даёт видимого эффекта без перекрытия с
      // соседним предметом). Один короткий пункт на элемент, не инструкция.
      const ly = extraBottom + 14, lh = 12.5;
      this.tUI.put(S.x + 12, ly, 'Бирюза — логическая точка/контур (не двигать)', 8.7, '#7AD6C4bb');
      this.tUI.put(S.x + 12, ly + lh, 'Жёлтый круг — опора картинки, тяните её к точке', 8.7, '#E8A33Dcc');
      this.tUI.put(S.x + 12, ly + lh * 2, 'Розовый круг — порядок перед/за (видно только при перекрытии)', 8.7, '#E07BD0cc');
      this.tUI.put(S.x + 12, ly + lh * 3, 'Зелёный квадрат — угол, тяните = размер', 8.7, '#8FD16Acc');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
