// Маленький технический тест решётки — 8×8 комната, гекс-навигация.
// Проверяет геометрию §5 напрямую по данным, без завязки на числа из
// документа (площади и т.п. считаются через shoelace из реальных вершин,
// не переписаны вручную) — так тест ловит реальную порчу формул, а не
// просто сверяет две копии одной константы.

import { describe, expect, it } from "vitest";
import { projX, projY } from "./projection";
import {
  HEX_VERTS,
  HexCell,
  at,
  buildHexLattice,
  fromScreen,
  fromWorld,
  hexCenter,
  hexNeighbors,
} from "./hexLattice";

const S = 32; // сторона квадратной клетки, мировые единицы (§4) — не импортируем
// squareGrid.ts специально: тест решётки должен жить независимо от него,
// как и сам hexLattice.ts (§11: hexLattice импортирует только projection.ts).

const W = 8, D = 8;
const floorW = S * W, floorD = S * D;
const cells = buildHexLattice(floorW, floorD);
const index = new Map<string, HexCell>(cells.map((c) => [c.c + "," + c.r, c]));

// Клетка считается «внутренней», если все её 6 геометрических соседей тоже
// есть в решётке — то есть она не задета зубчатым краем границы (§5.4).
const interior = cells.filter((c) => hexNeighbors(c.c, c.r).every(([nc, nr]) => index.has(nc + "," + nr)));

const worldDist = (a: HexCell, b: HexCell) => Math.hypot(a.wx - b.wx, a.wy - b.wy);

