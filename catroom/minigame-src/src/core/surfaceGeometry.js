// ============================================================
//  ГЕОМЕТРИЯ ПОВЕРХНОСТЕЙ — ручные правки из скрытой отладки
// ============================================================
//  Базовые значения живут в level.js, сохранённые браузером значения
//  накладываются поверх них. Это тот же подход, что у редактора геометрии
//  основной комнаты: статическая игра не пишет обратно в исходники,
//  поэтому рабочий слой хранится в localStorage.

const STORAGE_KEY = 'cat-game-surface-geometry-v2';

export function loadSurfaceGeometry() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value && typeof value === 'object' ? value : {};
  } catch (e) {
    return {};
  }
}

export function resolveSurfaceGeometry(id, size, defaults, saved) {
  const base = {
    inset: defaults.inset,
    left: defaults.left ?? -size.w / 2,
    right: defaults.right ?? size.w / 2
  };
  const override = saved && saved[id];
  return { ...base, ...(override || {}) };
}

export function saveSurfaceGeometry(id, surface) {
  const all = loadSurfaceGeometry();
  all[id] = {
    inset: Math.round(surface.inset),
    left: Math.round(surface.left),
    right: Math.round(surface.right)
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    // В приватном режиме редактор остаётся рабочим до перезагрузки.
  }
  return all[id];
}
