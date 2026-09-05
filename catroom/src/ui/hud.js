/* ============================================================================
   ui/hud.js — панели, HUD, инвентарь/запасы, настройки, заглушки, «призрак»
   переносимого предмета. Геометрия панелей (panelGeo) тоже тут — она чисто
   про раскладку UI (трапеции в мёртвых углах кадра), хоть и вычисляется из
   геометрии пола.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO, IC = root.ICONS;
  const { SCREEN_H, OX } = I;
  const { COL } = root.RCFG;
  const { clamp, inPoly } = root.GUTIL;

  root.MIXIN_HUD = {

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
    },

    /* ==================== ИНТЕРФЕЙС ==================== */
    drawUI() {
      const g = this.gUI; g.clear(); this.tUI.begin();
      this.drawHUD(g);

      const listOnR = this.mode === 'inventory' || this.mode === 'supplies';
      this.drawButtons(g, this.ui.L, [
        { id: 'settings', l: 'Настройки' }, { id: 'inventory', l: 'Инвентарь' }, { id: 'supplies', l: 'Корм' }
      ]);
      if (listOnR) this.drawList(g, this.ui.R);
      else {
        this.invIconImgs.forEach(im => im.setVisible(false));
        this.drawButtons(g, this.ui.R, [
        { id: 'quests', l: 'Задания' }, { id: 'shop', l: 'Магазин' },
        // Раньше «—» (заглушка) — теперь выбор персонажа: тап переключает на
        // следующего по списку из Cats/manifest.json, подпись — имя текущего.
        { id: 'character', l: this.activeCatConfig().name }
        ]);
      }

      if (this.mode === 'settings') this.drawSettings(g);
      if (this.mode === 'quests') this.drawPlaceholderPanel(g, 'Задания');
      if (this.mode === 'shop') this.drawPlaceholderPanel(g, 'Магазин');
      if (this.mode === 'characters') this.drawCharacterPanel(g);
      else this.catPreviewImg.setVisible(false);
      if (this.drag) this.drawGhost(g);
      else this.ghostImg.setVisible(false);
      this.tUI.end();
    },

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

      // Кнопка полного экрана — постоянная иконка в углу HUD, как в исходном
      // app.js (там она открывала canvas.requestFullscreen()); тут то же
      // самое через Phaser ScaleManager. Не тумблер в настройках — всегда на
      // виду и всегда кликабельна, независимо от текущего режима (см. onDown).
      const fr = this.fullscreenBtnRect();
      g.fillStyle(COL.chalk, 0.08); g.fillRoundedRect(fr.x, fr.y, fr.w, fr.h, 8);
      g.lineStyle(1.2, COL.chalk, 0.35); g.strokeRoundedRect(fr.x, fr.y, fr.w, fr.h, 8);
      this.tUI.put(fr.x + fr.w / 2, fr.y + fr.h / 2, document.fullscreenElement ? '⤡' : '⤢', 14, '#EBE2D5cc', 'center');
    },

    fullscreenBtnRect() { return { x: 504, y: 42, w: 28, h: 28 }; },
    hitFullscreenBtn(x, y) {
      const r = this.fullscreenBtnRect();
      return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    },

    drawPanel(g, pn, active) {
      const p = pn.poly.map(a => ({ x: a[0], y: a[1] }));
      g.fillStyle(COL.panel, 0.93); g.fillPoints(p, true);
      g.lineStyle(1.2, active ? COL.amber : COL.chalk, active ? 1 : 0.26); g.strokePoints(p, true);
    },

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
    },

    listSource() {
      if (this.mode !== 'inventory') return D.SUPPLIES_LIST;
      const used = new Set([...Object.values(this.st.place), ...Object.keys(this.st.floor)]);
      return D.ITEMS_LIST.filter(i => !used.has(i.id));
    },

    drawList(g, pn) {
      const src = this.listSource(), per = 3;
      const pages = Math.max(1, Math.ceil(src.length / per));
      let page = clamp(this.mode === 'inventory' ? this.pageInv : this.pageSup, 0, pages - 1);
      if (this.mode === 'inventory') this.pageInv = page; else this.pageSup = page;

      this.drawPanel(g, pn, true);
      this.tUI.put(pn.btn[0].x, pn.btn[0].y - 16, this.mode === 'inventory' ? 'Инвентарь' : 'Запасы', 10, '#EBE2D5aa');
      this.tUI.put(pn.btn[2].x + pn.btn[2].w - 4, pn.btn[0].y - 14, '× закрыть', 10, '#E8A33Dcc', 'right');

      const FS = root.FURN_SPRITES;
      this.listRects = [];
      for (let i = 0; i < per; i++) {
        const r = pn.btn[i], it = src[page * per + i];
        g.fillStyle(COL.chalk, 0.06); g.fillRoundedRect(r.x, r.y, r.w, r.h, 10);
        g.lineStyle(1.1, COL.chalk, 0.42); g.strokeRoundedRect(r.x, r.y, r.w, r.h, 10);
        if (!it) { this.listRects.push(null); this.invIconImgs[i].setVisible(false); continue; }
        // В спрайтовом режиме — миниатюра самой картинки вместо векторной
        // IC.drawIcon (см. this.furnitureSprites, drawSettings) — тем же
        // предметам, для которых включённый тумблер вообще что-то меняет на
        // сцене; у остальных (нет вырезанной картинки) иконка остаётся
        // прежней векторной, чтобы список не выглядел «наполовину пустым».
        const state = this.furnitureSprites && FS && FS.pickState(it.id, 'new');
        const im = this.invIconImgs[i];
        if (state) {
          const key = FS.textureKey(it.id, state);
          const src2 = this.textures.get(key).getSourceImage();
          const boxW = r.w * 0.7, boxH = r.h * 0.62;
          const scale = Math.min(boxW / src2.width, boxH / src2.height);
          im.setTexture(key).setVisible(true).setScale(scale)
            .setPosition(r.x + r.w / 2, r.y + r.h / 2 - 4);
        } else {
          im.setVisible(false);
          IC.drawIcon(g, it.id, r.x + r.w / 2, r.y + r.h / 2 - 4, pn.iconS);
        }
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
    },

    drawSettings(g) {
      const S = { x: 24, y: 300, w: 492, h: 346 };
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

      // Мебель: линии (процедурные силуэты) или спрайты (вырезанные картинки
      // из Furniture/, см. room/furnitureSprites.js/itemsRender.js) — на всю
      // ширину, не в паре с debug-тумблерами выше: это выбор арта, не
      // отладочный слой.
      const fsY = S.y + 90 + 2 * 46 + 8, fsOn = this.furnitureSprites;
      g.fillStyle(fsOn ? COL.amber : COL.chalk, fsOn ? 0.2 : 0.05);
      g.fillRoundedRect(S.x + 20, fsY, S.w - 40, 36, 9);
      g.lineStyle(1.1, fsOn ? COL.amber : COL.chalk, fsOn ? 1 : 0.28);
      g.strokeRoundedRect(S.x + 20, fsY, S.w - 40, 36, 9);
      this.tUI.put(S.x + 20 + (S.w - 40) / 2, fsY + 18, 'Мебель: ' + (fsOn ? 'спрайты' : 'линии'),
        10, fsOn ? '#E8A33D' : '#EBE2D5aa', 'center');
      this.setBtns.push({ x: S.x + 20, y: fsY, w: S.w - 40, h: 36, k: 'furnitureSprites' });

      // Фон сцены — переключение по кругу (cycleBackground, game.js), не
      // тумблер: вариантов больше двух не будет редко, но кнопка та же, что
      // и у остальных настроек, просто подпись — текущий выбор, а не вкл/выкл.
      const bgY = S.y + 90 + 3 * 46 + 16, bgW = S.w - 40;
      g.fillStyle(COL.chalk, 0.06); g.fillRoundedRect(S.x + 20, bgY, bgW, 36, 9);
      g.lineStyle(1.1, COL.chalk, 0.28); g.strokeRoundedRect(S.x + 20, bgY, bgW, 36, 9);
      this.tUI.put(S.x + 20 + bgW / 2, bgY + 18, 'Фон: ' + this.backgrounds[this.bgIndex].ru,
        10, '#EBE2D5aa', 'center');
      this.bgSwitchRect = { x: S.x + 20, y: bgY, w: bgW, h: 36 };

      const N = this.NAV;
      const msg = !N ? '' : N.unreachable.length
        ? 'Коту не подойти: ' + N.unreachable.join(', ')
        : 'Ко всем предметам есть подход · пол свободен на ' + N.area + '%';
      this.tUI.put(S.x + 20, S.y + S.h - 34, msg, 10,
        N && N.unreachable.length ? '#E8A33D' : '#EBE2D566');
    },

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
    },

    // Полноценный выбор персонажа: строки с именами слева, справа — превью
    // из спрайтов просматриваемого (charPreviewName) персонажа с вращением
    // сидящей позы (catPreviewFrameName), применяется только по «Выбрать».
    drawCharacterPanel(g) {
      const S = { x: 24, y: 260, w: 492, h: 340 };
      g.fillStyle(COL.panel, 0.97); g.fillRoundedRect(S.x, S.y, S.w, S.h, 14);
      g.lineStyle(1.2, COL.chalk, 0.3); g.strokeRoundedRect(S.x, S.y, S.w, S.h, 14);
      this.tUI.put(S.x + 20, S.y + 28, 'Выбор персонажа', 11, '#EBE2D5');
      this.tUI.put(S.x + S.w - 20, S.y + 28, '× закрыть', 10, '#E8A33Dcc', 'right');

      const names = this.catNames;
      const leftX = S.x + 20, leftW = 200;
      const listTop = S.y + 56, listBot = S.y + S.h - 20, gap = 10;
      const rh = clamp((listBot - listTop - gap * (names.length - 1)) / names.length, 34, 52);

      this.charRows = [];
      names.forEach((name, i) => {
        const y = listTop + i * (rh + gap);
        const on = name === this.charPreviewName;
        g.fillStyle(on ? COL.amber : COL.chalk, on ? 0.18 : 0.06);
        g.fillRoundedRect(leftX, y, leftW, rh, 9);
        g.lineStyle(1.1, on ? COL.amber : COL.chalk, on ? 1 : 0.3);
        g.strokeRoundedRect(leftX, y, leftW, rh, 9);
        this.tUI.put(leftX + 14, y + rh / 2, this.cache.json.get('catcfg-' + name).name,
          10.5, on ? '#E8A33D' : '#EBE2D5cc', 'left');
        this.charRows.push({ x: leftX, y, w: leftW, h: rh, name });
      });

      const rx = leftX + leftW + 20, rw = S.x + S.w - 20 - rx;
      const boxTop = S.y + 56, boxH = 190;
      g.fillStyle(COL.chalk, 0.05); g.fillRoundedRect(rx, boxTop, rw, boxH, 10);
      g.lineStyle(1.1, COL.chalk, 0.24); g.strokeRoundedRect(rx, boxTop, rw, boxH, 10);

      const { frameName, flip } = this.catPreviewFrame(this.charPreviewName);
      this.catPreviewImg.setTexture(this.catFrameKeyFor(this.charPreviewName, frameName)).setFlipX(flip);
      this.catPreviewImg.setPosition(rx + rw / 2, boxTop + boxH - 14).setVisible(true);

      const btnW = 150, btnH = 38, btnX = rx + rw / 2 - btnW / 2, btnY = boxTop + boxH + 20;
      const isCurrent = this.charPreviewName === this.catCharacter;
      g.fillStyle(COL.amber, isCurrent ? 0.08 : 0.22); g.fillRoundedRect(btnX, btnY, btnW, btnH, 10);
      g.lineStyle(1.2, COL.amber, isCurrent ? 0.3 : 1); g.strokeRoundedRect(btnX, btnY, btnW, btnH, 10);
      this.tUI.put(btnX + btnW / 2, btnY + btnH / 2, isCurrent ? 'Выбран' : 'Выбрать',
        11, isCurrent ? '#E8A33D88' : '#E8A33D', 'center');
      this.charPickBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
      this.charPanelRect = S;
    },

    // Корм/игрушка (kind:'supply') — у них нет ни габаритов it.s, ни понятия
    // «стена» (SUP_BY_ID — другой каталог), полноценный силуэт рисовать
    // нечем и незачем: маленькая иконка-пузырь у пальца, как и раньше.
    drawSupplyGhostIcon(g, p) {
      const x = p[0], y = p[1] - 48;
      g.fillStyle(COL.panel, 0.9); g.fillRoundedRect(x - 30, y - 30, 60, 60, 10);
      g.lineStyle(1.4, COL.amber, 1); g.strokeRoundedRect(x - 30, y - 30, 60, 60, 10);
      IC.drawIcon(g, this.drag.iid, x, y, 19);
      g.lineStyle(1.2, COL.amber, 0.9);
      g.lineBetween(x - 7, p[1], x + 7, p[1]);
      g.lineBetween(x, p[1] - 7, x, p[1] + 7);
    },

    // Предмет мебели в руке — тот же силуэт, что стоя в комнате (root.
    // ITEM_SHAPES), не иконка: несёшь именно ЕГО, а не абстрактную картинку.
    // Разворачиваем задней частью (глубиной) к БЛИЖАЙШЕЙ задней стене —
    // I.floorOrient(), та же эвристика, что теперь используется и при
    // фактической расстановке (drawItemInto), чтобы силуэт в руке не
    // отличался от того, как предмет ляжет на пол.
    drawGhost(g) {
      const p = this.drag.p;
      if (!p) return;

      if (this.drag.kind === 'supply') { this.ghostImg.setVisible(false); this.drawSupplyGhostIcon(g, p); return; }

      const it = D.ITEMS[this.drag.iid];
      // настенное/потолочное/поверхностное — своих габаритов нет, спрайтовый
      // призрак (ghostImg) им тоже не положен, тот же обезличенный пузырь.
      if (!it || !it.s) { this.ghostImg.setVisible(false); this.drawSupplyGhostIcon(g, p); return; }

      // Призрак показывает точку ПОСЛЕ floorSnap — иначе у стены он висел бы
      // там, где палец, а фактическая постановка (onUp, input.js) молча
      // доводила бы предмет чуть в сторону: WYSIWYG сорван.
      const [ux, uy] = I.unP(p[0], p[1]);
      const { x: wx, y: wy } = I.floorSnap(it, ux, uy);
      const [w, d] = I.floorOrient(it, wx, wy);
      const h = it.s[2];
      const poly = (pts, fill, fa, stroke, sw, close) => this.polyOn(g, pts, fill, fa, stroke, sw, close);
      const FS = root.FURN_SPRITES;
      const state = this.furnitureSprites && FS && FS.pickState(this.drag.iid, 'new');
      if (state) {
        // Тот же спрайт, масштаб, опорная точка (перед, не центр) и
        // разворот-зеркало, что и у уже стоящего предмета
        // (drawFloorItemInto, room/itemsRender.js) — призрак должен
        // WYSIWYG-совпадать с тем, что окажется на полу после отпускания.
        // Формулы те же, см. подробные комментарии там же.
        const key = FS.textureKey(this.drag.iid, state);
        const src = this.textures.get(key).getSourceImage();
        const targetW = (w + d) * I.PROJ.TW;
        const targetH = (w + d) * I.PROJ.TH + h * I.PROJ.ZH;
        const scale = Math.min(targetW / src.width, targetH / src.height);
        const rot = wx <= wy, depFull = rot ? w : d;
        const front = rot ? [wx + depFull / 2, wy] : [wx, wy + depFull / 2];
        const anchor = I.P(front[0], front[1]);
        this.ghostImg.setTexture(key).setVisible(true).setAlpha(0.88)
          .setScale(scale).setPosition(anchor[0], anchor[1]).setFlipX(!rot);
      } else {
        this.ghostImg.setVisible(false);
        const shapes = root.ITEM_SHAPES;
        if (shapes && shapes.has(this.drag.iid)) {
          shapes.draw(this.drag.iid, { g, poly, cx: wx, cy: wy, w, d, h, I, COL });
        } else {
          const A = [wx - w / 2, wy - d / 2], B = [wx + w / 2, wy - d / 2];
          const C = [wx + w / 2, wy + d / 2], E = [wx - w / 2, wy + d / 2];
          poly([I.P(B[0], B[1]), I.P(C[0], C[1]), I.P(C[0], C[1], h), I.P(B[0], B[1], h)], COL.chalk, 0.10, COL.chalk, 1);
          poly([I.P(E[0], E[1]), I.P(C[0], C[1]), I.P(C[0], C[1], h), I.P(E[0], E[1], h)], COL.chalk, 0.05, COL.chalk, 1);
          poly([I.P(A[0], A[1], h), I.P(B[0], B[1], h), I.P(C[0], C[1], h), I.P(E[0], E[1], h)], COL.chalk, 0.17, COL.chalk, 1);
        }
      }
      // метка-перекрестье в точке касания — предмет теперь большой, крестик
      // у самого пальца всё равно полезен для точности
      const anchor = I.P(wx, wy);
      g.lineStyle(1.2, COL.amber, 0.9);
      g.lineBetween(anchor[0] - 6, anchor[1], anchor[0] + 6, anchor[1]);
      g.lineBetween(anchor[0], anchor[1] - 6, anchor[0], anchor[1] + 6);

      // Причина отказа / след подхода — свободная расстановка, зоны для
      // наведения больше нет: считаем reject прямо для точки под пальцем.
      // drag.from (свой iid при перестановке уже стоящего предмета)
      // исключает сам предмет из проверки на пересечение с самим собой.
      const F = I.PROJ.F;
      const labelAnchor = I.P(wx, wy, h + 0.25);
      const reason = I.rejectFloor(wx, wy, it, this.st, D.ITEMS, F, this.LAY, this.drag.from);
      if (reason) {
        this.tUI.put(labelAnchor[0], labelAnchor[1] - 6, reason, 9, '#E8A33D', 'center');
      } else if (it.touch) {
        // след лапы — где коту стоять, чтобы дотянуться до предмета здесь
        const [ax, ay] = I.nearSpot(this.NAV, wx, wy);
        const pp = I.P(ax, ay);
        g.fillStyle(COL.amber, 0.5); g.fillCircle(pp[0], pp[1], 4);
        g.lineStyle(1, COL.amber, 0.9); g.strokeCircle(pp[0], pp[1], 4);
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
