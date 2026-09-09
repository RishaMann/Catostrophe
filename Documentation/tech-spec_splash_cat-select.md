# Тех. спека: запуск игры — Boot/Preload → Выбор кота

**Проект:** «Котику грустно» · **Стек:** Phaser 3, мобильный портрет
**Статус:** готово к реализации · черновик от 04.09.2026

Связанные материалы: раздел 4.1 ГДД («Стартовый экран: выбор без права передумать»), раздел 11 ГДД (схема экранов), правка в копилке — арт ночной улицы (коробка/решётка), правка — раскадровка эмоций кота.

---

## 0. Разводим два экрана

Узел «Сплэш / загрузка ассетов» в схеме экранов — это фактически две разные по назначению сцены, их не стоит путать при реализации:

1. **Boot/Preload** — чисто техническая сцена. Лого/плашка + прогресс-бар. Без атмосферных анимаций (дождь, фонари, банка), минимальный вес, чтобы не тормозить первый кадр.
2. **CatSelect** — атмосферная интерактивная сцена (арт ночной улицы), с анимациями и выбором кота. Стартует автоматически после того, как preload завершён.

Технически это разные Phaser Scene, между ними — прямой автопереход без участия игрока.

---

## 1. Boot/Preload Scene

Грузит только то, что нужно для показа CatSelect (не всю игру целиком — комната и остальное дальше догружаются в фоне уже во время «тёмной комнаты»/онбординга).

**Правка (была логическая ошибка в первой версии спеки):** нельзя вызвать `this.add.image('logo')` в том же `preload()`, где `this.load.image('logo', ...)` только поставлен в очередь — сама загрузка стартует лишь ПОСЛЕ выхода из `preload()`, так что на первом кадре текстуры ещё физически нет (пустой квадрат/варнинг). Раз лого обязано быть на экране уже в момент показа прогресс-бара, его грузят отдельной сценой-«прологом» ДО Boot — это и есть тот самый «синхронный запрос до остального preload», о котором ниже было только сказано, но не показано:

```js
// Preboot — только лого, ничего больше. create() стартует, как только
// лого физически лежит в текстурном кэше — значит, Boot может сразу
// показать его на экране прогресс-бара.
class PrebootScene extends Phaser.Scene {
  constructor() { super('Preboot'); }
  preload() { this.load.image('logo', 'assets/ui/logo_plate.png'); }
  create() { this.scene.start('Boot'); }
}

class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    // 'logo' уже в кэше — его загрузил Preboot, здесь можно сразу
    // показывать (см. createProgressBar).
    this.createProgressBar();

    this.load.image('street_bg', 'assets/scenes/street_bg.png');
    this.load.image('lamp_left', 'assets/scenes/lamp_left.png');
    this.load.image('lamp_right', 'assets/scenes/lamp_right.png');
    this.load.image('box', 'assets/scenes/box.png');
    this.load.image('grate', 'assets/scenes/grate.png');
    // Два разных спрайтшита глаз — не один общий: это единственная подсказка
    // игроку, что в коробке и решётке разные персонажи (см. распределение
    // ниже, п. 2). Конус света больше не отдельный ассет — рисуется кодом,
    // см. drawLightCone в CatSelectScene.
    this.load.spritesheet('eyes_baton', 'assets/scenes/eyes_baton_blink.png', { frameWidth: 32, frameHeight: 16 });
    this.load.spritesheet('eyes_shilo', 'assets/scenes/eyes_shilo_blink.png', { frameWidth: 32, frameHeight: 16 });
    this.load.image('tin_can', 'assets/scenes/tin_can.png');
    this.load.image('rain_drop', 'assets/particles/rain_drop.png');
    this.load.audio('sfx_rain_amb', 'assets/audio/rain_amb.mp3');
  }

  createProgressBar() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width/2, height*0.6, 300, 20, 0x000000, 0.4).setStrokeStyle(2, 0xffffff);
    const bar = this.add.rectangle(width/2 - 148, height*0.6, 0, 12, 0xffcf6b).setOrigin(0, 0.5);
    this.add.image(width/2, height*0.35, 'logo'); // безопасно: текстура уже в кэше

    this.load.on('progress', (v) => { bar.width = 296 * v; });
    this.load.on('complete', () => this.scene.start('CatSelect'));
  }
}
```

