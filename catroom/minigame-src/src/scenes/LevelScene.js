// ============================================================
//  СЦЕНА УРОВНЯ  —  кот прыгает по комнате
// ============================================================
//  Здесь только поведение. Все данные — в config/, все числа — в balance.js.
//
//  Три правила физики, которые важно держать в голове:
//
//  1. Мебель — не препятствие, а площадка. Кот пролетает сквозь неё
//     снизу и сбоку и приземляется только сверху. Головой не бьётся.
//  2. Площадка, с которой кот только что прыгнул, на треть секунды
//     перестаёт его замечать — иначе он «толкается» в собственный стол
//     вместо того, чтобы спрыгнуть с него вниз.
//  3. Стены и потолок — настоящие. Кот от них отскакивает и падает
//     по физике, а не телепортируется на старт.
// ============================================================

import Phaser from 'phaser';
import {
  FIELD, FLOOR_Y, CEILING_Y, FURNITURE, HAZARDS,
  STASH_POOL, CHANDELIER, FEEDING
} from '../config/level.js';
import { buildLayout } from '../config/layout.js';
import { BALANCE } from '../config/balance.js';
import { preloadArt, makeTextures, labelFor, sizeOf, WATER_LINE } from '../core/greybox.js';
import { load, save, addFish, markTaskDone } from '../core/save.js';
import { isEmbedded, exitToRoom } from '../core/bridge.js';

// Формулы в облачке «кот считает». Ничего не значат, но выглядят серьёзно.
const FORMULAS = [
  'v₀ = √(2gh)',
  's = v₀t + gt²/2',
  'α = arctg(v↑/v→)',
  'F = ma',
  'h = v₀²sin²α / 2g'
];

export default class LevelScene extends Phaser.Scene {
  constructor() { super('Level'); }

  init(data) {
    this.task = data.task;
    this.jumps = 0;
    this.runFish = 0;
    this.visited = [];
    this.state = 'idle';
    this.dragStart = null;
    this.ownerArmed = false;
    this.standingOn = null;
    this.standingBody = null;
    this.dropThrough = { body: null, until: 0 };
    this.fallen = {};          // что уже упало: lampa, tv
    this.wakes = 0;            // сколько раз кот разбудил хозяина за заход
    this.fed = false;          // покормил ли хозяин (один раз за заход)
    this.hangUntil = 0;        // до этого момента люстра кота не ловит
    this.hangTaken = false;    // рыбка за люстру выдаётся один раз
    this.catPose = 'cat';      // какая поза кота сейчас: cat или cat_hang
    this.bumped = false;       // чтобы реплика про стену не повторялась каждый кадр
    this.fedNow = false;
    this.fishReleased = false; // рыбки появляются только после попадания в аквариум
  }

  preload() { preloadArt(this); }

