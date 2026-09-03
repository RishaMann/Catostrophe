// Каталог предметов — перенос ITEMS/SUPPLIES из старого app.js, теперь
// полностью (все 23 предмета, не только напольные).
//
// Размеры старого прототипа были в метрах ("клетках" пола F×F, где F —
// дробный размер). Тут сетка размещения целочисленная (S=32 мировых
// единиц/клетка) — размеры округлены до ближайшего целого числа клеток, не
// меньше 1; для предметов, отмеченных как непроходимые (touch/blocksFloor)
// высота дополнительно поднята до минимум 1 клетки, чтобы предмет не терял
// объём при округлении вниз.
//
// ОГОВОРКА про категории wall/ceil/surface: у движка (§4 промпта) есть
// только квадратная сетка ПОЛА — полноценной системы настенных/потолочных
// точек крепления нет (кроме двери/окна — для них она сделана отдельно,
// см. RoomScene.drawDoor/drawWindow). Чтобы не оставлять эти 8 предметов
// недоступными, они кладутся через ТУ ЖЕ напольную сетку — декоративно
// (footprint 1×1, не блокируют пол), просто визуально «плоские», а не
// висящие на стене. Это сознательное упрощение геометрии, а не пропуск —
// сами предметы в инвентаре и раскладке ЕСТЬ.

export type ItemCategory = "tall" | "mid" | "low" | "wall" | "ceil" | "surface";

export interface CatalogItem {
  id: string;
  ru: string;
  category: ItemCategory;
  footprint: [number, number];
  height: number; // клетки; 0 — плоский декор, пол под ним проходим
  blocksFloor: boolean;
}

export const ITEM_CATALOG: CatalogItem[] = [
  { id: "wardrobe", ru: "Шкаф", category: "tall", footprint: [1, 1], height: 3, blocksFloor: true },
  { id: "bookshelf", ru: "Стеллаж", category: "tall", footprint: [1, 1], height: 2, blocksFloor: true },
  { id: "lamp", ru: "Торшер", category: "tall", footprint: [1, 1], height: 2, blocksFloor: true },
  { id: "sofa", ru: "Диван", category: "mid", footprint: [2, 1], height: 1, blocksFloor: true },
  { id: "aquarium", ru: "Аквариум", category: "mid", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "rug", ru: "Ковёр", category: "low", footprint: [3, 2], height: 0, blocksFloor: false },
  { id: "table", ru: "Столик", category: "low", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "pouf", ru: "Пуф", category: "low", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "ficus", ru: "Фикус", category: "low", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "scratch", ru: "Когтеточка", category: "low", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "box", ru: "Коробка", category: "low", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "bed", ru: "Лежанка", category: "low", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "bowls", ru: "Миски", category: "low", footprint: [1, 1], height: 1, blocksFloor: true },
  { id: "vacuum", ru: "Пылесос", category: "low", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "scales", ru: "Весы", category: "low", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "plaid", ru: "Плед", category: "surface", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "curtain", ru: "Штора", category: "wall", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "garland", ru: "Гирлянда", category: "wall", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "wshelf", ru: "Полка", category: "wall", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "clock", ru: "Часы", category: "wall", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "portrait", ru: "Портрет", category: "wall", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "bulb", ru: "Лампочка", category: "ceil", footprint: [1, 1], height: 0, blocksFloor: false },
  { id: "chandelier", ru: "Люстра", category: "ceil", footprint: [1, 1], height: 0, blocksFloor: false },
];

export const CATALOG_BY_ID: Record<string, CatalogItem> = Object.fromEntries(ITEM_CATALOG.map((i) => [i.id, i]));

export interface SupplyItem {
  id: string;
  ru: string;
  food?: true;
}

export const SUPPLIES: SupplyItem[] = [
  { id: "dry", ru: "Сухой корм", food: true },
  { id: "can", ru: "Консерва", food: true },
  { id: "treat", ru: "Лакомство", food: true },
  { id: "wand", ru: "Удочка" },
  { id: "ball", ru: "Мячик" },
  { id: "mouse", ru: "Мышка" },
];

export const SUPPLY_BY_ID: Record<string, SupplyItem> = Object.fromEntries(SUPPLIES.map((i) => [i.id, i]));
