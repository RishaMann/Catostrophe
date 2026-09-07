/* ============================================================================
   game.js — точка входа. Собирает RoomScene из миксинов (render/constants.js,
   util.js, room/shell.js, room/itemsRender.js, room/lighting.js,
   cat/catAppearance.js, cat/catBehavior.js, ui/hud.js, input.js) и запускает
   Phaser.Game. Сама
   логика отрисовки/поведения — в этих файлах; тут только жизненный цикл
   сцены (preload/create/update) и каскадная загрузка кота (манифест →
   конфиги персонажей → только те PNG, что реально названы в sprites.*).
   ========================================================================== */
(function () {
  'use strict';

  const I = window.ISO;
  const { SCREEN_W, SCREEN_H } = I;
  const { DEBUG, CAT_ART_SCALE_BASE, BG_DEPTH, SHELL_DEPTH, ZONE_DEPTH, SHADOW_DEPTH, GLOW_DEPTH, TEXT_DEPTH, CEIL_DEPTH, UI_DEPTH, UI_TEXT_DEPTH } = window.RCFG;
  const { TextPool, catFrameNames } = window.GUTIL;

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
      // Варианты на выбор — переключаются в «Настройки» (см. drawSettings в
      // ui/hud.js, cycleBackground ниже): исходный тёплый вечер, тёмный
      // ночной (под него как раз и рассчитана динамическая подсветка,
      // room/lighting.js — на тёплом фоне со своим встроенным светом её почти
      // не видно) и светлый дневной, пустой (Documentation/References/
      // back.png — без нарисованных окна/двери, только стены и пол).
      this.load.image('roomBg', 'art/room_bg.jpg');
      this.load.image('roomBg2', 'art/room_bg_2.jpg');
      this.load.image('roomBg3', 'art/room_bg3.jpg');
      // Спрайтовая мебель (второй режим отрисовки, переключается в
      // «Настройки») — манифест перечисляет, у каких id каталога есть
      // вырезанные картинки и в каких состояниях (см. room/furnitureSprites.js
      // и Furniture/manifest.json); сами PNG грузятся ниже, в
      // createStep2LoadImages(), после того как манифест точно пришёл.
      this.load.json('furnManifest', 'Furniture/manifest.json');
      // Закоммиченный базовый слой ручных правок AssetGeometry (см. шапку
      // room/assetGeometry.js) — расшаренный между origin'ами источник
      // истины, localStorage поверх него — черновой слой текущей сессии.
      this.load.json('assetGeometryData', 'src/room/assetGeometryData.json');
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
      window.AssetGeometry.seedBase(this.cache.json.get('assetGeometryData') || {});
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
      window.FURN_SPRITES.setManifest(this.cache.json.get('furnManifest'));
      const jobs = [...window.FURN_SPRITES.jobs('Furniture/')];
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
        door: { ...s.door }, win: { ...s.win }, light: { ...s.light },
        place: { ...s.place },
        // floor — свободная расстановка мебели (iid -> {x,y}), отдельно от
        // place (стены/потолок/поверхности, конечный список зон, см. iso.js).
        floor: Object.fromEntries(Object.entries(s.floor || {}).map(([iid, pos]) => [iid, { ...pos }])),
        // placeState — состояние спрайта настенного предмета (zid -> 'new'/
        // 'afterGag', см. FURN_SPRITES.pickState), отдельной картой: place
        // хранит просто iid строкой (см. iso.js), а не объект, дописывать
        // состояние прямо туда означало бы менять формат везде, где place
        // читают (listSource, input.js — сравнения строк). У floor-мебели
        // состояние своё, прямо в позиции (st.floor[iid].state) — там формат
        // и так объект.
        placeState: {}
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
        x: s.cat.x, y: s.cat.y, st: 'idle', t: 1, ph: 0, dir: 1, dir8: 'down',
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
      // Мебель из линий (процедурные силуэты, itemShapes.js) или из спрайтов
      // (вырезанные картинки, room/furnitureSprites.js) — тумблер в
      // «Настройки» (drawSettings/onDown). По умолчанию — прежнее поведение
      // (линии), спрайты — осознанный выбор.
      this.furnitureSprites = false;
      // Выключатель у двери (верхний свет) и тап по подставке торшера — оба
      // по умолчанию включены. См. room/lighting.js (collectLights) и
      // input.js (hitSwitch/тап по лампе).
      this.lightsOn = true; this.lampOn = true;
      // «Отладка предметов» (ui/assetGeometryEditor.js, MIXIN_ASSET_GEO_EDITOR)
      // — технический тумблер в «Настройки», не игровая механика.
      // geoSelected — {kind,entityId,iid} текущего редактируемого ассета
      // (кот/коробка) или null. geoDragTarget — 'anchor'|'sort'|null, что
      // сейчас тащит палец (см. pointermove/pointerup ниже).
      this.assetDebug = false;
      this.geoSelected = null;
      this.geoDragTarget = null;
      this.geoShowFrames = false;
      this.geoSaveFlashUntil = 0; // «вспышка» на кнопке Save после сохранения
      this.drag = null;
      this.listSwipeStart = null; // см. checkListSwipe (input.js)
      this.openingDrag = null; // 'door' | 'window' | null — см. dragOpening()
      this.uiDirty = true;
      this.shellDirty = true;

      // --- слои: фон-панорама, оболочка сцены, подсветка пустых зон при
      // драге, кот, пул предметов (по одному Graphics+Text на занятую зону),
      // UI поверх всего ---
      this.backgrounds = [
        { key: 'roomBg', ru: 'Тёплый вечер' },
        { key: 'roomBg2', ru: 'Тёмная ночь' },
        { key: 'roomBg3', ru: 'Светлый день' }
      ];
      this.bgIndex = 1; // тёмный ночной — под него сделана динамическая подсветка
      // Размер/положение (layoutBackground) выставляются позже, после
      // this.rebuild() — им нужен PROJ.OY, а его считает applyProj() внутри
      // rebuild()/buildScene(), не раньше.
      this.bgImg = this.add.image(0, 0, this.backgrounds[this.bgIndex].key).setOrigin(0, 0).setDepth(BG_DEPTH);
      this.gShell = this.add.graphics().setDepth(SHELL_DEPTH);
      this.tShell = new TextPool(this, TEXT_DEPTH);
      this.zoneGfx = this.add.graphics().setDepth(ZONE_DEPTH);
      this.tZones = new TextPool(this, TEXT_DEPTH);
      // Свет от торшера/лампочки/люстры (room/lighting.js) — тень лежит на
      // полу под предметами, свечение аддитивно поверх пола/стен/предметов и
      // кота. Пересобираются вместе с остальной сценой, из rebuild().
      this.gShadow = this.add.graphics().setDepth(SHADOW_DEPTH);
      this.gGlow = this.add.graphics().setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
      // Пиксельный дождь за стеклом (room/shell.js: rainVisible/updateRain) —
      // виден только пока стекло реально открыто (окно без шторы или штора в
      // открытом состоянии, см. rainVisible), поверх статичного дождя,
      // нарисованного художником прямо на спрайте окна/шторы — отсюда и
      // высокий depth (CEIL_DEPTH-50, выше любой мебели/стены, но ниже
      // текста/UI), и маска по фактическому стеклу (winPoly), а не весь
      // прямоугольник спрайта: дождь не должен вылезать на раму/подоконник.
      this.gRain = this.add.graphics().setDepth(CEIL_DEPTH - 50).setVisible(false);
      this.gRainMask = this.make.graphics({ x: 0, y: 0, add: false });
      this.gRain.setMask(this.gRainMask.createGeometryMask());
      // Кот — спрайт (Image), не векторная фигура: тень/реплика остаются на
      // отдельном Graphics чуть позади него.
      this.gCat = this.add.graphics().setDepth(0);
      this.catImg = this.add.image(0, 0, this.catFrameKey(this.activeCatConfig().sprites.idle))
        .setOrigin(0.5, 1)
        .setScale(CAT_ART_SCALE_BASE * this.params.zoom);
      this.tBubble = null;
      // Превью в панели выбора персонажа (drawCharacterPanel) — отдельный
      // Image, не catImg: показывает ПРОСМАТРИВАЕМОГО персонажа, который
      // может отличаться от активного до нажатия «Выбрать». Масштаб
      // фиксированный (не зависит от params.zoom) — это плашка в UI, не
      // объект сцены.
      this.catPreviewImg = this.add.image(0, 0, this.catFrameKey(this.activeCatConfig().sprites.idle))
        .setOrigin(0.5, 1).setScale(0.5).setVisible(false).setDepth(UI_DEPTH + 0.5);
      // Призрак переносимой спрайтовой мебели (drawGhost, ui/hud.js) — один
      // переиспользуемый Image, как catPreviewImg; '__DEFAULT' — служебная
      // текстура Phaser, реальную подставляет drawGhost перед показом.
      this.ghostImg = this.add.image(0, 0, '__DEFAULT').setOrigin(0.5, 1).setVisible(false).setDepth(UI_DEPTH + 0.3);
      // Миниатюры спрайтовой мебели в списке «Инвентарь» (drawList,
      // ui/hud.js) — по одной на видимую ячейку (их всегда 3, см. `per` в
      // drawList), поверх обычных векторных IC.drawIcon, только когда включён
      // спрайтовый режим и у предмета есть картинка.
      this.invIconImgs = [0, 1, 2].map(() =>
        this.add.image(0, 0, '__DEFAULT').setVisible(false).setDepth(UI_DEPTH + 0.5));
      // Онион-скин кадров цикла ходьбы в «Отладке предметов» (см.
      // ui/assetGeometryEditor.js: drawGeoOnionSkin) — 8 с запасом (реальные
      // циклы сейчас по 5-6 кадров, у 8-directional формата Labra свой цикл
      // на каждое направление, тоже укладывается).
      this.geoOnionImgs = Array.from({ length: 8 }, () =>
        this.add.image(0, 0, '__DEFAULT').setVisible(false).setDepth(UI_DEPTH + 0.4));
      this.itemGfx = new Map(); // zid/iid -> { g: Graphics, t: Text|null, img: Image|null }
      this.gUI = this.add.graphics().setDepth(UI_DEPTH);
      this.tUI = new TextPool(this, UI_TEXT_DEPTH);

      this.rebuild();
      this.layoutBackground();

      // Переход в/из полного экрана — асинхронный (сам браузер решает, когда
      // его завершить), иконку ⤢/⤡ обновляем по факту через это событие, не
      // сразу по клику.
      document.addEventListener('fullscreenchange', () => { this.uiDirty = true; });

      this.input.on('pointerdown', p => this.onDown(p));
      this.input.on('pointermove', p => {
        // Перетаскивание anchor/sort-хэндла в «Отладке предметов» —
        // приоритет выше обычного drag: это отдельный ввод поверх сцены,
        // не связан с this.drag (перенос мебели) вообще.
        if (this.geoDragTarget) { this.geoUpdateDrag(p.worldX, p.worldY); return; }
        if (this.openingDrag) { this.dragOpening(p.worldX, p.worldY); return; }
        if (this.drag) {
          this.drag.p = [p.worldX, p.worldY];
          this.checkListSwipe(p.worldX, p.worldY);
        }
      });
      this.input.on('pointerup', p => {
        if (this.geoDragTarget) { this.geoEndDrag(); return; }
        if (this.openingDrag) { this.openingDrag = null; return; }
        this.onUp(p);
      });

      this.idleCycle();
    }

    // Переключатель фона в «Настройки» (drawSettings/onDown, ui/hud.js и
    // input.js) — просто следующая по кругу текстура на уже существующем
    // Image, без пересоздания сцены. layoutBackground() пересчитывает размер/
    // положение — у разных картинок разное нативное разрешение.
    cycleBackground() {
      this.bgIndex = (this.bgIndex + 1) % this.backgrounds.length;
      this.bgImg.setTexture(this.backgrounds[this.bgIndex].key);
      this.layoutBackground();
      this.uiDirty = true;
    }

    // Фон — по всей ширине канваса БЕЗ отдельного растяжения по высоте
    // (раньше setDisplaySize(SCREEN_W,SCREEN_H) тянул картинку под ОБЕ
    // стороны канваса сразу — для панорам 819×1456, т.е. ровно 540×960,
    // это давало тот же результат, что и просто масштаб по ширине, но для
    // любого другого нативного разрешения плющило бы перспективу). Вместо
    // этого — один масштаб (ширина в размер канваса, высота — во столько же
    // раз, без зума и обрезки) и стыковка по общей точке: дальний нижний
    // угол комнаты на панораме — по построению этих фонов он горизонтально
    // по центру кадра и на ANCHOR_Y_FRAC вниз от верха — совмещается с
    // мировым нулём сцены, I.P(0,0) = (I.OX, I.PROJ.OY), той же точкой, где
    // сходятся стены на векторной оболочке (room/shell.js:drawShell). Это
    // общее правило для ЛЮБОГО фона, не подгонка под конкретную картинку —
    // раз выставлено, для новых панорам ничего пересчитывать не нужно.
    layoutBackground() {
      const tex = this.textures.get(this.backgrounds[this.bgIndex].key).getSourceImage();
      const scale = SCREEN_W / tex.width;
      const dispW = SCREEN_W, dispH = tex.height * scale;
      const ANCHOR_Y_FRAC = 0.375;
      this.bgImg.setDisplaySize(dispW, dispH)
        .setPosition(I.OX - 0.5 * dispW, I.PROJ.OY - ANCHOR_Y_FRAC * dispH);
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
      this.updateRain(time);
      if (this.uiDirty === undefined) this.uiDirty = true;
      // mode==='characters' перерисовывается каждый кадр не из-за uiDirty —
      // превью крутится по времени (catPreviewFrameName), не по событию.
      // assetDebug — та же причина: выбранный кот двигается сам по себе
      // (cat.x/y меняются в tick() выше), оверлей (ui/assetGeometryEditor.js)
      // должен следовать за ним, а не ждать следующего игрового события.
      if (this.uiDirty || this.drag || this.mode === 'characters' || this.assetDebug) { this.drawUI(); this.uiDirty = false; }
    }
  }

  Object.assign(RoomScene.prototype,
    window.MIXIN_SHELL,
    window.MIXIN_ITEMS,
    window.MIXIN_LIGHTING,
    window.MIXIN_CAT_APPEARANCE,
    window.MIXIN_CAT_BEHAVIOR,
    window.MIXIN_HUD,
    window.MIXIN_ASSET_GEO_EDITOR,
    window.MIXIN_INPUT
  );

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