Конус света под фонарём — не PNG от художника, а процедурная фигура (`Graphics`, см. `drawLightCone` в п. 2): полупрозрачный треугольник, залитый амброй, пульсирует по альфе. В первой версии спеки он был описан в таблице слоёв как отдельный ассет, но не заведён нигде в коде — вместо того чтобы дозаказывать художнику ещё один файл, рисуем его сами.

---

## 2. CatSelect Scene

Картинка со street-сценой (коробка + решётка) собирается не как один PNG, а как набор слоёв — иначе анимации не сделать. Разбивка для Aseprite:

| Слой/файл | Назначение |
|---|---|
| `street_bg` | статичный фон: дома, тротуар, лужи (без бликов света) |
| `lamp_left` / `lamp_right` | фонарь целиком, `origin` у основания столба (для покачивания за верх) |
| конус света | не файл — рисуется кодом (`Graphics`, полупрозрачный треугольник, pulsing-твин по альфе), см. `drawLightCone` |
| `box`, `grate` | статичные объекты укрытий: слева коробка — там всегда Батон, справа решётка ливнёвки — там всегда Шило |
| `eyes_baton` / `eyes_shilo` | два РАЗНЫХ спрайтшита глаз (моргание) — не общий на двоих: разный рисунок глаз/ритм моргания и есть та самая подсказка, что в укрытиях разные персонажи |
| `tin_can` | отдельный спрайт, катится по нижней части кадра |

