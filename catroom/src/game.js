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
  const { DEBUG, CAT_ART_SCALE_BASE, BG_DEPTH, SHELL_DEPTH, ZONE_DEPTH, SHADOW_DEPTH, GLOW_DEPTH, TEXT_DEPTH, UI_DEPTH, UI_TEXT_DEPTH } = window.RCFG;
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
      // Два варианта на выбор — переключаются в «Настройки» (см. drawSettings
      // в ui/hud.js, cycleBackground ниже): исходный тёплый вечер и новый
      // тёмный ночной, под который как раз и расчитана динамическая
      // подсветка (room/lighting.js) — на тёплом фоне со своим встроенным
      // светом её почти не видно.
      this.load.image('roomBg', 'art/room_bg.jpg');
      this.load.image('roomBg2', 'art/room_bg_2.jpg');
      // Спрайтовая мебель (второй режим отрисовки, переключается в
      // «Настройки») — манифест перечисляет, у каких id каталога есть
      // вырезанные картинки и в каких состояниях (см. room/furnitureSprites.js
      // и Furniture/manifest.json); сами PNG грузятся ниже, в
      // createStep2LoadImages(), после того как манифест точно пришёл.
      this.load.json('furnManifest', 'Furniture/manifest.json');
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
        floor: Object.fromEntries(Object.entries(s.floor || {}).map(([iid, pos]) => [iid, { ...pos }]))
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
        { key: 'roomBg2', ru: 'Тёмная ночь' }
      ];
      this.bgIndex = 1; // тёмный ночной — под него сделана динамическая подсветка
      this.bgImg = this.add.image(0, 0, this.backgrounds[this.bgIndex].key).setOrigin(0, 0)
        .setDisplaySize(SCREEN_W, SCREEN_H).setDepth(BG_DEPTH);
      this.gShell = this.add.graphics().setDepth(SHELL_DEPTH);
      this.tShell = new TextPool(this, TEXT_DEPTH);
      this.zoneGfx = this.add.graphics().setDepth(ZONE_DEPTH);
      this.tZones = new TextPool(this, TEXT_DEPTH);
      // Свет от торшера/лампочки/люстры (room/lighting.js) — тень лежит на
      // полу под предметами, свечение аддитивно поверх пола/стен/предметов и
      // кота. Пересобираются вместе с остальной сценой, из rebuild().
      this.gShadow = this.add.graphics().setDepth(SHADOW_DEPTH);
      this.gGlow = this.add.graphics().setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
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
      this.itemGfx = new Map(); // zid/iid -> { g: Graphics, t: Text|null, img: Image|null }
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
        if (this.drag) {
          this.drag.p = [p.worldX, p.worldY];
          this.checkListSwipe(p.worldX, p.worldY);
        }
      });
      this.input.on('pointerup', p => {
        if (this.openingDrag) { this.openingDrag = null; return; }
        this.onUp(p);
      });

      this.idleCycle();
    }

    // Переключатель фона в «Настройки» (drawSettings/onDown, ui/hud.js и
    // input.js) — просто следующая по кругу текстура на уже существующем
    // Image, без пересоздания сцены.
    cycleBackground() {
      this.bgIndex = (this.bgIndex + 1) % this.backgrounds.length;
      this.bgImg.setTexture(this.backgrounds[this.bgIndex].key);
      this.uiDirty = true;
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
      // mode==='characters' перерисовывается каждый кадр не из-за uiDirty —
      // превью крутится по времени (catPreviewFrameName), не по событию.
      if (this.uiDirty || this.drag || this.mode === 'characters') { this.drawUI(); this.uiDirty = false; }
    }
  }

  Object.assign(RoomScene.prototype,
    window.MIXIN_SHELL,
    window.MIXIN_ITEMS,
    window.MIXIN_LIGHTING,
    window.MIXIN_CAT_APPEARANCE,
    window.MIXIN_CAT_BEHAVIOR,
    window.MIXIN_HUD,
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
