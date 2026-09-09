/* ============================================================================
   cat/catAppearance.js — какой персонаж активен и что из этого рисуется на
   экране: выбор кадра по состоянию, флип, покачивание, тень, реплика.
   Арт и переключение персонажа полностью данные (Cats/<Имя>/config.json), не
   код тут — чтобы завести нового кота, этот файл менять не нужно.
   ========================================================================== */
(function (root) {
  'use strict';

  const I = root.ISO;
  const { COL, FONT, TEXT_DEPTH, WALK_FRAME_STEP, CAT_ART_SCALE_BASE } = root.RCFG;

  root.MIXIN_CAT_APPEARANCE = {

    /* ---------- персонажи кота ---------- */
    activeCatConfig() { return this.cache.json.get('catcfg-' + this.catCharacter); },
    catFrameKeyFor(name, frameName) { return `cat_${name}_${frameName}`; },
    catFrameKey(frameName) { return this.catFrameKeyFor(this.catCharacter, frameName); },

    // Геометрия конкретного кадра (room/assetGeometry.js) — где на картинке
    // кадра находится «точка контакта с полом» (origin) и мелкая ручная
    // поправка (offset/sortBias), если она есть в AssetGeometryEditor.
    // Технический аудит: без этого катImg.setOrigin(0.5,1) был один на все
    // кадры персонажа, а кадры вырезаны независимо (разные пропорции/
    // паддинг) — отсюда «болтание» при смене кадра. Сама МИРОВАЯ позиция
    // (cat.x/cat.y) тут не участвует и не меняется — resolveCatGeometry
    // только решает, куда на СПРАЙТЕ поставить уже готовую мировую точку.
    catSequenceFor(sprites, frameName) {
      const w = sprites.walk;
      if (w) {
        if (Array.isArray(w)) {
          if (w.includes(frameName)) return { id: `cat:${this.catCharacter}:walk`, frames: w };
        } else {
          // 8-directional формат (Cats/Labra) — своя последовательность на
          // каждое направление, они не обязаны иметь общую reference-точку
          // (разные ракурсы тела).
          for (const dir of Object.keys(w)) {
            if (w[dir].frames && w[dir].frames.includes(frameName)) {
              return { id: `cat:${this.catCharacter}:walk:${dir}`, frames: w[dir].frames };
            }
          }
        }
      }
      // Покадровые анимации (playToy1/playToy2/playFed/playIdle — see
      // updateCatVisual/petCat/playHand) — та же проблема, что у walk без
      // sequenceReference: каждый из ~38 кадров резался независимо, свой
      // альфа-bottom-center на кадр даёт заметное «шатание» из стороны в
      // сторону при покадровой смене (не только по X — от кадра к кадру
      // могла плавать и высота). Раньше catSequenceFor знал только про
      // sprites.walk — эти сегменты вообще не попадали под медиану.
      // {frames,count} — префикс + порядковый номер, не готовый список имён,
      // разворачиваем в него же, чтобы отдать sequenceReference тот же
      // формат frameTextureKeys, что и для walk.
      for (const key of ['playToy1', 'playToy2', 'playFed', 'playIdle']) {
        const seg = sprites[key];
        if (!seg || !seg.frames || !seg.count) continue;
        const isMatch = frameName.lastIndexOf(seg.frames + '_', 0) === 0
          && Number.isInteger(+frameName.slice(seg.frames.length + 1))
          && +frameName.slice(seg.frames.length + 1) < seg.count;
        if (!isMatch) continue;
        const frames = Array.from({ length: seg.count }, (_, i) => seg.frames + '_' + i);
        return { id: `cat:${this.catCharacter}:${key}`, frames };
      }
      return null;
    },
    resolveCatGeometry(frameName) {
      const AG = root.AssetGeometry;
      const key = this.catFrameKey(frameName);
      const tex = this.textures.get(key);
      const img = tex && tex.getSourceImage();
      const sprites = this.activeCatConfig().sprites;
      const seq = this.catSequenceFor(sprites, frameName);
      const getImg = k => { const t = this.textures.get(k); return t && t.getSourceImage(); };
      const auto = img
        ? AG.autoCat(key, img, seq && seq.id, seq && seq.frames.map(f => this.catFrameKey(f)), getImg)
        : { anchor: AG.DEFAULT_GEOMETRY.anchor, contentW: null, contentH: null };
      const override = AG.effectiveOverride('cat:' + this.catCharacter, frameName);
      return AG.resolve(auto, override);
    },

    // Кнопка в нижнем правом меню (см. drawUI/onDown) открывает полноценную
    // панель выбора (drawCharacterPanel в ui/hud.js) — не цикличное
    // переключение. charPreviewName — что сейчас показано в превью справа,
    // отдельно от catCharacter (реально применённого) до нажатия «Выбрать».
    openCharacterPicker() {
      this.charPreviewName = this.catCharacter;
      this.setMode('characters');
    },

    // Порядок «вращения» в превью подобран вручную по контрольному листу
    // кадров (preview_sequence.png, кадры 1..8 = поза×зеркало): по часовой
    // стрелке 1→5→3→7→4→6 — перед_a, перед_b, бок_a, спина_b, бок_a
    // зеркально, перед_b зеркально, дальше цикл. «Бок_a» — это sit_back_a:
    // несмотря на имя файла, там кот сфотографирован в профиль, не со
    // спины (настоящая спина — sit_back_b); зеркалить его даёт разворот в
    // другую сторону, а не дубль, как было бы с симметричным «перед».
    // previewPoses в config.json персонажа — всегда [перед_a, бок_a,
    // перед_b, спина_b] в этом порядке (см. Cats/*/config.json), ROTATION
    // ссылается на эти 4 позы по индексу + флаг отражения. Это дефолт для
    // персонажей без своего порядка; если у арта другое направление разворота
    // (см. Labra — там зеркало на других шагах цикла), персонаж переопределяет
    // это через sprites.previewRotation той же формы [[индекс, флаг], ...].
    ROTATION_ORDER: [[0, false], [2, false], [1, false], [3, false], [1, true], [2, true]],
    catPreviewFrame(name) {
      const sprites = this.cache.json.get('catcfg-' + name).sprites;
      const poses = sprites.previewPoses;
      if (!poses || poses.length < 4) return { frameName: (poses && poses[0]) || sprites.idle, flip: false };
      const R = sprites.previewRotation || this.ROTATION_ORDER;
      const idx = Math.floor(this.time.now / 500) % R.length;
      const [pi, flip] = R[idx];
      return { frameName: poses[pi], flip };
    },

    /* ==================== КОТ ====================
       Единственный слой, который честно перерисовывается каждый кадр — это
       нормально: спрайт + маленькая тень/реплика, не вся сцена. Глубина —
       cat.x+cat.y, та же шкала, что и I.depth() у предметов, так что Phaser
       сам вставляет кота в правильное место между их GameObject'ами.

       Арт — спрайты активного персонажа (this.catCharacter, Cats/<Имя>/), не
       векторная фигура: за то, какой файл из sprites/ показывать в каком
       состоянии, отвечает конфиг персонажа (activeCatConfig().sprites), не
       код тут — чтобы завести нового кота, код менять не нужно. Состояния,
       для которых в конфиге всего один статичный кадр (idle/sit/lie/eatDig),
       так и остаются статичными позами — как и раньше у векторной фигуры,
       различие между ними только в том, какая поза выбрана и лёгком покачивании
       на eat/dig. Только у walk честный цикл кадров, и опционально (сейчас —
       только у сиамского) у jump/игры — покадровая анимация sprites.play. */
    updateCatVisual() {
      const g = this.gCat;
      g.clear();
      if (!this.catOn) {
        this.catImg.setVisible(false);
        if (this.tBubble) this.tBubble.setVisible(false);
        return;
      }
      this.catImg.setVisible(true);
      const cat = this.cat;
      const sprites = this.activeCatConfig().sprites;
      const b = I.P(cat.x, cat.y);
      const depth = cat.x + cat.y;

      // «Натуральная» (нефлипнутая) поза кадров sprites.walk смотрит влево на
      // экране — тот же вывод, что уже делали на арте redfat/siamese в
      // phaser-game: там для обоих скинов «смотрит влево» = не флипаем,
      // «вправо» = флипаем. Проверено визуально: dir=1 (движение вправо) без
      // флипа кот шёл задом (мордой влево при движении вправо).
      let frameName, bobY = 0, flip = cat.dir > 0;
      switch (cat.st) {
        case 'walk': {
          const w = sprites.walk;
          if (Array.isArray(w)) {
            // старый формат — один цикл кадров на оба горизонтальных
            // направления, флип уже посчитан выше (cat.dir > 0)
            frameName = w[Math.floor(cat.ph / WALK_FRAME_STEP) % w.length];
          } else {
            // 8-directional формат (см. Cats/Labra/config.json) — набор
            // кадров и флип берутся по cat.dir8 (см. catBehavior.tick),
            // полностью заменяют дефолтный flip = cat.dir > 0 сверху
            const d = w[cat.dir8] || w.down;
            frameName = d.frames[Math.floor(cat.ph / WALK_FRAME_STEP) % d.frames.length];
            flip = !!d.flip;
          }
          break;
        }
        case 'sit':
          frameName = sprites.sit;
          break;
        case 'lie':
          frameName = sprites.lie;
          break;
        case 'eat':
        case 'dig': {
          // cat.playSegment === 'playFed' только когда покормили именно «с
          // руки» (feedHand) — у feedBowl/feedFloor он остаётся null (сброшен
          // в setSt), там всегда обычная статичная поза с покачиванием.
          const seg = cat.playSegment && sprites[cat.playSegment];
          if (seg) {
            const idx = Math.min(seg.count - 1, Math.floor(cat.stateElapsedMs / seg.frameMs));
            frameName = seg.frames + '_' + idx;
            flip = false;
          } else {
            frameName = sprites.eatDig;
            bobY = Math.sin(performance.now() / 90) * 2;
          }
          break;
        }
        case 'jump': {
          const seg = cat.playSegment && sprites[cat.playSegment];
          if (seg) {
            const idx = Math.min(seg.count - 1, Math.floor(cat.stateElapsedMs / seg.frameMs));
            frameName = seg.frames + '_' + idx;
            flip = false; // покадровая анимация игры/еды всегда анфас, не зеркалим
          } else {
            frameName = sprites.jump;
            bobY = -Math.abs(Math.sin(performance.now() / 140)) * 10;
          }
          break;
        }
        default:
          frameName = sprites.idle;
      }

      // «Отладка предметов»: переключатель кадров (geoCycleCatFrame,
      // ui/assetGeometryEditor.js) насильно ставит конкретный спрайт вместо
      // того, что выбрало бы обычное поведение (cat.st) — иначе поставить
      // конкретную позу для правки anchor/scale можно было бы только
      // дождавшись, пока кот сам её примет. Мировая позиция (b) и тень тут
      // не участвуют — подменяется только то, какая картинка встаёт в неё.
      if (this.assetDebug && this.geoCatFrameOverride) frameName = this.geoCatFrameOverride;

      // Кэш текущего кадра — только для AssetGeometryEditor (ui/
      // assetGeometryEditor.js), чтобы читать «что сейчас показано» без
      // повторения всего switch(cat.st) выше.
      this._lastCatFrame = frameName;

      // Геометрия кадра (room/assetGeometry.js) — origin по альфа-контенту
      // (авто) или ручной правке из AssetGeometryEditor (Настройки →
      // «Отладка предметов»), не фиксированный (0.5,1) на все кадры. Мировая
      // точка b = I.P(cat.x,cat.y) не пересчитывается вообще — геометрия
      // решает только, куда НА СПРАЙТЕ она попадёт (origin) и мелкий
      // пиксельный сдвиг (offset) поверх этого.
      const geo = this.resolveCatGeometry(frameName);
      this.catImg.setTexture(this.catFrameKey(frameName));
      this.catImg.setOrigin(geo.originX, geo.originY);
      // scaleMul — ручная поправка размера из AssetGeometryEditor (тянуть за
      // угол), поверх базового масштаба персонажа (CAT_ART_SCALE_BASE*zoom),
      // не вместо него — общий масштаб «комната приближена/отдалена»
      // (params.zoom) должен по-прежнему одинаково двигать всех персонажей.
      this.catImg.setScale(CAT_ART_SCALE_BASE * this.params.zoom * geo.scaleMul);
      this.catImg.setFlipX(flip);
      this.catImg.setPosition(b[0] + geo.offsetX, b[1] + bobY + geo.offsetY);
      this.catImg.setDepth(depth + geo.sortBias);

      // тень и реплика — по-прежнему векторные, чуть позади спрайта. Тень —
      // по одной на каждый источник света в радиусе (room/lighting.js:
      // drawCatShadow), не фиксированный кружок: считается каждый кадр, кот
      // двигается в отличие от мебели, чьи тени пересобираются в rebuild().
      g.setDepth(depth - 0.001);
      this.drawCatShadow(g, cat.x, cat.y);

      if (cat.bubble) {
        const tw = cat.bubble.length * 5.6 + 18, bx = b[0] - tw / 2, by = b[1] - 58 + bobY;
        g.fillStyle(COL.chalk, 0.93);
        g.fillRoundedRect(bx, by - 20, tw, 26, 9);
        g.fillPoints([{ x: b[0] - 5, y: by + 6 }, { x: b[0] + 5, y: by + 6 }, { x: b[0], y: by + 13 }], true);
        if (!this.tBubble) this.tBubble = this.add.text(0, 0, '', {}).setDepth(TEXT_DEPTH);
        this.tBubble.setStyle({ fontFamily: FONT, fontSize: '10.5px', color: '#2E2833' });
        this.tBubble.setText(cat.bubble).setOrigin(0.5, 0.5).setPosition(b[0], by - 7).setVisible(true);
      } else if (this.tBubble) {
        this.tBubble.setVisible(false);
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
