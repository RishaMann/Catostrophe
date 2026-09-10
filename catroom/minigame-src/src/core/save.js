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
  day: null,             // московская дата текущего периода наград
  dailyClaims: [],       // источники рыбок, уже оплаченные за этот период
  stashTaken: []         // старое поле: совместимость сохранений
};

function today() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
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
    state.dailyClaims = [];
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

export function isClaimed(claimId) {
  return load().dailyClaims.includes(claimId);
}

// Весь улов захода попадает в профиль только после успешного задания.
// Каждый источник оплачивается максимум один раз за московские сутки.
export function completeRun(rewards, taskId, taskReward) {
  const s = load();
  let awarded = 0;
  rewards.forEach(({ id, fish }) => {
    if (!id || !fish || s.dailyClaims.includes(id)) return;
    s.dailyClaims.push(id);
    awarded += fish;
  });
  const taskClaim = `task:${taskId}`;
  if (taskReward && !s.dailyClaims.includes(taskClaim)) {
    s.dailyClaims.push(taskClaim);
    awarded += taskReward;
  }
  s.fish += awarded;
  if (!s.tasksDoneToday.includes(taskId)) s.tasksDoneToday.push(taskId);
  save(s);
  return awarded;
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