describe("buildHexLattice(8×8)", () => {
  it("строит непустую решётку разумного размера", () => {
    // пол 256×256 мировых единиц, один гекс кроет ровно 2 квадратные клетки
    // (§5.2) => грубая оценка ~(8*8)/2 = 32 клетки, с запасом на зубчатый край
    expect(cells.length).toBeGreaterThan(25);
    expect(cells.length).toBeLessThan(60);
    expect(interior.length).toBeGreaterThan(10); // есть representative внутренние клетки
  });

  it("не содержит дублей координат (c, r) — то есть наложений", () => {
    const seen = new Set<string>();
    for (const c of cells) {
      const key = c.c + "," + c.r;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(cells.length);
  });

  it("у внутренней клетки ровно 6 соседей на месте — нет дыр в мощении", () => {
    for (const c of interior) {
      const nb = hexNeighbors(c.c, c.r);
      expect(nb.length).toBe(6);
      for (const [nc, nr] of nb) {
        expect(index.has(nc + "," + nr)).toBe(true);
      }
    }
  });

  it("границы: все центры внутри [0, floorW] × [0, floorD] включительно", () => {
    for (const c of cells) {
      expect(c.wx).toBeGreaterThanOrEqual(-1e-9);
      expect(c.wy).toBeGreaterThanOrEqual(-1e-9);
      expect(c.wx).toBeLessThanOrEqual(floorW + 1e-9);
      expect(c.wy).toBeLessThanOrEqual(floorD + 1e-9);
    }
  });

  it("критерий границы — по центру, а не по пересечению: угловые центры входят", () => {
    // дальний угол пола (0,0) — гарантированно есть клетка с центром прямо в нём
    // либо максимально близко (сетка редко попадает ровно в угол, но должна
    // покрывать окрестность без обрыва)
    const nearOrigin = cells.filter((c) => c.wx < S && c.wy < S);
    expect(nearOrigin.length).toBeGreaterThan(0);

    // точка сразу за пределами пола (мировые координаты) не должна порождать
    // клетку — проверяем это через сам критерий генератора, не через отдельную
    // клетку (зубчатый край может не иметь клетки ровно на границе теста)
    const outside = cells.some((c) => c.wx > floorW + 1e-6 || c.wy > floorD + 1e-6);
    expect(outside).toBe(false);
  });
});

describe("расстояния между соседями — мировая метрика", () => {
  // НЕСОВПАДЕНИЕ СО СПЕЦИФИКАЦИЕЙ. §5.3 документа утверждает: «Все шесть
  // рёбер равны по длине в мировой метрике [...] никаких поправок на
  // диагональ». По факту, при формулах hexCenter/hexNeighbors/unproject
  // ИЗ ТОГО ЖЕ документа (скопированы буквально, не переписаны) это не так:
  // 2 «вертикальных» соседа (0,±16 на экране) лежат в мире на расстоянии
  // 32*sqrt(2)≈45.25, 4 «диагональных» — на 16*sqrt(10)≈50.60. Отношение
  // ровно sqrt(5)/2, то есть это не шум округления, а структурное свойство
  // формул. Тест фиксирует РЕАЛЬНОЕ поведение (два разных, но каждый сам по
  // себе стабильный, класса рёбер), а не переписанную под ответ версию.
  it("вертикальные соседи (0, ±16 на экране) равны между собой", () => {
    const sample = interior.filter((_, i) => i % 5 === 0).slice(0, 6);
    expect(sample.length).toBeGreaterThan(2);
    for (const c of sample) {
      const [a, b] = [hexNeighbors(c.c, c.r)[0], hexNeighbors(c.c, c.r)[1]]; // (c,r-1) и (c,r+1)
      const da = worldDist(c, index.get(a[0] + "," + a[1])!);
      const db = worldDist(c, index.get(b[0] + "," + b[1])!);
      expect(da).toBeCloseTo(db, 6);
    }
  });

  it("четыре диагональных соседа равны между собой", () => {
    const sample = interior.filter((_, i) => i % 5 === 0).slice(0, 6);
    for (const c of sample) {
      const dists = hexNeighbors(c.c, c.r)
        .slice(2)
        .map(([nc, nr]) => worldDist(c, index.get(nc + "," + nr)!));
      const first = dists[0];
      for (const d of dists) expect(d).toBeCloseTo(first, 6);
    }
  });

  it("вертикальные и диагональные рёбра НЕ равны — ratio ровно sqrt(5)/2, не 1", () => {
    const c = interior[Math.floor(interior.length / 2)];
    const nb = hexNeighbors(c.c, c.r).map(([nc, nr]) => index.get(nc + "," + nr)!);
    const vertical = worldDist(c, nb[0]);
    const diagonal = worldDist(c, nb[2]);
    expect(diagonal / vertical).toBeCloseTo(Math.sqrt(5) / 2, 6);
    expect(Math.abs(diagonal - vertical)).toBeGreaterThan(1); // не просто float-шум
  });

  it("экранные расстояния до соседей НЕ все равны (это и есть смысл гекса)", () => {
    // если бы экранные расстояния тоже были равны, hexCenter был бы просто
    // лишним усложнением — фиксируем асимметрию явно, чтобы не потерять её
    // случайно при рефакторинге
    const c = interior[Math.floor(interior.length / 2)];
    const dists = hexNeighbors(c.c, c.r).map(([nc, nr]) => {
      const n = index.get(nc + "," + nr)!;
      return Math.hypot(n.sx - c.sx, n.sy - c.sy);
    });
    const allEqual = dists.every((d) => Math.abs(d - dists[0]) < 1e-6);
    expect(allEqual).toBe(false);
  });
});

describe("at() / fromScreen() / fromWorld()", () => {
  it("at(c, r) находит именно свою клетку и ничего для несуществующей", () => {
    const c = interior[0];
    expect(at(cells, c.c, c.r)).toBe(c);
    expect(at(cells, 9999, 9999)).toBeUndefined();
  });

  it("fromScreen на точном центре клетки возвращает ровно эту клетку", () => {
    for (const c of interior.slice(0, 8)) {
      expect(fromScreen(cells, c.sx, c.sy)).toBe(c);
    }
  });

  it("fromWorld на точном мировом центре клетки возвращает ровно эту клетку", () => {
    for (const c of interior.slice(0, 8)) {
      expect(fromWorld(cells, c.wx, c.wy)).toBe(c);
    }
  });

  it("fromWorld и fromScreen на одной и той же точке согласованы", () => {
    const c = interior[3];
    const bySx = fromScreen(cells, c.sx, c.sy);
    const byWorld = fromWorld(cells, c.wx, c.wy);
    expect(bySx).toBe(byWorld);
  });

  it("точка чуть ближе к соседу возвращает именно соседа, а не старую клетку", () => {
    const c = interior[5];
    const [nc, nr] = hexNeighbors(c.c, c.r)[0];
    const n = index.get(nc + "," + nr)!;
    // 60% пути от c к n по экрану — точно на территории соседа
    const sx = c.sx + (n.sx - c.sx) * 0.6;
    const sy = c.sy + (n.sy - c.sy) * 0.6;
    expect(fromScreen(cells, sx, sy)).toBe(n);
  });
});

describe("площадь: гекс покрывает ровно площадь двух квадратных клеток (§5.2)", () => {
  it("считает площади через shoelace из реальных вершин, не из захардкоженных чисел", () => {
    const shoelace = (pts: [number, number][]) => {
      let sum = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        sum += x1 * y2 - x2 * y1;
      }
      return Math.abs(sum) / 2;
    };

    const hexArea = shoelace(HEX_VERTS);

    // экранный «ромб» одной квадратной клетки — 4 угла клетки на полу (wz=0),
    // спроецированные той же projX/projY, что и всё остальное в проекте
    const squareCorners: [number, number][] = [
      [projX(0, 0), projY(0, 0, 0)],
      [projX(S, 0), projY(S, 0, 0)],
      [projX(S, S), projY(S, S, 0)],
      [projX(0, S), projY(0, S, 0)],
    ];
    const squareArea = shoelace(squareCorners);

    expect(hexArea).toBeCloseTo(2 * squareArea, 6);
  });

  it("центр (c, r) действительно совпадает с hexCenter(c, r) — площадь считается там, где стоит клетка", () => {
    const c = interior[0];
    const { sx, sy } = hexCenter(c.c, c.r);
    expect(sx).toBeCloseTo(c.sx, 9);
    expect(sy).toBeCloseTo(c.sy, 9);
  });
});
