/* ============================================================================
   room/lighting.js — pixel-art динамический свет/тени от торшера/лампочки/
   люстры/гирлянды/окна (item.light в data.js) поверх пола. Пересобирается
   только из rebuild() — позиции светильников меняются исключительно по
   событию постановки/перетаскивания, не каждый кадр (кроме тени кота — та
   двигается и считается каждый кадр отдельно, см. drawCatShadow, вызывается
   из cat/catAppearance.js в gCat, а не отсюда).

   Пиксель-пайплайн (room/pixelEffects.js, PFX): вся геометрия строится
   ЦЕЛЫМИ квадратами PFX.CONFIG.scale × scale, дизерингом Bayer 4x4 на
   границах уровней — ни одного smooth radial-gradient/blur, никакого CSS-
   фильтра поверх готовой картинки (см. отчёт после реализации, п.7).

   Порядок отрисовки — сначала ВСЕ тени от ВСЕХ источников (gShadow, обычный
   blend, лежат на полу под предметами), потом ВСЁ свечение от ВСЕХ
   источников (gGlow, аддитивный blend, поверх пола/стен/предметов/кота):
   пересечение зон не требует булевой геометрии — тёмный пиксель от одной
   тени, попавший в свет другой лампы, просто перекрашивается светом поверх.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO, PFX = root.PFX, CFG = PFX.CONFIG;
  const { WALL } = I;

  root.MIXIN_LIGHTING = {

    // Все включённые сейчас источники света — с мировой позицией/высотой,
    // цветом и радиусом. iid у источника нужен, чтобы он не отбрасывал тень
    // сам на себя (collectShadowCasters). lightsOn/lampOn — выключатель у
    // двери (верхний свет) и тап по подставке торшера (input.js) —
    // выключенный источник просто не попадает в список.
    collectLights() {
      const lights = [];
      Object.keys(this.st.floor).forEach(iid => {
        const it = D.ITEMS[iid];
        if (!it.light) return;
        if (iid === 'lamp' && !this.lampOn) return;
        const pos = this.st.floor[iid];
        lights.push({ iid, x: pos.x, y: pos.y, z: it.s[2] * 0.85, color: it.light.color, radius: it.light.radius, kind: 'floor' });
      });
      const ceilIid = this.st.place.CEIL;
      const ceilIt = ceilIid && D.ITEMS[ceilIid];
      if (ceilIt && ceilIt.light && this.lightsOn) {
        const L = this.st.light;
        lights.push({ iid: ceilIid, x: L.x, y: L.y, z: WALL - 0.7, color: ceilIt.light.color, radius: ceilIt.light.radius, kind: 'hanging' });
      }
      return lights;
    },

    // Предметы, которые отбрасывают тень: вся мебель на полу, кроме самого
    // источника света (тень «под собой» никого не украшает). Даёт габарит
    // (для длины/ширины тени) и мировую позицию.
    collectShadowCasters(excludeIid) {
      const out = [];
      Object.keys(this.st.floor).forEach(iid => {
        if (iid === excludeIid) return;
        const it = D.ITEMS[iid], pos = this.st.floor[iid];
        const [w, d] = I.floorOrient(it, pos.x, pos.y);
        out.push({ iid, x: pos.x, y: pos.y, baseWidth: w, baseDepth: d, height: it.s[2] });
      });
      return out;
    },

    // Ближайший/сильнейший источник для конкретной точки — «доминирующий
    // свет», единственный, от которого предмет отбрасывает тень (упрощение,
    // явно допущенное ТЗ: не суммируем тени от всех источников разом).
    dominantLightFor(x, y, lights) {
      let best = null, bestScore = -Infinity;
      lights.forEach(L => {
        const dist = Math.hypot(x - L.x, y - L.y);
        if (dist > L.radius) return;
        const score = (1 - dist / L.radius);
        if (score > bestScore) { bestScore = score; best = L; }
      });
      return best;
    },

    drawLighting() {
      const gS = this.gShadow, gG = this.gGlow;
      gS.clear(); gG.clear();
      const lights = this.collectLights();

      if (CFG.shadows.enabled) {
        const casters = this.collectShadowCasters(null);
        casters.forEach(c => {
          // Светильник, стоящий на полу (торшер), не отбрасывает тень сам на
          // себя — источник света исключается из выбора доминирующего света
          // именно для СВОЕГО caster'а, а не глобально (другой предмет рядом
          // с торшером всё ещё должен получать от него тень).
          const L = this.dominantLightFor(c.x, c.y, lights.filter(l => l.iid !== c.iid));
          if (!L) return;
          const reach = Math.max(c.baseWidth, c.baseDepth) * 0.5;
          const len = reach * (1 + CFG.shadows.furnitureReachMul);
          PFX.paintFloorShadow(gS, I, c.x, c.y, L.x, L.y, len, reach * 0.7, CFG.shadows.levels, CFG.shadows.maxAlpha);
        });
      }

      if (CFG.lighting.enabled) {
        this.drawWindowBeam(gG);
        lights.forEach(L => {
          const alpha = L.kind === 'hanging' ? CFG.lighting.hangingLamp.alpha : CFG.lighting.floorLamp.alpha;
          const falloffPower = L.kind === 'hanging'
            ? CFG.lighting.hangingLamp.falloffPower
            : CFG.lighting.floorLamp.falloffPower;
          PFX.paintFloorDisc(gG, I, L.x, L.y, L.radius, CFG.lighting.levels, L.color, alpha, falloffPower);
          this.drawWallGlow(gG, L);
        });
        this.drawGarlandGlow(gG);
      }

      // Единый флаг-переключатель отладочной подсветки (this.pfxDebug,
      // Настройки → «Pixel FX debug», видно только с ?debug=1) — источники
      // света и рамки теней-кастеров разом, вместо шести отдельных
      // тумблеров из ТЗ (не влезали в и без того плотную панель настроек,
      // см. итоговый отчёт, п.7 — упрощения).
      if (this.pfxDebug) { this.drawLightSourceMarkers(gG, lights); this.drawShadowCasterMarkers(gS); }
    },

    // Тень кота — тот же приём, что и у мебели (paintFloorShadow), только
    // считается каждый кадр (кот двигается, мебель — нет), в его собственный
    // Graphics (gCat), не в общий gShadow. Если ни один источник не достаёт —
    // мягкое рассеянное пятно прямо под ним (общий свет комнаты, не
    // кромешная тьма без единой тени).
    drawCatShadow(g, cx, cy) {
      if (!CFG.shadows.enabled) return;
      const lights = this.collectLights();
      const L = this.dominantLightFor(cx, cy, lights);
      if (L) {
        const len = CFG.shadows.catLen * (1 + (1 - Math.hypot(cx - L.x, cy - L.y) / L.radius) * 0.6);
        PFX.paintFloorShadow(g, I, cx, cy, L.x, L.y, len, 0.28, CFG.shadows.levels, CFG.shadows.maxAlpha + 0.1);
      } else {
        PFX.paintFloorDisc(g, I, cx, cy, 0.3, 2, 0x000000, 0.3);
      }
    },

    // Направленный холодный луч из окна на пол — ДВА независимых сегмента
    // (левое/правое стекло, room/shell.js: winGlassSegments), с тёмным
    // зазором между ними от центральной перекладины: она просто не входит
    // ни в один сегмент, свет там не рисуется вовсе (а не «прорисован и
    // затемнён» — реальная оклюзия рамой). Не привязан к выключателю (это
    // уличный/лунный свет), но задёрнутая штора (curtainClosed()) его
    // перекрывает — так же, как перекрывала бы настоящее окно.
    drawWindowBeam(g) {
      if (this.curtainClosed()) return;
      const F = I.PROJ.F, cfg = CFG.lighting.window;
      this.winGlassSegments().forEach(seg => {
        PFX.paintWindowBeam(g, I, seg.side, F, seg.lat0, seg.lat1,
          cfg.start, cfg.depth, cfg.spread, cfg.drift,
          cfg.levels, cfg.color, cfg.alpha, cfg.falloffPower);
      });
    },

    // Тёплое пятно на ближайшей стене — плоскость стены под сдвиговой (не
    // диагональной) проекцией не даёт точного эллипса после проекции, как у
    // пола (I.unP умеет только пол) — квантуем прямо в экранных координатах
    // (paintScreenDisc), для мягкого пятна на вертикали этого достаточно.
    // Свет из середины комнаты, далёкий от обеих стен, просто не достаёт.
    drawWallGlow(g, L) {
      const reachR = L.radius - L.y; // дальняя (правая) стена — плоскость y=0
      if (reachR > 0.3) {
        const c = I.P(L.x, 0, L.z);
        const rx = reachR * Math.hypot(I.PROJ.TW, I.PROJ.TH) * 1.6, ry = reachR * I.PROJ.ZH * 1.5;
        PFX.paintScreenDisc(g, c[0], c[1], rx, ry, 4, L.color, 0.16);
      }
      const reachL = L.radius - L.x; // левая стена — плоскость x=0
      if (reachL > 0.3) {
        const c = I.P(0, L.y, L.z);
        const rx = reachL * Math.hypot(I.PROJ.TW, I.PROJ.TH) * 1.6, ry = reachL * I.PROJ.ZH * 1.5;
        PFX.paintScreenDisc(g, c[0], c[1], rx, ry, 4, L.color, 0.16);
      }
    },

    // Гирлянда (item.id='garland', cat:'wall', БЕЗ собственной мировой
    // точки — живёт в одной из зон стены, см. dynamicZones/iso.js) — не одно
    // большое пятно, а несколько маленьких узлов вдоль зоны, где она стоит.
    // Экранные координаты узла берём прямо из géometрии зоны (z.r/z.wall) —
    // для стены нет дешёвой обратной проекции (I.unP — только пол), поэтому
    // тут тоже paintScreenDisc, как и у wallGlow.
    drawGarlandGlow(g) {
      const zid = Object.keys(this.st.place || {}).find(k => this.st.place[k] === 'garland');
      if (!zid || !this.zmap || !this.zmap[zid]) return;
      const it = D.ITEMS.garland;
      if (!it) return;
      const z = this.zmap[zid], cfg = CFG.lighting.garland, F = I.PROJ.F;
      const [a0, z0, a1, z1] = z.r, zmid = (z0 + z1) / 2;
      const n = Math.max(2, cfg.nodeCount);
      const color = 0xFFCE8A;
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (i + 0.5) / n;
        const p = z.wall === 'left' ? I.P(0, a, zmid) : I.P(a, 0, zmid);
        const rx = cfg.nodeRadius * I.PROJ.TW, ry = cfg.nodeRadius * I.PROJ.ZH;
        PFX.paintScreenDisc(g, p[0], p[1], rx, ry, 3, color, cfg.alpha);
      }
    },

    // --- отладка (PIXEL_EFFECTS.debug, ui/hud.js Настройки → видно только с ?debug=1) ---
    drawLightSourceMarkers(g, lights) {
      lights.forEach(L => {
        const p = I.P(L.x, L.y, L.z);
        g.fillStyle(0xFFFFFF, 0.9);
        g.fillRect(p[0] - 3, p[1] - 3, 6, 6);
      });
    },
    drawShadowCasterMarkers(g) {
      this.collectShadowCasters(null).forEach(c => {
        const p = I.P(c.x, c.y);
        g.lineStyle(1, 0xFF4D4D, 0.9);
        g.strokeRect(p[0] - 5, p[1] - 5, 10, 10);
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
