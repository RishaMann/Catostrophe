// Реестр спрайтов кота — из Documentation/Cats/<Skin>/*.png, нарезано
// скриптами в phaser-game/scripts/ и разложено в public/art/cats/<skin>/.
// Один в один картинки под наши 6 направлений (см. CatAgent.SPRITE_DIRS) НЕ
// ложатся — в спрайт-листе 4 ряда цикла ходьбы (frontleft/backleft/away/
// frontleft_alt по 6 кадров), а направлений 6, и — важно — то, какой ряд
// на самом деле «смотрит анфас», а какой «повёрнут ¾», у redfat и siamese
// РАЗНОЕ (листы рисовались независимо друг от друга). Прямого сравнения по
// имени ряда тут недостаточно — раскладка по направлениям (DIR_SPRITES_*
// ниже) задана заказчиком вручную, по размеченному листу кадров
// (scripts/out/<skin>_walk_sheet.png), а не подобрана на глаз кодом.
//
// Два персонажа — «Рыжий кот» (redfat) и «Сиамский кот» (siamese),
// переключаются в настройках (UIScene). Список имён файлов общий
// (CAT_FRAME_NAMES) — оба скина нарезаны из одинаково устроенных по
// раскладке спрайт-листов, различается только СОДЕРЖИМОЕ рядов. У siamese
// отдельно есть SIAMESE_PLAY_FRAMES — покадровая раскладка
// Documentation/Cats/Siamese/siamese_play.gif (151 кадр прорежены до 6,
// альфа-маска по порогу яркости — родная GIF-прозрачность не читалась,
// фон был запечён как непрозрачный чёрный, см. scripts/); у redfat такого
// материала нет — для него состояние "jump"/игра рисуется как раньше,
// первым кадром ходьбы с подскоком (см. RoomScene.updateCatSprite).

export type CatSkin = "redfat" | "siamese";
export const CAT_SKINS: CatSkin[] = ["redfat", "siamese"];
export const CAT_SKIN_LABELS: Record<CatSkin, string> = { redfat: "Рыжий кот", siamese: "Сиамский кот" };

const WALK_FRONT = ["walk_frontleft_0", "walk_frontleft_1", "walk_frontleft_2", "walk_frontleft_3", "walk_frontleft_4", "walk_frontleft_5"];
const WALK_BACK = ["walk_backleft_0", "walk_backleft_1", "walk_backleft_2", "walk_backleft_3", "walk_backleft_4", "walk_backleft_5"];
const WALK_AWAY = ["walk_away_0", "walk_away_1", "walk_away_2", "walk_away_3", "walk_away_4", "walk_away_5"];
const WALK_FRONT_ALT = ["walk_frontleft_alt_0", "walk_frontleft_alt_1", "walk_frontleft_alt_2", "walk_frontleft_alt_3", "walk_frontleft_alt_4", "walk_frontleft_alt_5"];
// У siamese для front-right/front-left ряд backleft берётся без 6-го кадра
// (индекс 5) — так попросил заказчик, посмотрев на размеченный лист кадров.
const WALK_BACK_5 = WALK_BACK.slice(0, 5);

export interface DirSprite {
  frames: string[];
  flip: boolean;
  idle: string;
  sitAlt: string; // второй кадр сидения — для состояния "sit"/"eat"/"dig", отличный от "idle"
  lie: string;
}

// Индекс = индекс в CatAgent.SPRITE_DIRS: 0 front-right, 1 toward-viewer,
// 2 front-left, 3 back-left, 4 away-from-viewer, 5 back-right.
//
// Разметка по направлениям — не подобрана на глаз, а задана заказчиком
// напрямую по размеченному листу кадров (scripts/out/<skin>_walk_sheet.png,
// 4 ряда × 6 кадров: 1=frontleft, 2=backleft, 3=away, 4=frontleft_alt).
// У redfat и siamese листы устроены по-разному (см. ниже), поэтому таблицы
// раздельные, не общие.
//
// redfat:
//   front-right = ряд 1 (frontleft), зеркало
//   front-left  = ряд 1 (frontleft), как есть
//   toward-viewer = ряд 2 (backleft), как есть
//   back-left   = ряд 3 (away), зеркало
//   back-right  = ряд 3 (away), как есть
//   away-from-viewer = ряд 4 (frontleft_alt), как есть
const DIR_SPRITES_REDFAT: DirSprite[] = [
  { frames: WALK_FRONT, flip: true, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // front-right
  { frames: WALK_BACK, flip: false, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // toward-viewer
  { frames: WALK_FRONT, flip: false, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // front-left
  { frames: WALK_AWAY, flip: true, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // back-left
  { frames: WALK_FRONT_ALT, flip: false, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // away-from-viewer
  { frames: WALK_AWAY, flip: false, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // back-right
];

// siamese:
//   front-right = ряд 2 (backleft, без 6-го кадра), зеркало
//   front-left  = ряд 2 (backleft, без 6-го кадра), как есть
//   toward-viewer = ряд 1 (frontleft), как есть
//   back-left   = ряд 3 (away), как есть
//   back-right  = ряд 3 (away), зеркало
//   away-from-viewer = ряд 4 (frontleft_alt), как есть
const DIR_SPRITES_SIAMESE: DirSprite[] = [
  { frames: WALK_BACK_5, flip: true, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // front-right
  { frames: WALK_FRONT, flip: false, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // toward-viewer
  { frames: WALK_BACK_5, flip: false, idle: "sit_front_a", sitAlt: "sit_front_b", lie: "lie_front_a" }, // front-left
  { frames: WALK_AWAY, flip: false, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // back-left
  { frames: WALK_FRONT_ALT, flip: false, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // away-from-viewer
  { frames: WALK_AWAY, flip: true, idle: "sit_back_a", sitAlt: "sit_back_b", lie: "lie_back_a" }, // back-right
];

export const DIR_SPRITES: DirSprite[] = DIR_SPRITES_REDFAT;

export function dirSpritesFor(skin: CatSkin): DirSprite[] {
  return skin === "siamese" ? DIR_SPRITES_SIAMESE : DIR_SPRITES_REDFAT;
}

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
  ...WALK_FRONT_ALT,
];

// Documentation/Cats/Siamese/siamese_play_full.gif (151 кадр, 70мс/кадр) —
// разложен на 4 именованных сегмента под конкретные триггеры (границы
// заданы заказчиком по номеру кадра в GIF, см. scripts/extract_play_frames.py):
//   play_idle — редкое случайное событие после долгого "sit" (CatAgent.decideNext/afterRest)
//   play_toy1 — первое взаимодействие с игрушкой (playHand)
//   play_toy2 — второе взаимодействие в течение 5 секунд после первого
//   play_fed  — покормили «с руки», перетащив еду на кота (feedHand)
// Без направления/флипа (в GIF кот всегда анфас) — только для skin === "siamese".
const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
export const SIAMESE_PLAY_IDLE_FRAMES: string[] = range("play_idle", 38);
export const SIAMESE_PLAY_TOY1_FRAMES: string[] = range("play_toy1", 53);
export const SIAMESE_PLAY_TOY2_FRAMES: string[] = range("play_toy2", 37);
export const SIAMESE_PLAY_FED_FRAMES: string[] = range("play_fed", 23);
export const SIAMESE_PLAY_FRAME_MS = 70; // тайминг взят из самого GIF (info.duration)

export const textureKey = (skin: CatSkin, name: string) => `cat_${skin}_${name}`;
