// ============================================================
//  ЗАГЛУШКИ  —  читаемые силуэты, пока нет настоящей графики
// ============================================================
//  Не просто прямоугольники: у кота видно уши и хвост, у хозяина —
//  как он лежит, у рыбки — что это рыбка. Так по экрану понятно,
//  что происходит, ещё до появления художника.
//
//  Как только картинка появляется в public/art/ и ключ дописан
//  в READY — силуэт заменяется картинкой, код не меняется.
// ============================================================

import { ASSETS, READY, ART_DIR } from '../config/assets.js';

export function preloadArt(scene) {
  READY.forEach(key => {
    const a = ASSETS[key];
    if (a && a.file) scene.load.image(key, ART_DIR + a.file);
  });
}

export function makeTextures(scene) {
  Object.entries(ASSETS).forEach(([key, a]) => {
    if (scene.textures.exists(key)) return;
    const g = scene.add.graphics();
    (DRAW[a.shape] || DRAW.rect)(g, a);
    g.generateTexture(key, a.w, a.h);
    g.destroy();
  });
}

// Где у аквариума поверхность воды — доля от его высоты, считая сверху.
// Из этой точки бьют брызги и вылетают рыбки.
export const WATER_LINE = 0.18;

// ---------- рисовалки силуэтов ----------
const DRAW = {

  // Аквариум: деревянная подставка, стекло, вода, грунт, водоросли,
  // замок и одна рыжая рыбка. Светлая линия — поверхность воды,
  // по ней игрок понимает, куда именно прыгать.
  akva(g, a) {
    const w = a.w, h = a.h;
    const standTop = h * 0.72;          // где кончается стекло и начинается тумба
    const water    = h * WATER_LINE;    // уровень воды

    // подставка
    g.fillStyle(0x4E3722, 1);
    g.fillRect(w * 0.05, standTop, w * 0.90, h - standTop);
    g.fillStyle(0x3A2919, 1);
    g.fillRect(w * 0.05, standTop, w * 0.90, 3);

    // воздух над водой внутри стекла
    g.fillStyle(0x24404E, 1);
    g.fillRect(0, 0, w, standTop);

    // вода
    g.fillStyle(a.color, 1);
    g.fillRect(3, water, w - 6, standTop - water - 3);

    // грунт
    g.fillStyle(0x6B5B4A, 1);
    g.fillRect(3, standTop - h * 0.12, w - 6, h * 0.12 - 3);

    // водоросли
    g.fillStyle(0x4A8B3A, 1);
    g.fillRect(w * 0.13, h * 0.32, 4, standTop - h * 0.44);
    g.fillRect(w * 0.20, h * 0.44, 4, standTop - h * 0.56);
    g.fillRect(w * 0.83, h * 0.35, 4, standTop - h * 0.47);

    // замок
    g.fillStyle(0x9C8F7A, 1);
    g.fillRect(w * 0.55, h * 0.44, w * 0.14, standTop - h * 0.44 - 3);
    g.fillRect(w * 0.53, h * 0.39, w * 0.05, h * 0.10);
    g.fillRect(w * 0.68, h * 0.39, w * 0.05, h * 0.10);

    // рыбка внутри
    g.fillStyle(0xE8722C, 1);
    g.fillEllipse(w * 0.36, h * 0.44, 14, 9);
    g.fillTriangle(
      w * 0.36 - 5, h * 0.44,
      w * 0.36 - 13, h * 0.38,
      w * 0.36 - 13, h * 0.50
    );

    // поверхность воды
    g.lineStyle(2, 0xBFEFF7, 0.8);
    g.beginPath(); g.moveTo(3, water); g.lineTo(w - 3, water); g.strokePath();

    // рама стекла и блик
    g.lineStyle(2, 0x2E3E46, 0.9);
    g.strokeRect(1, 1, w - 2, standTop - 1);
    g.lineStyle(2, 0xBFEFF7, 0.3);
    g.beginPath();
    g.moveTo(w * 0.09, water + 6);
    g.lineTo(w * 0.09, standTop - 9);
    g.strokePath();
  },

  rect(g, a) {
    g.fillStyle(a.color, 1);
    g.fillRect(0, 0, a.w, a.h);
    g.lineStyle(1, 0xffffff, 0.22);
    g.strokeRect(0.5, 0.5, a.w - 1, a.h - 1);
  },

  // Кот: тело-овал, голова, два уха, хвост. Смотрит вправо.
  cat(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(a.color, 1);
    // хвост
    g.lineStyle(5, a.color, 1);
    g.beginPath();
    g.moveTo(w * 0.12, h * 0.58);
    g.lineTo(w * 0.02, h * 0.30);
    g.strokePath();
    // тело
    g.fillEllipse(w * 0.42, h * 0.62, w * 0.62, h * 0.60);
    // голова
    g.fillCircle(w * 0.78, h * 0.42, h * 0.30);
    // уши
    g.fillTriangle(
      w * 0.66, h * 0.30, w * 0.72, h * 0.02, w * 0.80, h * 0.26
    );
    g.fillTriangle(
      w * 0.82, h * 0.26, w * 0.92, h * 0.04, w * 0.95, h * 0.34
    );
    // лапы
    g.fillRect(w * 0.24, h * 0.84, w * 0.12, h * 0.16);
    g.fillRect(w * 0.54, h * 0.84, w * 0.12, h * 0.16);
    // глаз, чтобы было видно, куда смотрит
    g.fillStyle(0x241C29, 1);
    g.fillCircle(w * 0.86, h * 0.38, 2.4);
  },

  // Кот, висящий на люстре: одна лапа вверх, голова вверх, тело вниз.
  cathang(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(a.color, 1);
    // поднятая лапа — та, которой держится
    g.fillRect(w * 0.42, 0, w * 0.16, h * 0.26);
    g.fillCircle(w * 0.50, h * 0.03, w * 0.12);
    // голова
    g.fillCircle(w * 0.50, h * 0.33, w * 0.30);
    // уши
    g.fillTriangle(w * 0.26, h * 0.30, w * 0.30, h * 0.15, w * 0.45, h * 0.23);
    g.fillTriangle(w * 0.74, h * 0.30, w * 0.70, h * 0.15, w * 0.55, h * 0.23);
    // тело свисает вниз
    g.fillEllipse(w * 0.50, h * 0.68, w * 0.60, h * 0.50);
    // задние лапы
    g.fillRect(w * 0.34, h * 0.88, w * 0.12, h * 0.12);
    g.fillRect(w * 0.54, h * 0.88, w * 0.12, h * 0.12);
    // хвост в сторону
    g.lineStyle(4, a.color, 1);
    g.beginPath(); g.moveTo(w * 0.68, h * 0.80); g.lineTo(w * 0.98, h * 0.94); g.strokePath();
    // глаза — смотрит вниз, оценивает высоту
    g.fillStyle(0x241C29, 1);
    g.fillCircle(w * 0.40, h * 0.36, 2.2);
    g.fillCircle(w * 0.60, h * 0.36, 2.2);
  },

  // Люстра: ножка, абажур-трапеция, три лампочки.
  lyustra(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(0x7A6C84, 1);
    g.fillRect(w * 0.46, 0, w * 0.08, h * 0.24);
    g.fillStyle(a.color, 1);
    g.fillPoints([
      { x: w * 0.16, y: h * 0.62 }, { x: w * 0.84, y: h * 0.62 },
      { x: w * 0.66, y: h * 0.20 }, { x: w * 0.34, y: h * 0.20 }
    ], true);
    g.fillStyle(0xFFF1C2, 1);
    g.fillCircle(w * 0.26, h * 0.74, h * 0.15);
    g.fillCircle(w * 0.50, h * 0.80, h * 0.15);
    g.fillCircle(w * 0.74, h * 0.74, h * 0.15);
  },

  // Ковёр: полотно с каймой, чтобы читалось как ковёр, а не как трава.
  kover(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(a.color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(3, 0xE8DFC8, 0.45);
    g.strokeRect(10, 8, w - 20, h - 16);
    g.lineStyle(1, 0xE8DFC8, 0.22);
    g.strokeRect(20, 16, w - 40, h - 32);
  },

  // Хозяин: лежит под одеялом, голова слева, рука согнута.
  human(g, a) {
    const w = a.w, h = a.h;
    // одеяло
    g.fillStyle(0x8FA3C4, 1);
    g.fillRoundedRect(w * 0.22, h * 0.34, w * 0.74, h * 0.62, 6);
    // подушка
    g.fillStyle(0xE7E2EC, 1);
    g.fillRoundedRect(0, h * 0.40, w * 0.26, h * 0.52, 6);
    // голова
    g.fillStyle(a.color, 1);
    g.fillCircle(w * 0.13, h * 0.42, h * 0.26);
    // рука поверх одеяла
    g.fillStyle(a.color, 1);
    g.fillRoundedRect(w * 0.28, h * 0.16, w * 0.34, h * 0.22, 5);
    g.fillCircle(w * 0.30, h * 0.27, h * 0.13);
  },

  // Рыбка: тело и хвост.
  fish(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(a.color, 1);
    g.fillEllipse(w * 0.56, h * 0.5, w * 0.72, h * 0.78);
    g.fillTriangle(w * 0.20, h * 0.5, 0, h * 0.06, 0, h * 0.94);
    g.fillStyle(0x14101c, 1);
    g.fillCircle(w * 0.76, h * 0.42, 1.8);
  },

  // Круглый стол: овальная столешница и три расходящиеся ножки.
  round(g, a) {
    const w = a.w, h = a.h, topH = h * 0.30;
    g.fillStyle(0x4E3722, 1);
    g.lineStyle(6, 0x4E3722, 1);
    g.beginPath(); g.moveTo(w * 0.50, topH * 0.7); g.lineTo(w * 0.50, h); g.strokePath();
    g.beginPath(); g.moveTo(w * 0.50, topH * 0.7); g.lineTo(w * 0.22, h * 0.96); g.strokePath();
    g.beginPath(); g.moveTo(w * 0.50, topH * 0.7); g.lineTo(w * 0.78, h * 0.96); g.strokePath();
    g.fillStyle(a.color, 1);
    g.fillEllipse(w * 0.5, topH * 0.55, w, topH);
  },

  // Шкаф: высокий корпус, две дверцы, ручки.
  shkaf(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(a.color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(2, 0x2E2418, 0.8);
    g.strokeRect(1, 1, w - 2, h - 2);
    g.beginPath(); g.moveTo(w * 0.5, 6); g.lineTo(w * 0.5, h - 6); g.strokePath();
    g.fillStyle(0xC9A227, 1);
    g.fillCircle(w * 0.44, h * 0.5, 3);
    g.fillCircle(w * 0.56, h * 0.5, 3);
  },

  // Комод с встроенным телевизором.
  tv(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(a.color, 1);
    g.fillRect(0, 0, w, h);
    g.lineStyle(2, 0x2E2418, 0.8);
    g.strokeRect(1, 1, w - 2, h - 2);
    // экран
    g.fillStyle(0x39434F, 1);
    g.fillRect(w * 0.12, h * 0.05, w * 0.76, h * 0.40);
    g.lineStyle(2, 0x8FA3C4, 0.55);
    g.strokeRect(w * 0.12, h * 0.05, w * 0.76, h * 0.40);
    // ящики
    g.lineStyle(2, 0x2E2418, 0.55);
    g.beginPath(); g.moveTo(w * 0.10, h * 0.62); g.lineTo(w * 0.90, h * 0.62); g.strokePath();
    g.beginPath(); g.moveTo(w * 0.10, h * 0.80); g.lineTo(w * 0.90, h * 0.80); g.strokePath();
    g.fillStyle(0xC9A227, 1);
    g.fillCircle(w * 0.5, h * 0.71, 3);
    g.fillCircle(w * 0.5, h * 0.89, 3);
  },

  // Столешница на ножках (запасная форма).
  table(g, a) {
    const w = a.w, h = a.h, top = Math.max(10, h * 0.22);
    g.fillStyle(a.color, 1);
    g.fillRoundedRect(0, 0, w, top, 3);
    g.fillRect(w * 0.14, top, 6, h - top);
    g.fillRect(w * 0.86 - 6, top, 6, h - top);
  },

  // Подушка, которой хозяин кидается.
  pillow(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(a.color, 1);
    g.fillRoundedRect(0, 0, w, h, 8);
    g.lineStyle(2, 0xB9B2C4, 0.8);
    g.strokeRoundedRect(1, 1, w - 2, h - 2, 8);
  },

  // Лампа: абажур-трапеция, тонкая ножка, подставка.
  lamp(g, a) {
    const w = a.w, h = a.h;
    g.fillStyle(0x7A6C84, 1);
    g.fillRect(w * 0.44, h * 0.40, w * 0.12, h * 0.50);
    g.fillRect(w * 0.20, h * 0.90, w * 0.60, h * 0.10);
    g.fillStyle(a.color, 1);
    g.fillPoints([
      { x: w * 0.26, y: 0 }, { x: w * 0.74, y: 0 },
      { x: w, y: h * 0.42 }, { x: 0, y: h * 0.42 }
    ], true);
  }
};

// Подпись рядом с заглушкой. Когда появится картинка — исчезнет.
export function labelFor(scene, key, x, y, below = false) {
  const a = ASSETS[key];
  if (!a || !a.label) return null;
  if (READY.includes(key) && scene.textures.exists(key)) return null;
  const dy = below ? a.h / 2 + 12 : -a.h / 2 - 3;
  return scene.add.text(x, y + dy, a.label, {
    fontFamily: 'sans-serif', fontSize: '12px', color: '#ffffff'
  }).setOrigin(0.5, below ? 0 : 1).setAlpha(0.7).setDepth(3);
}

export function sizeOf(key) {
  const a = ASSETS[key];
  return a ? { w: a.w, h: a.h } : { w: 10, h: 10 };
}
