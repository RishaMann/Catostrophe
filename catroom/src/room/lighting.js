/* ============================================================================
   room/lighting.js — тёплый ламповый свет от торшера/лампочки/люстры (item.
   light в data.js) и тени от него на полу. Пересобирается только из
   rebuild() — позиции светильников (свободная расстановка пола + движимая
   точка крепления на потолке) меняются исключительно по событию постановки/
   перетаскивания, не каждый кадр.

   Порядок отрисовки — сначала ВСЕ тени от ВСЕХ источников (gShadow, обычный
   blend, лежат на полу под предметами), потом ВСЁ свечение от ВСЕХ
   источников (gGlow, аддитивный blend, поверх пола/стен/предметов/кота).
   Благодаря этому пересечение зон не требует булевой геометрии: место, тёмное
   от одной лампы, но попадающее в радиус другой, просто перекрашивается
   светом второй поверх уже нарисованной тени — учитываются все источники
   сразу, без явного объединения/вычитания областей.

   Кольца свечения — несколько ВЛОЖЕННЫХ (не смежных) овалов с одной и той же
   альфой: центр перекрыт всеми кольцами сразу и получает кратно бо́льшую
   яркость, край — только одним. Каждый овал — плоская заливка без
   градиента, поэтому переход между кольцами получается ступенчатым,
   «пиксельным», а не гладким — тот же графичный стиль, что и у остальной
   сцены. Овал, а не диамант/прямоугольник: круг на полу — это на самом деле
   круг в мировых координатах, а не квадрат, и после изометрической проекции
   он остаётся ЭЛЛИПСОМ БЕЗ ПОВОРОТА (диагональные мировые оси x-y/x+y как
   раз и есть экранные X/Y после проекции, см. drawGlowRings) — тот же трюк,
   что уже применяла собственная тень кота (updateCatVisual), просто с
   несколькими вложенными радиусами вместо одного.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { WALL, WIN_W } = I;

  root.MIXIN_LIGHTING = {

    // Все включённые сейчас источники света — с мировой позицией/высотой,
    // цветом и радиусом. iid у источника нужен, чтобы он не отбрасывал тень
    // сам на себя (drawLightShadows). lightsOn/lampOn — выключатель у двери
    // (верхний свет) и тап по подставке торшера (см. input.js) — выключенный
    // источник просто не попадает в список, светить/отбрасывать тень нечему.
    collectLights() {
      const lights = [];
      Object.keys(this.st.floor).forEach(iid => {
        const it = D.ITEMS[iid];
        if (!it.light) return;
        if (iid === 'lamp' && !this.lampOn) return;
        const pos = this.st.floor[iid];
        lights.push({ iid, x: pos.x, y: pos.y, z: it.s[2] * 0.85, color: it.light.color, radius: it.light.radius });
      });
      const ceilIid = this.st.place.CEIL;
      const ceilIt = ceilIid && D.ITEMS[ceilIid];
      if (ceilIt && ceilIt.light && this.lightsOn) {
        const L = this.st.light;
        lights.push({ iid: ceilIid, x: L.x, y: L.y, z: WALL - 0.7, color: ceilIt.light.color, radius: ceilIt.light.radius });
      }
      return lights;
    },

    drawLighting() {
      const gS = this.gShadow, gG = this.gGlow;
      gS.clear(); gG.clear();
      this.drawWindowBeam(gG);
      const lights = this.collectLights();
      lights.forEach(L => this.drawLightShadows(gS, L));
      lights.forEach(L => { this.drawFloorGlow(gG, L); this.drawWallGlow(gG, L); });
    },

    // Тень от КАЖДОГО другого предмета на полу, попадающего в радиус этого
    // источника — эллипс со стороны, противоположной свету (та же условность,
    // что у собственной тени кота, updateCatVisual): не настоящая проекция
    // силуэта, а стилизованное пятно на полу под предметом, вытянутое от
    // источника. Ближе к лампе — темнее и длиннее, у края радиуса — исчезает.
    drawLightShadows(g, L) {
      Object.keys(this.st.floor).forEach(iid => {
        if (iid === L.iid) return;
        const it = D.ITEMS[iid], pos = this.st.floor[iid];
        const dx = pos.x - L.x, dy = pos.y - L.y, dist = Math.hypot(dx, dy);
        if (dist < 0.05 || dist > L.radius) return;
        const k = 1 - dist / L.radius, alpha = k * 0.28;
        if (alpha < 0.02) return;
        const nx = dx / dist, ny = dy / dist;
        const [w, d] = I.floorOrient(it, pos.x, pos.y);
        const reach = Math.max(w, d) * 0.5 + 0.25;
        const p = I.P(pos.x + nx * reach, pos.y + ny * reach);
        const rx = Math.max(16, (w + d) * 0.5 * I.PROJ.TW * 0.55) * (1 + k * 0.6);
        const ry = rx * I.PROJ.tilt;
        g.fillStyle(0x000000, alpha);
        g.fillEllipse(p[0], p[1], rx, ry);
      });
    },

    // Тень кота — тот же приём, что и у мебели (drawLightShadows), только
    // считается каждый кадр в updateCatVisual (cat/catAppearance.js), а не в
    // rebuild(): кот двигается, мебель — нет. Раньше тут был фиксированный
    // кружок под ногами независимо от освещения — теперь по одной тени НА
    // КАЖДЫЙ источник в радиусе (темнее и длиннее у ближнего, расходятся в
    // разные стороны от разных ламп), а если ни один не достаёт — мягкое
    // пятно прямо под ним, как раньше (общий рассеянный свет комнаты, не
    // кромешная тьма без единой тени).
    drawCatShadow(g, cx, cy) {
      const lights = this.collectLights();
      let any = false;
      lights.forEach(L => {
        const dx = cx - L.x, dy = cy - L.y, dist = Math.hypot(dx, dy);
        if (dist > L.radius) return;
        any = true;
        const k = 1 - dist / L.radius;
        const nx = dist < 0.02 ? 0 : dx / dist, ny = dist < 0.02 ? 0 : dy / dist;
        const p = I.P(cx + nx * 0.2, cy + ny * 0.2);
        const rx = 22 * (1 + k * 0.6), ry = rx * I.PROJ.tilt;
        g.fillStyle(0x000000, 0.12 + k * 0.26);
        g.fillEllipse(p[0], p[1], rx, ry);
      });
      if (!any) {
        const p = I.P(cx, cy);
        g.fillStyle(0x000000, 0.24);
        g.fillEllipse(p[0], p[1], 24, 24 * I.PROJ.tilt);
      }
    },

    // Направленный холодный луч из окна на пол — не круглый пул, как у ламп
    // (окно — щель, а не точка), а трапеция, расширяющаяся от рамы вглубь
    // комнаты, теми же вложенными плоскими слоями («пиксельный» спад).
    // Всегда включён — это уличный/лунный свет, а не электричество, к
    // выключателю не привязан.
    drawWindowBeam(g) {
      const st = this.st, F = I.PROJ.F;
      const w0 = st.win.pos, w1 = w0 + WIN_W;
      const color = 0x8FB6E8, steps = 5, depth = 3.0, spread = 1.2;
      for (let i = steps; i >= 1; i--) {
        const t = i / steps, d = depth * t, sp = spread * t;
        let pts;
        if (st.win.side === 'right') {
          const x0 = Math.max(0, w0 - sp), x1 = Math.min(F, w1 + sp);
          pts = [I.P(w0, 0), I.P(w1, 0), I.P(x1, d), I.P(x0, d)];
        } else if (st.win.side === 'frontRight') {
          const y0 = Math.max(0, w0 - sp), y1 = Math.min(F, w1 + sp);
          pts = [I.P(F, w0), I.P(F, w1), I.P(F - d, y1), I.P(F - d, y0)];
        } else continue;
        g.fillStyle(color, 0.05);
        g.fillPoints(pts.map(p => ({ x: p[0], y: p[1] })), true);
      }
    },

    // N вложенных овалов одинаковой альфы вокруг экранной точки center —
    // общий помощник для пола и стены, отличаются только тем, какой мировой
    // масштаб (scaleX/scaleY) соответствует «одной клетке» по каждой оси
    // экранного эллипса (см. вызовы ниже).
    drawGlowRings(g, center, radius, color, scaleX, scaleY, steps, baseAlpha) {
      for (let i = steps; i >= 1; i--) {
        const r = radius * i / steps;
        g.fillStyle(color, baseAlpha);
        g.fillEllipse(center[0], center[1], r * scaleX, r * scaleY);
      }
    },

    // Свечение на полу — круг радиуса L.radius вокруг источника. Мировая
    // окружность после проекции I.P — эллипс БЕЗ поворота: диагонали x-y и
    // x+y (веса TW/TH в P()) и есть его собственные оси, поэтому радиус по
    // каждой экранной оси — это диаметр окружности (2r), умноженный на TW
    // (по x-y) или TH (по x+y) и на √2 (переход в диагональные координаты).
    drawFloorGlow(g, L) {
      const k = 2 * Math.SQRT2;
      const center = I.P(L.x, L.y);
      this.drawGlowRings(g, center, L.radius, L.color, I.PROJ.TW * k, I.PROJ.TH * k, 5, 0.05);
    },

    // Тёплое пятно на ближайшей стене — тот же приём, приближённо (плоскость
    // стены — x/y × высота — под сдвиговой, не чисто диагональной проекцией,
    // поэтому точного поворота эллипса тут нет, овал берём по осям экрана —
    // для мягкого пятна света хватает). Свет из середины комнаты, далёкий от
    // обеих стен, просто не достаёт (reach <= 0) — стену не подсвечиваем.
    drawWallGlow(g, L) {
      const reachR = L.radius - L.y; // дальняя (правая) стена — плоскость y=0
      if (reachR > 0.3) {
        const center = I.P(L.x, 0, L.z);
        this.drawGlowRings(g, center, reachR, L.color, Math.hypot(I.PROJ.TW, I.PROJ.TH) * 1.6, I.PROJ.ZH * 1.5, 4, 0.05);
      }
      const reachL = L.radius - L.x; // левая стена — плоскость x=0
      if (reachL > 0.3) {
        const center = I.P(0, L.y, L.z);
        this.drawGlowRings(g, center, reachL, L.color, Math.hypot(I.PROJ.TW, I.PROJ.TH) * 1.6, I.PROJ.ZH * 1.5, 4, 0.05);
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
