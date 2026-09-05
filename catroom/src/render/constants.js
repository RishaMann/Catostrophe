/* ============================================================================
   constants.js — тема и раскладка слоёв по глубине. Общее для всех модулей
   game.js (room/cat/ui): один файл вместо магических чисел, разбросанных по
   отрисовке. Не содержит логики — только именованные значения.
   ========================================================================== */
(function (root) {
  'use strict';

  const COL = {
    deep: 0x332C39, panel: 0x2E2833, chalk: 0xEBE2D5,
    amber: 0xE8A33D, cat: 0x9FC4C0, ink: 0x2E2833
  };
  const FONT = '"Avenir Next","Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

  // Слои сцены больше не делят один Graphics — у каждого своя Phaser-глубина,
  // Phaser сам сортирует GameObject'ы по ней, интерливинг предмет/кот вручную
  // (как раньше drawCatOnce между отсортированными предметами) не нужен: и
  // предметы (I.depth(zmap,zid), диапазон примерно 0..2*floor), и кот
  // (cat.x+cat.y — та же шкала) просто получают Phaser .depth и рисуются в
  // правильном порядке автоматически.
  const BG_DEPTH = -2;      // фоновая панорама комнаты — под сеткой
  const SHELL_DEPTH = -1;   // пол, стены, проёмы, проходимость (debug)
  const ZONE_DEPTH = -0.5;  // подсветка пустых зон при драге — под предметами,
                             // но взаимоисключающе с ними (заняты либо зона, либо предмет)
  const SHADOW_DEPTH = -0.3; // тени от ламп/торшера/люстры — под предметами (лежат
                              // НА полу), но над полом/стенами (см. room/lighting.js)
  const GLOW_DEPTH = 9500;   // тёплое свечение источников света — поверх пола, стен,
                              // предметов И кота (аддитивный blend, см. lighting.js),
                              // но под панелями UI
  const TEXT_DEPTH = 1000;  // все надписи комнаты — всегда поверх боксов предметов
  const CEIL_DEPTH = 900;   // потолочный подвес — выше обычных предметов
  const UI_DEPTH = 10000;   // нижние панели/HUD — всегда поверх сцены
  const UI_TEXT_DEPTH = 10001;

  // Арт кота — калибровано под исходники ~300px при params.zoom=1 (floor 8).
  // Не константа: кот должен расти вместе с комнатой при приближении сцены
  // (params.zoom), поэтому это БАЗА — реальный масштаб = CAT_ART_SCALE_BASE
  // * params.zoom, считается в create() (см. spawn кота), не тут.
  const CAT_ART_SCALE_BASE = 0.18;
  // На сколько единиц cat.ph нужно накопить на один кадр цикла ходьбы —
  // cat.ph растёт на 9/сек во время ходьбы (tick()), поэтому ~1.1 даёт
  // бодрый шаг без мельтешения кадров.
  const WALK_FRAME_STEP = 1.1;

  root.RCFG = {
    COL, FONT, DEBUG,
    BG_DEPTH, SHELL_DEPTH, ZONE_DEPTH, SHADOW_DEPTH, GLOW_DEPTH, TEXT_DEPTH, CEIL_DEPTH, UI_DEPTH, UI_TEXT_DEPTH,
    CAT_ART_SCALE_BASE, WALK_FRAME_STEP
  };
})(typeof window !== 'undefined' ? window : globalThis);
