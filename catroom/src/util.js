/* ============================================================================
   util.js — общие чистые помощники: не знают про Phaser-сцену и не держат
   состояния (кроме TextPool — пул реиспользуемых Text-объектов одной сцены).
   ========================================================================== */
(function (root) {
  'use strict';

  const FONT = root.RCFG.FONT;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function inPoly(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }

  // Диапазоны движения двери/окна вдоль стены + вдоль примыкающего переднего
  // (открытого) края — один в один RANGE из исходного app.js: там же было
  // выяснено, где дверь/окно ещё не упираются в угол.
  const RANGE = { left: [0.6, 3.35], frontLeft: [1.8, 4.4], right: [0.4, 2.6], frontRight: [1.8, 4.2] };
  function nearestOnSeg(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = clamp(((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
    return { t, d: Math.hypot(a[0] + vx * t - px, a[1] + vy * t - py) };
  }

  // Какие файлы из sprites/<Персонаж>/ понадобятся движку — из конфига
  // персонажа. Список только тех кадров, что реально названы в конфиге —
  // лишние файлы в sprites/ (если есть) грузить не нужно. Правило общее для
  // ЛЮБОГО поля sprites.*, по форме значения, а не по имени поля — новое
  // поле (новая статичная поза, новый набор превью-кадров, новая покадровая
  // анимация) подхватывается само, тут ничего не трогать:
  //   строка              — один кадр ("idle": "sit_front_a")
  //   массив строк        — цикл кадров ("previewPoses": [...])
  //   {frames,count}      — покадровая анимация по префиксу ("playToy1": {...})
  //   {dir: {frames,flip}} — карта направлений ходьбы (8-directional "walk",
  //                          см. Cats/Labra/config.json); frames тут уже
  //                          массив готовых имён, не префикс+count
  // Не-строковые элементы массива (например, previewRotation — массив пар
  // [индекс, флаг], а не имён кадров) пропускаются, а не летят как кадр.
  function catFrameNames(cfg) {
    const set = new Set();
    Object.values(cfg.sprites).forEach(v => {
      if (typeof v === 'string') set.add(v);
      else if (Array.isArray(v)) v.forEach(f => { if (typeof f === 'string') set.add(f); });
      else if (v && typeof v === 'object') {
        if (v.frames && v.count) {
          for (let i = 0; i < v.count; i++) set.add(v.frames + '_' + i);
        } else {
          Object.values(v).forEach(dv => {
            if (dv && Array.isArray(dv.frames)) dv.frames.forEach(f => set.add(f));
          });
        }
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

  root.GUTIL = { clamp, rnd, pick, inPoly, RANGE, nearestOnSeg, catFrameNames, TextPool };
})(typeof window !== 'undefined' ? window : globalThis);
