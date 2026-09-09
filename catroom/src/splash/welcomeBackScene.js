/* ============================================================================
   splash/welcomeBackScene.js — экран для игрока, который кота уже один раз
   выбрал (см. save.js: SAVESTORE.getCatChoice(), пишется в
   catSelectScene.js: selectCat). Выбор одноразовый: пока это поле сохранено
   в localStorage, BootScene (см. goNext) сюда пускает вместо CatSelect —
   назад к выбору кота обратного пути нет, пока не сбросят сохранение.

   Чёрный экран, название по центру (тот же манифест art/logo/, что и у
   CatSelect, — без тапа-переключения, просто первая картинка), кнопка
   «Продолжить» — сразу в комнату с уже выбранным котом, через тот же
   DarkRoomOnboarding, что и CatSelect (тот принимает {catId}, hideout ему
   не нужен — см. darkRoomOnboardingStub.js).
   ========================================================================== */
(function (root) {
  'use strict';
  const { COL, FONT } = root.RCFG;

  window.WelcomeBackScene = class extends Phaser.Scene {
    constructor() { super('WelcomeBack'); }

    create() {
      const { width, height } = this.cameras.main;
      this.cameras.main.setBackgroundColor('#000000');

      this.addTitle(width, height);
      this.addContinueButton(width, height);
    }

    addTitle(width, height) {
      const names = (this.cache.json.exists('titleManifest') ? this.cache.json.get('titleManifest') : [])
        .filter(name => this.textures.exists(name));
      if (!names.length) return;

      const img = this.add.image(width / 2, height / 2 - 70, names[0]);
      const maxW = width * 0.8, maxH = 200;
      const tex = img.texture.getSourceImage();
      img.setScale(Math.min(1, maxW / tex.width, maxH / tex.height));
    }

    addContinueButton(width, height) {
      const btnY = height / 2 + 90, btnW = 220, btnH = 52;
      const bg = this.add.rectangle(width / 2, btnY, btnW, btnH, 0x000000, 0.6)
        .setStrokeStyle(2, COL.amber)
        .setInteractive({ useHandCursor: true });
      this.add.text(width / 2, btnY, 'Продолжить', {
        fontFamily: FONT, fontSize: '18px', color: '#EBE2D5'
      }).setOrigin(0.5);

      bg.on('pointerdown', () => {
        bg.disableInteractive(); // не даём тапнуть второй раз во время fade
        const catId = root.SAVESTORE ? root.SAVESTORE.getCatChoice() : null;
        this.cameras.main.fadeOut(500, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('DarkRoomOnboarding', { catId });
        });
      });
    }
  };
})(window);
