/* ============================================================================
   input.js — обработка тапов/перетаскивания: кнопки панелей, списки
   инвентаря/запасов, взятие/перестановка предметов, дверь/окно/лампа, кот,
   ходьба по полу.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { clamp, inPoly } = root.GUTIL;

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
          this.uiDirty = true;
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
        const idsR = ['quests', 'shop', 'character'];
        for (let i = 0; i < 3; i++) {
          const b = R.btn[i];
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            if (idsR[i] === 'character') { this.openCharacterPicker(); return; }
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
          cands.push({
            iid, from: iid, depth: I.floorDepth(pos),
            poly: I.floorPoly(I.floorRect(D.ITEMS[iid], pos.x, pos.y))
          });
        });
        Object.keys(this.st.place).filter(k => k !== 'CEIL' && this.zmap[k]).forEach(zid => {
          cands.push({
            iid: this.st.place[zid], from: zid, depth: I.depth(this.zmap, zid),
            poly: I.zonePoly(this.zmap[zid], F)
          });
        });
        cands.sort((a, b) => b.depth - a.depth);
        for (const c of cands) {
          if (inPoly([x, y], c.poly)) {
            this.drag = { kind: 'existing', from: c.from, iid: c.iid, p: [x, y] };
            this.uiDirty = true;
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

    onUp(p) {
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

      if (it.s) {
        // floor-мебель — свободная расстановка (st.floor), не конечный
        // список зон. from у floor-кандидата — сам iid (см. onDown).
        if (isExisting && inPoly([x, y], this.ui.R.poly)) {
          delete this.st.floor[drag.from];
          this.rebuild();
          this.drag = null; this.uiDirty = true;
          return;
        }
        const [cx, cy] = I.unP(x, y);
        const reason = I.rejectFloor(cx, cy, it, this.st, D.ITEMS, F, drag.from);
        if (!reason) {
          const prev = isExisting ? this.st.floor[drag.from] : null;
          this.st.floor[drag.iid] = { x: cx, y: cy };
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
    setMode(m) { this.mode = m; this.drag = null; this.ui = this.panelGeo(); this.uiDirty = true; this.shellDirty = true; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
