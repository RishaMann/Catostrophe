/* ============================================================================
   room/itemShapes.js — силуэты предметов пола/поверхности для itemsRender.js.
   Раньше drawItemInto() рисовал ЛЮБОЙ предмет одинаковым прозрачным боксом по
   его габаритам (w,d,h) — по нему нельзя было отличить шкаф от коробки.
   Тут — по функции на id: тот же боковой/верхний конвент граней (faceBlock,
   один в один старый inline-box), но с деталями, которые читаются силуэтом:
   шов дверец шкафа, полки стеллажа, абажур торшера, спинка/подлокотники
   дивана и т.д. Не иллюстрация — минимум штрихов, достаточных, чтобы предмет
   не путался с соседним по каталогу.

   Каждая функция получает ctx = {g, poly, cx, cy, w, d, h, it, I, COL}, где
   cx,cy — центр зоны, w,d,h — фактические габариты (I.fit уже применён,
   поэтому НЕ считаем, что w==it.s[0] — может быть повёрнуто на 90°, см.
   frame()/orientation() ниже), it — сам предмет из GAMEDATA.ITEMS (нужен,
   чтобы это определить), poly — тот же polyOn-хелпер сцены.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ---------- геометрические примитивы, общие для нескольких предметов ---------- */

  // Точки окружности радиуса (rx,ry) в мировых x,y на высоте z — после
  // проекции I.P превращаются в характерный «сплюснутый» эллипс, как и
  // положено кругу в этой аксонометрии.
  function ringPts(I, cx, cy, rx, ry, z, n) {
    n = n || 16;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      out.push(I.P(cx + rx * Math.cos(a), cy + ry * Math.sin(a), z));
    }
    return out;
  }

  // Прямоугольный параллелепипед между z0 и z1 — те же две видимые боковые
  // грани + крышка, что рисовал старый inline-box в drawItemInto, но с
  // произвольными x0..y1/z0..z1 (можно звать несколько раз для разных
  // «этажей» одного предмета — тумба+спинка дивана, платформа+стойка когтеточки).
  function faceBlock(poly, I, COL, x0, y0, x1, y1, z0, z1, a1, a2, a3) {
    a1 = a1 === undefined ? 0.10 : a1;
    a2 = a2 === undefined ? 0.05 : a2;
    a3 = a3 === undefined ? 0.17 : a3;
    const A = [x0, y0], B = [x1, y0], C = [x1, y1], E = [x0, y1];
    if (a1 !== null) poly([I.P(B[0], B[1], z0), I.P(C[0], C[1], z0), I.P(C[0], C[1], z1), I.P(B[0], B[1], z1)],
      COL.chalk, a1, COL.chalk, 1);
    if (a2 !== null) poly([I.P(E[0], E[1], z0), I.P(C[0], C[1], z0), I.P(C[0], C[1], z1), I.P(E[0], E[1], z1)],
      COL.chalk, a2, COL.chalk, 1);
    if (a3 !== null) poly([I.P(A[0], A[1], z1), I.P(B[0], B[1], z1), I.P(C[0], C[1], z1), I.P(E[0], E[1], z1)],
      COL.chalk, a3, COL.chalk, 1);
  }

  // Барабан/цилиндр: два кольца + два «ребра» силуэта (те же угловые точки,
  // что у faceBlock, только на окружности) — пуф, лежанка, миски, стойка
  // когтеточки. bottomSw — толщина нижнего (дальнего, еле видного) кольца.
  function drum(poly, g, I, COL, cx, cy, rx, ry, z0, z1, topAlpha, n) {
    n = n || 20;
    poly(ringPts(I, cx, cy, rx, ry, z0, n), null, 0, COL.chalk, 0.8);
    poly(ringPts(I, cx, cy, rx, ry, z1, n), COL.chalk, topAlpha == null ? 0.14 : topAlpha, COL.chalk, 1);
    const pR0 = I.P(cx + rx, cy, z0), pR1 = I.P(cx + rx, cy, z1);
    const pF0 = I.P(cx, cy + ry, z0), pF1 = I.P(cx, cy + ry, z1);
    g.lineStyle(1, COL.chalk, 0.5);
    g.lineBetween(pR0[0], pR0[1], pR1[0], pR1[1]);
    g.lineBetween(pF0[0], pF0[1], pF1[0], pF1[1]);
  }

  // Усечённая пирамида (абажур торшера): своя ширина внизу и вверху.
  function frustum(poly, I, COL, cx, cy, rxB, ryB, rxT, ryT, zB, zT, alphas) {
    const A = [cx - rxB, cy - ryB], B = [cx + rxB, cy - ryB], C = [cx + rxB, cy + ryB], E = [cx - rxB, cy + ryB];
    const A1 = [cx - rxT, cy - ryT], B1 = [cx + rxT, cy - ryT], C1 = [cx + rxT, cy + ryT], E1 = [cx - rxT, cy + ryT];
    poly([I.P(B[0], B[1], zB), I.P(C[0], C[1], zB), I.P(C1[0], C1[1], zT), I.P(B1[0], B1[1], zT)],
      COL.chalk, alphas[0], COL.chalk, 1);
    poly([I.P(E[0], E[1], zB), I.P(C[0], C[1], zB), I.P(C1[0], C1[1], zT), I.P(E1[0], E1[1], zT)],
      COL.chalk, alphas[1], COL.chalk, 1);
    poly([I.P(A1[0], A1[1], zT), I.P(B1[0], B1[1], zT), I.P(C1[0], C1[1], zT), I.P(E1[0], E1[1], zT)],
      null, 0, COL.chalk, 0.8);
    poly([I.P(A[0], A[1], zB), I.P(B[0], B[1], zB), I.P(C[0], C[1], zB), I.P(E[0], E[1], zB)],
      null, 0, COL.chalk, 0.4);
  }

  // I.floorOrient() (iso.js) кладёт предмет длинной стороной (it.s[0]) вдоль
  // БЛИЖАЙШЕЙ задней стены — то есть ПОВОРАЧИВАЕТ его на 90°, когда позиция
  // того требует, а не растягивает. Асимметричные детали
  // (шов дверец шкафа, спинка дивана, полки, бортик миски...) обязаны
  // поворачиваться вместе с ним: они заданы не в мировых x/y, а в локальных
  // u (вдоль длины it.s[0]) / v (вдоль глубины it.s[1]), которые frame()
  // переводит в мировые координаты с учётом поворота. Без этого предмет в
  // развёрнутой зоне выглядит не повёрнутым, а растянутым по одной из осей.
  function orientation(it, w) {
    if (!it || !it.s) return false;
    const L = it.s[0], S = it.s[1];
    if (Math.abs(L - S) < 1e-6) return false; // квадратный в плане — поворот не виден
    return Math.abs(w - S) < Math.abs(w - L); // w сейчас читается как короткая сторона → повёрнут
  }
  function frame(ctx) {
    const { it, w, d, cx, cy } = ctx;
    const rot = orientation(it, w);
    const lenFull = rot ? d : w, depFull = rot ? w : d;
    return { rot, cx, cy, lenFull, depFull, lenHalf: lenFull / 2, depHalf: depFull / 2 };
  }
  // (u,v) → мировые (x,y): u вдоль длины предмета, v вдоль глубины.
  function pt(fr, u, v) { return fr.rot ? [fr.cx + v, fr.cy + u] : [fr.cx + u, fr.cy + v]; }
  // Прямоугольник в (u,v) → мировые [x0,y0,x1,y1] (для faceBlock).
  function uvBox(fr, uFrom, uTo, vFrom, vTo) {
    const a = pt(fr, uFrom, vFrom), b = pt(fr, uTo, vTo);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }
  // Радиусы «вдоль длины/вдоль глубины» → мировые rx,ry (для ringPts/drum).
  function uvRadii(fr, radLen, radDep) { return fr.rot ? [radDep, radLen] : [radLen, radDep]; }

  /* ---------- по предмету: cat 'tall'/'mid'/'low' из data.js ---------- */
  const SHAPES = {

    wardrobe(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      faceBlock(poly, I, COL, x0, y0, x1, y1, 0, h);
      const fr = frame(ctx); // шов/ручки — на лицевой (длинной) грани, поворачивается вместе с предметом
      const front = pt(fr, 0, fr.depHalf);
      g.lineStyle(1, COL.chalk, 0.55); // шов между дверцами
      const s0 = I.P(front[0], front[1], 0.06 * h), s1 = I.P(front[0], front[1], 0.92 * h);
      g.lineBetween(s0[0], s0[1], s1[0], s1[1]);
      g.fillStyle(COL.chalk, 0.8); // ручки
      [-0.07, 0.07].forEach(f => {
        const p2 = pt(fr, f * fr.lenFull, fr.depHalf), p = I.P(p2[0], p2[1], h * 0.5);
        g.fillCircle(p[0], p[1], 1.6);
      });
    },

    bookshelf(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      faceBlock(poly, I, COL, x0, y0, x1, y1, 0, h);
      const fr = frame(ctx); // полки/корешки — на лицевой грани, во всю длину предмета
      const eL = pt(fr, -fr.lenHalf, fr.depHalf), eR = pt(fr, fr.lenHalf, fr.depHalf);
      g.lineStyle(1, COL.chalk, 0.4); // полки — 3 линии, иначе за 2м высоты
      [0.16, 0.42, 0.68].forEach(f => { // 76см без единой полки не смотрится книжным
        const a = I.P(eL[0], eL[1], h * f), b = I.P(eR[0], eR[1], h * f);
        g.lineBetween(a[0], a[1], b[0], b[1]);
      });
      g.lineStyle(1.4, COL.chalk, 0.5); // корешки книг на нижней полке
      [0.28, 0.5, 0.72].forEach(f => {
        const p2 = pt(fr, -fr.lenHalf + f * fr.lenFull, fr.depHalf);
        const a = I.P(p2[0], p2[1], h * 0.06), b = I.P(p2[0], p2[1], h * 0.34);
        g.lineBetween(a[0], a[1], b[0], b[1]);
      });
    },

    lamp(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      poly(ringPts(I, cx, cy, w * 0.42, d * 0.42, h * 0.02, 16), null, 0, COL.chalk, 0.8); // подставка
      g.lineStyle(1.4, COL.chalk, 0.7); // стойка — большая часть высоты, абажур компактный сверху
      const p0 = I.P(cx, cy, h * 0.04), p1 = I.P(cx, cy, h * 0.78);
      g.lineBetween(p0[0], p0[1], p1[0], p1[1]);
      frustum(poly, I, COL, cx, cy, w * 0.5, d * 0.5, w * 0.28, d * 0.28, h * 0.78, h * 0.98, [0.14, 0.08]);
    },

    sofa(ctx) {
      const { poly, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      faceBlock(poly, I, COL, x0, y0, x1, y1, 0, h * 0.55); // сиденье — сам бокс симметричен, поворот ему не важен
      const fr = frame(ctx);
      // спинка — вдоль дальнего (v=-depHalf) края, во всю длину предмета
      const back = uvBox(fr, -fr.lenHalf, fr.lenHalf, -fr.depHalf, -fr.depHalf + fr.depFull * 0.22);
      faceBlock(poly, I, COL, back[0], back[1], back[2], back[3], h * 0.5, h, 0.12, 0.06, 0.16);
      // подлокотники — по обоим концам длины, во всю глубину
      const armA = uvBox(fr, -fr.lenHalf, -fr.lenHalf + fr.lenFull * 0.12, -fr.depHalf, fr.depHalf);
      const armB = uvBox(fr, fr.lenHalf - fr.lenFull * 0.12, fr.lenHalf, -fr.depHalf, fr.depHalf);
      faceBlock(poly, I, COL, armA[0], armA[1], armA[2], armA[3], h * 0.32, h * 0.78, 0.12, 0.06, 0.18);
      faceBlock(poly, I, COL, armB[0], armB[1], armB[2], armB[3], h * 0.32, h * 0.78, 0.12, 0.06, 0.18);
    },

    aquarium(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      faceBlock(poly, I, COL, x0, y0, x1, y1, 0, h);
      const fr = frame(ctx); // уровень воды на обеих видимых гранях — поворачивается вместе с баком
      g.lineStyle(1, COL.chalk, 0.5);
      const eL = pt(fr, -fr.lenHalf, fr.depHalf), eR = pt(fr, fr.lenHalf, fr.depHalf);
      const a = I.P(eL[0], eL[1], h * 0.8), b = I.P(eR[0], eR[1], h * 0.8);
      g.lineBetween(a[0], a[1], b[0], b[1]);
      const sN = pt(fr, fr.lenHalf, -fr.depHalf), sF = pt(fr, fr.lenHalf, fr.depHalf);
      const a2 = I.P(sN[0], sN[1], h * 0.8), b2 = I.P(sF[0], sF[1], h * 0.8);
      g.lineBetween(a2[0], a2[1], b2[0], b2[1]);
      [[-0.18, 0.05, 0.35], [0.12, -0.05, 0.5]].forEach(([uf, vf, zf]) => {
        const p2 = pt(fr, uf * fr.lenFull, vf * fr.depFull);
        const [rx, ry] = uvRadii(fr, fr.lenFull * 0.07, fr.depFull * 0.08);
        poly(ringPts(I, p2[0], p2[1], rx, ry, h * zf, 10), COL.chalk, 0.25, COL.chalk, 0.8);
      });
    },

    rug(ctx) {
      const { poly, cx, cy, w, d, h, I, COL } = ctx;
      const z = Math.max(h, 0.02);
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      poly([I.P(x0, y0, z), I.P(x1, y0, z), I.P(x1, y1, z), I.P(x0, y1, z)], COL.chalk, 0.09, COL.chalk, 1);
      const ix0 = cx - w * 0.36, ix1 = cx + w * 0.36, iy0 = cy - d * 0.36, iy1 = cy + d * 0.36;
      poly([I.P(ix0, iy0, z), I.P(ix1, iy0, z), I.P(ix1, iy1, z), I.P(ix0, iy1, z)], null, 0, COL.chalk, 0.7);
    },

    table(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      const topZ0 = h * 0.9; // тонкая столешница (~4см на 40см высоты), не толстый бокс
      faceBlock(poly, I, COL, x0, y0, x1, y1, topZ0, h, 0.12, 0.06, 0.20);
      g.lineStyle(1.2, COL.chalk, 0.55); // ножки
      [[x0 + w * 0.12, y0 + d * 0.12], [x1 - w * 0.12, y0 + d * 0.12],
      [x1 - w * 0.12, y1 - d * 0.12], [x0 + w * 0.12, y1 - d * 0.12]].forEach(([lx, ly]) => {
        const a = I.P(lx, ly, 0), b = I.P(lx, ly, topZ0);
        g.lineBetween(a[0], a[1], b[0], b[1]);
      });
    },

    pouf(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      drum(poly, g, I, COL, cx, cy, w * 0.48, d * 0.48, 0, h, 0.16);
    },

    ficus(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2, potH = h * 0.22;
      faceBlock(poly, I, COL, x0, y0, x1, y1, 0, potH, 0.12, 0.06, 0.18); // горшок
      g.lineStyle(1.2, COL.chalk, 0.5); // ствол
      const t0 = I.P(cx, cy, potH), t1 = I.P(cx, cy, h * 0.5);
      g.lineBetween(t0[0], t0[1], t1[0], t1[1]);
      [[cx - w * 0.16, cy, h * 0.62], [cx + w * 0.16, cy, h * 0.62], [cx, cy - d * 0.1, h * 0.88]] // крона
        .forEach(([fx, fy, fz]) => poly(ringPts(I, fx, fy, w * 0.34, d * 0.24, fz, 14), COL.chalk, 0.18, COL.chalk, 0.9));
    },

    scratch(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      faceBlock(poly, I, COL, x0, y0, x1, y1, 0, h * 0.14, 0.12, 0.06, 0.2); // база
      drum(poly, g, I, COL, cx, cy, w * 0.22, d * 0.22, h * 0.14, h * 0.82, 0.1); // столб
      faceBlock(poly, I, COL, cx - w * 0.34, cy - d * 0.34, cx + w * 0.34, cy + d * 0.34, // площадка
        h * 0.82, h, 0.14, 0.08, 0.22);
      g.lineStyle(1, COL.chalk, 0.6); // игрушка на верёвке
      const anchor = I.P(cx + w * 0.3, cy, h * 0.95), bp = I.P(cx + w * 0.32, cy, h * 0.7);
      g.lineBetween(anchor[0], anchor[1], bp[0], bp[1]);
      g.fillStyle(COL.chalk, 0.2); g.fillCircle(bp[0], bp[1], 3.5);
      g.lineStyle(1, COL.chalk, 0.7); g.strokeCircle(bp[0], bp[1], 3.5);
    },

    box(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      faceBlock(poly, I, COL, x0, y0, x1, y1, 0, h);
      g.lineStyle(1, COL.chalk, 0.45); // сложенные крышки-клапаны — крест на крышке
      const A = I.P(x0, y0, h), B = I.P(x1, y0, h), C = I.P(x1, y1, h), E = I.P(x0, y1, h), M = I.P(cx, cy, h);
      [A, B, C, E].forEach(P => g.lineBetween(P[0], P[1], M[0], M[1]));
    },

    bed(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      drum(poly, g, I, COL, cx, cy, w * 0.5, d * 0.5, 0, h, 0.15);
      poly(ringPts(I, cx, cy, w * 0.32, d * 0.32, h * 0.55, 16), null, 0, COL.chalk, 0.6); // лежак-выемка
    },

    bowls(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      // h — высота отведённой зоны (с ковриком), не самой миски: миска мельче
      // (~7-8см у борта), иначе на вид получается ведёрко, а не миска.
      const rim = h * 0.42;
      const fr = frame(ctx); // миски стоят рядом вдоль длины предмета, не всегда вдоль мирового x
      const c1 = pt(fr, -0.22 * fr.lenFull, 0), c2 = pt(fr, 0.24 * fr.lenFull, 0);
      const [rx1, ry1] = uvRadii(fr, fr.lenFull * 0.16, fr.depFull * 0.22);
      const [rx2, ry2] = uvRadii(fr, fr.lenFull * 0.13, fr.depFull * 0.19);
      drum(poly, g, I, COL, c1[0], c1[1], rx1, ry1, 0, rim, 0.16, 12);
      drum(poly, g, I, COL, c2[0], c2[1], rx2, ry2, 0, rim * 0.8, 0.16, 12);
    },

    vacuum(ctx) {
      const { poly, g, I, COL, cx, cy, w, d, h } = ctx;
      poly(ringPts(I, cx, cy, w * 0.48, d * 0.48, h, 20), COL.chalk, 0.15, COL.chalk, 1); // корпус-диск
      const p = I.P(cx, cy, h + 0.001);
      g.fillStyle(COL.amber, 0.7); g.fillCircle(p[0], p[1], 2.2); // индикатор
      const fr = frame(ctx); // датчик спереди — поперёк длины, у дальнего края
      const s1 = pt(fr, -0.3 * fr.lenFull, -0.42 * fr.depFull), s2 = pt(fr, 0.3 * fr.lenFull, -0.42 * fr.depFull);
      g.lineStyle(1, COL.chalk, 0.5);
      const a = I.P(s1[0], s1[1], h), b = I.P(s2[0], s2[1], h);
      g.lineBetween(a[0], a[1], b[0], b[1]);
    },

    scales(ctx) {
      const { poly, cx, cy, w, d, h, I, COL } = ctx;
      const z = Math.max(h, 0.03);
      const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
      poly([I.P(x0, y0, z), I.P(x1, y0, z), I.P(x1, y1, z), I.P(x0, y1, z)], COL.chalk, 0.14, COL.chalk, 1); // платформа
      const ix0 = cx - w * 0.28, ix1 = cx + w * 0.28, iy0 = cy - d * 0.2, iy1 = cy + d * 0.2, z2 = z + 0.005;
      poly([I.P(ix0, iy0, z2), I.P(ix1, iy0, z2), I.P(ix1, iy1, z2), I.P(ix0, iy1, z2)], COL.chalk, 0.3, COL.chalk, 0.8); // дисплей
    }
  };

  root.ITEM_SHAPES = {
    has: id => Object.prototype.hasOwnProperty.call(SHAPES, id),
    draw: (id, ctx) => SHAPES[id](ctx)
  };
})(typeof window !== 'undefined' ? window : globalThis);
