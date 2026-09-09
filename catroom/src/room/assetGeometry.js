/* ============================================================================
   room/assetGeometry.js — общий (не привязанный к коту/мебели) слой геометрии
   визуальных ассетов. Отвечает на технический аудит (см. переписку): размер
   PNG никогда не должен определять ЛОГИЧЕСКОЕ положение объекта — только его
   visual bounds. Тут это проведено буквально: единственное, что эта система
   умеет читать из картинки, — где в НЕЙ САМОЙ находится непрозрачный контент
   (alpha bounds). Мировая позиция/footprint/depth остаются полностью на
   стороне вызывающего кода (cat/catAppearance.js, room/itemsRender.js) —
   этот модуль только говорит, КУДА В КАРТИНКЕ поставить уже готовую мировую
   точку (origin) и на сколько экранных пикселей её сдвинуть (offset).

   Пайплайн (auto + manual, оба слоя всегда доступны):
     source PNG (уже загружен как Phaser-текстура)
       → alphaBounds()        — где в картинке непрозрачный контент
       → autoCat()/autoFurniture() — предложенная геометрия (авто)
       → getOverride()        — ручная правка из AssetGeometryEditor, если есть
       → resolve()            — override поверх auto, приоритет ручному
       → рендер (catAppearance.js/itemsRender.js применяют origin/offset)

   Метаданные (ручные правки) хранятся в localStorage — вся игра статический
   сайт без бэкенда, это единственное место, куда можно писать из браузера.
   Сами PNG никогда не меняются. entityId/stateKey — общие строковые ключи
   (не «if (iid==='box')» внутри этого модуля): кот адресуется как
   'cat:<Персонаж>', мебель — как 'furn:<iid>'; какие именно entity сейчас
   можно редактировать — решает вызывающий код (ui/assetGeometryEditor.js),
   не этот файл.
   ========================================================================== */
