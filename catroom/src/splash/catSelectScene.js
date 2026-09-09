/* ============================================================================
   splash/catSelectScene.js — атмосферная сцена выбора кота (см.
   Documentation/tech-spec_splash_cat-select.md). Распределение зафиксировано
   в коде, без бэкенда: Батон (Redfat) — всегда в коробке слева, Шило
   (Siamese) — всегда в решётке справа. Единственная подсказка игроку, что
   там два разных кота — разные глаза, не текст. Свап по профилям (ГДД
   п.4.1: «При создании нового профиля коты меняются местами») — отдельная
   задача на будущее, не в объёме этой сцены.

   street_bg — уже настоящий референс художника (см. bootScene.js). Он
   один на всю сцену: фонари, конусы света, коробка и решётка уже
   нарисованы на нём, отдельными слоями (как хотела исходная спека — см.
   ГДД-таблицу) их ещё не резали. Поэтому пока art#street_bg загружен —
   покачивание фонарей/пульс конуса не рисуем поверх (нечем тут двигать,
   всё запечено в одну картинку), а глаза оверлеим точно поверх
   нарисованных, координаты которых промерены один раз по исходнику
   (Documentation/References/929411e0-7435-4aa8-9727-30d1773b1f5b.png,
   1024×1536 — см. ART_POINTS) и пересчитываются в экранные через cover-fit
   scale/offset (layout()). Как только появится настоящий слоёный арт (или
   просто плейсхолдеры lamp_left/right, box, grate — см. bootScene.js),
   пропадёт и street_bg, и вся сцена откатится на старый процедурный
   блокаут ниже — код это уже умеет, ничего менять не придётся.
   ========================================================================== */
