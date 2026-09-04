/* ============================================================================
   iso.js — ОБЩИЙ МОДУЛЬ. Один и тот же файл в движке и в редакторе уровней.

   Никаких импортов, никакого DOM, никакого Phaser. Только математика, которую
   обе стороны обязаны считать одинаково: проекция, глубина, габариты, зоны,
   проходимость. Если этот файл начнут "слегка адаптировать" на одной из сторон,
   предметы поедут в сортировке, а легальность разойдётся с картинкой.

   Всё состояние передаётся аргументами. Модуль не хранит ничего, кроме PROJ,
   который пересчитывается из параметров сцены.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ---------- константы кадра (совпадают с редактором) ---------- */
  const OX = 270, WALL = 3.4, TOPM = 112, MAXY = 700;
  const SCREEN_W = 540, SCREEN_H = 960;
  const DOOR_W = 1.15, DOOR_H = 2.35, WIN_W = 1.8, WIN_Z0 = 1.1, WIN_Z1 = 2.5, STUB = 0.55;
  const CAT_R = 0.36, STEP = 0.25;

  /* ---------- проекция ---------- */
  const PROJ = { TW: 60, TH: 30, ZH: 72, OY: 0, F: 6, tilt: 0.5 };

  // Комната держит размер кадра: F*TW всегда 360*zoom. Слайдер пола меняет
  // дробность сетки, а не экранный габарит комнаты.
  const kScale = p => 60 * (6 / p.floor) * p.zoom;

  function applyProj(p) {
    PROJ.TW = kScale(p);
    PROJ.TH = PROJ.TW * p.tilt;
    PROJ.ZH = PROJ.TW * 1.2;
    PROJ.OY = TOPM + WALL * PROJ.ZH;
    PROJ.F = p.floor;
    PROJ.tilt = p.tilt;
    return PROJ;
  }

  const P = (x, y, z = 0) => [OX + (x - y) * PROJ.TW, PROJ.OY + (x + y) * PROJ.TH - z * PROJ.ZH];
  const unP = (sx, sy) => {
    const u = (sx - OX) / PROJ.TW, v = (sy - PROJ.OY) / PROJ.TH;
    return [(u + v) / 2, (v - u) / 2];
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const centroid = p => [
    p.reduce((s, q) => s + q[0], 0) / p.length,
    p.reduce((s, q) => s + q[1], 0) / p.length
  ];

  /* ---------- полезная область: что реально попадает в кадр ---------- */
  // Lx — сколько клеток вширь помещается до левого/правого края кадра.
  // Ld — сколько клеток вглубь помещается до линии MAXY, ниже которой живут панели.
  // Зоны раскладываются только внутри этого прямоугольника. Клетки пола за его
  // пределами существуют, но ничего на них не ставится: на узком кадре игрок до
  // них не дотянется.
  function layoutBounds(p) {
    const TW = kScale(p), TH = TW * p.tilt, ZH = TW * 1.2, OY = TOPM + WALL * ZH;
    const Lx = (OX - 18) / TW;
    const Ld = (MAXY - OY) / TH;
    const Wend = Math.min(p.floor - 0.1, Lx - 0.05);
    return { Lx, Ld, Wend, F: p.floor };
  }

  /* ---------- статические зоны: пол ---------- */
  function generateLayout(p) {
    const F = p.floor, LAY = layoutBounds(p), Lx = LAY.Lx, Ld = LAY.Ld, Wend = LAY.Wend;
    const Z = [];
    const push = (id, band, r, ru, ex = {}) => {
      if (r[2] - r[0] < 0.6 || r[3] - r[1] < 0.6) return;
      if (r[0] < -0.01 || r[1] < -0.01 || r[2] > F || r[3] > F) return;
      Z.push({ id, band, r: r.map(v => Math.round(v * 100) / 100), ru, ...ex });
    };

    push('B1', 'back', [0, 0, 1.4, 1.25], 'Угол между стенами');

    // пол вдоль правой стены
    const rlen = Wend - 1.4, rn = clamp(Math.floor(rlen / 1.55), 0, 3);
    const rnm = ['Правая стена, у угла', 'Правая стена, дальше', 'Правая стена, дальний край'];
    for (let i = 0; i < rn; i++)
      push('RF_' + 'ABC'[i], 'back',
        [1.4 + i * (rlen / rn), 0, 1.4 + (i + 1) * (rlen / rn) - 0.05, 1.2], rnm[i]);

    // середина
    const mx0 = 1.45, my0 = 1.3;
    const mx1 = Math.min(F - 1.35, my0 + Lx - 0.25, Ld - 1.3 - my0);
    const my1 = Math.min(F - 1.35, mx0 + Lx - 0.25, Ld - 1.3 - mx0);
    push('M0', 'mid', [mx0, my0, Math.min(mx0 + 3.1, mx1), Math.min(my0 + 3.0, my1)],
      'Центр пола (ковёр)', { flat: true });
    push('M1', 'mid', [mx0, my0, mx0 + 1.1, Math.min(my0 + 2.2, my1)],
      'Середина, вдоль левой стены');
    push('M4', 'mid', [Math.max(mx1 - 1.05, mx0 + 1.35), my0, mx1, Math.min(my0 + 2.05, my1)],
      'Середина, вдоль правой стены');
    push('M2', 'mid', [mx0 + 1.25, my0 + 0.05, Math.min(mx0 + 2.45, mx1 - 1.15), my0 + 1.35],
      'Середина, центр');
    push('M7', 'mid', [mx0 + 1.15, my0 + 1.5, Math.min(mx0 + 3.2, mx1 - 0.05), my0 + 2.6],
      'Середина, поперёк');
    push('M5', 'mid', [mx0 - 0.15, my0 + 2.45, mx0 + 0.95, Math.min(my0 + 3.4, my1)],
      'У левого плинтуса');

    // передний ряд — буквой Г вдоль двух ближних краёв
    const fw = 1.15, fd = 1.05;
    const aMin = Math.max(1.55, F - 0.1 - Lx), aMax = Math.min(F - 1.35, Ld - F - fd);
    const fn = clamp(Math.floor((aMax - aMin) / (fw + 0.12)) + 1, 0, 3);
    for (let i = 0; i < fn; i++) {
      const a = aMin + i * (fw + 0.12);
      push('FL_' + i, 'front', [a, F - fd - 0.1, a + fw, F - 0.1], 'Ближний край, слева ' + (i + 1));
      push('FR_' + i, 'front', [F - fd - 0.1, a, F - 0.1, a + fw], 'Ближний край, справа ' + (i + 1));
    }
    push('FC', 'front', [F - fd - 0.1, F - fd - 0.1, F - 0.1, F - 0.1], 'Ближний угол');

    // Заказчик попросил весь пол доступным для расстановки, не только
    // курированные зоны выше (id'шники B1/RF_*/M*/FL_*/FR_*/FC — их не
    // трогаем, чтобы не сломать уже сохранённые раскладки сцен, которые на
    // них ссылаются). Плотно замащиваем регулярной сеткой ОСТАЛЬНУЮ, ещё не
    // занятую ни одной зоной выше, площадь пола — но только ту часть, что
    // реально попадает в кадр (Lx/Ld из layoutBounds), как и раньше: дальше
    // экрана игрок физически не дотянется, эту границу не меняем. band у
    // новой ячейки решает та же полоса глубины (близко к задним стенам / к
    // ближнему краю / середина), что и раньше — категории ACCEPTS ни для
    // одной зоны не меняются, только их плотность.
    const CELL = 1.05;
    const maxX = Math.min(F, Lx), maxY = Math.min(F, Ld);
    let gi = 0;
    for (let y0 = 0; y0 < maxY - 0.05; y0 += CELL) {
      const y1 = Math.min(y0 + CELL, maxY, F);
      for (let x0 = 0; x0 < maxX - 0.05; x0 += CELL) {
        const x1 = Math.min(x0 + CELL, maxX, F);
        const r = [x0, y0, x1, y1];
        // "занято", если хотя бы половина площади ячейки уже перекрыта
        // существующей (курированной) зоной — не дублируем, просто пропускаем.
        const coveredArea = Z.reduce((s, z) => {
          if (!overlap(z.r, r)) return s;
          const ow = Math.min(z.r[2], r[2]) - Math.max(z.r[0], r[0]);
          const oh = Math.min(z.r[3], r[3]) - Math.max(z.r[1], r[1]);
          return s + Math.max(0, ow) * Math.max(0, oh);
        }, 0);
        if (coveredArea > 0.5 * (r[2] - r[0]) * (r[3] - r[1])) continue;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        let band, ru;
        if (Math.min(cx, cy) < 1.3) { band = 'back'; ru = 'У задней стены'; }
        else if (Math.max(cx, cy) > F - 1.15) { band = 'front'; ru = 'У ближнего края'; }
        else { band = 'mid'; ru = 'Середина пола'; }
        push('G' + (gi++), band, r, ru);
      }
    }
    return Z;
  }

  /* ---------- динамические зоны: стены, окно, поверхность дивана ---------- */
  const ACCEPTS = {
    back: ['tall', 'mid', 'low'], mid: ['mid', 'low'], front: ['low'],
    wall: ['wall'], ceil: ['ceil'], surface: ['surface']
  };

  function split(from, to, ids, rus, make) {
    const w = to - from, out = [];
    if (w < 0.8) return out;
    if (w < 2.9) out.push(make(from, to, ids[0], rus[0]));
    else {
      const m = (from + to) / 2;
      out.push(make(from, m - 0.06, ids[0], rus[0]));
      out.push(make(m + 0.06, to, ids[1], rus[1]));
    }
    return out;
  }

  function dynamicZones(st, LAY, items, statics) {
    const z = [], W = LAY.Wend;
    const d0 = st.door.pos, d1 = st.door.pos + DOOR_W;
    const w0 = st.win.pos, w1 = st.win.pos + WIN_W;
    const mkL = (a, b, id, ru) => ({ id, band: 'wall', wall: 'left', r: [a, 1.55, b, 2.75], ru });
    const mkR = (a, b, id, ru) => ({ id, band: 'wall', wall: 'right', r: [a, 1.55, b, 2.75], ru });
    const mkFL = (a, b, id, ru) => ({ id, band: 'back', r: [0, a, 1.25, b], ru });

    if (st.door.side === 'left') {
      z.push(...split(1.25, Math.min(d0 - 0.15, W), ['LF_A', 'LF_B'],
        ['Левая стена, у угла', 'Левая стена, к двери'], mkFL));
      z.push(...split(d1 + 0.15, W, ['LF_C', 'LF_D'],
        ['Левая стена, за дверью', 'Левая стена, дальний край'], mkFL));
      z.push(...split(0.25, Math.min(d0 - 0.3, W), ['WL_A', 'WL_B'],
        ['Левая стена, у угла', 'Левая стена, к двери'], mkL));
      z.push(...split(d1 + 0.3, W, ['WL_C', 'WL_D'],
        ['Левая стена, за дверью', 'Левая стена, дальний край'], mkL));
      if (d1 < W) z.push({
        id: 'OVERDOOR', band: 'wall', wall: 'left',
        r: [d0 + 0.05, 2.5, d1 - 0.05, 3.1], ru: 'Над дверью'
      });
    } else {
      z.push(...split(1.25, W, ['LF_A', 'LF_B'],
        ['Левая стена, у угла', 'Левая стена, дальний край'], mkFL));
      z.push(...split(0.25, W, ['WL_A', 'WL_B'],
        ['Левая стена, у угла', 'Левая стена, дальний край'], mkL));
    }

    if (st.win.side === 'right') {
      z.push(...split(0.25, Math.min(w0 - 0.3, W), ['WR_A', 'WR_B'],
        ['Правая стена, у угла', 'Правая стена, к окну'], mkR));
      z.push(...split(w1 + 0.3, W, ['WR_C', 'WR_D'],
        ['Правая стена, за окном', 'Правая стена, дальний край'], mkR));
      z.push({ id: 'WIN_ROD', band: 'wall', wall: 'right', r: [w0 - 0.15, 2.55, w1 + 0.15, 3.1], ru: 'Карниз над окном' });
      z.push({ id: 'WIN_FRAME', band: 'wall', wall: 'right', r: [w0 - 0.25, WIN_Z0 - 0.05, w1 + 0.25, WIN_Z1 - 0.05], ru: 'Рама окна' });
    } else {
      z.push(...split(0.25, W, ['WR_A', 'WR_B'],
        ['Правая стена, у угла', 'Правая стена, дальний край'], mkR));
      z.push({ id: 'WIN_ROD', band: 'wall', wall: 'frontRight', r: [w0 - 0.1, 0.36, w1 + 0.1, 0.54], ru: 'Карниз (ближний край)' });
      z.push({ id: 'WIN_FRAME', band: 'wall', wall: 'frontRight', r: [w0 - 0.15, 0.1, w1 + 0.15, 0.34], ru: 'Рама (ближний край)' });
    }

    // поверхность дивана появляется только если диван где-то стоит
    const sz = Object.keys(st.place).find(k => st.place[k] === 'sofa');
    const base = Object.fromEntries(statics.map(x => [x.id, x]));
    if (sz && base[sz]) {
      const z0 = base[sz], it = items.sofa;
      const cx = (z0.r[0] + z0.r[2]) / 2, cy = (z0.r[1] + z0.r[3]) / 2;
      const zw = z0.r[2] - z0.r[0], zd = z0.r[3] - z0.r[1];
      const [w, d] = zw >= zd ? [it.s[0], it.s[1]] : [it.s[1], it.s[0]];
      z.push({
        id: 'ON_SOFA', band: 'surface', zh: it.s[2], ru: 'На диване',
        r: [cx - w / 2 + 0.12, cy - d / 2 + 0.1, cx + w / 2 - 0.12, cy + d / 2 - 0.1]
      });
    }
    return z;
  }

  /* ---------- сборка сцены целиком ---------- */
  // Вход: параметры сцены + состояние (дверь, окно, раскладка) + каталог предметов.
  // Выход: PROJ, границы, список зон и карта зон. Больше движку ничего не нужно.
  function buildScene(params, st, items) {
    applyProj(params);
    const LAY = layoutBounds(params);
    const statics = generateLayout(params);
    const F = params.F || params.floor;
    const d0 = st.door.pos, d1 = st.door.pos + DOOR_W;
    const w0 = st.win.pos, w1 = st.win.pos + WIN_W;

    // проход к двери держим свободным
    const clear = st.door.side === 'left'
      ? [0, d0 - 0.15, 1.1, d1 + 0.15]
      : [d0 - 0.15, F - 1.15, d1 + 0.15, F];

    const zones = [...statics, ...dynamicZones(st, LAY, items, statics)].map(z => {
      const o = { ...z };
      if (z.band === 'back' || z.band === 'mid' || z.band === 'front') {
        if (overlap(z.r, clear)) o.blocked = 'проход к двери должен оставаться свободным';
        if (st.win.side === 'right' && z.band === 'back' && z.r[1] < 1.25 && z.r[0] >= 1.0) {
          const ov = Math.min(z.r[2], w1) - Math.max(z.r[0], w0);
          if (ov > 0 && ov / (z.r[2] - z.r[0]) > 0.5) o.maxH = 1.3;
        }
      }
      return o;
    });

    const zmap = Object.fromEntries(zones.map(z => [z.id, z]));
    Object.keys(st.place).forEach(k => { if (k !== 'CEIL' && !zmap[k]) delete st.place[k]; });
    return { PROJ, LAY, zones, zmap };
  }

  /* ---------- габариты предмета в зоне ---------- */
  const fit = (it, z) => {
    const zw = z.r[2] - z.r[0], zd = z.r[3] - z.r[1], [L, S] = it.s;
    return zw >= zd ? [L, S] : [S, L];
  };

  function footprint(zmap, items, zid, iid) {
    const z = zmap[zid], it = items[iid];
    if (!it || !it.s || !z || z.band === 'wall' || z.band === 'surface') return null;
    const cx = (z.r[0] + z.r[2]) / 2, cy = (z.r[1] + z.r[3]) / 2, [w, d] = fit(it, z);
    return { r: [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2], h: it.s[2], it, c: [cx, cy] };
  }

  function reject(z, it) {
    if (z.blocked) return z.blocked;
    if (!ACCEPTS[z.band].includes(it.cat)) return {
      back: 'сюда встаёт мебель у стен', mid: 'здесь только среднее и низкое',
      front: 'ближний край держим низким', wall: 'это область на стене',
      ceil: 'это точка на потолке', surface: 'сюда кладут только то, что лежит на мебели'
    }[z.band];
    if (z.maxH && it.s && it.s[2] > z.maxH) return 'загородит окно';
    if (it.s && z.band !== 'surface') {
      const zw = z.r[2] - z.r[0], zd = z.r[3] - z.r[1];
      const L = Math.max(zw, zd), S = Math.min(zw, zd);
      if (it.s[0] > L - 0.1 || it.s[1] > S - 0.1) return 'не помещается: зона короче предмета';
    }
    return null;
  }

  // ключ сортировки по глубине: чем больше, тем ближе к зрителю
  const depth = (zmap, zid) => {
    const z = zmap[zid];
    return (z.r[0] + z.r[2]) / 2 + (z.r[1] + z.r[3]) / 2 + (z.band === 'surface' ? 0.01 : 0);
  };

  // контур зоны в экранных координатах
  function zonePoly(z, F) {
    const [a, b, c, d] = z.r;
    if (z.band === 'wall' && z.wall === 'right') return [P(a, 0, b), P(c, 0, b), P(c, 0, d), P(a, 0, d)];
    if (z.band === 'wall' && z.wall === 'left') return [P(0, a, b), P(0, c, b), P(0, c, d), P(0, a, d)];
    if (z.band === 'wall' && z.wall === 'frontRight') return [P(F, a, b), P(F, c, b), P(F, c, d), P(F, a, d)];
    if (z.band === 'surface') return [P(a, b, z.zh), P(c, b, z.zh), P(c, d, z.zh), P(a, d, z.zh)];
    return [P(a, b), P(c, b), P(c, d), P(a, d)];
  }

  /* ---------- проходимость ----------
     Навигационная область кота — весь пол минус препятствия от фактически
     поставленной мебели. Она НЕ зависит от того, сколько зон размещения есть и
     где они: пустая зона на проходимость не влияет никак.                    */
  function navObstacles(zmap, items, place) {
    const solid = [], touch = [];
    Object.entries(place).forEach(([zid, iid]) => {
      if (zid === 'CEIL' || !zmap[zid]) return;
      const f = footprint(zmap, items, zid, iid);
      if (!f) return;
      if (f.h >= 0.2) solid.push(f.r);
      if (f.it.touch) touch.push(f);
    });
    return { solid, touch };
  }

  function buildNav(zmap, items, place, catPos) {
    const F = PROJ.F, GN = Math.round(F / STEP) + 1;
    const b = { x0: CAT_R, y0: CAT_R, x1: F - CAT_R, y1: F - CAT_R };
    const { solid, touch } = navObstacles(zmap, items, place);
    const free = (x, y) => {
      if (x < b.x0 || y < b.y0 || x > b.x1 || y > b.y1) return false;
      return !solid.some(r => x > r[0] - CAT_R && x < r[2] + CAT_R && y > r[1] - CAT_R && y < r[3] + CAT_R);
    };
    const idx = (i, j) => i * GN + j, ok = [];
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) ok[idx(i, j)] = free(i * STEP, j * STEP);

    const comp = new Array(GN * GN).fill(-1); let nc = 0; const sizes = [];
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) {
      if (!ok[idx(i, j)] || comp[idx(i, j)] >= 0) continue;
      const q = [[i, j]]; comp[idx(i, j)] = nc; let n = 0;
      while (q.length) {
        const [a, bb] = q.pop(); n++;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([da, db]) => {
          const u = a + da, v = bb + db;
          if (u < 0 || v < 0 || u >= GN || v >= GN) return;
          if (ok[idx(u, v)] && comp[idx(u, v)] < 0) { comp[idx(u, v)] = nc; q.push([u, v]); }
        });
      }
      sizes[nc] = n; nc++;
    }

    const ci = clamp(Math.round(catPos.x / STEP), 0, GN - 1);
    const cj = clamp(Math.round(catPos.y / STEP), 0, GN - 1);
    let home = comp[idx(ci, cj)];
    if (home < 0 && sizes.length) home = sizes.indexOf(Math.max(...sizes));

    // предметы, к которым коту не подойти — главный инвариант комнаты
    const unreachable = touch.filter(f => {
      const [x0, y0, x1, y1] = f.r, m = CAT_R + 0.45;
      const i0 = clamp(Math.floor((x0 - m) / STEP), 0, GN - 1), i1 = clamp(Math.ceil((x1 + m) / STEP), 0, GN - 1);
      const j0 = clamp(Math.floor((y0 - m) / STEP), 0, GN - 1), j1 = clamp(Math.ceil((y1 + m) / STEP), 0, GN - 1);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++)
        if (comp[idx(i, j)] === home) return false;
      return true;
    }).map(f => f.it.ru);

    const total = ok.filter(Boolean).length;
    return {
      ok, comp, home, idx, GN, unreachable, pockets: nc,
      area: Math.round(100 * total * STEP * STEP / (F * F))
    };
  }

  function findPath(NAV, fx, fy, tx, ty) {
    if (!NAV) return [];
    const { GN, idx, comp, home } = NAV;
    const a = [clamp(Math.round(fx / STEP), 0, GN - 1), clamp(Math.round(fy / STEP), 0, GN - 1)];
    const b = [clamp(Math.round(tx / STEP), 0, GN - 1), clamp(Math.round(ty / STEP), 0, GN - 1)];
    if (comp[idx(b[0], b[1])] !== home) return [];
    const prev = new Array(GN * GN).fill(-1), seen = new Array(GN * GN).fill(false);
    const q = [a]; seen[idx(a[0], a[1])] = true;
    while (q.length) {
      const [i, j] = q.shift();
      if (i === b[0] && j === b[1]) break;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [di, dj] of nb) {
        const u = i + di, v = j + dj;
        if (u < 0 || v < 0 || u >= GN || v >= GN) continue;
        const k = idx(u, v);
        if (seen[k] || comp[k] !== home) continue;
        seen[k] = true; prev[k] = idx(i, j); q.push([u, v]);
      }
    }
    if (!seen[idx(b[0], b[1])]) return [];
    const path = []; let k = idx(b[0], b[1]);
    while (k >= 0 && k !== idx(a[0], a[1])) { path.push([Math.floor(k / GN) * STEP, (k % GN) * STEP]); k = prev[k]; }
    path.reverse();
    return path.filter((p, i) => i % 2 === 0 || i === path.length - 1);
  }

  function randomSpot(NAV, from, minD) {
    if (!NAV) return null;
    for (let n = 0; n < 200; n++) {
      const i = Math.floor(Math.random() * NAV.GN), j = Math.floor(Math.random() * NAV.GN);
      if (NAV.comp[NAV.idx(i, j)] !== NAV.home) continue;
      const x = i * STEP, y = j * STEP;
      if (Math.hypot(x - from.x, y - from.y) < minD) continue;
      return [x, y];
    }
    return null;
  }

  function nearSpot(NAV, x, y) {
    if (!NAV) return [x, y];
    let best = null, bd = 1e9;
    for (let i = 0; i < NAV.GN; i++) for (let j = 0; j < NAV.GN; j++) {
      if (NAV.comp[NAV.idx(i, j)] !== NAV.home) continue;
      const d = Math.hypot(i * STEP - x, j * STEP - y);
      if (d < bd) { bd = d; best = [i * STEP, j * STEP]; }
    }
    return best || [x, y];
  }

  root.ISO = {
    OX, WALL, TOPM, MAXY, SCREEN_W, SCREEN_H,
    DOOR_W, DOOR_H, WIN_W, WIN_Z0, WIN_Z1, STUB, CAT_R, STEP,
    PROJ, kScale, applyProj, P, unP, clamp, overlap, centroid,
    layoutBounds, generateLayout, dynamicZones, buildScene,
    ACCEPTS, fit, footprint, reject, depth, zonePoly,
    buildNav, findPath, randomSpot, nearSpot
  };
})(typeof window !== 'undefined' ? window : globalThis);