  create() {
    // ---------- фон ----------
    this.cameras.main.setBackgroundColor('#56504B');

    makeTextures(this);

    // Раскладка комнаты собирается заново при каждом заходе:
    // кровать с комодом могут поменяться сторонами, стол и шкаф
    // сдвигаются, вся комната иногда отражается зеркально.
    const layout = buildLayout(FURNITURE, STASH_POOL);
    this.items = layout.items;

    // ---------- границы мира ----------
    // Слева, справа и сверху — настоящие стены. Снизу границы нет:
    // там ковёр, он ловит кота своим коллайдером.
    this.physics.world.setBounds(0, CEILING_Y, FIELD.w, FIELD.h - CEILING_Y + 400);
    this.physics.world.setBoundsCollision(true, true, true, false);

    // ---------- ковёр ----------
    // Занимает весь низ. Приземление сюда — не провал: кот просто внизу
    // и может прыгать отсюда сколько угодно, а ещё ходить по нему тапом.
    const ps = sizeOf('pol');
    this.add.image(FIELD.w / 2, FLOOR_Y + ps.h / 2, 'pol').setAlpha(0.9).setDepth(1);
    labelFor(this, 'pol', FIELD.w / 2, FLOOR_Y + ps.h / 2);
    this.floorGroup = this.physics.add.staticGroup();
    this.floorGroup.create(FIELD.w / 2, FLOOR_Y + ps.h / 2, 'pol').refreshBody().setVisible(false);

    // ---------- окно ----------
    const okno = { ...HAZARDS.okno };
    if (layout.mirrored) okno.x = FIELD.w - okno.x;
    const os = sizeOf('okno');
    this.add.image(okno.x, okno.y, 'okno').setAlpha(0.75).setDepth(1);
    labelFor(this, 'okno', okno.x, okno.y);
    this.windowRect = new Phaser.Geom.Rectangle(
      okno.x - os.w / 2, okno.y - os.h / 2, os.w, os.h
    );

    // ---------- люстра ----------
    this.buildChandelier();

    // ---------- мебель ----------
    this.platforms = this.physics.add.staticGroup();
    this.items.forEach(item => {
      const body = this.platforms.create(item.x, item.y, item.id).refreshBody();
      body.setData('item', item);
      body.setDepth(2);
      // Односторонняя площадка: реагирует только на касание сверху
      body.body.checkCollision.down = false;
      body.body.checkCollision.left = false;
      body.body.checkCollision.right = false;
      labelFor(this, item.id, item.x, item.y);

      if (item.lamp) {
        const ls = sizeOf('lampa'), is = sizeOf(item.id);
        this.lampa = this.add.image(item.x, item.y - is.h / 2 - ls.h / 2, 'lampa').setDepth(4);
      }
      if (item.fragile === 'tv') {
        this.komodItem = item;
      }

      // Аквариум помечаем стрелкой: игрок должен понять, что рыбки
      // берутся отсюда, а не появляются сами.
      if (item.isAquarium) {
        const y = item.y - sizeOf(item.id).h / 2 - 14;
        this.aquaHint = this.add.text(item.x, y, '▼', {
          fontFamily: 'sans-serif', fontSize: '18px', color: '#7FD8E8'
        }).setOrigin(0.5, 1).setDepth(6);
        this.tweens.add({
          targets: this.aquaHint, y: y - 6,
          duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
      }

      if (item.id === this.task.goal) {
        const y = item.y - sizeOf(item.id).h / 2 - 20;
        this.goalMarker = this.add.text(item.x, y, '▼', {
          fontFamily: 'sans-serif', fontSize: '20px', color: '#F0B44E'
        }).setOrigin(0.5, 1).setDepth(6);
        this.tweens.add({
          targets: this.goalMarker, y: y - 7,
          duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
      }

      if (item.hasOwner) {
        const hs = sizeOf('hozyain'), is = sizeOf(item.id);
        this.ownerHome = item.y - is.h / 2 - hs.h / 2 + 6;
        this.owner = this.add.image(item.x, this.ownerHome, 'hozyain').setDepth(3);
        this.ownerRect = new Phaser.Geom.Rectangle(
          item.x - hs.w / 2, item.y - is.h / 2 - hs.h - 24, hs.w, hs.h + 34
        );
      }
    });

    // ---------- заначки ----------
    // Рыбки создаются заранее, но лежат невидимыми на своих местах.
    // Пока кот не плюхнулся в аквариум, их нет в комнате и взять их нельзя.
    const saved = load();
    this.stashSprites = [];
    layout.stash.forEach((s, i) => {
      if (saved.stashTaken.includes(i)) return;
      const sp = this.add.image(s.x, s.y, 'ryba').setDepth(4).setVisible(false);
      sp.setData('index', i).setData('fish', s.fish)
        .setData('tx', s.x).setData('ty', s.y)
        .setData('live', false);        // true — когда рыбка долетела и её можно взять
      this.stashSprites.push(sp);
    });

    // ---------- кот ----------
    this.cat = this.physics.add.sprite(100, FLOOR_Y - sizeOf('cat').h / 2, 'cat').setDepth(5);
    this.cat.body.allowGravity = false;
    this.cat.setCollideWorldBounds(true);
    this.cat.setBounce(BALANCE.BOUNCE_X, BALANCE.BOUNCE_Y);
    // Ограничиваем скорость падения, чтобы кот физически не мог
    // проскочить площадку между двумя кадрами.
    this.cat.body.setMaxVelocityY(1400);

    this.physics.add.collider(this.cat, this.floorGroup, () => this.land(null, 'pol'));

    // Односторонние площадки: коллизия только если кот падает вниз
    // и его лапы ещё выше верхней грани предмета.
    this.physics.add.collider(
      this.cat, this.platforms,
      (cat, body) => this.land(body.getData('item'), 'platform', body),
      (cat, body) => {
        // Площадка, с которой только что прыгнули, временно не ловит.
        if (body === this.dropThrough.body && this.time.now < this.dropThrough.until) return false;
        if (cat.body.velocity.y < 0) return false;            // летит вверх — пролетает насквозь
        const prevBottom = cat.body.prev.y + cat.body.height; // где были лапы в прошлом кадре
        return prevBottom <= body.body.top + 8;               // были выше — значит приземляется
      }
    );

    this.buildHud();

    this.aim = this.add.graphics().setDepth(7);
    this.input.on('pointerdown', p => this.onDown(p));
    this.input.on('pointermove', p => this.onMove(p));
    this.input.on('pointerup',   p => this.onUp(p));

    this.say('Тяни из любой точки и отпускай. Рыбы — в аквариуме.');
  }

  // ============================================================
  //  АКВАРИУМ
  // ============================================================
  //  Кот приземляется не на крышку, а прямо в воду. Всплеск, кот
  //  сидит по уши мокрый — и из аквариума разлетаются рыбки, которые
  //  дальше можно собирать по комнате. Повторные заходы дают только
  //  брызги и реплику: рыбы там больше нет.
  splashInto(item, body) {
    this.state = 'scene';
    this.standingOn = null;
    this.standingBody = null;

    const s = sizeOf(item.id);
    const topY = body ? body.body.top : (item.y - s.h / 2);
    const waterY = topY + s.h * WATER_LINE;

    // Сажаем кота в воду: торчит только верхняя половина.
    this.cat.body.reset(
      Phaser.Math.Clamp(this.cat.x, item.x - s.w * 0.28, item.x + s.w * 0.28),
      waterY + this.catSize().h * 0.18
    );
    this.cat.setDepth(1.5);              // за передним стеклом аквариума
    this.splash(this.cat.x, waterY);

    const first = !this.fishReleased;

    if (first) {
      this.fishReleased = true;
      if (this.aquaHint) {
        this.tweens.killTweensOf(this.aquaHint);
        this.aquaHint.destroy();
        this.aquaHint = null;
      }
      if (item.fish) {
        this.runFish += item.fish;
        addFish(item.fish);
        this.updateHud();
      }
      this.say(pick(item.lines));
      this.time.delayedCall(320, () => this.releaseFish(item.x, waterY));
    } else {
      this.say(pick(HAZARDS.akvarium.lines));
    }

    // Кот выбирается из воды сам, вторым всплеском.
    this.time.delayedCall(first ? BALANCE.AQUA_OUT_MS : BALANCE.AQUA_OUT_MS_AGAIN, () => {
      if (this.state !== 'scene') return;
      this.cat.setDepth(5);
      this.splash(this.cat.x, waterY);

      // На секунду аквариум перестаёт ловить кота. Без этого он
      // выпрыгивал и тут же плюхался обратно — и так до бесконечности.
      if (body) {
        this.dropThrough = { body, until: this.time.now + BALANCE.AQUA_IGNORE_MS };
      }

      // Прыжок в сторону центра комнаты, с запасом по горизонтали,
      // чтобы приземлиться рядом с аквариумом, а не в него.
      const away = this.cat.x < FIELD.w / 2 ? 1 : -1;
      this.launch(away * BALANCE.AQUA_OUT_VX, -BALANCE.AQUA_OUT_VY, false);
    });
  }

  // Брызги: горсть капель вверх и расходящееся кольцо по поверхности.
  splash(x, y) {
    for (let i = 0; i < BALANCE.SPLASH_DROPS; i++) {
      const drop = this.add.circle(
        x + Phaser.Math.Between(-26, 26), y,
        Phaser.Math.Between(2, 5), 0x9FE4F2, 0.95
      ).setDepth(8);
      this.tweens.add({
        targets: drop,
        x: drop.x + Phaser.Math.Between(-80, 80),
        y: y - Phaser.Math.Between(45, 125),
        alpha: 0,
        duration: Phaser.Math.Between(Math.round(BALANCE.SPLASH_MS * 0.6), BALANCE.SPLASH_MS),
        ease: 'Quad.easeOut',
        onComplete: () => drop.destroy()
      });
    }

    const ring = this.add.ellipse(x, y, 26, 10)
      .setFillStyle()
      .setStrokeStyle(2, 0xCFF3FA, 0.9)
      .setDepth(8);
    this.tweens.add({
      targets: ring, scaleX: 4.2, scaleY: 2.6, alpha: 0,
      duration: BALANCE.SPLASH_MS, ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy()
    });
  }

  // Рыбки вылетают из воды и разлетаются по своим местам в комнате.
  releaseFish(fromX, fromY) {
    if (!this.stashSprites.length) {
      this.say('Пусто. Кто-то успел раньше.');
      return;
    }
    this.say('Рыбы разлетелись. По всей комнате.');

    this.stashSprites.forEach((sp, i) => {
      const tx = sp.getData('tx'), ty = sp.getData('ty');
      const delay = i * BALANCE.FISH_FLY_GAP;

      sp.setPosition(fromX, fromY).setVisible(true).setScale(0.4).setAlpha(1);

      // Полёт: по горизонтали ровно, по вертикали с перелётом —
      // вместе это читается как дуга.
      this.tweens.add({
        targets: sp, x: tx, delay,
        duration: BALANCE.FISH_FLY_MS, ease: 'Sine.easeOut'
      });
      this.tweens.add({
        targets: sp, y: ty, delay,
        duration: BALANCE.FISH_FLY_MS, ease: 'Back.easeOut'
      });
      this.tweens.add({
        targets: sp, scaleX: 1, scaleY: 1, delay,
        duration: 280, ease: 'Back.easeOut'
      });
      this.tweens.add({
        targets: sp,
        angle: { from: Phaser.Math.Between(-200, 200), to: 0 },
        delay, duration: BALANCE.FISH_FLY_MS, ease: 'Quad.easeOut',
        onComplete: () => {
          if (!sp.active) return;
          sp.setData('live', true);       // теперь рыбку можно подобрать
          this.tweens.add({
            targets: sp, y: ty - 8, duration: 900,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
          });
        }
      });
    });
  }

  // ============================================================
  //  ЛЮСТРА
  // ============================================================
  buildChandelier() {
    const jit = Phaser.Math.Between(-CHANDELIER.jitter, CHANDELIER.jitter);
    this.chX = Phaser.Math.Clamp(CHANDELIER.x + jit, 140, FIELD.w - 140);
    this.chY = CHANDELIER.y;

    // Люстра висит на той же высоте, что и шкаф. Если после перестановки
    // комнаты они оказались рядом — отодвигаем люстру, чтобы не слиплись.
    const shkaf = this.items.find(i => i.id === 'shkaf');
    if (shkaf && Math.abs(this.chX - shkaf.x) < 145) {
      this.chX = shkaf.x < FIELD.w / 2
        ? Math.min(FIELD.w - 120, shkaf.x + 165)
        : Math.max(120, shkaf.x - 165);
    }

    // Шнур до потолка. Depth 0 — проходит позади всей мебели.
    const cord = this.add.graphics().setDepth(0);
    cord.lineStyle(2, 0x7A6C84, 0.7);
    cord.beginPath();
    cord.moveTo(this.chX, CEILING_Y);
    cord.lineTo(this.chX, this.chY);
    cord.strokePath();

    this.chandelier = this.add.image(this.chX, this.chY, 'lyustra').setDepth(4);
    labelFor(this, 'lyustra', this.chX, this.chY);
  }

  // Смена позы кота. Тело физики надо пересобрать под новый размер,
  // само по себе оно за текстурой не следует.
  setCatPose(key) {
    if (this.catPose === key) return;
    this.catPose = key;
    const s = sizeOf(key);
    this.cat.setTexture(key);
    this.cat.body.setSize(s.w, s.h, true);
  }

  catSize() { return sizeOf(this.catPose === 'cat_hang' ? 'cat_hang' : 'cat'); }

  grabChandelier() {
    this.cat.setVelocity(0, 0);
    this.cat.body.allowGravity = false;
    // Пока кот висит, физическое тело выключено: он держится лапой,
    // а не стоит на чём-то. Так его никуда не сносит и не сдвигает.
    this.cat.body.enable = false;
    if (this.ownerTimer) this.ownerTimer.remove();
    this.ownerArmed = false;
    this.state = 'hang';
    this.standingOn = null;
    this.standingBody = null;

    this.setCatPose('cat_hang');
    this.cat.setFlipX(false);
    // Поднятая лапа приходится ровно на абажур
    this.cat.setPosition(this.chX + 4, this.chY + 2 + this.catSize().h / 2);

    // лёгкое покачивание — люстра под котом живая
    this.tweens.add({
      targets: [this.cat, this.chandelier], angle: 4,
      duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });

    if (!this.hangTaken) {
      this.hangTaken = true;
      this.runFish += CHANDELIER.fish;
      addFish(CHANDELIER.fish);
      this.updateHud();
    }
    this.say(pick(CHANDELIER.lines));
  }

  releaseChandelier() {
    this.tweens.killTweensOf([this.cat, this.chandelier]);
    this.cat.setAngle(0);
    this.chandelier.setAngle(0);
    this.setCatPose('cat');
    // возвращаем физику на место ровно там, где кот висел
    this.cat.body.enable = true;
    this.cat.body.reset(this.cat.x, this.cat.y);
    this.hangUntil = this.time.now + BALANCE.HANG_COOLDOWN_MS;
  }

  // ============================================================
  //  ИНТЕРФЕЙС
  // ============================================================
  buildHud() {
    this.add.rectangle(FIELD.w / 2, 46, FIELD.w, 92, 0x241C29, 0.9)
      .setOrigin(0.5).setDepth(9);

    const d = 10;
    this.add.text(16, 12, 'ЗАДАНИЕ', {
      fontFamily: 'sans-serif', fontSize: '11px', color: '#9C90A5'
    }).setDepth(d);
    this.add.text(16, 28, this.task.title, {
      fontFamily: 'sans-serif', fontSize: '19px', color: '#ffffff', fontStyle: 'bold'
    }).setDepth(d);
    this.add.text(16, 55, this.task.hint, {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#A497AC', fontStyle: 'italic'
    }).setDepth(d);

    this.fishText = this.add.text(FIELD.w - 16, 16, 'Рыбки  0', {
      fontFamily: 'sans-serif', fontSize: '15px', color: '#7FC6D8'
    }).setOrigin(1, 0).setDepth(d);
    this.jumpText = this.add.text(FIELD.w - 16, 38, 'Прыжки  0', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#9C90A5'
    }).setOrigin(1, 0).setDepth(d);

    const back = this.add.text(FIELD.w - 16, 62, '× к заданиям', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#8D8195'
    }).setOrigin(1, 0).setDepth(d).setInteractive({ useHandCursor: true });
    back.on('pointerup', () => this.scene.start('Menu'));

    // Выйти сразу в catroom, не заходя в меню — только когда игра
    // открыта в его <iframe> (см. core/bridge.js). y=76, а не в один ряд с
    // «× к заданиям» (y=62) — под подсказкой задания (16,55), которая на
    // этой строке слева, чтобы не наезжать на неё.
    if (isEmbedded()) {
      const exit = this.add.text(16, 76, '← в комнату', {
        fontFamily: 'sans-serif', fontSize: '12px', color: '#8D8195'
      }).setDepth(d).setInteractive({ useHandCursor: true });
      exit.on('pointerup', () => exitToRoom(load().fish));
    }

    // Облачко реплики — живёт рядом с котом, а не наверху экрана
    this.bubbleBg = this.add.rectangle(0, 0, 10, 10, 0x241C29, 0.94)
      .setOrigin(0.5).setAlpha(0).setDepth(14);
    this.bubbleTx = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#F5EDEF',
      align: 'center', wordWrap: { width: 210 }
    }).setOrigin(0.5).setAlpha(0).setDepth(15);

    // Второе облачко — для хозяина. Другой цвет, чтобы не путать с котом.
    this.ownerBg = this.add.rectangle(0, 0, 10, 10, 0x2A3550, 0.95)
      .setOrigin(0.5).setAlpha(0).setDepth(14);
    this.ownerTx = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#CFE0F5',
      align: 'center', wordWrap: { width: 220 }
    }).setOrigin(0.5).setAlpha(0).setDepth(15);

    // Облачко «кот считает»: появляется, пока тянешь дугу.
    this.thinkBg = this.add.rectangle(0, 0, 10, 10, 0x241C29, 0.85)
      .setOrigin(0.5).setVisible(false).setDepth(16);
    this.thinkTx = this.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#FFFFFF'
    }).setOrigin(0.5).setVisible(false).setDepth(17);
  }

  // Показывает реплику над котом (или под ним, если кот у верхнего края)
  say(text) {
    this.bubbleTx.setText(text);
    this.bubbleBg.setSize(this.bubbleTx.width + 22, this.bubbleTx.height + 14);
    this.placeBubble();
    this.tweens.killTweensOf([this.bubbleTx, this.bubbleBg]);
    this.bubbleTx.setAlpha(1);
    this.bubbleBg.setAlpha(0.94);
    this.tweens.add({
      targets: [this.bubbleTx, this.bubbleBg], alpha: 0, delay: 2300, duration: 400
    });
  }

  // Реплика хозяина — над кроватью
  sayOwner(text) {
    if (!this.owner) return;
    this.ownerTx.setText(text);
    const w = this.ownerTx.width + 22, h = this.ownerTx.height + 14;
    this.ownerBg.setSize(w, h);
    const x = Phaser.Math.Clamp(this.owner.x, w / 2 + 10, FIELD.w - w / 2 - 10);
    const y = Math.max(CEILING_Y + h / 2 + 8, this.owner.y - 46);
    this.ownerBg.setPosition(x, y);
    this.ownerTx.setPosition(x, y);
    this.tweens.killTweensOf([this.ownerTx, this.ownerBg]);
    this.ownerTx.setAlpha(1);
    this.ownerBg.setAlpha(0.95);
    this.tweens.add({
      targets: [this.ownerTx, this.ownerBg], alpha: 0, delay: 2200, duration: 400
    });
  }

  placeBubble() {
    const h = this.bubbleBg.height, w = this.bubbleBg.width;
    const ch = this.catSize().h;
    const above = this.cat.y - ch / 2 - h / 2 - 10;
    const y = above < CEILING_Y + 50 ? this.cat.y + ch / 2 + h / 2 + 10 : above;
    const x = Phaser.Math.Clamp(this.cat.x, w / 2 + 10, FIELD.w - w / 2 - 10);
    this.bubbleBg.setPosition(x, y);
    this.bubbleTx.setPosition(x, y);
  }

  showThink(on) {
    this.thinkBg.setVisible(on);
    this.thinkTx.setVisible(on);
    if (!on) return;
    this.thinkTx.setText(this.formula || FORMULAS[0]);
    this.thinkBg.setSize(this.thinkTx.width + 18, this.thinkTx.height + 10);
    this.placeThink();
  }

  placeThink() {
    if (!this.thinkBg.visible) return;
    const ch = this.catSize().h;
    const w = this.thinkBg.width, h = this.thinkBg.height;
    const above = this.cat.y - ch / 2 - h / 2 - 14;
    const y = above < CEILING_Y + 40 ? this.cat.y + ch / 2 + h / 2 + 14 : above;
    const x = Phaser.Math.Clamp(this.cat.x, w / 2 + 8, FIELD.w - w / 2 - 8);
    this.thinkBg.setPosition(x, y);
    this.thinkTx.setPosition(x, y);
  }

  updateHud() {
    this.fishText.setText('Рыбки  ' + this.runFish);
    this.jumpText.setText('Прыжки  ' + this.jumps);
  }

  // ============================================================
  //  УПРАВЛЕНИЕ
  // ============================================================
  canAct() {
    return this.state === 'idle' || this.state === 'landed' || this.state === 'hang';
  }

  onDown(p) {
    if (!this.canAct()) return;
    if (p.y < CEILING_Y) return;           // не перехватываем нажатия по шапке
    // Тянуть можно из ЛЮБОЙ точки экрана — целиться по коту не нужно.
    // Короткое нажатие без движения останется командой «иди туда».
    this.dragStart = { x: p.x, y: p.y };
    this.stateBeforeAim = this.state;
    this.state = 'aiming';
    this.formula = pick(FORMULAS);
  }

  onMove(p) {
    if (this.state !== 'aiming' || !this.dragStart) return;
    const v = this.dragVector(p);
    this.aim.clear();
    if (v.dist < BALANCE.MIN_DRAG) { this.showThink(false); return; }

    this.showThink(true);

    const vx = Math.cos(v.angle) * v.dist * BALANCE.LAUNCH_POWER;
    const vy = Math.sin(v.angle) * v.dist * BALANCE.LAUNCH_POWER;
    for (let i = 1; i <= BALANCE.AIM_DOTS; i++) {
      const t = i * BALANCE.AIM_STEP;
      const x = this.cat.x + vx * t;
      const y = this.cat.y + vy * t + 0.5 * BALANCE.GRAVITY * t * t;
      if (y > FIELD.h || x < -20 || x > FIELD.w + 20) break;
      const k = 1 - i / (BALANCE.AIM_DOTS + 3);
      this.aim.fillStyle(BALANCE.AIM_COLOR, 0.20 + 0.60 * k);
      this.aim.fillCircle(x, y, 2 + 2.6 * k);
    }
  }

  onUp(p) {
    if (this.state !== 'aiming' || !this.dragStart) return;
    this.aim.clear();
    this.showThink(false);
    const v = this.dragVector(p);
    this.dragStart = null;

    if (v.dist < BALANCE.MIN_DRAG) {
      // это был тап, а не оттяжка — отправляем кота идти
      this.state = this.stateBeforeAim || (this.standingOn ? 'landed' : 'idle');
      if (this.state === 'hang') return;      // с люстры не походишь
      let left, right;
      if (this.standingOn) {
        const sz = sizeOf(this.standingOn.id);
        left  = this.standingOn.x - sz.w / 2 + 16;
        right = this.standingOn.x + sz.w / 2 - 16;
      } else {
        left = 20; right = FIELD.w - 20;      // по ковру — во всю ширину
      }
      if (Math.abs(p.y - this.cat.y) < 130) this.walkTo(p.x, left, right);
      return;
    }

    this.launch(
      Math.cos(v.angle) * v.dist * BALANCE.LAUNCH_POWER,
      Math.sin(v.angle) * v.dist * BALANCE.LAUNCH_POWER,
      true
    );
  }

  // Ходьба по ковру или по площадке, на которой кот стоит
  walkTo(x, left, right) {
    const tx = Phaser.Math.Clamp(x, left, right);
    const d = Math.abs(tx - this.cat.x);
    if (d < 4) return;
    this.cat.setFlipX(tx < this.cat.x);
    this.tweens.killTweensOf(this.cat);
    this.tweens.add({
      targets: this.cat, x: tx,
      duration: (d / BALANCE.WALK_SPEED) * 1000,
      ease: 'Sine.easeInOut'
    });
  }

  launch(vx, vy, spread) {
    if (this.state === 'hang' || this.catPose === 'cat_hang') this.releaseChandelier();

    // Кот — не пушка. Дуга показывает намерение, но прыгает он примерно:
    // ±13 % к силе и небольшой увод по углу. Промахи — часть игры.
    if (spread) {
      const k = 1 + rnd(-BALANCE.JUMP_SPREAD, BALANCE.JUMP_SPREAD);
      const ang = Math.atan2(vy, vx) + rnd(-BALANCE.JUMP_SPREAD_ANGLE, BALANCE.JUMP_SPREAD_ANGLE);
      const m = Math.hypot(vx, vy) * k;
      vx = Math.cos(ang) * m;
      vy = Math.sin(ang) * m;
    }

    // Площадка под лапами на треть секунды перестаёт ловить кота —
    // иначе прыжок вниз со стола упирался бы в этот же стол.
    if (this.standingBody) {
      this.dropThrough = { body: this.standingBody, until: this.time.now + BALANCE.DROP_THROUGH_MS };
    }

    this.tweens.killTweensOf(this.cat);
    this.cat.setFlipX(vx < 0);
    this.cat.body.allowGravity = true;
    this.cat.setVelocity(vx, vy);
    this.state = 'flying';
    this.standingOn = null;
    this.standingBody = null;
    if (spread) { this.jumps++; this.updateHud(); }
    this.armOwner();
  }

  dragVector(p) {
    const dx = this.dragStart.x - p.x;
    const dy = this.dragStart.y - p.y;
    const dist = Math.min(Math.hypot(dx, dy), BALANCE.MAX_DRAG);
    return { dist, angle: Math.atan2(dy, dx) };
  }

  // ============================================================
  //  ХОЗЯИН
  // ============================================================
  armOwner() {
    if (!this.owner) return;
    this.ownerArmed = false;
    if (this.ownerTimer) this.ownerTimer.remove();
    const delay = Phaser.Math.Between(BALANCE.OWNER_DELAY_MIN, BALANCE.OWNER_DELAY_MAX);
    this.ownerTimer = this.time.delayedCall(delay, () => this.tryArmOwner());
  }

  // Хозяин просыпается, только если кот реально может на него свалиться:
  // летит вниз и находится где-то над кроватью. Раньше он загорался красным
  // даже когда кот уходил свечкой вверх — это и был баг.
  tryArmOwner() {
    if (!this.owner || this.state !== 'flying') return;

    const goingDown = this.cat.body.velocity.y > -40;
    const nearBed = this.ownerRect &&
      this.cat.x > this.ownerRect.x - 40 &&
      this.cat.x < this.ownerRect.right + 40 &&
      this.cat.y < this.ownerRect.bottom + 60;

    if (!goingDown || !nearBed) {
      // ещё не время — проверим снова через мгновение
      this.ownerTimer = this.time.delayedCall(180, () => this.tryArmOwner());
      return;
    }

    this.ownerArmed = true;
    this.owner.setTint(0xE0706B);
    this.time.delayedCall(BALANCE.OWNER_ACTIVE_MS, () => {
      this.ownerArmed = false;
      if (this.owner && !this.fedNow) this.owner.clearTint();
    });
  }

  // Счётчик побудок. Пятая — и хозяин сдаётся.
  noteWake() {
    this.wakes++;
    if (this.wakes >= BALANCE.WAKES_TO_FEED && !this.fed) {
      this.fed = true;
      this.time.delayedCall(900, () => this.feedCat());
      return true;
    }
    return false;
  }

  // Хозяин встаёт, ворчит и кидает коту рыбу.
  feedCat() {
    if (!this.owner || this.state === 'done') return;
    this.fedNow = true;
    this.owner.setTint(0xF2C97D);
    this.tweens.add({
      targets: this.owner, y: this.ownerHome - 30,
      duration: 280, ease: 'Back.easeOut'
    });
    this.sayOwner(pick(FEEDING.owner));

    this.time.delayedCall(650, () => {
      const fish = this.add.image(this.owner.x, this.owner.y - 14, 'ryba').setDepth(9);
      const tx = this.cat.x, ty = this.cat.y;
      this.tweens.add({
        targets: fish, x: tx, y: ty, angle: 380,
        duration: 640, ease: 'Quad.easeOut',
        onComplete: () => {
          fish.destroy();
          this.runFish += BALANCE.FEED_FISH;
          addFish(BALANCE.FEED_FISH);
          this.updateHud();
          this.say(pick(FEEDING.cat));
        }
      });
      this.tweens.add({
        targets: this.owner, y: this.ownerHome, duration: 420, delay: 700,
        onComplete: () => { this.fedNow = false; this.owner.clearTint(); }
      });
    });
  }

  // ============================================================
  //  СЦЕНКА: упал предмет → хозяин встал → подушка
  // ============================================================
  dropFragile(kind, item) {
    this.state = 'scene';
    this.fallen[kind] = true;

    // 1. Предмет падает
    let sprite;
    if (kind === 'lampa') {
      sprite = this.lampa;
    } else {
      // телевизор: отдельный спрайт, который «сваливается» с комода
      const s = sizeOf(item.id);
      sprite = this.add.image(item.x, item.y - s.h * 0.28, 'podushka')
        .setTint(0x39434F).setDepth(4);
    }
    if (sprite) {
      this.tweens.add({
        targets: sprite,
        y: FLOOR_Y - 14,
        x: sprite.x + Phaser.Math.Between(-40, 40),
        angle: Phaser.Math.Between(70, 110),
        duration: 520, ease: 'Cubic.easeIn'
      });
    }
    this.say(pick(HAZARDS.padenie.lines));

    // Грохот — это тоже побудка. Если она пятая, хозяин не бросается
    // подушкой, а идёт кормить.
    if (this.noteWake()) {
      this.time.delayedCall(700, () => {
        this.state = this.standingOn ? 'landed' : 'idle';
      });
      return;
    }

    // 2. Хозяин садится и замахивается — это предупреждение игроку
    this.time.delayedCall(700, () => {
      if (!this.owner) return;
      this.owner.setTint(0xE0706B);
      this.tweens.add({
        targets: this.owner, y: this.ownerHome - 26, duration: 260, ease: 'Back.easeOut'
      });
      this.say('Он сел. Это плохой знак.');

      // 3. Бросок. Управление возвращается игроку СРАЗУ —
      //    подушка летит в точку, где кот был в момент броска,
      //    так что от неё можно увернуться прыжком.
      this.time.delayedCall(BALANCE.PILLOW_WARN_MS, () => {
        this.state = this.standingOn ? 'landed' : 'idle';

        const targetX = this.cat.x, targetY = this.cat.y;
        const pil = this.add.image(this.owner.x, this.owner.y - 10, 'podushka').setDepth(8);
        const dist = Phaser.Math.Distance.Between(pil.x, pil.y, targetX, targetY);
        this.pillow = pil;

        this.tweens.add({
          targets: pil,
          x: targetX, y: targetY,
          angle: 300,
          duration: (dist / BALANCE.PILLOW_SPEED) * 1000,
          ease: 'Linear',
          onComplete: () => {
            if (!this.pillow) return;          // уже попала — убрана в update
            this.pillow = null;
            this.tweens.add({
              targets: pil, alpha: 0, y: pil.y + 40, duration: 400,
              onComplete: () => pil.destroy()
            });
            this.say('Мимо. Он мазила.');
          }
        });

        // хозяин ложится обратно
        this.tweens.add({
          targets: this.owner, y: this.ownerHome, duration: 400, delay: 700,
          onComplete: () => { if (!this.fedNow) this.owner.clearTint(); }
        });
      });
    });
  }

  // Проверка попадания подушки — вызывается каждый кадр
  checkPillow() {
    if (!this.pillow) return;
    const d = Phaser.Math.Distance.Between(
      this.pillow.x, this.pillow.y, this.cat.x, this.cat.y
    );
    if (d > BALANCE.PILLOW_HIT_RADIUS) return;

    const pil = this.pillow;
    this.pillow = null;
    this.tweens.killTweensOf(pil);
    pil.destroy();

    const away = this.cat.x < this.owner.x ? -1 : 1;
    this.say(pick(HAZARDS.podushka.lines));
    this.launch(away * 170, -330, false);
  }

  // ============================================================
  //  ПОЛЁТ
  // ============================================================
  update() {
    if (this.bubbleTx.alpha > 0 && this.state !== 'scene') this.placeBubble();
    this.placeThink();
    this.checkPillow();
    if (this.state !== 'flying') return;

    this.stashSprites.forEach(sp => {
      if (!sp.active || !sp.getData('live')) return;   // ещё в аквариуме или в полёте
      if (Phaser.Math.Distance.Between(this.cat.x, this.cat.y, sp.x, sp.y) < 30) {
        const n = sp.getData('fish');
        this.runFish += n;
        const s = load();
        s.stashTaken.push(sp.getData('index'));
        s.fish += n;
        save(s);
        this.updateHud();
        this.say('Заначка. Я про неё помнил.');
        sp.destroy();
      }
    });

    // --- люстра ловит кота в полёте ---
    if (this.chandelier && this.time.now > this.hangUntil) {
      const d = Phaser.Math.Distance.Between(this.cat.x, this.cat.y, this.chX, this.chY + 16);
      if (d < BALANCE.HANG_RADIUS) { this.grabChandelier(); return; }
    }

    const pt = new Phaser.Geom.Point(this.cat.x, this.cat.y);

    if (this.ownerArmed && this.ownerRect &&
        Phaser.Geom.Rectangle.ContainsPoint(this.ownerRect, pt)) {
      this.ownerArmed = false;
      this.land(null, 'hozyain');
      return;
    }
    if (Phaser.Geom.Rectangle.ContainsPoint(this.windowRect, pt)) {
      this.land(null, 'okno');
      return;
    }

    // Стены и потолок кот не пробивает: у мира есть границы, он от них
    // отскакивает и дальше падает по физике. Никаких телепортов на старт.
    // Здесь только реплика при заметном ударе.
    const b = this.cat.body;
    if ((b.blocked.left || b.blocked.right || b.blocked.up) && !this.bumped) {
      this.bumped = true;
      this.say(pick(HAZARDS.stena.lines));
      this.time.delayedCall(600, () => { this.bumped = false; });
    }

    // Страховка: если кота всё-таки унесло далеко вниз мимо ковра —
    // сажаем его на ковёр там же по горизонтали, а не на старте.
    if (this.cat.y > FIELD.h + 200) {
      this.cat.body.allowGravity = false;
      this.cat.body.reset(
        Phaser.Math.Clamp(this.cat.x, 30, FIELD.w - 30),
        FLOOR_Y - this.catSize().h / 2
      );
      this.state = 'idle';
      this.standingOn = null;
      this.standingBody = null;
    }
  }

  // ============================================================
  //  ПРИЗЕМЛЕНИЕ
  // ============================================================
  land(item, kind, body) {
    if (this.state !== 'flying') return;

    const vx = this.cat.body.velocity.x;
    this.cat.setVelocity(0, 0);
    this.cat.body.allowGravity = false;
    if (this.ownerTimer) this.ownerTimer.remove();

    // --- ковёр: не провал, кот просто внизу и может прыгать дальше ---
    if (kind === 'pol') {
      this.state = 'idle';
      this.standingOn = null;
      this.standingBody = null;
      // Ставим кота на ковёр через body.reset, а не через cat.y:
      // присвоение координаты внутри обработчика столкновения физика
      // потом «доигрывает» своим смещением, и кот проваливается в пол
      // на несколько пикселей. reset ставит и тело, и картинку разом.
      this.cat.body.reset(this.cat.x, FLOOR_Y - this.catSize().h / 2);
      const slideTo = Phaser.Math.Clamp(this.cat.x + vx * BALANCE.SLIDE_FACTOR, 30, FIELD.w - 30);
      this.tweens.add({ targets: this.cat, x: slideTo, duration: BALANCE.SLIDE_MS, ease: 'Cubic.easeOut' });
      this.say(pick(HAZARDS.pol.lines));
      return;
    }

    // --- окно или хозяин: сбило, падаем на ковёр ---
    if (kind !== 'platform') {
      this.state = 'landed';
      this.standingOn = null;
      this.standingBody = null;
      this.say(pick(HAZARDS[kind].lines));
      if (kind === 'hozyain') this.noteWake();
      this.time.delayedCall(900, () => {
        if (this.state === 'done' || this.state === 'scene') return;
        this.cat.body.reset(
          Phaser.Math.Clamp(this.cat.x, 40, FIELD.w - 40),
          FLOOR_Y - this.catSize().h / 2
        );
        this.state = 'idle';
      });
      return;
    }

    // --- аквариум: кот попадает не на крышку, а в воду ---
    if (item.isAquarium) {
      this.splashInto(item, body);
      return;
    }

    // --- приземлился на мебель ---
    this.state = 'landed';
    this.standingOn = item;
    this.standingBody = body;

    // Ставим лапы ровно на поверхность. По горизонтали кот остаётся там,
    // куда попал — это не «магнит», а только выравнивание по высоте.
    const topY = body ? body.body.top : (item.y - sizeOf(item.id).h / 2);
    this.cat.body.reset(this.cat.x, topY - this.catSize().h / 2);

    const s = sizeOf(item.id), cs = this.catSize();
    const left  = item.x - s.w / 2 + cs.w * 0.35;
    const right = item.x + s.w / 2 - cs.w * 0.35;
    const slideTo = Phaser.Math.Clamp(this.cat.x + vx * BALANCE.SLIDE_FACTOR, left, right);
    this.tweens.add({
      targets: this.cat, x: slideTo, duration: BALANCE.SLIDE_MS, ease: 'Cubic.easeOut'
    });

    if (!this.visited.includes(item.id) && item.fish) {
      this.visited.push(item.id);
      this.runFish += item.fish;
      addFish(item.fish);
      this.updateHud();
    }

    // --- цель достигнута ---
    if (item.id === this.task.goal) {
      this.state = 'done';
      this.say(pick(item.lines));
      const clean = this.jumps <= BALANCE.CLEAN_JUMP_LIMIT;
      const reward = clean ? BALANCE.TASK_REWARD_CLEAN : BALANCE.TASK_REWARD;
      addFish(reward);
      markTaskDone(this.task.id);
      this.time.delayedCall(1500, () => {
        this.scene.start('Result', {
          task: this.task, reward, clean, jumps: this.jumps, runFish: this.runFish + reward
        });
      });
      return;
    }

    // --- хрупкое: лампа или телевизор могут упасть ---
    if (item.fragile && !this.fallen[item.fragile] &&
        Math.random() < BALANCE.FRAGILE_CHANCE) {
      this.time.delayedCall(420, () => this.dropFragile(item.fragile, item));
      return;
    }

    this.say(pick(item.lines));
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rnd(a, b) { return a + Math.random() * (b - a); }