(function (root) {
  'use strict';

  // Какие floor-предметы переведены на эту геометрию (авто по альфа-
  // контенту + ручная правка) — общий признак для ВСЕХ мест, где мебель
  // рисуется картинкой: стоящая на полу (room/itemsRender.js), «призрак» в
  // руке при перетаскивании (ui/hud.js drawGhost) и редактор (ui/
  // assetGeometryEditor.js). Раньше это был фиксированный Set(['box']) —
  // каждый новый предмет с картинкой пришлось бы дописывать сюда вручную,
  // хотя реальный признак «у этого предмета есть картинка» уже полностью
  // описан в Furniture/manifest.json (room/furnitureSprites.js). Теперь
  // FURNITURE_ITEMS.has(iid) — просто прокси на FS.has(iid): любой предмет,
  // которому вырезали спрайт и добавили в манифест, автоматически получает
  // честную anchor-геометрию везде, без правок кода — и старые предметы, и
  // будущие.
  const FURNITURE_ITEMS = { has: iid => !!(root.FURN_SPRITES && root.FURN_SPRITES.has(iid)) };

  const STORAGE_KEY = 'catroom.assetGeometry.v1';
  const ALPHA_THRESHOLD = 10; // 0..255, отсекаем полупрозрачный шум сглаживания по краю

  /* ---------- alpha bounds: единственное, что модуль читает из картинки ---------- */
  const alphaCache = new Map(); // textureKey -> {x0,y0,x1,y1,w,h,imgW,imgH} | null (не удалось прочитать)
  let scratch = null; // один переиспользуемый offscreen-канвас на все вызовы

  function alphaBoundsOf(textureKey, img) {
    if (alphaCache.has(textureKey)) return alphaCache.get(textureKey);
    let result = null;
    try {
      const w = img.width, h = img.height;
      if (!scratch) scratch = document.createElement('canvas');
      scratch.width = w; scratch.height = h;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
          if (data[row + x * 4 + 3] > ALPHA_THRESHOLD) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      // Пустая (полностью прозрачная) картинка — считаем контентом всё
      // изображение целиком, чтобы не делить на ноль ниже.
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
      result = { x0, y0, x1: x1 + 1, y1: y1 + 1, imgW: w, imgH: h };
      result.w = result.x1 - result.x0;
      result.h = result.y1 - result.y0;
    } catch (e) {
      // Canvas tainted (кросс-домен) или ещё не декодирован — авто-анализ
      // недоступен, резолвер откатится на безопасный fallback (см. resolve()).
      result = null;
    }
    alphaCache.set(textureKey, result);
    return result;
  }

  /* ---------- ручные правки: localStorage, ключ — entityId, дальше stateKey ---------- */
  let store = null;
  function loadStore() {
    if (store) return store;
    try { store = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (e) { store = {}; }
    return store;
  }
  function saveStore() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store || {})); } catch (e) { /* квота/приватный режим — тихо игнорируем */ }
  }

  // Базовый слой из закоммиченного файла (room/assetGeometryData.json,
  // грузится через Phaser JSON loader в game.js и передаётся сюда один раз
  // при старте сцены). Решает конкретную практическую проблему: localStorage
  // привязан к origin (схема+хост+порт), а локальный dev-сервер catroom
  // поднимается с autoPort — то есть почти на каждом перезапуске это другой
  // origin, и правки из редактора «пропадают» не потому что стёрлись, а
  // потому что осели на порту, которого больше нет. Файл — расшаренный между
  // origin'ами и версионируемый источник истины, localStorage поверх него —
  // черновой слой для правок текущей сессии, которые ещё не экспортированы
  // (см. geoExportCurrent в ui/assetGeometryEditor.js). Приоритет —
  // localStorage поверх base, ПОПОЛЯМ: base используется только для тех
  // entity/state/полей, которых в localStorage вообще нет (см. getOverride).
  let base = {};
  function seedBase(fileData) {
    base = (fileData && typeof fileData === 'object') ? fileData : {};
  }

  function getOverride(entityId, stateKey) {
    const s = loadStore();
    const fromBase = (base[entityId] && base[entityId][stateKey]) || null;
    const fromStore = (s[entityId] && s[entityId][stateKey]) || null;
    if (!fromBase && !fromStore) return null;
    return Object.assign({}, fromBase, fromStore);
  }
  function setOverride(entityId, stateKey, patch) {
    const s = loadStore();
    if (!s[entityId]) s[entityId] = {};
    s[entityId][stateKey] = Object.assign({}, s[entityId][stateKey], patch);
    saveStore();
  }
  function resetOverride(entityId, stateKey) {
    const s = loadStore();
    if (s[entityId]) delete s[entityId][stateKey];
    saveStore();
  }

  // Живая (несохранённая) правка — пока пользователь тащит anchor/sort в
  // AssetGeometryEditor. Не пишется в localStorage до явного Save (см.
  // effectiveOverride ниже — она побеждает над сохранённым override, чтобы
  // рендер сразу показывал результат перетаскивания). Ровно один активный
  // live-патч сразу — редактор в любой момент времени работает с одним
  // выбранным ассетом/state, это не ограничение архитектуры, а факт UI.
  let live = null;
  function setLive(entityId, stateKey, patch) {
    live = { entityId, stateKey, patch: Object.assign({}, live && live.entityId === entityId && live.stateKey === stateKey ? live.patch : null, patch) };
  }
  function clearLive() { live = null; }
  function getLive(entityId, stateKey) {
    return (live && live.entityId === entityId && live.stateKey === stateKey) ? live.patch : null;
  }
  // override, который реально должен использовать рендер прямо сейчас —
  // сохранённый (localStorage) с наложенной живой правкой поверх, если она
  // есть и относится к тому же ассету/state.
  function effectiveOverride(entityId, stateKey) {
    const saved = getOverride(entityId, stateKey);
    const l = getLive(entityId, stateKey);
    if (!saved && !l) return null;
    return Object.assign({}, saved, l);
  }

  const DEFAULT_GEOMETRY = { anchor: { x: 0.5, y: 1 }, offset: { x: 0, y: 0 }, sortBias: 0, scaleMul: 1 };

  // auto: {anchor:{x,y}, contentW, contentH} — из alpha bounds, без override.
  // Единая для кота и мебели: разница между ними только в том, ЧТО считается
  // «референсной точкой контента» (см. autoCat ниже — там ещё и sequence).
  function autoFromAlpha(ab) {
    if (!ab) return { anchor: { x: DEFAULT_GEOMETRY.anchor.x, y: DEFAULT_GEOMETRY.anchor.y }, contentW: null, contentH: null };
    return {
      anchor: { x: (ab.x0 + ab.x1) / 2 / ab.imgW, y: ab.y1 / ab.imgH },
      contentW: ab.w, contentH: ab.h
    };
  }

  // Мебель: авто = альфа-контент этого конкретного состояния, без привязки к
  // другим состояниям того же предмета — у box/new и box/afterGag разные
  // силуэты по определению (разные state), общая у них только ЛОГИЧЕСКАЯ
  // точка (footprint), которую этот модуль вообще не трогает (см. шапку файла).
  function autoFurniture(textureKey, img) {
    return autoFromAlpha(alphaBoundsOf(textureKey, img));
  }

  // Кот: если frameKey входит в последовательность (walk-цикл, покадровая
  // анимация игры/еды) — берём НЕ собственный alpha bottom/center этого
  // кадра, а МЕДИАНУ по всей последовательности (см. шапку файла: «sequence
  // → общая reference geometry», не «каждый кадр свой центр»). Медиана, не
  // среднее — устойчивее к одному кадру-выбросу (например, кадр с поднятой
  // лапой/хвостом). Заодно и МАСШТАБ (medianH/thisFrameH, см. autoCat) — не
  // только точка опоры плавала между независимо нарезанными кадрами, но и
  // видимый размер (голова/тело крупнее-мельче кадр от кадра); нормируем к
  // той же медианной высоте контента, что и anchor, тем же проходом.
  // sequenceFrames — все ключи текстур кадров цикла, приходят от вызывающего
  // кода (catAppearance.js знает про sprites.walk/play*), этот модуль про
  // формат конфига персонажа ничего не знает.
  const seqRefCache = new Map(); // sequenceId -> {ax, ay, medianH, heights: Map(key->h)} | null
  function median(arr) {
    const a = arr.slice().sort((x, y) => x - y);
    const n = a.length;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }
  function sequenceReference(sequenceId, frameTextureKeys, getImg) {
    if (seqRefCache.has(sequenceId)) return seqRefCache.get(sequenceId);
    const axs = [], ays = [], heights = new Map();
    frameTextureKeys.forEach(key => {
      const img = getImg(key);
      if (!img) return;
      const ab = alphaBoundsOf(key, img);
      if (!ab) return;
      axs.push((ab.x0 + ab.x1) / 2 / ab.imgW);
      ays.push(ab.y1 / ab.imgH);
      heights.set(key, ab.h);
    });
    const ref = axs.length ? { ax: median(axs), ay: median(ays), medianH: median([...heights.values()]), heights } : null;
    seqRefCache.set(sequenceId, ref);
    return ref;
  }

  function autoCat(textureKey, img, sequenceId, frameTextureKeys, getImg) {
    const ab = alphaBoundsOf(textureKey, img);
    const base = autoFromAlpha(ab);
    if (sequenceId && frameTextureKeys && frameTextureKeys.length > 1) {
      const ref = sequenceReference(sequenceId, frameTextureKeys, getImg);
      if (ref) {
        base.anchor = { x: ref.ax, y: ref.ay };
        const h = ref.heights.get(textureKey);
        if (h) base.scaleMul = ref.medianH / h;
      }
    }
    return base;
  }

  // auto — результат autoCat()/autoFurniture() выше. override — ручная
  // правка (getOverride) или null. Override побеждает целиком по полю: если
  // пользователь подвинул anchor в редакторе, auto для anchor больше не
  // используется, но offset/sortBias, которые он не трогал, остаются auto-0.
  // scaleMul — то же самое, но с промежуточным auto-слоем (см. autoCat):
  // ручной override.scaleMul, если он есть, побеждает; иначе — авто-поправка
  // по sequence (синхронизация размера кадров walk/play*), иначе — 1.
  function resolve(auto, override) {
    const a = (override && override.anchor) || auto.anchor || DEFAULT_GEOMETRY.anchor;
    const o = (override && override.offset) || DEFAULT_GEOMETRY.offset;
    const sortBias = (override && typeof override.sortBias === 'number') ? override.sortBias : DEFAULT_GEOMETRY.sortBias;
    const scaleMul = (override && typeof override.scaleMul === 'number') ? override.scaleMul
      : (typeof auto.scaleMul === 'number') ? auto.scaleMul : DEFAULT_GEOMETRY.scaleMul;
    return {
      originX: a.x, originY: a.y,
      offsetX: o.x, offsetY: o.y,
      sortBias, scaleMul,
      contentW: auto.contentW, contentH: auto.contentH
    };
  }

  // Объединённый base+localStorage слепок — то, что реально нужно записать
  // обратно в assetGeometryData.json, чтобы «испечь» текущие правки в файл
  // (см. geoExportCurrent в ui/assetGeometryEditor.js): просто localStorage
  // потерял бы всё, что уже было в base и что пользователь в этой сессии не
  // трогал.
  function dumpMerged() {
    const s = loadStore();
    const keys = new Set([...Object.keys(base), ...Object.keys(s)]);
    const out = {};
    keys.forEach(entityId => {
      const stateKeys = new Set([...Object.keys(base[entityId] || {}), ...Object.keys(s[entityId] || {})]);
      out[entityId] = {};
      stateKeys.forEach(stateKey => {
        out[entityId][stateKey] = Object.assign({}, (base[entityId] || {})[stateKey], (s[entityId] || {})[stateKey]);
      });
    });
    return out;
  }

  root.AssetGeometry = {
    alphaBoundsOf, autoFurniture, autoCat, sequenceReference,
    getOverride, setOverride, resetOverride, resolve,
    setLive, clearLive, getLive, effectiveOverride,
    seedBase, dumpMerged,
    DEFAULT_GEOMETRY, FURNITURE_ITEMS,
    // Экспорт для AssetGeometryEditor (список всех правок — для Reset/отладки)
    _dumpStore: () => JSON.parse(JSON.stringify(loadStore()))
  };
})(typeof window !== 'undefined' ? window : globalThis);
