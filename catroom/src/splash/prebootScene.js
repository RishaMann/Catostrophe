/* ============================================================================
   splash/prebootScene.js — сцена-пролог перед Boot: грузит только лого,
   чтобы Boot мог сразу нарисовать его на экране прогресс-бара (см.
   Documentation/tech-spec_splash_cat-select.md, п.1 — почему нельзя
   add.image('logo') в том же preload(), где само лого только поставлено
   в очередь: загрузка стартует лишь ПОСЛЕ выхода из preload()).
   ========================================================================== */
(function () {
  'use strict';

  window.PrebootScene = class extends Phaser.Scene {
    constructor() { super('Preboot'); }

    preload() {
      // Настоящего лого пока нет в репозитории — Boot сам решает, показать
      // картинку или текстовый плейсхолдер (см. bootScene.js), проверяя
      // this.textures.exists('logo'). Если/когда появится
      // assets/ui/logo_plate.png, эта строка начнёт его подтягивать без
      // изменений в остальном коде — отсутствие файла тут не валит загрузку
      // (Phaser просто не создаст текстуру и залогирует ошибку).
      this.load.image('logo', 'assets/ui/logo_plate.png');
    }

    create() {
      this.scene.start('Boot');
    }
  };
})();
