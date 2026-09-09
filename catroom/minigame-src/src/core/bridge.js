// ============================================================
//  BRIDGE — связь с catroom, когда игра открыта в его <iframe>
// ============================================================
//  Мини-игра всегда может работать сама по себе (GitHub Pages, npm run
//  dev) — тогда window.parent === window и всё в этом файле молчит.
//  Внутри catroom (catroom/src/minigame.js создаёт iframe и слушает
//  postMessage) — по этим же сообщениям catroom начисляет рыбок и
//  настроение коту в СВОЁМ сохранении (catroom/src/save.js), не трогая
//  localStorage мини-игры напрямую.
// ============================================================

const EMBEDDED = (() => {
  try { return !!window.parent && window.parent !== window; } catch (e) { return false; }
})();

export function isEmbedded() { return EMBEDDED; }

// Один снимок total fish на момент открытия страницы — дальше отдаём
// родителю разницу (сколько заработано ЗА ЭТОТ заход), а не абсолютное
// число: у catroom своя рыбья экономика, свой счётчик.
let sessionStartFish = null;

export function markSessionStart(totalFish) {
  if (sessionStartFish === null) sessionStartFish = totalFish;
}

export function exitToRoom(totalFishNow) {
  const earned = Math.max(0, totalFishNow - (sessionStartFish || 0));
  if (EMBEDDED) {
    try {
      window.parent.postMessage({ type: 'catdom:exit', fishEarned: earned }, '*');
      return;
    } catch (e) { /* другой origin/уже закрыто — просто не выходим */ }
  }
}
