/* ============================================================================
   data.js — каталог предметов, запасов и конфигурация первой сцены.
   s: [ширина, глубина, высота] в клетках. touch: к предмету кот должен подходить.
   frontOk/midOk: разрешён у переднего края / в середине комнаты несмотря на
   категорию (по умолчанию tall встаёт только у стен, front — только low, см.
   ACCEPTS в iso.js) — точечное исключение для конкретного предмета (торшер
   реально можно поставить где угодно, в отличие от шкафа/стеллажа), а не
   ослабление правила для всей категории.
   light: {color, radius} — предмет светится (см. room/lighting.js): radius
   в клетках пола, color — тёплый ламповый оттенок, свой для каждого типа
   светильника, не общий «жёлтый свет вообще».
   ========================================================================== */
(function (root) {
  'use strict';

  const ITEMS_LIST = [
    { id: 'wardrobe',  ru: 'Шкаф',        cat: 'tall',    s: [1.2, .7, 2.3], touch: 1 },
    { id: 'bookshelf', ru: 'Стеллаж',     cat: 'tall',    s: [1.1, .6, 2.0] },
    { id: 'lamp',      ru: 'Торшер',      cat: 'tall',    s: [.45, .45, 1.8], frontOk: 1, midOk: 1,
      light: { color: 0xFFB65C, radius: 2.0 } },
    { id: 'sofa',      ru: 'Диван',       cat: 'mid',     s: [1.8, .85, .85], touch: 1 },
    { id: 'aquarium',  ru: 'Аквариум',    cat: 'mid',     s: [1.4, .6, 1.1], touch: 1, frontOk: 1 },
    { id: 'rug',       ru: 'Ковёр',       cat: 'low',     s: [2.8, 2.4, .03] },
    { id: 'table',     ru: 'Столик',      cat: 'low',     s: [1.1, .7, .4], touch: 1 },
    { id: 'pouf',      ru: 'Пуф',         cat: 'low',     s: [.7, .7, .35] },
    { id: 'ficus',     ru: 'Фикус',       cat: 'low',     s: [.6, .6, 1.0], touch: 1 },
    { id: 'scratch',   ru: 'Когтеточка',  cat: 'low',     s: [.6, .6, 1.0], touch: 1 },
    { id: 'box',       ru: 'Коробка',     cat: 'low',     s: [.7, .7, .6], touch: 1 },
    { id: 'bed',       ru: 'Лежанка',     cat: 'low',     s: [.75, .6, .25], touch: 1 },
    { id: 'bowls',     ru: 'Миски',       cat: 'low',     s: [.8, .5, .18], touch: 1 },
    { id: 'vacuum',    ru: 'Пылесос',     cat: 'low',     s: [.5, .5, .12] },
    { id: 'scales',    ru: 'Весы',        cat: 'low',     s: [.6, .45, .08] },
    { id: 'plaid',     ru: 'Плед',        cat: 'surface' },
    { id: 'curtain',   ru: 'Штора',       cat: 'wall' },
    { id: 'garland',   ru: 'Гирлянда',    cat: 'wall' },
    { id: 'wshelf',    ru: 'Полка',       cat: 'wall' },
    { id: 'clock',     ru: 'Часы',        cat: 'wall' },
    { id: 'portrait',  ru: 'Портрет',     cat: 'wall' },
    { id: 'bulb',      ru: 'Лампочка',    cat: 'ceil', light: { color: 0xFFE1A8, radius: 2.1 } },
    { id: 'chandelier',ru: 'Люстра',      cat: 'ceil', light: { color: 0xFFD79A, radius: 2.8 } }
  ];

  const SUPPLIES_LIST = [
    { id: 'dry',   ru: 'Сухой корм', food: 1 },
    { id: 'can',   ru: 'Консерва',   food: 1 },
    { id: 'treat', ru: 'Лакомство',  food: 1 },
    { id: 'wand',  ru: 'Удочка' },
    { id: 'ball',  ru: 'Мячик' },
    { id: 'mouse', ru: 'Мышка' }
  ];

  const SAY = {
    hand:   ['Вот это другое дело.', 'Приемлемо. Ещё.', 'Наконец-то сервис.'],
    bowl:   ['Ладно, засчитано.', 'Я как раз проходил мимо.', 'Не потому что ты позвал.'],
    floor:  ['Это. На полу. Серьёзно?', 'Я вам не голубь.', 'Придётся это закопать.'],
    buried: ['Похороны состоялись.', 'Больше никто не пострадал.'],
    toy:    ['Оно живое!', 'Поймал. Оно мертво.', 'Кинь ещё раз, я подумаю.']
  };

  // Сама раскладка сцены (params/door/win/light/cat/place) больше не здесь —
  // она per-сцена и грузится отдельным JSON (src/scenes/<имя>.json,
  // RoomScene.preload()/this.cache.json). Тут остаётся только каталог,
  // общий для всех сцен и для редактора уровней (см. README).

  root.GAMEDATA = {
    ITEMS_LIST, SUPPLIES_LIST, SAY,
    ITEMS: Object.fromEntries(ITEMS_LIST.map(i => [i.id, i])),
    SUPPLIES: Object.fromEntries(SUPPLIES_LIST.map(i => [i.id, i]))
  };
})(typeof window !== 'undefined' ? window : globalThis);
