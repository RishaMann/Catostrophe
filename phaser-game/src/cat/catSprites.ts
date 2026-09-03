// Реестр спрайтов кота — из Documentation/Cats/*.png, нарезано скриптами в
// phaser-game/scripts/ и разложено в public/art/cats/<skin>/. Один в один
// картинки под наши 6 направлений (см. CatAgent.SPRITE_DIRS) НЕ ложатся —
// в исходнике только 3 угла ходьбы (перед-¾, зад-¾, прямо-в-спину) плюс
// повторный набор перед-¾. Прямого «прямо на зрителя» кадра ходьбы нет
// вообще. Собираем 6 направлений из того, что есть, зеркалированием —
// та же идея, что «2 ракурса + отзеркаливание» из §7.4 документа, только
// с 3 базовыми углами вместо 2.

export type CatSkin = "baton" | "shilo";

const WALK_FRONT = ["walk_frontleft_0", "walk_frontleft_1", "walk_frontleft_2", "walk_frontleft_3", "walk_frontleft_4", "walk_frontleft_5"];
const WALK_BACK = ["walk_backleft_0", "walk_backleft_1", "walk_backleft_2", "walk_backleft_3", "walk_backleft_4", "walk_backleft_5"];
const WALK_AWAY = ["walk_away_0", "walk_away_1", "walk_away_2", "walk_away_3", "walk_away_4", "walk_away_5"];

export interface DirSprite {
  frames: string[];
  flip: boolean;
  idle: string;
  sitAlt: string; // второй кадр сидения — для состояния "sit"/"eat"/"dig", отличный от "idle"
  lie: string;
}

// Индекс = индекс в CatAgent.SPRITE_DIRS: 0 front-right, 1 toward-viewer,
// 2 front-left, 3 back-left, 4 away-from-viewer, 5 back-right.
export const DIR_SPRITES: DirSprite[] = [
  { frames: WALK_FRONT, flip: true, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // front-right — зеркало front-left
  { frames: WALK_FRONT, flip: false, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // toward-viewer — своего кадра нет, берём front-left как есть
  { frames: WALK_FRONT, flip: false, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // front-left — прямое совпадение
  { frames: WALK_BACK, flip: true, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // back-left (влево-вверх) — зеркало, иначе кот шёл задом
  { frames: WALK_AWAY, flip: false, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // away-from-viewer — прямое совпадение (кадр «прямо в спину»)
  { frames: WALK_BACK, flip: false, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // back-right (вправо-вверх) — как есть, иначе кот шёл задом
];

// Все файлы, которые нужно загрузить в preload() — идентичный список для
// каждого скина (имена файлов внутри public/art/cats/<skin>/ совпадают).
export const CAT_FRAME_NAMES: string[] = [
  "sit_front_a",
  "sit_front_b",
  "sit_back_a",
  "sit_back_b",
  "lie_front_a",
  "lie_front_b",
  "lie_back_a",
  "lie_back_b",
  ...WALK_FRONT,
  ...WALK_BACK,
  ...WALK_AWAY,
];

export const textureKey = (skin: CatSkin, name: string) => `cat_${skin}_${name}`;
