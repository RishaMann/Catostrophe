// §10 промпта — спецификация комнаты. Размер параметрический: три числа
// приходят отсюда, нигде в коде не хардкодятся (см. §14, §13 критерии приёмки).

export interface RoomSpec {
  size: [number, number]; // [W, D] в квадратных клетках
  wallHeight: number; // в клетках
  navLattice: "hex" | "square"; // 'hex' по умолчанию, 'square' — для сравнения в debug
}

export const DEFAULT_ROOM: RoomSpec = {
  size: [8, 8],
  wallHeight: 6,
  navLattice: "hex",
};
