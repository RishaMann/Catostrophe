/* ============================================================================
   analytics.js — единая точка отправки целей в Яндекс.Метрику. Счётчик
   (window.ym) подключается отдельным <script> в index.html, сюда его
   вставлять второй раз не нужно. Модули игры (в т.ч. Promotion/) вызывают
   только sendMetrikaGoal — сырой ym(...) больше нигде по проекту не
   разбросан.
   ========================================================================== */
(function (root) {
  'use strict';

  const YANDEX_METRIKA_ID = 112400019;

  // Метрика — необязательный внешний сервис: AdBlock/оффлайн/блокировка
  // mc.yandex.ru не должны бросать исключение наружу и мешать игре.
  function sendMetrikaGoal(goal, params) {
    if (!goal) return;
    try {
      if (typeof root.ym !== 'function') return;
      root.ym(YANDEX_METRIKA_ID, 'reachGoal', goal, params);
    } catch (error) {
      console.warn('[Metrika] Goal failed:', goal, error);
    }
  }

  root.ANALYTICS = { YANDEX_METRIKA_ID, sendMetrikaGoal };
})(typeof window !== 'undefined' ? window : globalThis);
