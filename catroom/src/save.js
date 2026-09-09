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

  // Полный вайп (Настройки → «Полный вайп игры», см. input.js) — единственный
  // способ вернуть игрока на CatSelect: пока catId сохранён, Boot туда
  // больше не пускает (см. getCatChoice/splash/bootScene.js). Удаляет ключ
  // целиком, не просто зануляет catId, — заодно и остаток состояния
  // комнаты/мебели/настроения, раз это уже «вайп игры», а не только выбора.
  function clearAll() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(KEY);
    } catch (e) { /* см. writeRaw — тот же приватный режим/квота */ }
  }

  root.SAVESTORE = {
    read: readRaw, write: writeRaw, clear: clearAll,

    // Выбор кота на сплэше (CatSelect → «Начать», см. splash/catSelectScene.js)
    // — отдельное поле, не catCharacter: это решение ИГРОКА в терминах
    // сплэша ('baton'/'shilo'), а не имя персонажа из Cats/manifest.json —
    // комната сама мапит одно в другое (game.js: CAT_ID_TO_NAME). Пишется
    // СРАЗУ в момент выбора, не ждёт периодического autosave комнаты (тот
    // сохраняет catCharacter только раз в SAVE_INTERVAL_MS/на скрытие
    // вкладки — закрой игрок игру раньше, выбор потерялся бы и CatSelect
    // показался бы снова). Пока это поле есть — Boot пускает сразу в
    // WelcomeBackScene, минуя CatSelect (см. splash/bootScene.js).
    getCatChoice() {
      const saved = readRaw();
      return (saved && saved.catId) || null;
    },
    setCatChoice(catId) {
      writeRaw({ ...(readRaw() || {}), catId });
    }
  };

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
      // ...root.SAVESTORE.read() — иначе этот снимок затёр бы catId
      // (SAVESTORE.setCatChoice, см. save.js), про который RoomScene ничего
      // не знает: он пишется на CatSelect ДО того, как комната вообще
      // появляется, а полный снимок ниже перезаписывает весь ключ целиком.
      root.SAVESTORE.write({
        ...root.SAVESTORE.read(),
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
