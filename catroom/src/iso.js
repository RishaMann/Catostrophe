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

  /* ---------- статические зоны: пол ----------
     История: раньше пол размечался конечным списком именованных зон
     (курированные B1, RF_A..C, M0..M7, FL_i, FR_i, FC, плюс плотная сетка
     G-ячеек поверх них). Дважды упёрлись в потолок этого подхода — сначала «половина пола
     недоступна» (граница Lx/Ld не совпадала с реальной видимостью после
     zoom), потом «шкаф/аквариум никуда не помещаются» (ячейка сетки была
     меньше мебели) — а диван и ковёр из-за единственной подходящей по
     размеру зоны вообще нельзя было переставить в другое место. Вместо
     очередной подгонки размера ячейки — свободная расстановка (см.
     floorBand/floorOrient/floorRect/rejectFloor ниже): легальность точки
     считается геометрией (границы комнаты, проход к двери, пересечение с
     другой мебелью, категория по фактической полосе), а не принадлежностью
     заранее нарисованной зоне. generateLayout больше не нужен движку —
     оставлен пустым (а не удалён), чтобы вызов по старому имени не падал,
     если где-то ещё на него ссылаются (см. предупреждение в шапке файла:
     это общий с редактором уровней модуль).
     ========================================================================== */
  function generateLayout() { return []; }

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

  function dynamicZones(st, LAY, items) {
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

    // поверхность дивана появляется только если диван где-то стоит —
    // позиция теперь из свободной расстановки (st.floor.sofa), не из
    // курированной зоны (её больше нет).
    const sofaPos = st.floor && st.floor.sofa;
    if (sofaPos && items.sofa) {
      const it = items.sofa, cx = sofaPos.x, cy = sofaPos.y;
      const [w, d] = floorOrient(it, cx, cy);
      z.push({
        id: 'ON_SOFA', band: 'surface', zh: it.s[2], ru: 'На диване',
        r: [cx - w / 2 + 0.12, cy - d / 2 + 0.1, cx + w / 2 - 0.12, cy + d / 2 - 0.1]
      });
    }
    return z;
  }

  /* ---------- свободная расстановка мебели по полу ----------
     Каждый floor-предмет (cat: tall/mid/low) хранит СВОЮ мировую позицию —
     центр footprint'а — в st.floor[iid] = {x, y}. Никакого списка зон:
     легальность точки — геометрия (границы комнаты, проход к двери,
     пересечение с другой уже стоящей мебелью, категория по фактической
     полосе расстояния до стен/переднего края), а не принадлежность заранее
     нарисованной зоне. Стены/потолок/поверхности (curtain, bulb, plaid и
     т.п.) свободной расстановки не касаются — там по-прежнему конечный
     список зон из dynamicZones() выше, они привязаны к конкретным
     конструктивным местам (стена, крепление лампы, сиденье дивана), а не к
     свободной площади пола. */

  // Полосы те же пороги, что раньше были у плотной сетки/курированных зон —
  // просто теперь считаются от фактической позиции предмета, а не от id
  // заранее нарисованной ячейки.
  function floorBand(cx, cy, F) {
    if (Math.min(cx, cy) < 1.3) return 'back';
    if (Math.max(cx, cy) > F - 1.15) return 'front';
    return 'mid';
  }

  // Та же эвристика, что раньше жила только в «призраке» в руке (drawGhost,
  // ui/hud.js): широкой стороной к БЛИЖАЙШЕЙ задней стене — расстояние до
  // левой стены (x=0) это cx, до правой (y=0) это cy.
  function floorOrient(it, cx, cy) {
    return cx <= cy ? [it.s[1], it.s[0]] : [it.s[0], it.s[1]];
  }

  function floorRect(it, cx, cy) {
    const [w, d] = floorOrient(it, cx, cy);
    return [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2];
  }

  // Контур floor-прямоугольника в экранных координатах — тот же порядок
  // углов, что у zonePoly() для обычного (не wall/surface) случая.
  function floorPoly(r) {
    const [a, b, c, d] = r;
    return [P(a, b), P(c, b), P(c, d), P(a, d)];
  }

  function doorClearRect(st, F) {
    const d0 = st.door.pos, d1 = d0 + DOOR_W;
    return st.door.side === 'left'
      ? [0, d0 - 0.15, 1.1, d1 + 0.15]
      : [d0 - 0.15, F - 1.15, d1 + 0.15, F];
  }

  // excludeIid — свой же iid при перестановке уже стоящего предмета: иначе
  // предмет всегда конфликтовал бы сам с собой на прежнем месте.
  function rejectFloor(cx, cy, it, st, items, F, excludeIid) {
    const r = floorRect(it, cx, cy);
    if (r[0] < -0.01 || r[1] < -0.01 || r[2] > F + 0.01 || r[3] > F + 0.01) return 'не помещается в комнату';
    if (overlap(r, doorClearRect(st, F))) return 'проход к двери должен оставаться свободным';

    const band = floorBand(cx, cy, F);
    const okCat = ACCEPTS[band].includes(it.cat) || (band === 'front' && it.frontOk);
    if (!okCat) return {
      back: 'сюда встаёт мебель у стен', mid: 'здесь только среднее и низкое', front: 'ближний край держим низким'
    }[band];

    // то же правило, что раньше было флагом maxH у курированных зон вдоль
    // правой (задней) стены под окном: не заслонять окно высокой мебелью.
    if (st.win.side === 'right' && r[1] < 1.25 && r[0] >= 1.0 && it.s[2] > 1.3) {
      const w0 = st.win.pos, w1 = w0 + WIN_W;
      const ov = Math.min(r[2], w1) - Math.max(r[0], w0);
      if (ov > 0 && ov / (r[2] - r[0]) > 0.5) return 'загородит окно';
    }

    // Пересечение с другой мебелью — «плоские» предметы (ковёр и т.п.,
    // высота < 0.2, тот же порог, что у навигационных «solid»-препятствий)
    // в проверку не идут ни как помеха, ни как то, чему мешают: ковёр лежит
    // ПОД мебелью, а не конкурирует с ней за место.
    if (it.s[2] >= 0.2) {
      for (const [iid, pos] of Object.entries(st.floor || {})) {
        if (iid === excludeIid) continue;
        const other = items[iid];
        if (!other || !other.s || other.s[2] < 0.2) continue;
        if (overlap(r, floorRect(other, pos.x, pos.y))) return 'здесь уже стоит: ' + other.ru;
      }
    }
    return null;
  }

  function floorDepth(pos) { return pos.x + pos.y; }

  function floorFootprint(items, floorState, iid) {
    const it = items[iid], pos = floorState[iid];
    if (!it || !it.s || !pos) return null;
    return { r: floorRect(it, pos.x, pos.y), h: it.s[2], it, c: [pos.x, pos.y] };
  }

  /* ---------- сборка сцены целиком ---------- */
  // Вход: параметры сцены + состояние (дверь, окно, раскладка, свободная
  // расстановка) + каталог предметов. Выход: PROJ, границы, список зон
  // (стены/потолок/поверхности — floor-мебель в них больше не участвует,
  // см. rejectFloor/floorFootprint) и карта зон.
  function buildScene(params, st, items) {
    applyProj(params);
    const LAY = layoutBounds(params);
    const F = params.F || params.floor;

    const zones = dynamicZones(st, LAY, items);
    const zmap = Object.fromEntries(zones.map(z => [z.id, z]));
    Object.keys(st.place).forEach(k => { if (k !== 'CEIL' && !zmap[k]) delete st.place[k]; });
    if (!st.floor) st.floor = {};
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
     поставленной floor-мебели (свободная расстановка, st.floor). Она НЕ
     зависит от того, сколько где легальных мест для постановки — пустое
     место на проходимость не влияет никак. Стены/потолок/поверхности пола
     не касаются и тут не участвуют.                                       */
  function navObstaclesFloor(items, floorState) {
    const solid = [], touch = [];
    Object.keys(floorState || {}).forEach(iid => {
      const f = floorFootprint(items, floorState, iid);
      if (!f) return;
      if (f.h >= 0.2) solid.push(f.r);
      if (f.it.touch) touch.push(f);
    });
    return { solid, touch };
  }

  function buildNav(items, floorState, catPos) {
    const F = PROJ.F, GN = Math.round(F / STEP) + 1;
    const b = { x0: CAT_R, y0: CAT_R, x1: F - CAT_R, y1: F - CAT_R };
    const { solid, touch } = navObstaclesFloor(items, floorState);
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
    // свободная расстановка floor-мебели (см. блок выше dynamicZones)
    floorBand, floorOrient, floorRect, floorPoly, floorDepth, floorFootprint, rejectFloor,
    buildNav, findPath, randomSpot, nearSpot
  };
})(typeof window !== 'undefined' ? window : globalThis);