(function (root) {
  'use strict';
  const { COL, FONT } = root.RCFG;

  const HIDEOUT_CAT = { box: 'baton', grate: 'shilo' };

  // Сдвиг всей уличной сцены (фон/фонари/укрытия/глаза) вниз — освобождает
  // полосу вверху экрана под название (addTitle, центрируется ровно в
  // этой полосе) и полосу внизу под сообщения (drawMessageStrip). 230 —
  // граница, размеченная вручную на скриншоте (картинка с фонарями должна
  // начинаться отсюда, выше — зона под название). MSG_STRIP_H/GAP_ABOVE_STRIP
  // — своя нижняя полоса для CatSelect, не общая с рекламным баннером
  // комнаты (AD_BANNER_H, render/constants.js) — та вообще другая сцена.
  const SCENE_SHIFT_Y = 230;
  // Картинка street_bg дополнительно поднята на 100px вверх от
  // SCENE_SHIFT_Y — просьба «передвинуть картинку на 100px выше», не
  // трогая ни название (оно всё ещё центрируется в SCENE_SHIFT_Y/2), ни
  // расчёт самого SCENE_SHIFT_Y.
  const IMAGE_UP_SHIFT = 100;
  const MSG_STRIP_H = 40;
  const GAP_ABOVE_STRIP = 24;

  // Пиксельные координаты в исходнике 929411e0-...png (1024×1536) — центры
  // лампочек и КАЖДОГО глаза по отдельности (не одна точка с угаданным
  // зазором между «глазами» — так было в первой версии и разъехалось с
  // картинкой, см. правку ниже). Найдены программно: два самых ярких пика
  // в области каждого укрытия, с минимальным разносом друг от друга,
  // проверено визуально (аннотация поверх скриншота). Если street_bg
  // заменят на другую картинку — эти числа тоже нужно перемерить.
  const ART_POINTS = {
    lampL: { x: 227, y: 325 },
    lampR: { x: 779, y: 325 },
    boxEyeL: { x: 291, y: 825 },
    boxEyeR: { x: 312, y: 827 },
    grateEyeL: { x: 710, y: 896 },
    grateEyeR: { x: 752, y: 888 }
  };

  // Смещения лап от центра укрытия (L.box/L.grate — середина между глазами)
  // — куда сажать лапы, будто кот держится за край. Промерены по аннотации
  // на скриншоте (кружки на левом/правом краю коробки и решётки) тем же
  // способом, что и ART_POINTS: экранные координаты кружков минус экранные
  // координаты глаз, переведённые в игровые пиксели через масштаб сцены.
  // Асимметрия по Y (не просто зеркально слева/справа) — потому что оба
  // укрытия нарисованы в изометрии: ближний край ниже, дальний выше.
  // angle — лапа наклонена наружу от центра укрытия, как будто цепляется
  // за край именно с этой стороны (см. addPaw).
  const HAND_OFFSETS = {
    box: [{ x: -27, y: 3, angle: -35 }, { x: 45, y: -6, angle: 35 }],
    grate: [{ x: -43, y: 25, angle: -35 }, { x: 33, y: -6, angle: 35 }]
  };

  window.CatSelectScene = class extends Phaser.Scene {
    constructor() { super('CatSelect'); }

    create() {
      const { width, height } = this.cameras.main;
      const L = this.layout(width, height);
      this.L = L; // нужен позже — showHands() считает позиции лап от L.box/L.grate
      this.selectedHideout = null;

      this.cameras.main.setBackgroundColor('#000000');
      this.drawStreetBg(width, height, L);

      if (!L.real) {
        // Плейсхолдер без street_bg — фонари/конусы/укрытия рисуем сами,
        // с покачиванием и пульсом. На настоящем арте всё это уже
        // нарисовано (см. шапку файла), поэтому вся ветка ниже условная.
        const lampL = this.addLamp(L.lampL.x, L.lampL.y, 'lamp_left');
        const lampR = this.addLamp(L.lampR.x, L.lampR.y, 'lamp_right');
        [lampL, lampR].forEach((lamp, i) => {
          this.tweens.add({
            targets: lamp,
            angle: { from: -1.5, to: 1.5 },
            duration: 2600 + i * 300, // разная фаза — не качаются синхронно
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
          });
        });

        const coneL = this.drawLightCone(L.lampL.x, L.lampL.y);
        const coneR = this.drawLightCone(L.lampR.x, L.lampR.y);
        [coneL, coneR].forEach((cone, i) => {
          this.tweens.add({
            targets: cone,
            alpha: { from: 0.32, to: 0.55 },
            duration: 1900 + i * 280, // тоже в противофазе, как и фонари
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
          });
        });

        this.addHideout(L.box.x, L.box.y, 'box');
        this.addHideout(L.grate.x, L.grate.y, 'grate');
      }

      // --- глаза в коробке и решётке: на плейсхолдере — разные силуэты на
      // каждого кота; на настоящем арте — оверлей ровно поверх уже
      // нарисованных глаз (обе точки, не одна с угаданным зазором — см.
      // ART_POINTS), который просто умеет моргать ---
      const eyesBox = L.real ? this.addEyesOnArt(L.boxEyeL, L.boxEyeR) : this.addEyes(L.box.x, L.box.y, 'baton');
      const eyesGrate = L.real ? this.addEyesOnArt(L.grateEyeL, L.grateEyeR) : this.addEyes(L.grate.x, L.grate.y, 'shilo');
      // Self-rescheduling delayedCall, не time.addEvent({loop:true}): у
      // последнего случайный delay вычисляется ОДИН раз при создании
      // TimerEvent, а loop:true дальше повторяет этот же интервал
      // бесконечно — на выходе не случайное моргание, а метроном с
      // фиксированным (просто разным между собой) периодом.
      this.scheduleBlink(eyesBox, 0);
      this.scheduleBlink(eyesGrate, 700);

      // --- дождь ---
      this.drawRain(width);

      // --- жестяная банка: та же логика self-reschedule, что и у глаз ---
      this.scheduleTinCan();

      // --- название игры: центрировано в полосе над сдвинутой сценой ---
      this.addTitle(width);

      // --- нижняя полоса сообщений (см. splash/catSelectMessages.js) ---
      this.drawMessageStrip(width, height);

      // тап по укрытию — ПОКА не переход, а выбор: лапы переезжают на его
      // край, и (с первого такого тапа) появляется кнопка «Начать» —
      // см. chooseHideout/selectCat.
      this.add.zone(L.box.x, L.box.y, 220, 220).setInteractive()
        .on('pointerdown', () => this.chooseHideout('box'));
      this.add.zone(L.grate.x, L.grate.y, 220, 220).setInteractive()
        .on('pointerdown', () => this.chooseHideout('grate'));

      // На случай, если игрок каким-то образом вернётся на эту сцену снова
      // (сейчас поток однонаправленный, но защититься дёшево) — снять блок
      // ввода, поставленный в selectCat().
      this.events.once('shutdown', () => { this.input.enabled = true; });

      // Появление сцены после Boot — «открывающиеся веки», не мгновенный
      // щелчок и не обычный fadeIn: сцена уже собрана и живёт (дождь идёт)
      // под двумя чёрными «веками», сходящимися по центру.
      this.playEyeOpenIntro();
    }

    // Название игры — не один файл, а папка art/logo/ (manifest.json,
    // тот же приём, что Cats/manifest.json): тап по названию листает
    // варианты по кругу. Центрировано и по X, и по Y — ровно в полосе
    // SCENE_SHIFT_Y, которую сцена ниже освобождает под него (см. layout()/
    // drawStreetBg()). Манифест может быть пуст или файла ещё нет физически
    // на диске — тогда просто ничего не показываем, а не падаем.
    addTitle(width) {
      const names = (this.cache.json.exists('titleManifest') ? this.cache.json.get('titleManifest') : [])
        .filter(name => this.textures.exists(name));
      if (!names.length) return;

      this.titleNames = names;
      this.titleIdx = 0;
      const img = this.add.image(width / 2, SCENE_SHIFT_Y / 2, names[0])
        .setDepth(10)
        .setInteractive({ useHandCursor: true });
      this.fitTitleWidth(img, width);
      img.on('pointerdown', () => this.cycleTitle(img, width));
      this.titleImg = img;
    }

    fitTitleWidth(img, width) {
      const maxW = width * 0.8;
      const maxH = SCENE_SHIFT_Y - 20; // с запасом по 10px сверху/снизу
      const tex = img.texture.getSourceImage();
      img.setScale(Math.min(1, maxW / tex.width, maxH / tex.height));
    }

    cycleTitle(img, width) {
      this.titleIdx = (this.titleIdx + 1) % this.titleNames.length;
      img.setTexture(this.titleNames[this.titleIdx]);
      this.fitTitleWidth(img, width);
    }

    // Раскладка сцены: если street_bg реальный — во всю ширину канваса (не
    // cover-fit: раньше лишнее по бокам обрезалось, теперь картинка видна
    // целиком, без обрезки, высота — во столько же раз, что и ширина), и
    // сдвинут вверх на IMAGE_UP_SHIFT от базового SCENE_SHIFT_Y (offY). Позиции
    // глаз/фонарей переводятся из ART_POINTS в экранные координаты тем же
    // scale/offset, что и сам фон, — иначе оверлеи разъедутся с картинкой на
    // других размерах экрана. Без street_bg — старые фиксированные доли
    // ширины/высоты канваса, с тем же базовым сдвигом (см. addLamp/addHideout).
    layout(width, height) {
      if (this.textures.exists('street_bg')) {
        const tex = this.textures.get('street_bg').getSourceImage();
        const scale = width / tex.width;
        const dispW = width, dispH = tex.height * scale;
        const offX = 0;
        const offY = SCENE_SHIFT_Y - IMAGE_UP_SHIFT;
        const toScreen = p => ({ x: offX + p.x * scale, y: offY + p.y * scale });
        const boxEyeL = toScreen(ART_POINTS.boxEyeL), boxEyeR = toScreen(ART_POINTS.boxEyeR);
        const grateEyeL = toScreen(ART_POINTS.grateEyeL), grateEyeR = toScreen(ART_POINTS.grateEyeR);
        return {
          real: true, scale, dispW, dispH, offX, offY,
          lampL: toScreen(ART_POINTS.lampL),
          lampR: toScreen(ART_POINTS.lampR),
          boxEyeL, boxEyeR, grateEyeL, grateEyeR,
          // Центр зоны тапа — середина между глазами, не отдельно
          // промеренная точка: этого достаточно для 220×220 хит-зоны.
          box: { x: (boxEyeL.x + boxEyeR.x) / 2, y: (boxEyeL.y + boxEyeR.y) / 2 },
          grate: { x: (grateEyeL.x + grateEyeR.x) / 2, y: (grateEyeL.y + grateEyeR.y) / 2 }
        };
      }
      return {
        real: false, scale: 1,
        lampL: { x: width * 0.25, y: height * 0.28 + SCENE_SHIFT_Y },
        lampR: { x: width * 0.75, y: height * 0.28 + SCENE_SHIFT_Y },
        box: { x: width * 0.25, y: height * 0.68 + SCENE_SHIFT_Y },
        grate: { x: width * 0.75, y: height * 0.72 + SCENE_SHIFT_Y }
      };
    }

    drawStreetBg(width, height, L) {
      // setOrigin(0,0) + позиция offX/offY (не центр канваса!) — тот же
      // top-left, что использует toScreen() в layout() для пересчёта
      // ART_POINTS, поэтому сдвиг SCENE_SHIFT_Y двигает картинку и оверлеи
      // синхронно, одной и той же парой чисел.
      if (L.real) { this.add.image(L.offX, L.offY, 'street_bg').setOrigin(0, 0).setDisplaySize(L.dispW, L.dispH); return; }
      // Плейсхолдер: ночная улица блокаутом — небо, тротуар, силуэты домов,
      // без бликов света (их даёт конус/фонарь поверх). Полоса сама не
      // сдвигается (плоская заливка на весь канвас без сдвига ничем не
      // отличается от сдвинутой), сдвигаются только сами объекты на ней.
      const g = this.add.graphics();
      g.fillStyle(0x1a1420, 1); g.fillRect(0, 0, width, height);
      g.fillStyle(0x241c2c, 1); g.fillRect(0, height * 0.75, width, height * 0.25); // тротуар
      g.fillStyle(0x14101a, 1);
      [[0, 0.15, 0.4], [0.45, 0.05, 0.55], [0.78, 0.2, 0.35]].forEach(([x0, w0, h0]) => {
        g.fillRect(x0 * width, height * (0.75 - h0), w0 * width, height * h0);
      });
    }

    addLamp(x, y, key) {
      if (this.textures.exists(key)) return this.add.image(x, y, key).setOrigin(0.5, 0);
      const g = this.add.graphics().setPosition(x, y);
      g.fillStyle(0x2E2833, 1); g.fillRect(-3, 0, 6, 130); // столб
      g.fillStyle(COL.amber, 0.9); g.fillCircle(0, 0, 10); // лампа
      g.lineStyle(2, 0x2E2833, 1); g.strokeCircle(0, 0, 10);
      return g;
    }

    drawLightCone(x, y) {
      const g = this.add.graphics().setAlpha(0.4);
      g.fillStyle(COL.amber, 1);
      g.fillTriangle(x, y, x - 55, y + 200, x + 55, y + 200);
      return g;
    }

    addHideout(x, y, key) {
      if (this.textures.exists(key)) { this.add.image(x, y, key); return; }
      const g = this.add.graphics().setPosition(x, y);
      if (key === 'box') {
        g.fillStyle(0x6b4a30, 1); g.fillRect(-55, -45, 110, 90);
        g.lineStyle(2, 0x4a3320, 1); g.strokeRect(-55, -45, 110, 90);
        g.lineBetween(-55, -45, 0, -65); g.lineBetween(55, -45, 0, -65); // открытые створки
      } else {
        g.fillStyle(0x14161a, 1); g.fillRect(-55, -45, 110, 90);
        g.lineStyle(2, 0x333840, 1);
        for (let i = -40; i <= 40; i += 20) g.lineBetween(i, -45, i, 45); // прутья решётки
        g.strokeRect(-55, -45, 110, 90);
      }
    }

    // Плейсхолдер (нет ни спрайтшита, ни street_bg) — различимые силуэты:
    // Батон (сонные круглые, тёплый янтарный) и Шило (узкие прищуренные,
    // холодный зелёный) — подсказка, что коты разные. Моргание без
    // настоящего спрайтшита — не смена кадров, а сжатие по Y до щели и
    // обратно (см. scheduleBlink).
    addEyes(x, y, catId) {
      const key = 'eyes_' + catId;
      if (this.textures.exists(key)) {
        const animKey = 'blink_' + catId;
        if (!this.anims.exists(animKey)) {
          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(key, { start: 0, end: 3 }),
            frameRate: 8
          });
        }
        const sprite = this.add.sprite(x, y, key, 0);
        sprite.blinkAnimKey = animKey;
        return sprite;
      }
      const g = this.add.graphics().setPosition(x, y);
      const shape = catId === 'baton'
        ? { color: 0xE8A33D, rx: 7, ry: 7, gap: 20 }   // круглые, сонные
        : { color: 0x8FD69B, rx: 9, ry: 4, gap: 22 };  // узкие, прищуренные
      g.fillStyle(shape.color, 0.95);
      g.fillEllipse(-shape.gap / 2, 0, shape.rx, shape.ry);
      g.fillEllipse(shape.gap / 2, 0, shape.rx, shape.ry);
      return g;
    }

    // На настоящем street_bg глаза уже нарисованы (светятся сами) — этот
    // оверлей просто садится ТОЧНО на обе измеренные точки (не на одну
    // среднюю с угаданным зазором, как было раньше и разъехалось с
    // картинкой) и умеет моргать. Не различаем Батона/Шило цветом — на
    // референсе они визуально одинаковые; различать их разными
    // спрайтшитами, как хочет исходная спека, есть смысл, когда появится
    // настоящий per-персонажный арт глаз (eyes_baton/eyes_shilo).
    addEyesOnArt(pL, pR) {
      const midX = (pL.x + pR.x) / 2, midY = (pL.y + pR.y) / 2;
      const g = this.add.graphics().setPosition(midX, midY);
      g.fillStyle(0xFAE3A0, 0.95);
      g.fillEllipse(pL.x - midX, pL.y - midY, 5, 5);
      g.fillEllipse(pR.x - midX, pR.y - midY, 5, 5);
      return g;
    }

    scheduleBlink(eyes, phaseOffset) {
      this.time.delayedCall(Phaser.Math.Between(2500, 5000) + phaseOffset, () => {
        if (eyes.blinkAnimKey) eyes.play(eyes.blinkAnimKey);
        else this.tweens.add({ targets: eyes, scaleY: 0.08, duration: 70, yoyo: true, ease: 'Sine.easeInOut' });
        this.scheduleBlink(eyes, phaseOffset);
      });
    }

    drawRain(width) {
      const key = this.textures.exists('rain_drop') ? 'rain_drop' : this.makeRainDropTexture();
      this.add.particles(0, 0, key, {
        x: { min: 0, max: width },
        y: -20,
        lifespan: 900,
        speedY: { min: 500, max: 700 },
        speedX: { min: -20, max: -60 },
        scale: { start: 0.6, end: 0.6 },
        alpha: { start: 0.5, end: 0.2 },
        quantity: 3,
        frequency: 40,
        blendMode: 'ADD'
      });
      if (this.cache.audio.exists('sfx_rain_amb')) {
        this.sound.play('sfx_rain_amb', { loop: true, volume: 0.5 });
      }
    }

    // Капля дождя 2×10 — генерируется один раз в текстурный кэш, тем же
    // способом, что и любой другой процедурный ассет игры.
    makeRainDropTexture() {
      const key = 'rain_drop_gen';
      if (!this.textures.exists(key)) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xBFD8E8, 1); g.fillRect(0, 0, 2, 10);
        g.generateTexture(key, 2, 10);
        g.destroy();
      }
      return key;
    }

    scheduleTinCan() {
      this.time.delayedCall(Phaser.Math.Between(8000, 15000), () => {
        this.rollTinCan();
        this.scheduleTinCan();
      });
    }

    rollTinCan() {
      const { width, height } = this.cameras.main;
      // Путь банки — сразу над нижней полосой сообщений, с небольшим
      // промежутком (GAP_ABOVE_STRIP), а не «почти у низа канваса»: низ
      // канваса теперь занят полосой (drawMessageStrip), банка не должна
      // закатываться под неё.
      const canY = height - MSG_STRIP_H - GAP_ABOVE_STRIP;
      let can;
      if (this.textures.exists('tin_can')) {
        can = this.add.image(-30, canY, 'tin_can');
      } else {
        can = this.add.graphics().setPosition(-30, canY);
        can.fillStyle(0x9AA0A6, 1); can.fillEllipse(0, 0, 22, 14);
        can.lineStyle(1.5, 0x5B6066, 1); can.strokeEllipse(0, 0, 22, 14);
      }
      this.tweens.add({
        targets: can,
        x: width + 30,
        angle: 720,
        duration: 3500,
        ease: 'Sine.easeInOut',
        onComplete: () => can.destroy()
      });
    }

    // Нижняя полоса сообщений — по виду как рекламный блок комнаты
    // (drawBannerStrip, ui/hud.js): тёмная полупрозрачная полоса на всю
    // ширину, текст по центру. Тексты — не тут, а в отдельном файле
    // (splash/catSelectMessages.js, root.CAT_SELECT_MESSAGES), чтобы их
    // можно было править руками, не трогая логику сцены. Ротация — простой
    // фиксированный интервал (не self-reschedule со случайностью, как у
    // глаз/банки): это читаемые реплики, а не фоновая деталь, метроном тут
    // как раз ожидаем и не бросается в глаза.
    drawMessageStrip(width, height) {
      const messages = root.CAT_SELECT_MESSAGES || [];
      if (!messages.length) return;

      const y = height - MSG_STRIP_H;
      this.add.rectangle(width / 2, y + MSG_STRIP_H / 2, width, MSG_STRIP_H, 0x000000, 0.55).setDepth(20);
      const text = this.add.text(width / 2, y + MSG_STRIP_H / 2, messages[0], {
        fontFamily: FONT, fontSize: '13px', color: '#EBE2D5cc'
      }).setOrigin(0.5).setDepth(21);

      if (messages.length > 1) {
        let idx = 0;
        this.time.addEvent({
          delay: 5000, loop: true,
          callback: () => { idx = (idx + 1) % messages.length; text.setText(messages[idx]); }
        });
      }
    }

    // Веки — два прямоугольника на весь экран, сходятся по центру (midY).
    // Сначала чуть приоткрываются и тут же снова смыкаются (один
    // «спросонок»-моргание, через yoyo+hold), потом расходятся до конца.
    // Тайминги ориентировочные — подбираются на плейтесте вместе с
    // fadeOut при выборе кота (см. selectCat), чтобы открытие и закрытие
    // ощущались одной парой, а не двумя случайными эффектами.
    playEyeOpenIntro() {
      const { width, height } = this.cameras.main;
      const midY = height / 2, flutter = midY * 0.12;

      const lidTop = this.add.rectangle(width / 2, 0, width, midY, 0x000000).setOrigin(0.5, 0).setDepth(1000);
      const lidBottom = this.add.rectangle(width / 2, height, width, midY, 0x000000).setOrigin(0.5, 1).setDepth(1000);

      this.tweens.add({
        targets: lidTop, y: flutter, duration: 220, ease: 'Sine.easeOut', yoyo: true, hold: 60,
        onComplete: () => this.tweens.add({
          targets: lidTop, y: -midY, duration: 600, ease: 'Sine.easeInOut',
          onComplete: () => lidTop.destroy()
        })
      });
      this.tweens.add({
        targets: lidBottom, y: height - flutter, duration: 220, ease: 'Sine.easeOut', yoyo: true, hold: 60,
        onComplete: () => this.tweens.add({
          targets: lidBottom, y: height + midY, duration: 600, ease: 'Sine.easeInOut',
          onComplete: () => lidBottom.destroy()
        })
      });
    }

    // Тап по укрытию — предварительный выбор, не сразу переход: лапы
    // переезжают на край выбранного укрытия (showHands), и с первого
    // такого тапа появляется кнопка «Начать» (showStartButton) — только
    // она запускает реальный переход (см. selectCat).
    chooseHideout(hideout) {
      if (this.selectedHideout !== hideout) {
        this.selectedHideout = hideout;
        this.showHands(hideout);
      }
      this.showStartButton();
    }

    // Две лапы на краях выбранного укрытия — «кот держится, выглядывая»,
    // смещения см. HAND_OFFSETS. При смене выбора старая пара уничтожается
    // и рисуется заново на новом укрытии — «перемещаются», а не копятся.
    showHands(hideout) {
      if (this.handIcons) this.handIcons.forEach(h => h.destroy());
      const center = this.L[hideout];
      this.handIcons = HAND_OFFSETS[hideout].map(off => this.addPaw(center.x + off.x, center.y + off.y, off.angle));
    }

    // Лапа — по референсу (Documentation/References/9b6d0b948cfd363f99c3d4641e91c32a.jpg):
    // тёмный силуэт «ноги» + четыре розовые подушечки (одна побольше снизу-
    // по центру, три пальца поменьше сверху). Когти не рисуем — на таком
    // размере (~30px) не читаются, сам силуэт уже узнаётся как лапа.
    // angle — наклон наружу от центра укрытия (см. HAND_OFFSETS), чтобы
    // читалось как «цепляется за край именно с этой стороны».
    addPaw(x, y, angleDeg) {
      const g = this.add.graphics().setPosition(x, y).setAngle(angleDeg || 0).setDepth(15);
      g.fillStyle(0x1c1a1a, 0.95);
      g.fillEllipse(0, 10, 22, 26); // силуэт лапы/ноги
      g.fillStyle(0xE8879F, 1);
      g.fillEllipse(0, 2, 12, 10);  // главная подушечка
      g.fillCircle(-8, -8, 5);      // левый палец
      g.fillCircle(0, -11, 5);      // средний палец
      g.fillCircle(8, -8, 5);       // правый палец
      return g;
    }

    // Кнопка «Начать» — появляется один раз, с первого тапа по укрытию, и
    // остаётся на месте (переключение между укрытиями её не трогает —
    // только лапы переезжают, см. chooseHideout). Стоит над путём банки
    // (rollTinCan), с тем же отступом от полосы сообщений.
    showStartButton() {
      if (this.startBtn) return;
      const { width, height } = this.cameras.main;
      const canY = height - MSG_STRIP_H - GAP_ABOVE_STRIP;
      const btnY = canY - 45, btnW = 180, btnH = 44;

      const bg = this.add.rectangle(width / 2, btnY, btnW, btnH, 0x000000, 0.6)
        .setStrokeStyle(2, COL.amber)
        .setDepth(20)
        .setInteractive({ useHandCursor: true });
      const text = this.add.text(width / 2, btnY, 'Начать', {
        fontFamily: FONT, fontSize: '16px', color: '#EBE2D5'
      }).setOrigin(0.5).setDepth(21);

      bg.on('pointerdown', () => this.selectCat(this.selectedHideout));
      this.startBtn = { bg, text };
    }

    // Переход — не мгновенный, а затухание в чёрный. Вызывается только по
    // кнопке «Начать» (showStartButton), не прямо по тапу на укрытие (см.
    // chooseHideout) — у игрока есть шанс передумать между двумя
    // укрытиями до нажатия. Хидаут однозначно определяет кота
    // (HIDEOUT_CAT), поэтому в онбординг передаём сразу catId, а не
    // только hideout.
    //
    // Выбор — одноразовый: сохраняем его СРАЗУ (SAVESTORE.setCatChoice), не
    // дожидаясь автосохранения комнаты (которое случится только через
    // SAVE_INTERVAL_MS или на скрытие вкладки — закрой игрок игру раньше,
    // выбор потерялся бы и CatSelect показался бы снова при следующем
    // запуске, см. bootScene.js: goNext). Пока это поле сохранено — сюда
    // игрок больше не попадёт.
    selectCat(hideout) {
      // блокируем повторный тап на время перехода
      this.input.enabled = false;

      const catId = HIDEOUT_CAT[hideout];
      if (root.SAVESTORE) root.SAVESTORE.setCatChoice(catId);

      this.cameras.main.fadeOut(700, 0, 0, 0); // 700мс, можно потюнить под тайминг гэга открытия
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('DarkRoomOnboarding', { hideout, catId });
      });
    }
  };
})(window);
