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
  const BG_DEPTH = -2;      // фоновая панорама комнаты — под сеткой
  const SHELL_DEPTH = -1;   // пол, стены, проёмы, проходимость (debug)
  const ZONE_DEPTH = -0.5;  // подсветка пустых зон при драге — под предметами,
                             // но взаимоисключающе с ними (заняты либо зона, либо предмет)
  const TEXT_DEPTH = 1000;  // все надписи комнаты — всегда поверх боксов предметов
  const CEIL_DEPTH = 900;   // потолочный подвес — выше обычных предметов
  const UI_DEPTH = 10000;   // нижние панели/HUD — всегда поверх сцены
  const UI_TEXT_DEPTH = 10001;

  // Арт кота — калибровано под исходники ~300px при params.zoom=1 (floor 8).
  // Не константа: кот должен расти вместе с комнатой при приближении сцены
  // (params.zoom), поэтому это БАЗА — реальный масштаб = CAT_ART_SCALE_BASE
  // * params.zoom, считается в create() (см. spawn кота), не тут.
  const CAT_ART_SCALE_BASE = 0.18;
  // На сколько единиц cat.ph нужно накопить на один кадр цикла ходьбы —
  // cat.ph растёт на 9/сек во время ходьбы (tick()), поэтому ~1.1 даёт
  // бодрый шаг без мельтешения кадров.
  const WALK_FRAME_STEP = 1.1;

  const clamp = I.clamp;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // Диапазоны движения двери/окна вдоль стены + вдоль примыкающего переднего
  // (открытого) края — один в один RANGE из исходного app.js: там же было
  // выяснено, где дверь/окно ещё не упираются в угол.
  const RANGE = { left: [0.6, 3.35], frontLeft: [1.8, 4.4], right: [0.4, 2.6], frontRight: [1.8, 4.2] };
  function nearestOnSeg(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = clamp(((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
    return { t, d: Math.hypot(a[0] + vx * t - px, a[1] + vy * t - py) };
  }

  function inPoly(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }

  // Какие файлы из sprites/<Персонаж>/ понадобятся движку — из конфига
  // персонажа: цикл ходьбы + по одному кадру на каждую из статичных поз, плюс
  // (не у всех есть) покадровая анимация игры. Список только тех кадров, что
  // реально названы в конфиге — лишние файлы в sprites/ (если есть) грузить
  // не нужно.
  function catFrameNames(cfg) {
    const set = new Set();
    (cfg.sprites.walk || []).forEach(f => set.add(f));
    ['idle', 'sit', 'lie', 'eatDig', 'jump'].forEach(k => { if (cfg.sprites[k]) set.add(cfg.sprites[k]); });
    // Любое поле sprites.* вида {frames,count,frameMs} — покадровая анимация
    // (у сиамского: playToy1/playToy2/playFed/playIdle) — собираем кадры
    // общим правилом, не перечисляя имена полей: новый персонаж или новый
    // триггер добавляется только в config.json, тут ничего не трогать.
    Object.values(cfg.sprites).forEach(v => {
      if (v && typeof v === 'object' && v.frames && v.count) {
        for (let i = 0; i < v.count; i++) set.add(v.frames + '_' + i);
      }
    });
    return [...set];
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
      // Cats/manifest.json перечисляет папки-персонажей — сами config.json
      // (и тем более PNG из sprites/, чей список кадров вообще не известен
      // заранее) на этом этапе ещё грузить нельзя: их пути зависят от
      // содержимого манифеста, который сам ещё не пришёл.
      this.load.json('catManifest', 'Cats/manifest.json');
      // Фоновая арт-панорама комнаты — тот же кадр 9:16, что и канвас
      // (819×1456 = 540×960), поэтому ложится на весь канвас без перекоса и
      // совпадает по перспективе со стенами/полом, которые рисует drawShell().
      this.load.image('roomBg', 'art/room_bg.jpg');
    }

    // Персонажи кота грузятся в 3 прохода, каждый — заново запущенный
    // this.load.start() из ПОЛНОСТЬЮ осевшего состояния загрузчика (а не
    // дозапись очереди из середины текущего прохода — так и пробовали
    // сначала, официальный на вид приём 'дописывать в filecomplete' в этой
    // версии Phaser файлы в список кладёт, но так и не начинает их
    // качать — зависает без единой ошибки в консоли, поймано только через
    // scene.load.state/list в консоли браузера, не по логам):
    //   1) preload(): манифест + сама сцена (create() ждёт этого сам, штатно)
    //   2) create(): манифест уже есть → грузим config.json персонажей
    //   3) их callback: конфиги уже есть → знаем имена кадров → грузим PNG
    // Только после (3) — весь остальной прежний create() (комната/кот/UI/ввод).
    create() {
      this.catNames = this.cache.json.get('catManifest');
      this.load.once('complete', () => this.createStep2LoadImages());
      this.catNames.forEach(name => this.load.json('catcfg-' + name, `Cats/${name}/config.json`));
      this.load.start();
    }

    // ~70 отдельных PNG (по кадрам, названным в конфигах персонажей) — через
    // this.load.image()+load.start() зависает без ошибок где-то на 32-м файле
    // (похоже на maxParallelDownloads Phaser'а: первая пачка догружается,
    // очередь из list в queue/inflight дальше сама не переливается). Вместо
    // борьбы с этим — обычные браузерные Image, у них такого лимита нет,
    // регистрируем в Phaser вручную через textures.addImage().
    createStep2LoadImages() {
      const jobs = [];
      this.catNames.forEach(name => {
        const cfg = this.cache.json.get('catcfg-' + name);
        catFrameNames(cfg).forEach(fn => {
          jobs.push({ key: `cat_${name}_${fn}`, url: `Cats/${name}/sprites/${fn}.png` });
        });
      });
      let remaining = jobs.length;
      const done = () => { if (--remaining <= 0) this.createStep3Finish(); };
      if (!remaining) { this.createStep3Finish(); return; }
      jobs.forEach(job => {
        const img = new Image();
        img.onload = () => { this.textures.addImage(job.key, img); done(); };
        img.onerror = () => { console.error('не загрузился кадр кота:', job.url); done(); };
        img.src = job.url;
      });
    }

    createStep3Finish() {
      // состояние сцены — копия конфига, чтобы не портить загруженный JSON
      const s = this.cache.json.get(this.sceneName);
      this.st = {
        door: { ...s.door }, win: { ...s.win },
        light: { ...s.light }, place: { ...s.place }
      };
      this.params = { ...s.params };

      // Какой персонаж активен сейчас — первый по списку при старте.
      // Скорость/частоты поведения берутся из конфига активного персонажа
      // при каждом обращении (activeCatConfig()), не кэшируются отдельно,
      // кроме this.catSpeed — он читается в tick() на каждом кадре, дешевле
      // держать под рукой.
      this.catCharacter = this.catNames[0];
      this.catSpeed = this.activeCatConfig().speed;

      this.cat = {
        x: s.cat.x, y: s.cat.y, st: 'idle', t: 1, ph: 0, dir: 1,
        path: [], after: null, bubble: null, bt: 0, jump: 0, stateElapsedMs: 0,
        // playSegment — какое поле sprites.* сейчас проигрывается покадрово
        // (playToy1/playToy2/playFed у сиамского), null — обычная статичная
        // поза. lastPlayAt — когда в последний раз играли игрушкой, для
        // различения «первый раз» (playToy1) и «снова в течение 5с» (playToy2).
        playSegment: null, lastPlayAt: -Infinity
      };
      this.mood = 62; this.fish = 1247; this.gems = 12;
      this.mode = 'view';
      this.pageInv = 0; this.pageSup = 0;
      this.showWalk = false; this.showLabels = DEBUG; this.showEmpty = DEBUG; this.catOn = true;
      this.drag = null;
      this.openingDrag = null; // 'door' | 'window' | null — см. dragOpening()
      this.uiDirty = true;
      this.shellDirty = true;

      // --- слои: фон-панорама, оболочка сцены, подсветка пустых зон при
      // драге, кот, пул предметов (по одному Graphics+Text на занятую зону),
      // UI поверх всего ---
      this.add.image(0, 0, 'roomBg').setOrigin(0, 0)
        .setDisplaySize(SCREEN_W, SCREEN_H).setDepth(BG_DEPTH);
      this.gShell = this.add.graphics().setDepth(SHELL_DEPTH);
      this.tShell = new TextPool(this, TEXT_DEPTH);
      this.zoneGfx = this.add.graphics().setDepth(ZONE_DEPTH);
      this.tZones = new TextPool(this, TEXT_DEPTH);
      // Кот — спрайт (Image), не векторная фигура: тень/реплика остаются на
      // отдельном Graphics чуть позади него.
      this.gCat = this.add.graphics().setDepth(0);
      this.catImg = this.add.image(0, 0, this.catFrameKey(this.activeCatConfig().sprites.idle))
        .setOrigin(0.5, 1)
        .setScale(CAT_ART_SCALE_BASE * this.params.zoom);
      this.tBubble = null;
      this.itemGfx = new Map(); // zid -> { g: Graphics, t: Text|null }
      this.gUI = this.add.graphics().setDepth(UI_DEPTH);
      this.tUI = new TextPool(this, UI_TEXT_DEPTH);

      this.rebuild();

      // Переход в/из полного экрана — асинхронный (сам браузер решает, когда
      // его завершить), иконку ⤢/⤡ обновляем по факту через это событие, не
      // сразу по клику.
      document.addEventListener('fullscreenchange', () => { this.uiDirty = true; });

      this.input.on('pointerdown', p => this.onDown(p));
      this.input.on('pointermove', p => {
        if (this.openingDrag) { this.dragOpening(p.worldX, p.worldY); return; }
        if (this.drag) { this.drag.p = [p.worldX, p.worldY]; }
      });
      this.input.on('pointerup', p => {
        if (this.openingDrag) { this.openingDrag = null; return; }
        this.onUp(p);
      });

      this.idleCycle();
    }

    /* ---------- персонажи кота ---------- */
    activeCatConfig() { return this.cache.json.get('catcfg-' + this.catCharacter); }
    catFrameKey(frameName) { return `cat_${this.catCharacter}_${frameName}`; }
    // Кнопка в нижнем правом меню (см. drawUI/onDown) — цикличное
    // переключение, не отдельный экран выбора: персонажей мало, и так проще.
    cycleCatCharacter() {
      const i = this.catNames.indexOf(this.catCharacter);
      this.catCharacter = this.catNames[(i + 1) % this.catNames.length];
      this.catSpeed = this.activeCatConfig().speed;
      this.uiDirty = true;
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
    }

    // Геометрия проёмов — общая для отрисовки (drawShell) и хит-теста
    // (hitDoor/hitWindow), чтобы клик и рисунок никогда не разошлись.
    doorPoly() {
      const F = I.PROJ.F, d0 = this.st.door.pos, d1 = d0 + DOOR_W;
      return this.st.door.side === 'left'
        ? [I.P(0, d0), I.P(0, d1), I.P(0, d1, DOOR_H), I.P(0, d0, DOOR_H)]
        : [I.P(d0, F), I.P(d1, F), I.P(d1, F, DOOR_H), I.P(d0, F, DOOR_H)];
    }
    winPoly() {
      const F = I.PROJ.F, w0 = this.st.win.pos, w1 = w0 + WIN_W;
      return this.st.win.side === 'right'
        ? [I.P(w0, 0, WIN_Z0), I.P(w1, 0, WIN_Z0), I.P(w1, 0, WIN_Z1), I.P(w0, 0, WIN_Z1)]
        : [I.P(F, w0, 0.08), I.P(F, w1, 0.08), I.P(F, w1, STUB), I.P(F, w0, STUB)];
    }
    hitDoor(x, y) { return inPoly([x, y], this.doorPoly()); }
    hitWindow(x, y) { return inPoly([x, y], this.winPoly()); }

    // Точка крепления лампы/люстры на потолке — тот же квадрат-подсказка,
    // что уже рисовался в drawZoneOverlay (амбер-рамка вокруг this.st.light),
    // теперь ещё и хватается/двигается, как дверь/окно.
    lightPoly() {
      const L = this.st.light;
      return [I.P(L.x - .5, L.y - .5, WALL), I.P(L.x + .5, L.y - .5, WALL),
      I.P(L.x + .5, L.y + .5, WALL), I.P(L.x - .5, L.y + .5, WALL)];
    }
    hitLight(x, y) { return inPoly([x, y], this.lightPoly()); }
    // Обратная проекция для точки НА ПОТОЛКЕ (z=WALL), не на полу (z=0) —
    // I.unP этого не умеет (только пол), поэтому та же поправка на WALL*ZH,
    // что была в light-ветке startMove() исходного app.js.
    unProjectCeil(sx, sy) {
      const u = (sx - OX) / I.PROJ.TW, v = (sy - I.PROJ.OY + WALL * I.PROJ.ZH) / I.PROJ.TH;
      return [(u + v) / 2, (v - u) / 2];
    }

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

    /* ==================== ПОДСВЕТКА ПУСТЫХ ЗОН ПРИ ДРАГЕ ====================
       Единственный слой, который по-прежнему перерисовывается каждый кадр —
       но это лёгкая операция (пара десятков контуров зон, без стен/предметов),
       и раньше она уже была условной (showEmpty || placing). Показывается
       ТОЛЬКО когда предмет уже взят в руку (или включён debug-тумблер);
       открытие инвентаря само по себе ничего на полу не подсвечивает —
       легальность зависит от предмета, а не от факта открытия меню. */
    drawZoneOverlay() {
      const g = this.zoneGfx, F = I.PROJ.F;
      g.clear();
      // Драг корма/игрушки (kind:'supply') целится в кота/миску/пол, а не в
      // зону по I.reject — подсветка «легальных зон» тут смысла не имеет и
      // D.ITEMS[iid] для него не существует (это D.SUPPLIES), поэтому не
      // считаем legal вовсе.
      const placing = !!this.drag && this.drag.kind !== 'supply';
      const active = this.showEmpty || !!this.drag;
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
        // Точка крепления лампы больше не рисуется тут — переехала в
        // drawShell() (lightPoly()), т.к. теперь она ещё и двигается, как
        // дверь/окно (см. hitLight/dragOpening), и должна быть видна не
        // только при showEmpty/драге, а всегда, пока открыт инвентарь.
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
       нормально: спрайт + маленькая тень/реплика, не вся сцена. Глубина —
       cat.x+cat.y, та же шкала, что и I.depth() у предметов, так что Phaser
       сам вставляет кота в правильное место между их GameObject'ами.

       Арт — спрайты активного персонажа (this.catCharacter, Cats/<Имя>/), не
       векторная фигура: за то, какой файл из sprites/ показывать в каком
       состоянии, отвечает конфиг персонажа (activeCatConfig().sprites), не
       код тут — чтобы завести нового кота, код менять не нужно. Состояния,
       для которых в конфиге всего один статичный кадр (idle/sit/lie/eatDig),
       так и остаются статичными позами — как и раньше у векторной фигуры,
       различие между ними только в том, какая поза выбрана и лёгком покачивании
       на eat/dig. Только у walk честный цикл кадров, и опционально (сейчас —
       только у сиамского) у jump/игры — покадровая анимация sprites.play. */
    updateCatVisual() {
      const g = this.gCat;
      g.clear();
      if (!this.catOn) {
        this.catImg.setVisible(false);
        if (this.tBubble) this.tBubble.setVisible(false);
        return;
      }
      this.catImg.setVisible(true);
      const cat = this.cat;
      const sprites = this.activeCatConfig().sprites;
      const b = I.P(cat.x, cat.y);
      const depth = cat.x + cat.y;

      // «Натуральная» (нефлипнутая) поза кадров sprites.walk смотрит влево на
      // экране — тот же вывод, что уже делали на арте redfat/siamese в
      // phaser-game: там для обоих скинов «смотрит влево» = не флипаем,
      // «вправо» = флипаем. Проверено визуально: dir=1 (движение вправо) без
      // флипа кот шёл задом (мордой влево при движении вправо).
      let frameName, bobY = 0, flip = cat.dir > 0;
      switch (cat.st) {
        case 'walk': {
          const frames = sprites.walk;
          frameName = frames[Math.floor(cat.ph / WALK_FRAME_STEP) % frames.length];
          break;
        }
        case 'sit':
          frameName = sprites.sit;
          break;
        case 'lie':
          frameName = sprites.lie;
          break;
        case 'eat':
        case 'dig': {
          // cat.playSegment === 'playFed' только когда покормили именно «с
          // руки» (feedHand) — у feedBowl/feedFloor он остаётся null (сброшен
          // в setSt), там всегда обычная статичная поза с покачиванием.
          const seg = cat.playSegment && sprites[cat.playSegment];
          if (seg) {
            const idx = Math.min(seg.count - 1, Math.floor(cat.stateElapsedMs / seg.frameMs));
            frameName = seg.frames + '_' + idx;
            flip = false;
          } else {
            frameName = sprites.eatDig;
            bobY = Math.sin(performance.now() / 90) * 2;
          }
          break;
        }
        case 'jump': {
          const seg = cat.playSegment && sprites[cat.playSegment];
          if (seg) {
            const idx = Math.min(seg.count - 1, Math.floor(cat.stateElapsedMs / seg.frameMs));
            frameName = seg.frames + '_' + idx;
            flip = false; // покадровая анимация игры/еды всегда анфас, не зеркалим
          } else {
            frameName = sprites.jump;
            bobY = -Math.abs(Math.sin(performance.now() / 140)) * 10;
          }
          break;
        }
        default:
          frameName = sprites.idle;
      }

      this.catImg.setTexture(this.catFrameKey(frameName));
      this.catImg.setFlipX(flip);
      this.catImg.setPosition(b[0], b[1] + bobY);
      this.catImg.setDepth(depth);

      // тень и реплика — по-прежнему векторные, чуть позади спрайта
      g.setDepth(depth - 0.001);
      g.fillStyle(0x000000, 0.32);
      g.fillEllipse(b[0], b[1], 26, 26 * (I.PROJ.tilt || 0.5));

      if (cat.bubble) {
        const tw = cat.bubble.length * 5.6 + 18, bx = b[0] - tw / 2, by = b[1] - 58 + bobY;
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
        { id: 'quests', l: 'Задания' }, { id: 'shop', l: 'Магазин' },
        // Раньше «—» (заглушка) — теперь выбор персонажа: тап переключает на
        // следующего по списку из Cats/manifest.json, подпись — имя текущего.
        { id: 'character', l: this.activeCatConfig().name }
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

      // Кнопка полного экрана — постоянная иконка в углу HUD, как в исходном
      // app.js (там она открывала canvas.requestFullscreen()); тут то же
      // самое через Phaser ScaleManager. Не тумблер в настройках — всегда на
      // виду и всегда кликабельна, независимо от текущего режима (см. onDown).
      const fr = this.fullscreenBtnRect();
      g.fillStyle(COL.chalk, 0.08); g.fillRoundedRect(fr.x, fr.y, fr.w, fr.h, 8);
      g.lineStyle(1.2, COL.chalk, 0.35); g.strokeRoundedRect(fr.x, fr.y, fr.w, fr.h, 8);
      this.tUI.put(fr.x + fr.w / 2, fr.y + fr.h / 2, document.fullscreenElement ? '⤡' : '⤢', 14, '#EBE2D5cc', 'center');
    }

    fullscreenBtnRect() { return { x: 504, y: 42, w: 28, h: 28 }; }
    hitFullscreenBtn(x, y) {
      const r = this.fullscreenBtnRect();
      return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
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

      // Причина отказа / след подхода — только для мебели (kind !== 'supply');
      // у корма/игрушки нет понятия «легальной зоны», D.ITEMS[iid] для него и
      // не существует (это D.SUPPLIES). Куда его донесли — решает
      // resolveSupplyDrop в onUp, тут только визуальный призрак.
      if (this.drag.kind === 'supply') return;
      // Причина отказа / след подхода — для зоны прямо под призраком сейчас.
      // I.reject уже считался для подсветки зон (drawZoneOverlay), тут просто
      // берём его результат для ОДНОЙ конкретной наведённой зоны и показываем.
      const it = D.ITEMS[this.drag.iid], F = I.PROJ.F;
      const hover = this.zones.find(z =>
        (!this.st.place[z.id] || z.id === this.drag.from) && inPoly([p[0], p[1]], I.zonePoly(z, F)));
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
            if (idsR[i] === 'character') { this.cycleCatCharacter(); return; }
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
      // (rebuild()/удаление из place — не тут, а в onUp по факту отпускания),
      // и его можно либо перенести на новую легальную зону, либо вернуть в
      // инвентарь, отпустив над правой панелью (см. onUp). Перебор от ближних
      // к зрителю, чтобы попадать в то, что сверху.
      if (this.mode === 'inventory' && !this.drag) {
        const placed = Object.keys(this.st.place)
          .filter(k => k !== 'CEIL' && this.zmap[k])
          .sort((a, b) => I.depth(this.zmap, b) - I.depth(this.zmap, a));
        for (const zid of placed) {
          if (inPoly([x, y], I.zonePoly(this.zmap[zid], I.PROJ.F))) {
            this.drag = { kind: 'existing', from: zid, iid: this.st.place[zid], p: [x, y] };
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
    }

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

      // Существующий предмет, отпущенный над правой панелью (там всё ещё
      // список инвентаря, т.к. режим не менялся) — вернуть в инвентарь.
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
    }

    // shellDirty тоже — крепление лампы в drawShell рисуется только пока
    // mode==='inventory', так что вход/выход из инвентаря обязан перерисовать
    // оболочку, не только UI.
    setMode(m) { this.mode = m; this.drag = null; this.ui = this.panelGeo(); this.uiDirty = true; this.shellDirty = true; }

    /* ==================== ПОВЕДЕНИЕ КОТА ====================
       Тайминги/вероятности — из behavior активного персонажа
       (Cats/<Имя>/config.json), не константы в коде: чтобы завести другого
       кота с другим темпераментом, менять этот файл, а не JS. */
    // playSegment сбрасывается тут по умолчанию на КАЖДЫЙ переход состояния —
    // playHand()/feedHand() выставляют его сами СРАЗУ ПОСЛЕ вызова setSt (не
    // до), иначе обычное кормление из миски/пола (feedBowl/feedFloor тоже
    // зовут setSt('eat'/'dig',...)) унаследовало бы чужую покадровую
    // анимацию «с руки» от предыдущего раза.
    setSt(st, t, after) {
      this.cat.st = st; this.cat.t = t; this.cat.after = after || null;
      this.cat.stateElapsedMs = 0; this.cat.playSegment = null;
    }
    bubble(txt, dur) { this.cat.bubble = txt; this.cat.bt = dur || 3.2; }

    walkTo(x, y, after) {
      const p = I.findPath(this.NAV, this.cat.x, this.cat.y, x, y);
      if (!p.length) { this.setSt('idle', 1.2, after); return; }
      this.cat.path = p; this.setSt('walk', 99, after);
    }
    idleCycle() {
      const B = this.activeCatConfig().behavior;
      this.setSt('idle', rnd(B.idleMinS, B.idleMaxS), () => this.decideNext());
    }
    decideNext() {
      const B = this.activeCatConfig().behavior;
      const r = Math.random();
      if (r < B.wanderChance) this.wander();
      else if (r < B.wanderChance + B.sitChance) this.setSt('sit', rnd(B.sitMinS, B.sitMaxS), () => this.afterRest());
      else this.setSt('lie', rnd(B.lieMinS, B.lieMaxS), () => this.afterRest());
    }
    afterRest() {
      const B = this.activeCatConfig().behavior;
      if (Math.random() < B.restWanderChance) this.wander(); else this.idleCycle();
    }
    wander() {
      const s = I.randomSpot(this.NAV, this.cat, 1.2);
      if (!s) { this.setSt('idle', 2, () => this.idleCycle()); return; }
      this.walkTo(s[0], s[1], () => this.idleCycle());
    }
    // Игрушка — если у персонажа есть покадровая анимация (playToy1/playToy2,
    // сейчас только у сиамского): первое взаимодействие — playToy1, второе В
    // ТЕЧЕНИЕ 5 СЕКУНД после первого — playToy2, дальше по кругу третье уже
    // снова считается «первым» (5с успели истечь). У персонажа без такого
    // арта (рыжий) — как раньше, статичная поза с подскоком, 1.6с.
    playHand() {
      const sprites = this.activeCatConfig().sprites;
      const now = performance.now();
      const withinWindow = now - this.cat.lastPlayAt < 5000;
      const seg = withinWindow && sprites.playToy2 ? 'playToy2' : (sprites.playToy1 ? 'playToy1' : null);
      this.cat.lastPlayAt = now;
      const anim = seg && sprites[seg];
      const dur = anim ? (anim.count * anim.frameMs) / 1000 : 1.6;
      this.cat.path = []; this.cat.jump = 3;
      this.setSt('jump', dur, () => {
        this.bubble(pick(D.SAY.toy)); this.mood = clamp(this.mood + 5, 0, 100);
        this.uiDirty = true; this.idleCycle();
      });
      this.cat.playSegment = seg; // после setSt — она сама сбрасывает playSegment в null
    }
    // Прямой тап по коту (не через донесённую игрушку) — отдельная анимация
    // (playIdle, кадры 1-38 исходного GIF), не playToy1/playToy2: это разные
    // ситуации — там «поиграли игрушкой», тут просто погладили/тронули.
    // lastPlayAt/окно 5с игрушки этот тап не трогает и не сбрасывает.
    petCat() {
      const anim = this.activeCatConfig().sprites.playIdle;
      const dur = anim ? (anim.count * anim.frameMs) / 1000 : 1.6;
      this.cat.path = []; this.cat.jump = 3;
      this.setSt('jump', dur, () => {
        this.bubble(pick(D.SAY.toy)); this.mood = clamp(this.mood + 5, 0, 100);
        this.uiDirty = true; this.idleCycle();
      });
      this.cat.playSegment = anim ? 'playIdle' : null;
    }
    // Корм/игрушка из «Запасов» — перенос drag'а из исходного app.js: берём в
    // руку (onDown уже завёл this.drag={kind:'supply',...}), тащим, и то, КУДА
    // донесли, решает, что произойдёт (см. resolveSupplyDrop, вызывается из
    // onUp). Одним тапом больше ничего не срабатывает.
    // Кормление «с руки» (еду донесли до кота, не до миски/пола) — если у
    // персонажа есть покадровая анимация (playFed, сейчас только у
    // сиамского), играем её; иначе как раньше — статичная поза с покачиванием.
    // feedBowl/feedFloor намеренно этим не пользуются: там кот ест из миски
    // или закапывает на полу, не «с руки» — своя, отдельная от play-арта
    // ситуация, даже когда она тоже заканчивается состоянием 'eat'/'dig'.
    feedHand() {
      const anim = this.activeCatConfig().sprites.playFed;
      const dur = anim ? (anim.count * anim.frameMs) / 1000 : 1.8;
      this.cat.path = [];
      this.bubble(pick(D.SAY.hand));
      this.setSt('eat', dur, () => {
        this.mood = clamp(this.mood + 8, 0, 100); this.uiDirty = true; this.idleCycle();
      });
      this.cat.playSegment = anim ? 'playFed' : null;
    }
    feedFloor(x, y) {
      this.bubble(pick(D.SAY.floor));
      const sp = I.nearSpot(this.NAV, x, y);
      this.walkTo(sp[0], sp[1], () => {
        this.setSt('dig', 2.2, () => {
          this.bubble(pick(D.SAY.buried));
          this.mood = clamp(this.mood - 6, 0, 100); this.uiDirty = true; this.idleCycle();
        });
      });
    }
    feedBowl() {
      const zid = Object.keys(this.st.place).find(k => this.st.place[k] === 'bowls');
      const f = zid ? I.footprint(this.zmap, D.ITEMS, zid, 'bowls') : null;
      if (!f) { this.bubble(pick(D.SAY.floor)); return; }
      const sp = I.nearSpot(this.NAV, f.c[0], f.c[1]);
      this.walkTo(sp[0], sp[1], () => {
        this.bubble(pick(D.SAY.bowl));
        this.setSt('eat', 2, () => {
          this.mood = clamp(this.mood + 10, 0, 100); this.uiDirty = true; this.idleCycle();
        });
      });
    }
    // Куда донесли корм/игрушку — тот же разбор случаев, что в endDrag
    // исходного app.js: на кота — покормить с руки (корм) или поиграть
    // (игрушка); на миски — к миске; на любой пол — закопать. Игрушка,
    // брошенная не рядом с котом, не срабатывает вовсе — по просьбе заказчика
    // (в отличие от исходника, где она играла с любой зоны).
    resolveSupplyDrop(x, y) {
      const sup = D.SUPPLIES[this.drag.iid];
      const cp = I.P(this.cat.x, this.cat.y);
      const onCat = this.catOn && Math.hypot(x - cp[0], y - cp[1]) < 46;
      if (onCat) {
        this.setMode('view');
        if (sup.food) this.feedHand(); else this.playHand();
        return;
      }
      if (!sup.food) return;
      const F = I.PROJ.F;
      const zp = this.zones.find(z => inPoly([x, y], I.zonePoly(z, F)));
      if (!zp) return;
      this.setMode('view');
      if (this.st.place[zp.id] === 'bowls') { this.feedBowl(); return; }
      if (['back', 'mid', 'front'].includes(zp.band)) {
        const [tx, ty] = I.unP(x, y);
        this.feedFloor(tx, ty);
      }
    }

    tick(dt) {
      const cat = this.cat;
      if (cat.bt > 0) { cat.bt -= dt; if (cat.bt <= 0) cat.bubble = null; }
      if (!this.catOn) return;
      cat.stateElapsedMs += dt * 1000;
      cat.ph += dt * (cat.st === 'walk' ? 9 : cat.st === 'dig' ? 14 : 2);

      if (cat.st === 'walk') {
        if (!cat.path.length) {
          const f = cat.after; cat.after = null;
          if (f) f(); else this.idleCycle();
          return;
        }
        const [tx, ty] = cat.path[0];
        const dx = tx - cat.x, dy = ty - cat.y, dist = Math.hypot(dx, dy);
        const sp = this.catSpeed * dt;
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
      // create() теперь сразу возвращается и грузит конфиги/картинки кота
      // асинхронной цепочкой (createStep2.../createStep3Finish) — Phaser же
      // считает сцену запущенной и зовёт update() каждый кадр всё это время,
      // до того как this.cat вообще появится. Без охраны здесь падает на
      // самом первом кадре (this.cat.bt у ещё не созданного this.cat).
      if (!this.cat) return;
      const dt = Math.min(delta, 60) / 1000;
      this.tick(dt);
      if (this.shellDirty) { this.drawShell(); this.shellDirty = false; }
      this.drawZoneOverlay();
      this.updateCatVisual();
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
