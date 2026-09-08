/* ============================================================================
   room/pixelEffects.js — общий pixel-art effect pipeline: конфиг + Bayer-
   дизеринг + аналитические per-pixel заливки (диск на полу, направленный
   луч из окна, вытянутая тень), которыми пользуются room/lighting.js и
   room/shell.js (дождь).

   Вместо второго HTML canvas (его в Phaser/WebGL нет смысла заводить —
   ctx.imageSmoothingEnabled тут ни на что не влияет) весь pixel-grid
   реализован ПРЯМО в мировых координатах: экран режется на квадраты
   PIXEL_EFFECTS.scale × scale ("виртуальные пиксели"), центр каждого
   квадрата обратно проецируется на пол (I.unP) в мировые координаты, и
   яркость считается там — то есть сама маска СТРОИТСЯ на редкой сетке, а не
   рисуется гладко и потом обрезается фильтром. Итоговый блок закрашивается
   ОДНИМ fillRect на весь scale×scale квадрат — реальный эквивалент рендера в
   low-res буфер с последующим nearest-neighbour апскейлом, без лишней
   Render-to-texture обвязки Phaser (см. итоговый отчёт, п.7 — упрощения).
   ========================================================================== */
(function (root) {
  'use strict';

  const PIXEL_EFFECTS = {
    scale: 4, // сторона "виртуального пикселя" в реальных px канваса (540x960)

    lighting: {
      enabled: true,
      levels: 5,        // дискретных уровней яркости на диск лампы
      dither: 'bayer4',
      floorLamp: { alpha: 0.85 },
      hangingLamp: { alpha: 0.85 },
      garland: { alpha: 0.7, nodeCount: 4, nodeRadius: 0.55 },
      window: { levels: 4, alpha: 0.55, color: 0x8FB6E8, depth: 3.0, spread: 1.2, mullionGap: 0.16 }
    },

    shadows: {
      enabled: true,
      levels: 3,
      maxAlpha: 0.4,
      dominantLightOnly: true,
      furnitureReachMul: 0.6, // во сколько раз тень длиннее половины габарита предмета
      catLen: 0.55
    },

    rain: {
      enabled: true,
      fps: 16,
      bg: { count: 26, color: 0x4C6382, alpha: 0.5, w: 1, hMin: 2, hMax: 4, speedMin: 90, speedMax: 130 },
      fg: { count: 12, color: 0xCFE3F7, alpha: 0.85, w: 2, hMin: 4, hMax: 8, speedMin: 150, speedMax: 210 }
    }

    // Отладочная подсветка (источники света/тени-кастеры/маска окна) — не
    // здесь, а единый флаг this.pfxDebug на сцене (Настройки → «Pixel FX
    // debug», видно только с ?debug=1) — см. room/lighting.js/drawLighting,
    // room/shell.js/updateRain.
  };

  // Bayer 4x4 (0..15) — упорядоченный дизеринг: пиксель "включается" на
  // следующий уровень раньше или позже соседей по детерминированному
  // паттерну вместо ровного кольца/сглаживания.
  const BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  // t — непрерывная яркость 0..1 (1 = центр источника/начало тени, 0 — край).
  // Возвращает целый уровень 0..levels, дизерингом размывая границу между
  // floor(t*levels) и следующим уровнем по паттерну Bayer, привязанному к
  // (gx,gy) — координатам того же виртуального пикселя, что и заливка.
  function ditherLevel(levels, t, gx, gy) {
    if (t <= 0) return 0;
    if (t >= 1) return levels;
    const scaled = t * levels;
    const base = Math.floor(scaled);
    const frac = scaled - base;
    const threshold = (BAYER4[((gy % 4) + 4) % 4][((gx % 4) + 4) % 4] + 0.5) / 16;
    return Math.min(levels, base + (frac > threshold ? 1 : 0));
  }

  function snap(v, scale) { return Math.floor(v / scale) * scale; }

  root.PFX = {
    CONFIG: PIXEL_EFFECTS,
    BAYER4,
    ditherLevel,
    snap,

    // Заливка круглого пятна на ПОЛУ (z=0) с дискретным дизерингом — общий
    // рабочий конь для torch/hanging lamp/окна на полу. bboxScreenPts — уже
    // спроецированные (I.P) угловые точки мирового квадрата, описывающего
    // круг радиуса worldRadius — считает вызывающий код (там же, где и
    // I.P/I.unP уже под рукой через this.*).
    paintFloorDisc(g, I, worldCx, worldCy, worldRadius, levels, color, maxAlpha) {
      const scale = PIXEL_EFFECTS.scale;
      const c00 = I.P(worldCx - worldRadius, worldCy - worldRadius);
      const c11 = I.P(worldCx + worldRadius, worldCy - worldRadius);
      const c22 = I.P(worldCx - worldRadius, worldCy + worldRadius);
      const c33 = I.P(worldCx + worldRadius, worldCy + worldRadius);
      const xs = [c00[0], c11[0], c22[0], c33[0]], ys = [c00[1], c11[1], c22[1], c33[1]];
      const x0 = snap(Math.min(...xs), scale), x1 = snap(Math.max(...xs), scale);
      const y0 = snap(Math.min(...ys), scale), y1 = snap(Math.max(...ys), scale);
      for (let sy = y0; sy <= y1; sy += scale) {
        for (let sx = x0; sx <= x1; sx += scale) {
          const w = I.unP(sx + scale / 2, sy + scale / 2);
          const dist = Math.hypot(w[0] - worldCx, w[1] - worldCy);
          const t = 1 - dist / worldRadius;
          if (t <= 0) continue;
          const lvl = ditherLevel(levels, t, sx / scale, sy / scale);
          if (lvl <= 0) continue;
          g.fillStyle(color, (lvl / levels) * maxAlpha);
          g.fillRect(sx, sy, scale, scale);
        }
      }
    },

    // Направленный холодный луч от одного стеклянного сегмента окна — по
    // полу, аналитически в мировых координатах (депth = расстояние от
    // стены, lateral = положение вдоль окна), без полигональной геометрии:
    // ярче у стекла, гаснет к depth, ограничен по lateral шириной сегмента
    // (уже без перекладины — её должен вырезать вызывающий код, передав
    // раздельно левый/правый сегмент).
    paintWindowBeam(g, I, side, F, lat0, lat1, depth, spread, levels, color, maxAlpha) {
      const scale = PIXEL_EFFECTS.scale;
      // bbox по экрану — по мировому прямоугольнику [lat0-spread..lat1+spread] x [0..depth]
      const corners = side === 'right'
        ? [I.P(lat0 - spread, 0), I.P(lat1 + spread, 0), I.P(lat0 - spread, depth), I.P(lat1 + spread, depth)]
        : [I.P(F, lat0 - spread), I.P(F, lat1 + spread), I.P(F - depth, lat0 - spread), I.P(F - depth, lat1 + spread)];
      const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
      const x0 = snap(Math.min(...xs), scale), x1 = snap(Math.max(...xs), scale);
      const y0 = snap(Math.min(...ys), scale), y1 = snap(Math.max(...ys), scale);
      for (let sy = y0; sy <= y1; sy += scale) {
        for (let sx = x0; sx <= x1; sx += scale) {
          const w = I.unP(sx + scale / 2, sy + scale / 2);
          const d = side === 'right' ? w[1] : (F - w[0]);
          const lat = side === 'right' ? w[0] : w[1];
          if (d < 0 || d > depth) continue;
          const tDepth = d / depth;
          const sp = spread * tDepth;
          if (lat < lat0 - sp || lat > lat1 + sp) continue;
          const t = 1 - tDepth;
          const lvl = ditherLevel(levels, t, sx / scale, sy / scale);
          if (lvl <= 0) continue;
          g.fillStyle(color, (lvl / levels) * maxAlpha);
          g.fillRect(sx, sy, scale, scale);
        }
      }
    },

    // Вытянутая тень предмета/кота на полу от одного (доминирующего)
    // источника: эллипс, растянутый от источника наружу вдоль оси
    // caster->прочь-от-света, с сужением к концу и дизерингом на границе.
    paintFloorShadow(g, I, casterX, casterY, lightX, lightY, len, halfWidth, levels, maxAlpha) {
      const scale = PIXEL_EFFECTS.scale;
      let nx = casterX - lightX, ny = casterY - lightY;
      const d0 = Math.hypot(nx, ny) || 1;
      nx /= d0; ny /= d0;
      const reach = len + halfWidth;
      const c00 = I.P(casterX - reach, casterY - reach), c11 = I.P(casterX + reach, casterY - reach);
      const c22 = I.P(casterX - reach, casterY + reach), c33 = I.P(casterX + reach, casterY + reach);
      const xs = [c00[0], c11[0], c22[0], c33[0]], ys = [c00[1], c11[1], c22[1], c33[1]];
      const x0 = snap(Math.min(...xs), scale), x1 = snap(Math.max(...xs), scale);
      const y0 = snap(Math.min(...ys), scale), y1 = snap(Math.max(...ys), scale);
      for (let sy = y0; sy <= y1; sy += scale) {
        for (let sx = x0; sx <= x1; sx += scale) {
          const w = I.unP(sx + scale / 2, sy + scale / 2);
          const relx = w[0] - casterX, rely = w[1] - casterY;
          const along = relx * nx + rely * ny;       // вдоль тени, 0=у предмета, len=конец
          const perp = -relx * ny + rely * nx;        // поперёк
          if (along < -halfWidth * 0.4 || along > len) continue;
          const t = Math.max(0, along / len);
          const widthAt = halfWidth * (1 - t * 0.55);
          if (Math.abs(perp) > widthAt) continue;
          const bright = 1 - t;
          const lvl = ditherLevel(levels, bright, sx / scale, sy / scale);
          if (lvl <= 0) continue;
          g.fillStyle(0x000000, (lvl / levels) * maxAlpha);
          g.fillRect(sx, sy, scale, scale);
        }
      }
    },

    // Квантованное пятно света в ЭКРАННЫХ координатах (для стены/гирлянды —
    // плоскостей, для которых нет дешёвой обратной проекции пола) — то же
    // дискретное кольцо+дизеринг, но без I.unP, по нормализованному
    // эллиптическому расстоянию от screen-центра.
    paintScreenDisc(g, cx, cy, rx, ry, levels, color, maxAlpha) {
      const scale = PIXEL_EFFECTS.scale;
      const x0 = snap(cx - rx, scale), x1 = snap(cx + rx, scale);
      const y0 = snap(cy - ry, scale), y1 = snap(cy + ry, scale);
      for (let sy = y0; sy <= y1; sy += scale) {
        for (let sx = x0; sx <= x1; sx += scale) {
          const nx = (sx + scale / 2 - cx) / rx, ny = (sy + scale / 2 - cy) / ry;
          const dist = Math.hypot(nx, ny);
          const t = 1 - dist;
          if (t <= 0) continue;
          const lvl = ditherLevel(levels, t, sx / scale, sy / scale);
          if (lvl <= 0) continue;
          g.fillStyle(color, (lvl / levels) * maxAlpha);
          g.fillRect(sx, sy, scale, scale);
        }
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