```js
// Распределение зафиксировано в коде, без бэкенда: Батон (Redfat) всегда
// в коробке слева, Шило (Siamese) всегда в решётке справа. Единственная
// подсказка игроку, что там вообще два разных кота — разные глаза
// (eyes_baton/eyes_shilo, см. таблицу слоёв выше). Свап по профилям
// (ГДД п. 4.1: «При создании нового профиля коты меняются местами») —
// отдельная задача на будущее, не в объёме этой спеки.
const HIDEOUT_CAT = { box: 'baton', grate: 'shilo' };

class CatSelectScene extends Phaser.Scene {
  constructor() { super('CatSelect'); }

  create() {
    const { width, height } = this.cameras.main;

    this.add.image(width/2, height/2, 'street_bg');

    // --- покачивающиеся фонари ---
    const lampL = this.add.image(width*0.25, height*0.28, 'lamp_left').setOrigin(0.5, 0);
    const lampR = this.add.image(width*0.75, height*0.28, 'lamp_right').setOrigin(0.5, 0);
    [lampL, lampR].forEach((lamp, i) => {
      this.tweens.add({
        targets: lamp,
        angle: { from: -1.5, to: 1.5 },
        duration: 2600 + i*300, // разная фаза — не качаются синхронно
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    });

    // --- конус света под каждым фонарём: не PNG, рисуем сами (ПРАВКА: в
    // первой версии спеки был в таблице слоёв, но нигде не заводился —
    // вместо того чтобы заказывать художнику ещё один ассет, сделали
    // процедурно) ---
    const coneL = this.drawLightCone(width*0.25, height*0.30);
    const coneR = this.drawLightCone(width*0.75, height*0.30);
    [coneL, coneR].forEach((cone, i) => {
      this.tweens.add({
        targets: cone,
        alpha: { from: 0.32, to: 0.55 },
        duration: 1900 + i*280, // тоже в противофазе, как и фонари
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    });

    // --- укрытия: коробка и решётка (ПРАВКА: грузились в preload, но
    // раньше не добавлялись на сцену) ---
    this.add.image(width*0.25, height*0.68, 'box');
    this.add.image(width*0.75, height*0.72, 'grate');

    // --- глаза в коробке и решётке: разные текстуры на каждого кота
    // (см. HIDEOUT_CAT/таблицу слоёв) — сама подсказка, что коты разные,
    // без прямого текста ---
    const eyesBox = this.add.sprite(width*0.25, height*0.68, 'eyes_baton', 0);
    const eyesGrate = this.add.sprite(width*0.75, height*0.72, 'eyes_shilo', 0);
    this.anims.create({
      key: 'blink_baton',
      frames: this.anims.generateFrameNumbers('eyes_baton', { start: 0, end: 3 }),
      frameRate: 8
    });
    this.anims.create({
      key: 'blink_shilo',
      frames: this.anims.generateFrameNumbers('eyes_shilo', { start: 0, end: 3 }),
      frameRate: 8
    });
    // ПРАВКА: this.time.addEvent({ delay: Between(...), loop: true }) —
    // случайный delay вычисляется ОДИН раз при создании TimerEvent, а
    // loop:true дальше повторяет этот же интервал бесконечно — на выходе
    // не случайное моргание, а метроном с фиксированным (просто разным
    // между собой) периодом. Вместо loop — self-rescheduling delayedCall:
    // каждый раз берём новое случайное число.
    this.scheduleBlink(eyesBox, 'blink_baton', 0);
    this.scheduleBlink(eyesGrate, 'blink_shilo', 700);

    // --- дождь ---
    this.add.particles(0, 0, 'rain_drop', {
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
    // Фоновый шум дождя (ПРАВКА: грузился в preload, но нигде не запускался)
    this.sound.play('sfx_rain_amb', { loop: true, volume: 0.5 });

    // --- жестяная банка: та же ошибка с loop:true, тот же self-reschedule ---
    this.scheduleTinCan();

    // тап по укрытию — выбор кота. Хидаут и так однозначно определяет кота
    // (HIDEOUT_CAT), поэтому в онбординг передаём сразу catId, а не только
    // hideout — следующей сцене не нужно повторно знать про распределение.
    this.add.zone(width*0.25, height*0.68, 220, 220).setInteractive()
      .on('pointerdown', () => this.selectCat('box'));
    this.add.zone(width*0.75, height*0.72, 220, 220).setInteractive()
      .on('pointerdown', () => this.selectCat('grate'));

    // На случай, если игрок каким-то образом вернётся на эту сцену снова
    // (сейчас поток однонаправленный, но защититься дёшево) — снять блок
    // ввода, поставленный в selectCat().
    this.events.once('shutdown', () => { this.input.enabled = true; });

    // Появление сцены после Boot — не мгновенный щелчок и не обычный
    // fadeIn: сцена собирается сразу целиком и уже «живёт» (дождь идёт,
    // фонари качаются) под двумя чёрными «веками», сходящимися в узкую
    // щель по центру экрана. Веки открываются глазами — тематическая рифма
    // с морганием кота в укрытии.
    this.playEyeOpenIntro();
  }

  // Веки — два прямоугольника на весь экран, сходятся по центру (midY).
  // Сначала чуть приоткрываются и тут же снова смыкаются (один «моргание
  // спросонья», через yoyo+hold), потом расходятся до конца за края экрана.
  // Тайминги ориентировочные — подбираются на плейтесте вместе с fadeOut
  // при выборе кота (см. selectCat), чтобы открытие и закрытие ощущались
  // одной парой, а не двумя случайными эффектами.
  playEyeOpenIntro() {
    const { width, height } = this.cameras.main;
    const midY = height / 2, flutter = midY * 0.12;

    const lidTop = this.add.rectangle(width/2, 0, width, midY, 0x000000).setOrigin(0.5, 0).setDepth(1000);
    const lidBottom = this.add.rectangle(width/2, height, width, midY, 0x000000).setOrigin(0.5, 1).setDepth(1000);

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

  // Простая процедурная «фара»: полупрозрачный треугольник амброго цвета
  // под фонарём. Graphics — обычный GameObject, у него есть .alpha, поэтому
  // твин ниже (в create()) работает так же, как если бы это была картинка.
  drawLightCone(x, y) {
    const g = this.add.graphics().setAlpha(0.4);
    g.fillStyle(0xffcf6b, 1);
    g.fillTriangle(x, y, x - 55, y + 200, x + 55, y + 200);
    return g;
  }

  // Случайная задержка перечитывается на каждой итерации — в отличие от
  // time.addEvent({loop:true}), тут период от моргания к моргания реально
  // разный, не только между двумя укрытиями, но и от раза к разу у одного.
  scheduleBlink(eyes, animKey, phaseOffset) {
    this.time.delayedCall(Phaser.Math.Between(2500, 5000) + phaseOffset, () => {
      eyes.play(animKey);
      this.scheduleBlink(eyes, animKey, phaseOffset);
    });
  }

  scheduleTinCan() {
    this.time.delayedCall(Phaser.Math.Between(8000, 15000), () => {
      this.rollTinCan();
      this.scheduleTinCan();
    });
  }

  rollTinCan() {
    const { width, height } = this.cameras.main;
    const can = this.add.image(-30, height*0.9, 'tin_can');
    this.tweens.add({
      targets: can,
      x: width + 30,
      angle: 720,
      duration: 3500,
      ease: 'Sine.easeInOut',
      onComplete: () => can.destroy()
    });
  }

  // ПРАВКА: тап по укрытию — не мгновенный переход, а затухание в чёрный
  selectCat(hideout) {
    // блокируем повторный тап на время перехода
    this.input.enabled = false;

    this.cameras.main.fadeOut(700, 0, 0, 0); // 700мс, можно потюнить под тайминг гэга открытия
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('DarkRoomOnboarding', { hideout, catId: HIDEOUT_CAT[hideout] });
    });
  }
}
```

