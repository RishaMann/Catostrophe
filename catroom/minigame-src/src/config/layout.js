// ============================================================
//  РАСКЛАДКА КОМНАТЫ  —  меняется при каждом заходе
// ============================================================
//
//  Задача: чтобы уровень не приедался, но маршрут всегда оставался
//  проходимым. Поэтому мебель не расставляется случайно, а получает
//  безопасные вариации базовой схемы:
//
//    1. Зеркало       — вся комната отражается по горизонтали (50%)
//    2. Обмен сторон  — кровать и комод меняются местами (50%),
//                       тумбочка всегда переезжает вслед за кроватью
//    3. Сдвиг         — стол и шкаф немного смещаются в стороны
//    4. Заначки       — три штуки из пула в шесть позиций
//
//  Высоты не трогаются никогда: именно они определяют, дотягивается
//  кот от предмета к предмету или нет.
// ============================================================

import { FIELD } from './level.js';

export function buildLayout(FURNITURE, STASH_POOL) {
  const items = FURNITURE.map(it => ({ ...it }));
  const by = id => items.find(i => i.id === id);

  // --- 2. кровать и комод меняются сторонами ---
  if (Math.random() < 0.5) {
    const krovat = by('krovat'), komod = by('komod'), tumba = by('tumba');
    if (krovat && komod) {
      krovat.x = 400;
      komod.x  = 78;
      if (tumba) tumba.x = 470;      // тумбочка всегда у изголовья
    }
  }

  // --- 3. стол и шкаф немного гуляют ---
  const stol = by('stol');
  if (stol) stol.x = clamp(stol.x + rnd(-70, 70), 90, FIELD.w - 90);
  const shkaf = by('shkaf');
  if (shkaf) shkaf.x = clamp(shkaf.x + rnd(-60, 60), 100, FIELD.w - 100);

  // аквариум тоже немного гуляет по ковру, но остаётся в досягаемости
  const akva = by('akvarium');
  if (akva) akva.x = clamp(akva.x + rnd(-70, 70), 100, FIELD.w - 100);

  // --- 1. зеркало всей комнаты ---
  const mirrored = Math.random() < 0.5;
  if (mirrored) items.forEach(i => { i.x = FIELD.w - i.x; });

  // Аквариум не должен оказаться на месте старта кота (x ≈ 100):
  // иначе кот стоит внутри него ещё до первого прыжка.
  const akvaFinal = by('akvarium');
  if (akvaFinal) akvaFinal.x = clamp(akvaFinal.x, 235, FIELD.w - 110);

  // --- 4. три заначки из пула ---
  const pool = [...STASH_POOL];
  const stash = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const s = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    stash.push(mirrored ? { ...s, x: FIELD.w - s.x } : { ...s });
  }

  return { items, stash, mirrored };
}

function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
