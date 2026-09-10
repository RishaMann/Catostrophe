// ============================================================
//  ГЕОМЕТРИЯ ПОВЕРХНОСТЕЙ — ручные правки из скрытой отладки
// ============================================================
//  Базовые значения живут в level.js, поверх них — два слоя:
//    BASE_FILE (surfaceGeometryData.json, закоммиченный источник истины,
//               одинаков у всех игроков после деплоя)
//    localStorage (черновик текущего браузера/сессии, ещё не «испечён»
//               в файл — см. exportSurfaceGeometry/dumpMerged)
//  localStorage побеждает над файлом там, где есть и то, и то — тот же
//  порядок приоритета, что у редактора геометрии основной комнаты
//  (catroom/src/room/assetGeometry.js), тем же способом решает ту же
//  проблему: localStorage привязан к origin, и правки «теряются» при
//  смене порта/хоста дев-сервера, если их не забрать в файл руками.
//
//  Хранилище — общий словарь id -> произвольный плоский объект, одно и то
//  же для ВСЕХ видов ручных правок этой сцены: линии поверхностей
//  (inset/left/right/tiltLeft/tiltRight/slideSpeed) и точки зацепа
//  (id вида 'hang:<имя>' -> {x,y}, см. LevelScene.buildHangPoints). Формы
//  не пересекаются по ключам, поэтому один STORAGE_KEY/файл спокойно
//  обслуживает оба — сам модуль про разницу между ними не знает, её
//  различает только вызывающий код (resolveSurfaceGeometry/resolveHangPoint).

import BASE_FILE from '../config/surfaceGeometryData.json';

const STORAGE_KEY = 'cat-game-surface-geometry-v2';
const EXPORT_KEY = 'cat-game-surface-geometry-last-export-v1';

export function loadSurfaceGeometry() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value && typeof value === 'object' ? value : {};
  } catch (e) {
    return {};
  }
}

function saveGeneric(id, data) {
  const all = loadSurfaceGeometry();
  all[id] = { ...data };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    // В приватном режиме редактор остаётся рабочим до перезагрузки.
  }
  return all[id];
}

export function resolveSurfaceGeometry(id, size, defaults, saved) {
  const base = {
    inset: defaults.inset,
    left: defaults.left ?? -size.w / 2,
    right: defaults.right ?? size.w / 2,
    // Наклон линии (px, высота НАД/ПОД общим inset на каждом краю) —
    // статичная, всегда действующая настройка (не путать с
    // item.tippable/tipState — тем временным заваливанием, что триггерится
    // геймплеем, см. LevelScene.triggerTip). Дефолт 0 — ровная линия, как
    // раньше.
    tiltLeft: defaults.tiltLeft || 0,
    tiltRight: defaults.tiltRight || 0,
    // «Скользкое» — включает пассивное сползание на наклонной линии САМО
    // ПО СЕБЕ, не только у item.tippable в заваленном состоянии (см.
    // LevelScene.slidingTarget). Дефолт false — как раньше, наклон сам по
    // себе ничего не двигает, если явно не пометить линию скользкой.
    slippery: defaults.slippery || false,
    // Скорость сползания кота по наклонной линии (px/с) — используется
    // только у item.tippable, но поле общее для всех: не задано в
    // defaults — не задано и тут, resolve просто не добавит ключ.
    ...(defaults.slideSpeed != null ? { slideSpeed: defaults.slideSpeed } : {})
  };
  const fromFile = BASE_FILE && BASE_FILE[id];
  const fromStorage = saved && saved[id];
  return { ...base, ...(fromFile || {}), ...(fromStorage || {}) };
}

export function saveSurfaceGeometry(id, surface) {
  return saveGeneric(id, {
    inset: Math.round(surface.inset),
    left: Math.round(surface.left),
    right: Math.round(surface.right),
    ...((surface.tiltLeft || surface.tiltRight) ? {
      tiltLeft: Math.round(surface.tiltLeft || 0),
      tiltRight: Math.round(surface.tiltRight || 0)
    } : {}),
    ...(surface.slippery ? { slippery: true } : {}),
    ...(surface.slideSpeed != null ? { slideSpeed: Math.round(surface.slideSpeed) } : {})
  });
}

