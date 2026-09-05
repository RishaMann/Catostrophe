/* ============================================================================
   room/furnitureSprites.js — реестр спрайтовой мебели (второй режим отрисовки
   рядом с процедурными силуэтами из itemShapes.js). Сами картинки вырезаны из
   Documentation/References/furniture.png и лежат в Furniture/<id>/<state>.png
   (см. Furniture/manifest.json, грузится и регистрируется как Phaser-текстуры
   в game.js — та же каскадная схема, что и для кадров кота).

   state — задел на будущее: у предмета может быть несколько картинок
   (Furniture/box/new.png и Furniture/box/afterGag.png уже вырезаны — коробка
   закрыта/распотрошена котом), но переключение состояния по геймплейному
   событию (гэг) пока не реализовано — везде используется 'new', пока кто-то
   явно не положит другое имя в st.floor[iid].state. Так реестр не придётся
   переделывать, когда появятся анимация гэга/состояние после гэга/анимация
   кота у конкретного предмета.
   ========================================================================== */
(function (root) {
  'use strict';

  let manifest = {};

  root.FURN_SPRITES = {
    setManifest(m) { manifest = m || {}; },
    has(iid) { return !!manifest[iid]; },
    states(iid) { return manifest[iid] || null; },

    // Состояние по умолчанию — 'new', если не запрошено конкретное или
    // запрошенного нет в наличии (напр. у большинства предметов пока вырезан
    // только один кадр).
    pickState(iid, wanted) {
      const st = manifest[iid];
      if (!st) return null;
      if (wanted && st[wanted]) return wanted;
      if (st.new) return 'new';
      const keys = Object.keys(st);
      return keys.length ? keys[0] : null;
    },

    textureKey(iid, state) { return `furn_${iid}_${state}`; },

    // Все файлы манифеста как {key, url} — для каскадной загрузки картинок в
    // game.js (тот же приём, что и с кадрами кота: обычные Image() вместо
    // this.load.image(), у Phaser-загрузчика на полусотне файлов через
    // load.start() виснет очередь).
    jobs(baseUrl) {
      const out = [];
      Object.keys(manifest).forEach(iid => {
        Object.entries(manifest[iid]).forEach(([state, relPath]) => {
          out.push({ key: this.textureKey(iid, state), url: baseUrl + relPath });
        });
      });
      return out;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
