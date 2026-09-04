// §8 промпта — перекрытие через Painter's algorithm по одному числу.
// depth = (wx + wy) * 8 + wz * 2 + facetBias — больше depth = ближе к
// зрителю = рисуется позже = загораживает.
//
// Одна функция с одним входом (§8.3) — чтобы секционная отрисовка (вариант 2
// из §8.3, если понадобится позже) подключилась без переписывания рендера.

export type Facet = "decal" | "wall" | "floorItem" | "cat" | "hanging";

export interface DepthPoint {
  facet: Facet;
  wx: number;
  wy: number;
  wz: number;
}

// декаль −4, стена −2, предмет пола 0, кот +1, подвес 0 (§8.1). Кот получает
// +1, чтобы при равном wx+wy оказаться поверх предмета, а не быть «съеденным».
const FACET_BIAS: Record<Facet, number> = {
  decal: -4,
  wall: -2,
  floorItem: 0,
  cat: 1,
  hanging: 0,
};

export function depthOf(p: DepthPoint): number {
  return (p.wx + p.wy) * 8 + p.wz * 2 + FACET_BIAS[p.facet];
}