// Точка зацепа (люстра/окно, см. LevelScene.registerHangPoint) — та же
// схема base-файл+localStorage, но хранит СМЕЩЕНИЕ (dx,dy) от процедурной
// позиции ЭТОГО захода (defaults.x/y — люстра с её случайным jitter,
// окно после возможного зеркалирования), не абсолютные координаты.
// Абсолютные x,y меняются от захода к заходу (комната каждый раз немного
// другая), а привязка к спрайту должна сохраняться — если бы override был
// абсолютным, после первого же Save точка «прикола­чивалась» бы к пикселю
// одного конкретного захода и переставала следовать за люстрой/окном в
// следующих (это и была жалоба).
export function resolveHangPoint(id, defaults, saved) {
  const fromFile = BASE_FILE && BASE_FILE[id];
  const fromStorage = saved && saved[id];
  const offset = { dx: 0, dy: 0, ...(fromFile || {}), ...(fromStorage || {}) };
  return { x: defaults.x + (offset.dx || 0), y: defaults.y + (offset.dy || 0), dx: offset.dx || 0, dy: offset.dy || 0 };
}

export function saveHangPoint(id, offset) {
  return saveGeneric(id, { dx: Math.round(offset.dx || 0), dy: Math.round(offset.dy || 0) });
}

// Геометрия картинки (масштаб/зеркало/сдвиг) — независимая от логической
// точки/линии предмета, id-неймспейс 'sprite:<имя>'. Раньше картинка
// точки зацепа (люстра) была жёстко приклеена к самой точке (x,y один в
// один) — это и была жалоба «точка двигается вместе с люстрой»: поправить
// картинку относительно точки было нечем. offsetX/Y — сдвиг картинки от
// логической точки/центра предмета, НЕ абсолютные координаты.
export function resolveSpriteGeometry(id, saved) {
  const defaults = { scaleMul: 1, mirror: false, offsetX: 0, offsetY: 0 };
  const fromFile = BASE_FILE && BASE_FILE[id];
  const fromStorage = saved && saved[id];
  return { ...defaults, ...(fromFile || {}), ...(fromStorage || {}) };
}

export function saveSpriteGeometry(id, geo) {
  return saveGeneric(id, {
    scaleMul: Math.round(geo.scaleMul * 100) / 100,
    mirror: !!geo.mirror,
    offsetX: Math.round(geo.offsetX),
    offsetY: Math.round(geo.offsetY)
  });
}

// Слепок BASE_FILE + localStorage — то, что надо вставить обратно в
// surfaceGeometryData.json и закоммитить, чтобы правки стали дефолтом для
// ВСЕХ игроков (сам localStorage — только черновик этого браузера, его
// никто больше не видит). Просто localStorage потерял бы всё, что уже
// было в файле и что в этой сессии не трогали. Общий для линий и точек
// зацепа — оба лежат в одном словаре, dumpMerged про разницу не знает.
export function dumpSurfaceGeometry() {
  const s = loadSurfaceGeometry();
  const ids = new Set([...Object.keys(BASE_FILE || {}), ...Object.keys(s)]);
  const out = {};
  ids.forEach(id => { out[id] = { ...(BASE_FILE[id] || {}), ...(s[id] || {}) }; });
  return out;
}

// «Экспорт» — не только копирование для разработчика, но и именованная
// пользовательская контрольная точка для кнопки «Сбросить».
export function saveExportSnapshot(snapshot) {
  try {
    localStorage.setItem(EXPORT_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // В приватном режиме экспорт всё равно остаётся в консоли/буфере.
  }
}

export function loadExportSnapshot() {
  try {
    const value = JSON.parse(localStorage.getItem(EXPORT_KEY));
    if (value && typeof value === 'object') return value;
  } catch (e) {
    // Повреждённая контрольная точка не должна ломать редактор.
  }
  return BASE_FILE || {};
}
