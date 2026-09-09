/* ============================================================================
   Promotion/promotionConfig.js — ручной конфиг партнёрских сообщений нижней
   полосы (см. ui/hud.js: drawBannerStrip/advanceBannerSlide). Текст, ссылка и
   цели Метрики правятся тут, без изменений в UI-коде — компонент только
   читает эти поля.
   ========================================================================== */
(function (root) {
  'use strict';

  root.PROMOTION_CONFIG = {
    // Общий выключатель: false полностью убирает Promotion из ротации —
    // drawBannerStrip просто продолжает крутить обычные подсказки, без
    // разрыва/скачка в ленте.
    enabled: true,

    // Сколько мс после ПЕРВОГО запуска игрока (firstGameStartedAt, см.
    // catroom/src/save.js) Promotion вообще не участвует в ротации. Это
    // именно про знакомство с игрой один раз, не про каждое открытие —
    // firstGameStartedAt не обновляется между сессиями.
    firstLaunchDelayMs: 120000,

    // Целевая доля рекламных слайдов в ленте. В этом MVP частоту реально
    // задаёт BANNER_AD_EVERY (render/constants.js, сейчас 4 → 1 рекламный
    // слайд на 4, то есть ровно 0.25) — maxShare тут объявлен как источник
    // истины на будущее, если ротация станет считать долю от этого поля
    // напрямую, а не от отдельной константы.
    maxShare: 0.25,

    promotions: [
      {
        id: 'oplati-podpisku',
        enabled: true,

        line1: 'Используешь зарубежные подписки? Оплати через нашу ссылку →',
        line2: '5% вернутся нам бонусами и помогут развитию игры 🐾',

        infoText: 'Это партнёрская ссылка. Сервис начисляет нам 5% от каждой ' +
          'вашей оплаты на бонусный баланс. Эти бонусы помогают сократить ' +
          'расходы на сервисы и направить больше средств на развитие «Котострофы».',

        url: 'https://telegram.me/oplatipodpiskubot?start=ref_278491710',

        analytics: {
          impression: 'partner_banner_impression',
          click: 'partner_banner_click',
          infoClick: 'partner_banner_info_click'
        }
      }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
