// ============================================================
//  ЗАДАНИЯ  —  пул целей для уровня
// ============================================================
//  goal  — id предмета из level.js, куда надо добраться
// ============================================================

export const TASKS = [
  { id: 'shkaf-1', goal: 'shkaf',  title: 'Забраться на шкаф',       hint: 'Там наверху что-то есть. Я чувствую.' },
  { id: 'komod-1', goal: 'komod',  title: 'Занять комод',            hint: 'Телевизор тёплый. Это аргумент.' },
  { id: 'stol-1',  goal: 'stol',   title: 'Оказаться на круглом столе', hint: 'На стол нельзя. Именно поэтому.' },
  { id: 'krovat-1',goal: 'krovat', title: 'Занять кровать',          hint: 'Она свободна. Технически.' },
  { id: 'shkaf-2', goal: 'shkaf',  title: 'На шкаф за 4 прыжка',     hint: 'Можно и медленно. Но зачем.' }
];

// Три задания на сегодня, стабильные в течение дня
export function tasksForToday(dayString) {
  const seed = [...dayString].reduce((a, c) => a + c.charCodeAt(0), 0);
  const pool = [...TASKS];
  const out = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    out.push(pool.splice((seed + i * 7) % pool.length, 1)[0]);
  }
  return out;
}
