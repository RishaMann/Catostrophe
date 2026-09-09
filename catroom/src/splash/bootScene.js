/* ============================================================================
   splash/bootScene.js — техническая сцена загрузки: лого/плашка + прогресс-
   бар, без атмосферных анимаций (см. tech-spec_splash_cat-select.md, п.0/1).
   Грузит только то, что нужно для показа CatSelect, не всю игру.

   street_bg — уже настоящий референс художника (Documentation/References/
   929411e0-7435-4aa8-9727-30d1773b1f5b.png, скопирован в art/street_bg.png,
   см. catSelectScene.js — там же промеренные по нему координаты глаз и
   фонарей). Остального (lamp_left, lamp_right, box, grate, спрайтшиты
   глаз, банка, дождь) в репозитории пока нет — load.image() всё равно
   ставится в очередь (при
   404 Phaser не создаст текстуру, но и не остановит загрузку), а
   CatSelectScene сама решает, рисовать картинку или процедурный
   плейсхолдер, проверяя this.textures.exists(key). Как только появятся
   остальные файлы, плейсхолдеры уступят им место без правок кода.
   ========================================================================== */
(function (root) {
  'use strict';
  const { COL, FONT } = root.RCFG;

  window.BootScene = class extends Phaser.Scene {
    constructor() { super('Boot'); }

    preload() {
      // 'logo' уже в кэше (или его не оказалось — Preboot попытался
      // загрузить) — тут уже безопасно решать, что показывать.
      this.createProgressBar();

      this.load.image('street_bg', 'art/street_bg.png');
      this.load.image('lamp_left', 'assets/scenes/lamp_left.png');
      this.load.image('lamp_right', 'assets/scenes/lamp_right.png');
      this.load.image('box', 'assets/scenes/box.png');
      this.load.image('grate', 'assets/scenes/grate.png');
      // Два РАЗНЫХ спрайтшита глаз — не один общий: единственная подсказка
      // игроку, что в коробке и решётке разные персонажи (см.
      // catSelectScene.js: HIDEOUT_CAT).
      this.load.spritesheet('eyes_baton', 'assets/scenes/eyes_baton_blink.png', { frameWidth: 32, frameHeight: 16 });
      this.load.spritesheet('eyes_shilo', 'assets/scenes/eyes_shilo_blink.png', { frameWidth: 32, frameHeight: 16 });
      this.load.image('tin_can', 'assets/scenes/tin_can.png');
      this.load.image('rain_drop', 'assets/particles/rain_drop.png');
      this.load.audio('sfx_rain_amb', 'assets/audio/rain_amb.mp3');

      // Название на CatSelect (см. catSelectScene.js: addTitle) — не один
      // файл, а папка art/logo/: manifest.json перечисляет картинки,
      // тап по названию листает их по кругу. Список заранее не известен
      // (как и у Cats/manifest.json), поэтому сами файлы догружаются
      // каскадом вторым проходом — см. loadTitleImages().
      this.load.json('titleManifest', 'art/logo/manifest.json');
    }

    createProgressBar() {
      const { width, height } = this.cameras.main;
      this.add.rectangle(width / 2, height * 0.6, 300, 20, 0x000000, 0.4).setStrokeStyle(2, COL.chalk);
      const bar = this.add.rectangle(width / 2 - 148, height * 0.6, 0, 12, COL.amber).setOrigin(0, 0.5);

      if (this.textures.exists('logo')) {
        this.add.image(width / 2, height * 0.35, 'logo'); // безопасно: текстура уже в кэше
      } else {
        // Плейсхолдер, пока нет готовой плашки — тот же текст, что в
        // <title> index.html, тем же шрифтом, что весь остальной UI игры.
        this.add.text(width / 2, height * 0.35, 'Котику грустно', {
          fontFamily: FONT, fontSize: '28px', color: '#EBE2D5'
        }).setOrigin(0.5);
      }

      this.load.on('progress', (v) => { bar.width = 296 * v; });
    }

    // create() запускается уже ПОСЛЕ того, как штатный цикл preload()
    // полностью отработал и загрузчик сам сбросился в IDLE — только тогда
    // повторный this.load.start() безопасен (вызвать его из колбэка
    // 'complete' внутри ещё текущего цикла загрузчик тихо игнорирует, он
    // ещё не в IDLE). Тот же порядок, что у каскадной загрузки кота/мебели
    // в game.js (там тоже второй проход — из create(), не из preload()).
    create() {
      this.loadTitleImages();
    }

    // Манифест уже пришёл первым проходом (preload) — теперь можно
    // поставить в очередь сами файлы, имена которых заранее не знали (тот
    // же приём, что и с котами/мебелью, см. game.js: createStep2LoadImages).
    loadTitleImages() {
      const names = this.cache.json.get('titleManifest') || [];
      if (!names.length) { this.goNext(); return; }
      // Ключ текстуры — само имя файла (в manifest.json они и так уникальны
      // и уже с осмысленным именем, отдельный префикс тут не нужен).
      names.forEach(name => this.load.image(name, 'art/logo/' + name));
      this.load.once('complete', () => this.goNext());
      this.load.start();
    }

    // Кота выбирают ровно один раз (см. save.js: SAVESTORE.setCatChoice,
    // вызывается из catSelectScene.js: selectCat) — если выбор уже
    // сохранён, CatSelect больше не показываем, сразу WelcomeBackScene
    // (чёрный экран с названием и «Продолжить», см. welcomeBackScene.js).
    goNext() {
      const catId = root.SAVESTORE ? root.SAVESTORE.getCatChoice() : null;
      this.scene.start(catId ? 'WelcomeBack' : 'CatSelect');
    }
  };
})(window);
