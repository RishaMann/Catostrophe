/* ============================================================================
   icons.js — иконки предметов, один в один перенесённые из SVG-редактора.
   Рисуются процедурно: ассетов нет, всё Graphics. Так блокаут выглядит
   одинаково в редакторе и в движке.
   ========================================================================== */
(function (root) {
  'use strict';

  const CHALK = 0xEBE2D5;

  // квадратичная кривая → полилиния
  function q(from, cp, to, n) {
    n = n || 10;
    const out = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push({
        x: u * u * from.x + 2 * u * t * cp.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * cp.y + t * t * to.y
      });
    }
    return out;
  }
  // дуга-полуэллипс от угла a0 до a1 (в радианах), центр (cx,cy)
  function arc(cx, cy, rx, ry, a0, a1, n) {
    n = n || 14;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return out;
  }

  function drawIcon(g, id, ox, oy, S) {
    const LW = Math.max(1, 1.5 * S / 20);
    const line = () => g.lineStyle(LW, CHALK, 0.95);
    const soft = () => g.fillStyle(CHALK, 0.20);
    const px = (x, y) => ({ x: ox + x * S, y: oy + y * S });

    const R = (x, y, w, h, fill, rx) => {
      const p = px(x, y), W = w * S, H = h * S, r = (rx || 0) * S;
      if (fill) { soft(); r ? g.fillRoundedRect(p.x, p.y, W, H, r) : g.fillRect(p.x, p.y, W, H); }
      line(); r ? g.strokeRoundedRect(p.x, p.y, W, H, r) : g.strokeRect(p.x, p.y, W, H);
    };
    const C = (x, y, r, fill) => {
      const p = px(x, y);
      if (fill) { soft(); g.fillCircle(p.x, p.y, r * S); }
      line(); g.strokeCircle(p.x, p.y, r * S);
    };
    const E = (x, y, rx, ry, fill) => {
      const p = px(x, y);
      if (fill) { soft(); g.fillEllipse(p.x, p.y, rx * 2 * S, ry * 2 * S); }
      line(); g.strokeEllipse(p.x, p.y, rx * 2 * S, ry * 2 * S);
    };
    const Ln = (x1, y1, x2, y2) => {
      const a = px(x1, y1), b = px(x2, y2);
      line(); g.lineBetween(a.x, a.y, b.x, b.y);
    };
    const Pg = (pts, fill) => {
      const p = pts.map(a => px(a[0], a[1]));
      if (fill) { soft(); g.fillPoints(p, true); }
      line(); g.strokePoints(p, true);
    };
    // произвольная полилиния из локальных координат
    const Path = (pts, fill, close) => {
      const p = pts.map(a => (a.x !== undefined ? px(a.x, a.y) : px(a[0], a[1])));
      if (fill) { soft(); g.fillPoints(p, true); }
      line(); g.strokePoints(p, !!close);
    };
    const QP = (a, c, b, n) => q({ x: a[0], y: a[1] }, { x: c[0], y: c[1] }, { x: b[0], y: b[1] }, n);

    switch (id) {
      case 'wardrobe':
        R(-.5, -.8, 1, 1.6, 1, .08); Ln(0, -.8, 0, .8); C(-.12, 0, .06, 1); C(.12, 0, .06, 1); break;

      case 'bookshelf':
        R(-.55, -.8, 1.1, 1.6, 1, .06); Ln(-.55, -.25, .55, -.25); Ln(-.55, .25, .55, .25);
        R(-.42, -.72, .14, .42, 1); R(-.2, -.72, .14, .42, 1); R(-.42, -.18, .14, .4, 1); break;

      case 'lamp':
        Pg([[-.45, -.35], [.45, -.35], [.28, -.85], [-.28, -.85]], 1);
        Ln(0, -.35, 0, .7); Ln(-.3, .75, .3, .75); break;

      case 'sofa':
        R(-.75, -.35, 1.5, .5, 1, .1); R(-.75, .1, 1.5, .42, 1, .1);
        Ln(-.42, .1, -.42, .52); Ln(.42, .1, .42, .52);
        Ln(-.62, .52, -.62, .7); Ln(.62, .52, .62, .7); break;

      case 'aquarium': {
        R(-.7, -.5, 1.4, 1, 1, .06);
        const w1 = [[-.7, -.18]].concat(QP([-.7, -.18], [-.35, -.34], [0, -.18]).map(p => [p.x, p.y]));
        const w2 = QP([0, -.18], [.35, -.02], [.7, -.18]).map(p => [p.x, p.y]);
        Path(w1.concat(w2), 0, false);
        E(.1, .25, .2, .13, 1);
        Pg([[-.14, .25], [-.3, .12], [-.3, .38]], 1); break;
      }

      case 'rug': E(0, 0, .8, .5, 1); E(0, 0, .58, .34, 0); break;

      case 'table':
        R(-.75, -.2, 1.5, .22, 1, .05); Ln(-.55, .02, -.55, .6); Ln(.55, .02, .55, .6); break;

      case 'pouf':
        E(0, .1, .6, .4, 1);
        Path([[-.6, .1]].concat(QP([-.6, .1], [0, -.4], [.6, .1]).map(p => [p.x, p.y])), 0, false); break;

      case 'ficus':
        Pg([[-.32, .15], [.32, .15], [.24, .72], [-.24, .72]], 1);
        E(-.28, -.25, .28, .16, 1); E(.28, -.25, .28, .16, 1); E(0, -.52, .26, .17, 1);
        Ln(0, .15, 0, -.4); break;

      case 'scratch':
        R(-.22, -.6, .44, 1.1, 1, .06); R(-.5, .5, 1, .18, 1, .05);
        C(.45, -.45, .14, 1); Ln(.22, -.55, .45, -.5); break;

      case 'box':
        R(-.6, -.35, 1.2, 1, 1, .05);
        Ln(-.6, -.35, 0, -.05); Ln(.6, -.35, 0, -.05); Ln(0, -.05, 0, .65); break;

      case 'bed':
        Path(arc(0, -.1, .75, .6, Math.PI, 0).map(p => [p.x, p.y]), 1, true);
        Path(arc(0, -.1, .55, .34, Math.PI, 0).map(p => [p.x, p.y]), 0, false); break;

      case 'bowls':
        E(-.36, .1, .34, .24, 1); E(.38, .1, .3, .21, 1);
        C(-.36, .04, .05, 1); C(-.24, .08, .05, 1); break;

      case 'vacuum': C(0, .05, .6, 1); C(0, .05, .2, 0); Ln(-.45, -.3, .45, -.3); break;

      case 'scales': R(-.6, -.4, 1.2, .8, 1, .14); R(-.26, -.18, .52, .22, 1, .04); break;

      case 'plaid': {
        const pts = [[-.7, -.3], [.7, -.3], [.7, .2]]
          .concat(QP([.7, .2], [.35, .42], [0, .2]).map(p => [p.x, p.y]))
          .concat(QP([0, .2], [-.35, -.02], [-.7, .2]).map(p => [p.x, p.y]));
        Path(pts, 1, true);
        Ln(-.35, -.3, -.35, .18); Ln(.35, -.3, .35, .18); break;
      }

      case 'curtain': {
        Ln(-.8, -.6, .8, -.6);
        const half = (x0, x1) => [[x0, -.6], [x0, .5]]
          .concat(QP([x0, .5], [x0 + .18, .7], [x1, .5]).map(p => [p.x, p.y]))
          .concat([[x1, -.6]]);
        Path(half(-.7, -.34), 1, true);
        Path(half(.34, .7), 1, true); break;
      }

      case 'garland': {
        const pts = [[-.75, -.3]]
          .concat(QP([-.75, -.3], [-.375, .2], [0, -.3]).map(p => [p.x, p.y]))
          .concat(QP([0, -.3], [.375, -.8], [.75, -.3]).map(p => [p.x, p.y]));
        Path(pts, 0, false);
        C(-.4, .08, .11, 1); C(0, .16, .11, 1); C(.4, .08, .11, 1); break;
      }

      case 'wshelf':
        Ln(-.7, .2, .7, .2); Ln(-.5, .2, -.4, .5); Ln(.5, .2, .4, .5);
        R(-.5, -.2, .28, .4, 1, .04); C(0, -.02, .18, 1);
        Pg([[.3, .2], [.5, .2], [.4, -.2]], 1); break;

      case 'clock': C(0, 0, .7, 1); Ln(0, 0, 0, -.4); Ln(0, 0, .3, .1); break;

      case 'portrait':
        R(-.6, -.7, 1.2, 1.4, 1, .06); C(0, -.2, .22, 1);
        Pg([[-.4, .5], [0, .05], [.4, .5]], 1); break;

      case 'bulb': C(0, -.15, .42, 1); R(-.16, .27, .32, .3, 1, .05); Ln(0, -.57, 0, -.85); break;

      case 'chandelier':
        Ln(0, -.85, 0, -.35); Ln(-.6, -.35, .6, -.35);
        Pg([[-.75, -.05], [-.45, -.05], [-.6, -.35]], 1);
        Pg([[-.15, -.05], [.15, -.05], [0, -.35]], 1);
        Pg([[.45, -.05], [.75, -.05], [.6, -.35]], 1); break;

      case 'dry':
        Pg([[-.45, -.6], [.45, -.6], [.55, .65], [-.55, .65]], 1);
        C(-.2, .1, .09, 1); C(.12, .24, .09, 1); C(.2, -.08, .09, 1); C(-.1, -.3, .09, 1); break;

      case 'can':
        E(0, -.4, .55, .22, 1); R(-.55, -.4, 1.1, .85, 1, 0);
        Path(arc(0, .45, .55, .22, Math.PI, 0).map(p => [p.x, p.y]), 0, false);
        Ln(-.28, -.05, .28, -.05); break;

      case 'treat':
        E(-.05, 0, .5, .3, 1); Pg([[.45, 0], [.8, -.28], [.8, .28]], 1); C(-.28, -.07, .06, 1); break;

      case 'wand': {
        Ln(-.7, .7, .15, -.15);
        const pts = [[.15, -.15]]
          .concat(QP([.15, -.15], [.45, -.7], [.77, -.4]).map(p => [p.x, p.y]))
          .concat(QP([.77, -.4], [.72, .05], [.15, -.15]).map(p => [p.x, p.y]));
        Path(pts, 1, true); break;
      }

      case 'ball':
        C(0, 0, .62, 1);
        Path([[-.55, -.25]].concat(QP([-.55, -.25], [0, .1], [.55, -.25]).map(p => [p.x, p.y])), 0, false);
        Path([[-.4, .48]].concat(QP([-.4, .48], [-.1, -.22], [-.2, -.57]).map(p => [p.x, p.y])), 0, false);
        break;

      case 'mouse':
        E(0, .1, .55, .34, 1); C(-.45, -.15, .22, 1); C(-.52, -.34, .13, 1);
        Ln(.5, .15, .85, .5); C(-.6, -.08, .05, 1); break;

      default: C(0, 0, .5, 1);
    }
  }

  root.ICONS = { drawIcon };
})(typeof window !== 'undefined' ? window : globalThis);