**Тайминг перехода:** 700 мс затухания в чёрный — отправная точка, финальное значение подбирается на плейтесте вместе с длиной паузы перед первым кадром «тёмной комнаты» (см. ГДД п. 4.2, шаг 2 — «доступно одно действие: погладить», играется уже в темноте после fade) и с длительностью открытия век на входе в сцену (`playEyeOpenIntro`) — по ощущениям это одна пара «глаза открылись → глаза закрылись», тайминги стоит подбирать вместе, не порознь.

---

## 3. Чек-лист для разработчика

- [ ] Boot грузит только ассеты CatSelect, не всю игру
- [ ] Лого грузится синхронно до основного preload — отдельной сценой `Preboot` (см. п. 1), а не `add.image` в том же `preload()`, где `load.image('logo', ...)` только поставлен в очередь
- [ ] Фонари качаются с разной фазой (не синхронно)
- [ ] Конус света под фонарём — рисуется кодом (`drawLightCone`), не отдельный PNG, пульсирует твином по альфе независимо от покачивания фонаря
- [ ] Коробка и решётка (`box`/`grate`) реально добавлены на сцену, не только загружены
- [ ] У коробки и решётки — разные спрайтшиты глаз (`eyes_baton`/`eyes_shilo`), не общий на двоих
- [ ] Фоновый шум дождя (`sfx_rain_amb`) запущен в `create()`, не только загружен
- [ ] Глаза моргают с разной случайной задержкой в каждом укрытии — **и от раза к разу**, не только между укрытиями (self-rescheduling `delayedCall`, не `time.addEvent({loop:true})` — см. п. 2, `scheduleBlink`)
- [ ] Банка появляется не по фиксированному ритму (`Between(8000, 15000)`), чтобы не читалась как метроном — та же ошибка с `loop:true` исправлена через `scheduleTinCan`
- [ ] Тап по укрытию **блокирует повторный ввод**, запускает `fadeOut`, и только по `camerafadeoutcomplete` — переход сцены
- [ ] Распределение котов зафиксировано в коде (`HIDEOUT_CAT`): Батон (Redfat) — коробка слева, Шило (Siamese) — решётка справа, без бэкенда и без сети на этом экране; подсказка игроку — разные глаза. Свап по профилям (ГДД п. 4.1) — не в этой спеке, отдельная задача на будущее. Labra в эту пару не входит — тестовый персонаж прототипа комнаты (переключатель для него теперь живёт в «Настройках» самой комнаты, вне потока Boot→CatSelect→онбординг)
- [ ] Появление сцены после Boot — не мгновенный щелчок и не обычный fadeIn, а «открывающиеся веки» (`playEyeOpenIntro`): сцена уже собрана и живёт под ними, веки чуть приоткрываются, снова смыкаются (один «спросонок»-моргание) и только потом расходятся до конца
