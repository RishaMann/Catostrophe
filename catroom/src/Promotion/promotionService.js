/* ============================================================================
   Promotion/promotionService.js — логика поверх promotionConfig.js: какая
   кампания сейчас имеет право показаться (pickEligible) и как открыть её
   ссылку (openLink). UI (ui/hud.js) и ввод (input.js) вызывают только это —
   сырой ym(...)/window.open по всему проекту не размножаем.
   ========================================================================== */
(function (root) {
  'use strict';

  // t.me и алиас telegram.me — единственные ссылки, которые Telegram Mini
  // App умеет открывать через openTelegramLink; всё остальное (в будущих
  // кампаниях) идёт через обычный openLink/window.open ниже.
  const TELEGRAM_LINK_RE = /^https?:\/\/(t\.me|telegram\.me)\//i;

  // firstGameStartedAt/lastPromoId — не читает localStorage сам (это дело
  // save.js), только считает: прошла ли задержка знакомства и какую кампанию
  // показать, чтобы не повторить предыдущую подряд (сейчас кампания одна,
  // но при добавлении второй правило уже готово).
  function pickEligible(firstGameStartedAt, lastPromoId) {
    const cfg = root.PROMOTION_CONFIG;
    if (!cfg || !cfg.enabled) return null;
    // firstGameStartedAt ещё не известен — считаем, что игрок только что
    // начал, то есть задержка ТОЧНО не прошла (а не наоборот).
    const startedAt = firstGameStartedAt || Date.now();
    if (Date.now() - startedAt < cfg.firstLaunchDelayMs) return null;
    const active = (cfg.promotions || []).filter(p => p.enabled);
    if (!active.length) return null;
    return active.find(p => p.id !== lastPromoId) || active[0];
  }

  function openLink(url) {
    if (!url) return;
    try {
      const tg = root.Telegram && root.Telegram.WebApp;
      if (tg && TELEGRAM_LINK_RE.test(url) && typeof tg.openTelegramLink === 'function') {
        tg.openTelegramLink(url); return;
      }
      if (tg && typeof tg.openLink === 'function') { tg.openLink(url); return; }
    } catch (e) { /* падаем на обычную вкладку ниже */ }
    root.open(url, '_blank', 'noopener');
  }

  root.PROMOTION = { pickEligible, openLink };
})(typeof window !== 'undefined' ? window : globalThis);
