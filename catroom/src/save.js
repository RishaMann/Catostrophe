/* ============================================================================
   save.js — сохранение состояния игрока на устройство (localStorage). Один
   JSON-снимок под ключом ниже. SAVESTORE — низкоуровневые чтение/запись, не
   привязаны к сцене; MIXIN_SAVE — методы сцены, которые знают, ЧТО из this.*
   сохранять и как накатить обратно при загрузке.
   ========================================================================== */
(function (root) {
  'use strict';

  const KEY = 'catroom.save.v1';

  function readRaw() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeRaw(data) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* приватный режим браузера / переполненная квота — не мешаем игре */ }
  }

  root.SAVESTORE = { read: readRaw, write: writeRaw };

  root.MIXIN_SAVE = {
    // Вызывается один раз в createStep3Finish, ПОСЛЕ того как дефолты сцены
    // (this.st/mood/fish/gems/catCharacter/lightsOn/lampOn) уже расставлены
    // конфигом сцены, но ДО создания catImg (тот читает activeCatConfig(),
    // которая смотрит на this.catCharacter) — см. вызов в game.js.
    loadSavedState() {
      const saved = root.SAVESTORE.read();
      // firstGameStartedAt — момент первого запуска ИГРОКА, не текущей
      // сессии; нужен и Promotion (firstLaunchDelayMs), и просто как факт
      // сохранения. Если сейчас первый раз в жизни — фиксируем текущее время.
      this.firstGameStartedAt = (saved && saved.firstGameStartedAt) || Date.now();
      if (!saved) return;
      if (saved.mood != null) this.mood = saved.mood;
      if (saved.fish != null) this.fish = saved.fish;
      if (saved.gems != null) this.gems = saved.gems;
      if (saved.lightsOn != null) this.lightsOn = saved.lightsOn;
      if (saved.lampOn != null) this.lampOn = saved.lampOn;
      if (saved.catCharacter && this.catNames.includes(saved.catCharacter)) {
        this.catCharacter = saved.catCharacter;
        this.catSpeed = this.activeCatConfig().speed;
      }
      const st = saved.st;
      if (st) {
        if (st.place) this.st.place = st.place;
        if (st.floor) this.st.floor = st.floor;
        if (st.placeState) this.st.placeState = st.placeState;
        if (st.doorGag != null) this.st.door.gag = st.doorGag;
      }
    },

    // Полный снимок игрока — по таймеру (SAVE_INTERVAL_MS, game.js update())
    // и на скрытие/закрытие страницы. Дешёвая операция (один JSON.stringify
    // небольшого объекта) — можно звать чаще, чем реально нужно, с запасом.
    saveGame() {
      if (!this.st) return; // сцена ещё не досоздалась (createStep3Finish не завершился)
      root.SAVESTORE.write({
        v: 1,
        firstGameStartedAt: this.firstGameStartedAt,
        mood: this.mood, fish: this.fish, gems: this.gems,
        catCharacter: this.catCharacter,
        lightsOn: this.lightsOn, lampOn: this.lampOn,
        st: {
          place: this.st.place, floor: this.st.floor,
          placeState: this.st.placeState, doorGag: this.st.door && this.st.door.gag
        }
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
