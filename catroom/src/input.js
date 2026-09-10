/* ============================================================================
   input.js — обработка тапов/перетаскивания: кнопки панелей, списки
   инвентаря/запасов, взятие/перестановка предметов, дверь/окно/лампа, кот,
   ходьба по полу.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { clamp, inPoly } = root.GUTIL;
  const FS = root.FURN_SPRITES;

  // Штора — 4 состояния по тапу (см. onDown ниже): открыта/закрыта, каждая
  // ещё и с рваной парой (Furniture/curtain/tornOpen.png, tornClosed.png).
  // new/afterGag остались как были (пристойные), торн-пара — третье
  // измерение поверх них, не замена. closed для дождя/луча (room/shell.js
  // curtainClosed()) — и afterGag, и tornClosed.
  const CURTAIN_CYCLE = ['new', 'afterGag', 'tornOpen', 'tornClosed'];

  root.MIXIN_INPUT = {

    hitBtn(rects, x, y) {
      for (const b of rects) if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      return null;
    },

    onDown(p) {
      const x = p.worldX, y = p.worldY;

      // Кнопка полного экрана — первым делом, до всего остального: должна
      // работать в любом режиме/панели, не только в 'view'. Через сам canvas
      // напрямую (как toggleFull() в исходном app.js), не this.scale.start/
      // stopFullscreen() — у Phaser ScaleManager в этой конфигурации падает
      // (HierarchyRequestError: insertBefore, «new child contains parent»),
      // сам браузерный Fullscreen API этим не страдает.
      if (this.hitFullscreenBtn(x, y)) {
        if (document.fullscreenElement) document.exitFullscreen();
        else this.game.canvas.requestFullscreen && this.game.canvas.requestFullscreen();
        return;
      }

      // Выключатель верхнего света — обычный бытовой прибор, тоже до всего
      // остального и в любом режиме (в отличие от крепления лампы/люстры на
      // потолке — то средство редактирования, доступно только в инвентаре).
      if (this.hitSwitch(x, y)) {
        this.lightsOn = !this.lightsOn;
        this.shellDirty = true;
        this.drawLighting();
        this.rebuildItemGfx(); // тусклый/яркий значок лампочки/люстры на потолке
        return;
      }

      // Крестик «Отладки предметов» (drawGeoPanel, ui/assetGeometryEditor.js)
      // — тоже до всего остального и в любом режиме: панель может быть
      // открыта поверх чего угодно, закрыть её нужно без лишних условий.
      if (this.assetDebug && this.geoCloseBtn) {
        const cb = this.geoCloseBtn;
        if (x >= cb.x && x <= cb.x + cb.w && y >= cb.y && y <= cb.y + cb.h) {
          this.assetDebug = false;
          this.geoSelected = null; this.geoDragTarget = null;
          this.geoCatFrameOverride = null; this.geoCatMove = false; this.geoApplyAll = false;
          root.AssetGeometry.clearLive();
          this.uiDirty = true;
          return;
        }
      }

      // Шапка панели «Отладки предметов» — таскать саму панель по экрану
      // (см. geoPanelPos/geoPanelDrag в game.js): тоже до всего остального и
      // в любом режиме, как и крестик выше — панель может закрывать собой
      // сам редактируемый предмет, подвинуть её нужно без лишних условий.
      if (this.assetDebug && this.geoPanelHeaderRect) {
        const hr = this.geoPanelHeaderRect;
        if (x >= hr.x && x <= hr.x + hr.w && y >= hr.y && y <= hr.y + hr.h) {
          this.geoPanelDrag = { dx: x - this.geoPanelPos.x, dy: y - this.geoPanelPos.y };
          return;
        }
      }

      // Promotion в нижней полосе (drawBannerStrip/drawPromoInfoPanel,
      // ui/hud.js) — доступен в любом режиме, как и сама полоса: она не
      // часть панелей инвентаря/настроек и никогда ими не перекрывается.
      // Панель ⓘ — первой. Лента под ней на паузе, пока панель открыта (см.
      // game.js update()), поэтому сообщение, к которому относится инфа,
      // никуда не уезжает и остаётся кликабельным: тап на «× закрыть» или
      // внутри панели — просто закрывает её; тап на самом сообщении
      // (bannerMainRect) — закрывает панель И переходит по ссылке, как
      // обычный клик по баннеру; тап где угодно ещё — просто закрывает.
      if (this.promoInfoOpen) {
        const ir = this.promoInfoPanelRect;
        const closeBtn = ir && { x: ir.x + ir.w - 90, y: ir.y + 4, w: 86, h: 24 };
        if (closeBtn && x >= closeBtn.x && x <= closeBtn.x + closeBtn.w && y >= closeBtn.y && y <= closeBtn.y + closeBtn.h) {
          this.closePromoInfoPanel();
          return;
        }
        const insidePanel = ir && x >= ir.x && x <= ir.x + ir.w && y >= ir.y && y <= ir.y + ir.h;
        if (insidePanel) return; // тап внутри — ничего не делаем, панель остаётся открытой

        const mr = this.bannerMainRect;
        const hitMain = mr && x >= mr.x && x <= mr.x + mr.w && y >= mr.y && y <= mr.y + mr.h;
        const promo = this.promoInfoPromo;
        this.closePromoInfoPanel();
        if (hitMain && promo) {
          if (root.ANALYTICS) root.ANALYTICS.sendMetrikaGoal(promo.analytics.click, { promotionId: promo.id });
          root.PROMOTION && root.PROMOTION.openLink(promo.url);
        }
        return;
      }
      if (this.bannerInfoRect) {
        const r = this.bannerInfoRect;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          const promo = this._activePromo;
          // Снимок кампании на момент клика — панель держит именно его,
          // даже если лента под ней потом уйдёт на подсказку/другую кампанию
          // (см. drawPromoInfoPanel/advanceBannerSlide, ui/hud.js).
          this.promoInfoPromo = promo;
          this.promoInfoOpen = true; this.uiDirty = true;
          if (promo && root.ANALYTICS) root.ANALYTICS.sendMetrikaGoal(promo.analytics.infoClick, { promotionId: promo.id });
          return;
        }
      }
      if (this.bannerMainRect) {
        const r = this.bannerMainRect;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          const promo = this._activePromo;
          if (promo) {
            // Аналитика — до перехода, но не должна его задерживать/блокировать:
            // sendMetrikaGoal сам ловит свои ошибки (см. analytics.js), тут
            // достаточно не ждать её результата перед openLink.
            if (root.ANALYTICS) root.ANALYTICS.sendMetrikaGoal(promo.analytics.click, { promotionId: promo.id });
            root.PROMOTION && root.PROMOTION.openLink(promo.url);
          }
          return;
        }
      }

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
          // И предмет из инвентаря, и корм/игрушка из «Запасов» — одинаково
          // берутся в руку и переносятся, а не срабатывают по одному тапу:
          // куда донесли (до кота / до пола / до миски), то и произошло.
          this.drag = { kind: this.mode === 'inventory' ? 'new' : 'supply', iid: cell.id, p: [x, y] };
          // Тот же тач может оказаться свайпом по списку, не переносом
          // предмета — см. checkListSwipe: решаем постфактум, по тому, куда
          // палец поехал дальше (в комнату — перенос, вбок внутри панели —
          // страница).
          this.listSwipeStart = { x, y };
          this.uiDirty = true;
          return;
        }
      }

      // настройки
      if (this.mode === 'settings') {
        const S = { x: 24, y: 300, w: 492, h: 470 };
        if (x >= S.x + S.w - 80 && x <= S.x + S.w - 6 && y >= S.y + 10 && y <= S.y + 36) { this.setMode('view'); return; }
        const t = this.hitBtn(this.setBtns || [], x, y);
        if (t) {
          // Разовые действия (drawSettings, ui/hud.js) — не тумблеры this[k],
          // отдельная ветка вместо общего toggle ниже.
          if (t.k === 'clearFurniture') { this.clearAllFurniture(); this.uiDirty = true; return; }
          if (t.k === 'character') { this.openCharacterPicker(); return; }
          if (t.k === 'fullWipe') {
            // Единственный способ вернуть игрока на CatSelect (см.
            // save.js: getCatChoice/bootScene.js: goNext — пока catId
            // сохранён, Boot туда не пускает). Удаляем весь сейв целиком
            // (не только catId) и перезагружаем страницу — так проще и
            // надёжнее, чем вручную откатывать состояние уже созданной
            // сцены комнаты (мебель/кот/свет/настроение и т.д.).
            if (root.SAVESTORE) root.SAVESTORE.clear();
            location.reload();
            return;
          }
          this[t.k] = !this[t.k];
          if (t.k === 'showWalk') this.shellDirty = true;
          if (t.k === 'pfxDebug') this.drawLighting();
          if (t.k === 'showLabels' || t.k === 'furnitureSprites') this.rebuildItemGfx();
          // Выключили «Отладку предметов» — сбросить выбор/перетаскивание и
          // живую (несохранённую) правку, чтобы не осталась висеть до
          // следующего включения.
          if (t.k === 'assetDebug' && !this.assetDebug) {
            this.geoSelected = null; this.geoDragTarget = null;
            this.geoCatFrameOverride = null; this.geoCatMove = false; this.geoApplyAll = false;
            root.AssetGeometry.clearLive();
          }
          this.uiDirty = true;
          return;
        }
        const bg = this.bgSwitchRect;
        if (bg && x >= bg.x && x <= bg.x + bg.w && y >= bg.y && y <= bg.y + bg.h) {
          this.cycleBackground();
          return;
        }
        if (x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h) return;
      }

      // «Магазин» — та же геометрия панели, что у настроек. «Игра»
      // (мини-игра) отдельным режимом не является — see ниже, кнопка сразу
      // открывает overlay (src/minigame.js), не переключает mode.
      if (this.mode === 'shop') {
        const S = this.placeholderRect || { x: 24, y: 300, w: 492, h: 180 };
        if (x >= S.x + S.w - 80 && x <= S.x + S.w - 6 && y >= S.y + 10 && y <= S.y + 36) { this.setMode('view'); return; }
        if (x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h) return;
      }

      // Выбор персонажа: строка — сменить превью, «Выбрать» — применить.
      if (this.mode === 'characters') {
        const S = this.charPanelRect || { x: 24, y: 260, w: 492, h: 340 };
        if (x >= S.x + S.w - 80 && x <= S.x + S.w - 6 && y >= S.y + 10 && y <= S.y + 36) { this.setMode('view'); return; }
        const row = this.hitBtn(this.charRows || [], x, y);
        if (row) { this.charPreviewName = row.name; this.uiDirty = true; return; }
        const btn = this.charPickBtn;
        if (btn && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
          if (this.charPreviewName !== this.catCharacter) {
            this.catCharacter = this.charPreviewName;
            this.catSpeed = this.activeCatConfig().speed;
          }
          this.setMode('view');
          return;
        }
        if (x >= S.x && x <= S.x + S.w && y >= S.y && y <= S.y + S.h) return;
      }

      // «Отладка предметов» (ui/assetGeometryEditor.js) — только в обычном
      // режиме (не поверх инвентаря/других панелей: там тап по коту/коробке
      // уже что-то делает — гладить/переставлять/переключать гэг, см. ниже
      // по файлу — а тут ещё выбор ассета для правки). Приоритет: сначала
      // хэндлы (перетащить уже выбранное), потом кнопки панели редактора,
      // потом сам выбор нового ассета тапом.
      if (this.assetDebug && this.mode === 'view') {
        const handleKind = this.geoHitHandle(x, y);
        if (handleKind) { this.geoStartDrag(handleKind); return; }
        const gb = this.hitBtn(this.geoBtns || [], x, y);
        if (gb) {
          if (gb.id === 'geoSave') this.geoSaveCurrent();
          else if (gb.id === 'geoExport') this.geoExportCurrent();
          else this.geoResetCurrent(); // geoReset и geoAuto — оба откат к автоматике
          return;
        }
        const fb = this.geoFramesBtn;
        if (fb && x >= fb.x && x <= fb.x + fb.w && y >= fb.y && y <= fb.y + fb.h) {
          this.geoShowFrames = !this.geoShowFrames; this.uiDirty = true; return;
        }
        const sb = this.geoStateBtn;
        if (sb && x >= sb.x && x <= sb.x + sb.w && y >= sb.y && y <= sb.y + sb.h) {
          this.geoCycleState(); return;
        }
        const cfb = this.geoCatFrameBtn;
        if (cfb && x >= cfb.x && x <= cfb.x + cfb.w && y >= cfb.y && y <= cfb.y + cfb.h) {
          this.geoCycleCatFrame(); return;
        }
        const mc = this.geoMoveChk;
        if (mc && x >= mc.x && x <= mc.x + mc.w && y >= mc.y && y <= mc.y + mc.h) {
          this.geoCatMove = !this.geoCatMove; this.uiDirty = true; return;
        }
        const aac = this.geoApplyAllChk;
        if (aac && x >= aac.x && x <= aac.x + aac.w && y >= aac.y && y <= aac.y + aac.h) {
          this.geoApplyAll = !this.geoApplyAll; this.uiDirty = true; return;
        }
        const target = this.geoTargets().find(t => Math.hypot(x - t.screen[0], y - t.screen[1]) < 26);
        if (target) { this.selectGeoTarget(target); return; }
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
        const idsR = ['minigame', 'shop'];
        for (let i = 0; i < idsR.length; i++) {
          const b = R.btn[i];
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            if (idsR[i] === 'minigame') { this.openMinigame(); return; }
            this.setMode(this.mode === idsR[i] ? 'view' : idsR[i]);
            return;
          }
        }
      }

      // панель поглощает тап целиком, до сцены он не доходит
      if (inPoly([x, y], L.poly) || inPoly([x, y], R.poly)) return;

      // Дверь/окно — тоже только при открытом инвентаре, до захвата предмета
      // (проверяем раньше него, иначе окно/дверь никогда не выигрывали бы у
      // мебели, если их зоны перекрываются на экране).
      if (this.mode === 'inventory' && !this.drag) {
        if (this.hitDoor(x, y)) { this.openingDrag = 'door'; return; }
        if (this.hitWindow(x, y)) { this.openingDrag = 'window'; return; }
        if (this.hitLight(x, y)) { this.openingDrag = 'light'; return; }
      }

      // Взять уже стоящий предмет «в руку» — только при открытом инвентаре.
      // Раньше тап сразу удалял предмет обратно в инвентарь без какого-либо
      // перетаскивания; теперь это именно захват: предмет остаётся на месте
      // (rebuild()/удаление — не тут, а в onUp по факту отпускания), и его
      // можно либо перенести на новое легальное место, либо вернуть в
      // инвентарь, отпустив над правой панелью (см. onUp). Кандидаты из ДВУХ
      // разных систем — floor (свободная расстановка, st.floor) и
      // стена/потолок/поверхность (конечный список зон, st.place) — сведены
      // в один список и отсортированы по глубине вместе, как раньше, чтобы
      // попадать в то, что визуально сверху, независимо от того, к какой
      // системе оно относится. from у floor-кандидата — iid: свободная
      // расстановка ключует позицию по нему же, отдельного id зоны нет.
      if (this.mode === 'inventory' && !this.drag) {
        const F = I.PROJ.F, cands = [];
        Object.keys(this.st.floor).forEach(iid => {
          const pos = this.st.floor[iid];
          const it = D.ITEMS[iid];
          const [w, d] = I.floorOrient(it, pos.x, pos.y), h = it.s[2];
          // Точка захвата (жёлтый кружок) рисуется приподнятой над полом —
          // I.P(..., h*0.5), см. drawGrabPoint/drawFloorItemInto в
          // itemsRender.js — та же формула. Для невысоких предметов это
          // почти не сдвигает экранную точку относительно плоского
          // footprint-полигона, но для box/ficus (заметная высота) кружок
          // на экране уходит выше диамонда footprint'а — тап точно по нему
          // промахивался мимо poly. Держим ту же формулу здесь и добавляем
          // отдельную проверку по радиусу вокруг маркера, а не только polygon.
          const rot = pos.x <= pos.y, depFull = rot ? w : d;
          const front = rot ? [pos.x + depFull / 2, pos.y] : [pos.x, pos.y + depFull / 2];
          const marker = I.P(front[0], front[1], h * 0.5);
          cands.push({
            iid, from: iid, depth: I.floorDepth(pos),
            poly: I.floorPoly(I.floorRect(it, pos.x, pos.y)),
            marker
          });
        });
        Object.keys(this.st.place).filter(k => k !== 'CEIL' && this.zmap[k]).forEach(zid => {
          cands.push({
            iid: this.st.place[zid], from: zid, depth: I.depth(this.zmap, zid),
            poly: I.zonePoly(this.zmap[zid], F)
          });
        });
        // Потолочный предмет — свой хит-регион (ceilHitPoly, shell.js), не
        // общий zonePoly (у CEIL зоны нет вовсе). Глубина заведомо больше
        // любой floor/wall — рисуется он тоже поверх всего (CEIL_DEPTH).
        if (this.st.place.CEIL) {
          cands.push({ iid: this.st.place.CEIL, from: 'CEIL', depth: 1e9, poly: this.ceilHitPoly() });
        }
        cands.sort((a, b) => b.depth - a.depth);
        const MARKER_R = 10;
        for (const c of cands) {
          const onMarker = c.marker && Math.hypot(x - c.marker[0], y - c.marker[1]) <= MARKER_R;
          if (onMarker || inPoly([x, y], c.poly)) {
            this.drag = { kind: 'existing', from: c.from, iid: c.iid, p: [x, y] };
            this.uiDirty = true;
            return;
          }
        }
      }

      // Тап по подставке торшера — включить/выключить (только не в
      // инвентаре: там тап по предмету значит «взять переставить», см.
      // подбор existing чуть выше). !this.assetDebug — тут и во всех
      // остальных тап-переключателях состояния ниже (гэг мебели/потолка,
      // дверь, штора, портрет): в «Отладке предметов» у этих предметов
      // хит-зона (весь силуэт/проём) обычно куда больше 26px-круга выбора
      // цели (geoTargets, onDown выше), и тап мимо самого кружка перещёлкивал
      // состояние вместо выбора предмета для правки — мешал прицельно
      // кликнуть по объекту.
      if (this.mode === 'view' && !this.drag && !this.assetDebug && this.st.floor.lamp) {
        const pos = this.st.floor.lamp;
        const poly = I.floorPoly(I.floorRect(D.ITEMS.lamp, pos.x, pos.y));
        if (inPoly([x, y], poly)) {
          this.lampOn = !this.lampOn;
          this.drawLighting();
          this.rebuildItemGfx(); // тёплая/тусклая точка у абажура
          return;
        }
      }

      // Тап по floor-предмету с гэг-состоянием — переключить (закрыта/
      // распотрошена и т.п., см. Furniture/manifest.json). Раньше это было
      // захардкожено только на box; теперь общее правило для ЛЮБОГО
      // floor-предмета, у которого реально вырезана afterGag-картинка
      // (FS.states(iid).afterGag) — стол/диван/шкаф/стеллаж подхватились
      // сами, без отдельных блоков. Хранится в позиции (st.floor[iid].state),
      // как и раньше у box; кандидаты отсортированы по глубине — тап должен
      // попадать в то, что визуально сверху, если footprint'ы перекрылись.
      if (this.mode === 'view' && !this.drag && !this.assetDebug && FS) {
        const gagCands = Object.keys(this.st.floor)
          .filter(iid => FS.states(iid) && FS.states(iid).afterGag)
          .map(iid => {
            const pos = this.st.floor[iid];
            return { pos, depth: I.floorDepth(pos), poly: I.floorPoly(I.floorRect(D.ITEMS[iid], pos.x, pos.y)) };
          })
          .sort((a, b) => b.depth - a.depth);
        for (const c of gagCands) {
          if (inPoly([x, y], c.poly)) {
            c.pos.state = c.pos.state === 'afterGag' ? 'new' : 'afterGag';
            this.rebuildItemGfx();
            return;
          }
        }
      }

      // Тап по потолочному предмету с гэг-состоянием (сейчас — люстра, см.
      // Furniture/chandelier/afterGag.png) — тот же переключатель, но
      // хранится в st.placeState.CEIL (как у шторы/портрета), не в позиции:
      // у потолочного предмета своей st.floor-позиции нет, только st.place.CEIL.
      if (this.mode === 'view' && !this.drag && !this.assetDebug && FS && this.st.place.CEIL) {
        const ceilIid = this.st.place.CEIL;
        if (FS.states(ceilIid) && FS.states(ceilIid).afterGag && inPoly([x, y], this.ceilHitPoly())) {
          const cur = (this.st.placeState || {}).CEIL || 'new';
          this.st.placeState.CEIL = cur === 'afterGag' ? 'new' : 'afterGag';
          this.rebuildItemGfx();
          return;
        }
      }

      // Тап по двери — переключить гэг-состояние (Furniture/door/
      // leftAfterGag.png), тот же мгновенный toggle, что у коробки. Флаг
      // живёт в this.st.door.gag (не в manifest-состоянии стороны — та
      // остаётся left/frontLeft, см. updateDoorSprite в room/itemsRender.js),
      // переключается независимо от того, на какой стене сейчас дверь.
      if (this.mode === 'view' && !this.drag && !this.assetDebug && this.hitDoor(x, y)) {
        this.st.door.gag = !this.st.door.gag;
        this.rebuildItemGfx();
        return;
      }

      // Тап по шторе — открыть/задёрнуть (this.st.placeState[zid], см.
      // room/shell.js: curtainZid/curtainClosed). Задёрнутая штора и гасит
      // лунный луч из окна (drawWindowBeam), и (в спрайтовом режиме) закрывает
      // собой стекло — оба эффекта читают то же состояние, поэтому дёргаем
      // полный drawLighting(), не только rebuildItemGfx().
      if (this.mode === 'view' && !this.drag && !this.assetDebug) {
        const curtainZid = this.curtainZid();
        if (curtainZid) {
          // Хват — по фактическому габариту шторы (curtainPoly: весь проём
          // от пола до потолка), не по тесной decor-зоне WIN_ROD/WIN_FRAME
          // (та — только под карниз/раму, палец туда не попадёт) — то же
          // расхождение зоны и видимого силуэта, что чинили для спрайтов
          // мебели (см. drawFloorItemInto).
          const poly = this.curtainPoly();
          if (inPoly([x, y], poly)) {
            const cur = (this.st.placeState || {})[curtainZid] || 'new';
            const idx = CURTAIN_CYCLE.indexOf(cur);
            this.st.placeState[curtainZid] = CURTAIN_CYCLE[(idx + 1) % CURTAIN_CYCLE.length];
            this.drawLighting();
            this.rebuildItemGfx();
            return;
          }
        }
      }

      // Тап по портрету — анимированно падает вдоль стены до пола (твин
      // поворота, затем замена на Furniture/portrait/afterGag.png уже с
      // осколками), повторный тап — так же анимированно поднимается обратно
      // (см. animatePortraitFall в room/itemsRender.js). Сам toggle
      // this.st.placeState[zid] происходит по завершении твина, не тут.
      if (this.mode === 'view' && !this.drag && !this.assetDebug) {
        const portraitZid = Object.keys(this.st.place).find(zid => this.st.place[zid] === 'portrait');
        const z = portraitZid && this.zmap[portraitZid];
        if (z) {
          const wanted = (this.st.placeState || {})[portraitZid];
          const fallen = wanted === 'fallen';
          // Хват — по decor-зоне на стене, пока висит; по кругу вокруг той
          // же точки на полу, куда «упал» (wallFloorAnchor), когда лежит —
          // иначе после падения по нему нельзя тапнуть обратно. Пока идёт
          // сам твин (entry.fallAnim) — тап просто ни во что не попадает,
          // повторный запуск анимации поверх текущей запрещён внутри
          // animatePortraitFall.
          let hit;
          if (fallen) {
            const fp = this.wallFloorAnchor(portraitZid);
            hit = Math.hypot(x - fp[0], y - fp[1]) < 45;
          } else {
            hit = inPoly([x, y], I.zonePoly(z, I.PROJ.F));
          }
          if (hit) {
            this.animatePortraitFall(portraitZid);
            return;
          }
        }
      }

      // тап по коту — погладить (не «поиграть игрушкой», для этого нужно
      // донести игрушку из «Запасов», см. resolveSupplyDrop)
      const cp = I.P(this.cat.x, this.cat.y);
      if (Math.hypot(x - cp[0], y - cp[1] + 20) < 34) { this.petCat(); return; }

      // тап по полу — идём
      const [gx, gy] = I.unP(x, y);
      const F = I.PROJ.F;
      if (gx >= 0 && gy >= 0 && gx <= F && gy <= F) this.walkTo(gx, gy, () => this.idleCycle());
    },

    // Свайп по списку «Инвентарь»/«Запасы» — палец, взявший предмет из ячейки
    // (см. onDown: this.listSwipeStart взводится там же, где this.drag),
    // сдвинулся в сторону вбок, не покидая панель списка. Решаем не в
    // onDown/onUp, а по ходу движения (pointermove, game.js) — иначе пришлось
    // бы ждать отпускания, чтобы понять, было ли это «взять предмет» или
    // «пролистать», и предмет всё это время висел бы над пальцем как призрак.
    checkListSwipe(x, y) {
      if (!this.listSwipeStart || !this.drag || (this.drag.kind !== 'new' && this.drag.kind !== 'supply')) return;
      if (!inPoly([x, y], this.ui.R.poly)) { this.listSwipeStart = null; return; } // ушёл в комнату — обычный перенос
      const dx = x - this.listSwipeStart.x, dy = y - this.listSwipeStart.y;
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return; // пока не ясно, свайп это или лёгкое дрожание пальца
      const src = this.listSource(), pages = Math.max(1, Math.ceil(src.length / 3));
      const dir = dx < 0 ? 1 : -1;
      if (this.mode === 'inventory') this.pageInv = clamp(this.pageInv + dir, 0, pages - 1);
      else this.pageSup = clamp(this.pageSup + dir, 0, pages - 1);
      this.drag = null; this.listSwipeStart = null; this.uiDirty = true;
    },

    onUp(p) {
      this.listSwipeStart = null;
      if (!this.drag) return;
      const drag = this.drag;
      const x = p.worldX, y = p.worldY, F = I.PROJ.F;

      if (drag.kind === 'supply') {
        this.resolveSupplyDrop(x, y);
        this.drag = null; this.uiDirty = true;
        return;
      }

      const it = D.ITEMS[drag.iid];
      const isExisting = drag.kind === 'existing';

      // Потолочный предмет (лампочка/люстра) — слот всегда один (st.place.
      // CEIL), своих x,y нет (позиция — st.light, крепление двигается
      // отдельно, см. hitLight/dragOpening), поэтому не перебираем зоны (их
      // для ceil и не заводили, см. ACCEPTS в iso.js) — просто вешаем куда
      // угодно на сцену, кроме панелей.
      if (it.cat === 'ceil') {
        if (isExisting && inPoly([x, y], this.ui.R.poly)) {
          delete this.st.place.CEIL;
          this.rebuild();
        } else if (!inPoly([x, y], this.ui.L.poly) && !inPoly([x, y], this.ui.R.poly)) {
          this.st.place.CEIL = drag.iid;
          this.rebuild();
        }
        this.drag = null; this.uiDirty = true;
        return;
      }

      if (it.s) {
        // floor-мебель — свободная расстановка (st.floor), не конечный
        // список зон. from у floor-кандидата — сам iid (см. onDown).
        if (isExisting && inPoly([x, y], this.ui.R.poly)) {
          delete this.st.floor[drag.from];
          this.rebuild();
          this.drag = null; this.uiDirty = true;
          return;
        }
        const [ux, uy] = I.unP(x, y);
        // «встык к стене» — если точка попадает в полосу у задней стены,
        // предмет доводится вплотную к ней, а не остаётся там, где палец
        // его фактически отпустил (см. floorSnap в iso.js).
        const { x: cx, y: cy } = I.floorSnap(it, ux, uy);
        const reason = I.rejectFloor(cx, cy, it, this.st, D.ITEMS, F, this.LAY, drag.from);
        if (!reason) {
          const prev = isExisting ? this.st.floor[drag.from] : null;
          // .state переносим со старой позиции — иначе любая перестановка
          // (даже «взял и положил на то же место») тихо сбрасывала предмет
          // в состояние 'new' (см. FS.pickState): новый объект позиции не
          // содержал поле state вовсе, только что выбранный пользователем
          // вид терялся при каждом хвате.
          this.st.floor[drag.iid] = prev && prev.state !== undefined
            ? { x: cx, y: cy, state: prev.state } : { x: cx, y: cy };
          this.rebuild();
          // если постановка отрезала подход — откатываем
          if (this.NAV.unreachable.length) {
            if (prev) this.st.floor[drag.iid] = prev; else delete this.st.floor[drag.iid];
            this.rebuild();
            this.bubble('Так к нему не подойти.');
          }
        }
        // reason непустой — тихая отмена, предмет и так ещё на своём месте
        // (для 'new' его нигде и не было).
        this.drag = null; this.uiDirty = true;
        return;
      }

      // стена/потолок/поверхность — по-прежнему конечный список зон
      // (dynamicZones): существующий предмет, отпущенный над правой панелью
      // (список инвентаря, т.к. режим не менялся) — вернуть в инвентарь.
      if (isExisting && inPoly([x, y], this.ui.R.poly)) {
        delete this.st.place[drag.from];
        this.rebuild();
        this.drag = null; this.uiDirty = true;
        return;
      }

      // ближайшая по глубине легальная зона под пальцем; своя исходная зона
      // (для «existing») тоже кандидат — иначе некуда «отпустить на месте»
      let hit = null;
      const cands = this.zones.filter(z => (!this.st.place[z.id] || z.id === drag.from) && !I.reject(z, it));
      for (const z of cands) {
        if (inPoly([x, y], I.zonePoly(z, F))) { hit = z; break; }
      }
      if (hit && hit.id !== drag.from) {
        if (isExisting) delete this.st.place[drag.from];
        this.st.place[hit.id] = drag.iid;
        this.rebuild();
        // если постановка отрезала подход — откатываем
        if (this.NAV.unreachable.length) {
          delete this.st.place[hit.id];
          if (isExisting) this.st.place[drag.from] = drag.iid;
          this.rebuild();
          this.bubble('Так к нему не подойти.');
        }
      }
      // hit.id === drag.from (отпустили там же, откуда взяли) или !hit
      // (мимо всего) — тихая отмена, предмет и так ещё на своём месте.
      this.drag = null; this.uiDirty = true;
    },

    // shellDirty тоже — крепление лампы в drawShell рисуется только пока
    // mode==='inventory', так что вход/выход из инвентаря обязан перерисовать
    // оболочку, не только UI.
    // rebuildItemGfx() тут обязателен, не только shellDirty: вход/выход из
    // инвентаря меняет не только оболочку (дверь/окно/сетка, см. showLines в
    // drawShell), но и сами предметы — точки захвата (drawGrabPoint) и
    // силуэты предметов без спрайта показываются/прячутся тем же условием
    // (this.mode==='inventory'), а без явного вызова остались бы устаревшими
    // до следующей случайной перестановки.
    setMode(m) {
      this.mode = m; this.drag = null; this.listSwipeStart = null; this.ui = this.panelGeo();
      this.uiDirty = true; this.shellDirty = true; this.rebuildItemGfx();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
