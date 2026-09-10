// ============================================================
//  ПЕРСОНАЖИ МИНИ-ИГРЫ
// ============================================================
//  Основная игра передаёт текущее catCharacter через iframe bridge.
//  Здесь хранится только визуальный контракт мини-игры: механика и
//  физическое тело одинаковы для всех персонажей.

export const DEFAULT_CHARACTER = 'Siamese';
export const CHARACTER_NAMES = ['Redfat', 'Siamese', 'Labra'];

const ROOT = 'art/characters/';

const SIAMESE_STATES = {
  idle:   { texture: 'cat-Siamese-key-01' },
  aim:    { texture: 'cat-Siamese-key-02' },
  launch: { texture: 'cat-Siamese-key-03' },
  rise:   { texture: 'cat-Siamese-key-04' },
  apex:   { texture: 'cat-Siamese-key-05' },
  fall:   { texture: 'cat-Siamese-key-06' },
  land:   { texture: 'cat-Siamese-key-07' },
  slide:  { texture: 'cat-Siamese-key-08' },
  hang:   { texture: 'cat-Siamese-hang', size: { w: 34, h: 54 }, offsetY: 0 },
  wet:    { texture: 'cat-Siamese-key-11' },
  hit:    { texture: 'cat-Siamese-key-12' },
  walk:   { animation: 'cat:Siamese:walk' },
  crawl:  { animation: 'cat:Siamese:crawl' },
  flatCrawl: { animation: 'cat:Siamese:flat-crawl' }
};

const FALLBACK_STATES = name => ({
  idle:   { texture: `cat-${name}-idle` },
  aim:    { texture: `cat-${name}-land` },
  launch: { texture: `cat-${name}-walk-0` },
  rise:   { texture: `cat-${name}-walk-0` },
  apex:   { texture: `cat-${name}-walk-0` },
  fall:   { texture: `cat-${name}-walk-0` },
  land:   { texture: `cat-${name}-land` },
  slide:  { texture: `cat-${name}-land` },
  hang:   { texture: `cat-${name}-idle` },
  wet:    { texture: `cat-${name}-hit` },
  hit:    { texture: `cat-${name}-hit` },
  walk:   { animation: `cat:${name}:walk` },
  crawl:  { animation: `cat:${name}:walk`, rate: 7 },
  flatCrawl: { texture: `cat-${name}-hit` }
});

export const CHARACTERS = {
  Siamese: { states: SIAMESE_STATES },
  Redfat:  { states: FALLBACK_STATES('Redfat') },
  Labra:   { states: FALLBACK_STATES('Labra') }
};

export function normalizeCharacter(name) {
  return CHARACTER_NAMES.includes(name) ? name : DEFAULT_CHARACTER;
}

export function preloadCharacterArt(scene) {
  for (let i = 1; i <= 12; i++) {
    const nn = String(i).padStart(2, '0');
    scene.load.image(`cat-Siamese-key-${nn}`, `${ROOT}Siamese/cat-key-${nn}.png`);
  }
  scene.load.image('cat-Siamese-hang', `${ROOT}Siamese/hang.png`);
  scene.load.spritesheet('cat-Siamese-movement', `${ROOT}Siamese/movement.png`, {
    frameWidth: 72, frameHeight: 56
  });

  ['Redfat', 'Labra'].forEach(name => {
    scene.load.image(`cat-${name}-idle`, `${ROOT}${name}/idle.png`);
    scene.load.image(`cat-${name}-land`, `${ROOT}${name}/land.png`);
    scene.load.image(`cat-${name}-hit`, `${ROOT}${name}/hit.png`);
    for (let i = 0; i < 6; i++) {
      scene.load.image(`cat-${name}-walk-${i}`, `${ROOT}${name}/walk-${i}.png`);
    }
  });
}

export function registerCharacterAnimations(scene) {
  const create = (key, frames, frameRate) => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({ key, frames, frameRate, repeat: -1 });
  };

  create(
    'cat:Siamese:walk',
    scene.anims.generateFrameNumbers('cat-Siamese-movement', { start: 0, end: 4 }),
    10
  );
  create(
    'cat:Siamese:crawl',
    scene.anims.generateFrameNumbers('cat-Siamese-movement', { start: 5, end: 9 }),
    8
  );
  create(
    'cat:Siamese:flat-crawl',
    scene.anims.generateFrameNumbers('cat-Siamese-movement', { start: 10, end: 14 }),
    7
  );

  ['Redfat', 'Labra'].forEach(name => {
    create(
      `cat:${name}:walk`,
      Array.from({ length: 6 }, (_, i) => ({ key: `cat-${name}-walk-${i}` })),
      9
    );
  });
}

export function catVisual(character, state) {
  const selected = CHARACTERS[normalizeCharacter(character)];
  return selected.states[state] || selected.states.idle;
}
