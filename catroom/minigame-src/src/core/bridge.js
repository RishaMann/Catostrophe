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

let launchContext = { catCharacter: 'Siamese' };
const contextListeners = new Set();

if (EMBEDDED) {
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'catdom:init') return;
    launchContext = {
      ...launchContext,
      catCharacter: typeof data.catCharacter === 'string'
        ? data.catCharacter
        : launchContext.catCharacter
    };
    contextListeners.forEach(listener => listener({ ...launchContext }));
  });

  // Родитель отвечает контекстом. Отдельный ready нужен, потому что iframe
  // может успеть загрузиться до того, как parent назначил onload.
  try { window.parent.postMessage({ type: 'catdom:ready' }, '*'); } catch (e) { /* standalone */ }
}

export function isEmbedded() { return EMBEDDED; }
export function getLaunchContext() { return { ...launchContext }; }
export function onLaunchContext(listener) {
  contextListeners.add(listener);
  return () => contextListeners.delete(listener);
}

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
