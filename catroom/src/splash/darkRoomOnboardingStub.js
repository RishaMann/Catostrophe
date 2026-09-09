/* ============================================================================
   splash/darkRoomOnboardingStub.js — ВРЕМЕННАЯ заглушка. Онбординг «тёмная
   комната» (ГДД п.4.2) — отдельная задача, для неё пока нет тех.спеки,
   поэтому здесь только пропускной пункт: принимает {hideout, catId} от
   CatSelectScene и сразу стартует комнату с выбранным котом — чтобы весь
   путь Preboot→Boot→CatSelect→комната был кликабелен и тестируем уже
   сейчас, а не висел на месте после выбора укрытия.

   Когда появится тех.спека реального онбординга — этот файл удаляется, а
   его сцена ('DarkRoomOnboarding') заменяется настоящей с тем же входным
   контрактом ({hideout, catId}).
   ========================================================================== */
(function () {
  'use strict';

  window.DarkRoomOnboardingStub = class extends Phaser.Scene {
    constructor() { super('DarkRoomOnboarding'); }

    init(data) {
      this.catId = data && data.catId;
    }

    create() {
      this.cameras.main.setBackgroundColor('#000000');
      this.scene.start('room', { catId: this.catId });
    }
  };
})();
