// ============================================================
//  СОХРАНЕНИЕ  —  всё состояние игрока в браузере
// ============================================================
//  Своего сервера у нас нет. Состояние живёт в localStorage,
//  а позже сюда же добавится дублирование в Telegram CloudStorage.
//  Весь остальной код обращается только к этим четырём функциям.
// ============================================================

const KEY = 'cat-game-save-v1';

const DEFAULT = {
  fish: 0,               // рыбки
  tasksDoneToday: [],    // id заданий, выполненных сегодня
  day: null,             // какой сегодня день (чтобы сбрасывать список заданий)
  stashTaken: []         // какие заначки уже собраны за сегодня
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function load() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (e) {
    data = {};
  }
  const state = { ...DEFAULT, ...data };
  // новый день — задания и заначки обновляются
  if (state.day !== today()) {
    state.day = today();
    state.tasksDoneToday = [];
    state.stashTaken = [];
    save(state);
  }
  return state;
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // приватный режим браузера — играем без сохранения, это не повод падать
  }
}

export function addFish(n) {
  const s = load();
  s.fish += n;
  save(s);
  return s.fish;
}

// Полный сброс. Нужен, пока мы тестируем: задания за день выполняются
// один раз, и без сброса пришлось бы ждать завтра.
// Перед релизом эту функцию и кнопку в меню убираем.
export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    // приватный режим — сбрасывать нечего
  }
  return load();
}

export function markTaskDone(taskId) {
  const s = load();
  if (!s.tasksDoneToday.includes(taskId)) s.tasksDoneToday.push(taskId);
  save(s);
  return s;
}
