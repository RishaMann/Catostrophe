/* ============================================================================
   minigame.js — открытие/закрытие мини-игры (catroom/minigame/, отдельная
   Phaser-игра, собранная из minigame-src/, см. её README) во весь экран
   поверх канваса catroom. Общение с ней — только через postMessage
   (minigame-src/src/core/bridge.js шлёт 'catdom:exit' на выходе), сама
   мини-игра ведёт свою экономику рыбок в своём localStorage — сюда
   попадает только СКОЛЬКО заработано за заход (fishEarned), не абсолютное
   число: у catroom рыбки свои, их источников много (кормёжка, поглаживание
   и т.п.), это не «общий кошелёк», а разовая награда за игру.
   Без зависимостей от ISO/GAMEDATA — грузится в index.html до них, чтобы
   ui/hud.js мог позвать root.CatMinigame.open() из любого места.
   ========================================================================== */
(function (root) {
  'use strict';

  const overlay = document.getElementById('minigameOverlay');
  const frame = document.getElementById('minigameFrame');
  let onExit = null;
  let launchContext = { catCharacter: 'Siamese' };

  function sendLaunchContext() {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'catdom:init', ...launchContext }, window.location.origin);
  }

  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !frame || e.source !== frame.contentWindow) return;
    if (d.type === 'catdom:ready') {
      sendLaunchContext();
      return;
    }
    if (d.type !== 'catdom:exit') return;
    close_();
    if (onExit) { const cb = onExit; onExit = null; cb(Number(d.fishEarned) || 0); }
  });

  // exitCb(fishEarned) — вызывается один раз, при выходе из мини-игры
  // (кнопка «в комнату» там) или при её закрытии. fishEarned — 0, если
  // игрок ничего не заработал за заход или закрыл сразу.
  function open(options, exitCb) {
    if (!overlay || !frame) return;
    // Старый вызов open(callback) остаётся рабочим для внешних тестов.
    if (typeof options === 'function') {
      exitCb = options;
      options = null;
    }
    launchContext = {
      catCharacter: options && typeof options.catCharacter === 'string'
        ? options.catCharacter
        : 'Siamese'
    };
    onExit = exitCb || null;
    // Полная перезагрузка при каждом открытии — простой и надёжный способ
    // сбросить состояние сцены мини-игры; её собственный прогресс (рыбки,
    // задания дня) не теряется, он в её localStorage, не в памяти страницы.
    // 'minigame/' (папка, не .../index.html явно) — некоторые статические
    // раздатчики (например, serve с cleanUrls, см. .claude/launch.json)
    // при запросе index.html редиректят на URL без него и БЕЗ конечного
    // слэша — тогда относительные пути мини-игры (./assets/...) резолвятся
    // от catroom, а не от minigame/, и она грузится пустым экраном.
    frame.onload = sendLaunchContext;
    frame.src = 'minigame/';
    overlay.style.display = 'block';
  }

  function close_() {
    if (!overlay || !frame) return;
    overlay.style.display = 'none';
    frame.onload = null;
    frame.src = 'about:blank';
  }

  root.CatMinigame = { open, close: close_ };
})(typeof window !== 'undefined' ? window : globalThis);
