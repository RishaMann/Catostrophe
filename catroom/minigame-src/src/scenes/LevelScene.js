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
  FIELD, FLOOR_Y, FLOOR_SURFACE_Y, PLATFORM_SURFACE_INSET,
  CEILING_Y, FURNITURE, HAZARDS,
  STASH_POOL, CHANDELIER, FEEDING
} from '../config/level.js';
import { buildLayout } from '../config/layout.js';
import { BALANCE } from '../config/balance.js';
import {
  catVisual, normalizeCharacter, preloadCharacterArt, registerCharacterAnimations
} from '../config/characters.js';
import { preloadArt, makeTextures, labelFor, sizeOf, WATER_LINE } from '../core/greybox.js';
import { load, save, addFish, markTaskDone } from '../core/save.js';
import { getLaunchContext, onLaunchContext, isEmbedded, exitToRoom } from '../core/bridge.js';
import {
  loadSurfaceGeometry, resolveSurfaceGeometry, saveSurfaceGeometry
} from '../core/surfaceGeometry.js';

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
    this.character = normalizeCharacter(getLaunchContext().catCharacter);
    this.catVisualState = null;
    this.catVisualLockUntil = 0;
    this.surfaceDebugMode = false;
    this.surfaceDebugTapCount = 0;
    this.surfaceDebugLastTap = 0;
    this.surfaceDebugSelected = null;
    this.surfaceDebugDrag = null;
    this.surfaceDebugPanelDrag = null;
    this.surfaceDebugTargets = [];
  }

  preload() {
    preloadArt(this);
    preloadCharacterArt(this);
  }

  create() {
    // ---------- фон ----------
    makeTextures(this);
    registerCharacterAnimations(this);
    this.cameras.main.setBackgroundColor('#202938');
    this.add.image(0, 0, 'background').setOrigin(0).setDepth(-20);

    this.stopLaunchContext = onLaunchContext(context => {
      const next = normalizeCharacter(context.catCharacter);
      if (next === this.character) return;
      this.character = next;
      if (this.catVisualSprite) this.setCatVisual('idle', true);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.stopLaunchContext) this.stopLaunchContext();
    });

    // Раскладка комнаты собирается заново при каждом заходе:
    // кровать с комодом могут поменяться сторонами, стол и шкаф
    // сдвигаются, вся комната иногда отражается зеркально.
    const layout = buildLayout(FURNITURE, STASH_POOL);
    this.items = layout.items;
    this.surfaceOverrides = loadSurfaceGeometry();

    // ---------- границы мира ----------
    // Слева, справа и сверху — настоящие стены. Снизу границы нет:
    // там ковёр, он ловит кота своим коллайдером.
    this.physics.world.setBounds(0, CEILING_Y, FIELD.w, FIELD.h - CEILING_Y + 400);
    this.physics.world.setBoundsCollision(true, true, true, false);

    // ---------- ковёр ----------
    // Занимает весь низ. Приземление сюда — не провал: кот просто внизу
    // и может прыгать отсюда сколько угодно, а ещё ходить по нему тапом.
    const ps = sizeOf('pol');
    this.floorSurface = resolveSurfaceGeometry(
      'pol', ps,
      { inset: FLOOR_SURFACE_Y - FLOOR_Y },
      this.surfaceOverrides
    );
    this.add.image(FIELD.w / 2, FLOOR_Y + ps.h / 2, 'pol').setAlpha(0.9).setDepth(1);
    labelFor(this, 'pol', FIELD.w / 2, FLOOR_Y + ps.h / 2);
    this.floorGroup = this.physics.add.staticGroup();
    const floorBody = this.floorGroup.create(FIELD.w / 2, FLOOR_Y + ps.h / 2, 'pol')
      .setVisible(false);
    this.surfaceDebugTargets.push({
      id: 'pol', label: 'Ковёр', item: null, body: floorBody,
      centerX: FIELD.w / 2, visualTop: FLOOR_Y, size: ps,
      defaults: { inset: FLOOR_SURFACE_Y - FLOOR_Y, left: -ps.w / 2, right: ps.w / 2 },
      surface: this.floorSurface
    });
    this.applySurfaceTarget(this.surfaceDebugTargets[0]);

    // ---------- окно ----------
    const okno = { ...HAZARDS.okno };
    if (layout.mirrored) okno.x = FIELD.w - okno.x;
    const os = sizeOf('okno');
    const windowKey = layout.mirrored ? 'okno_right' : 'okno';
    this.add.image(okno.x, okno.y, windowKey).setDepth(1);
    labelFor(this, windowKey, okno.x, okno.y);
    this.windowRect = new Phaser.Geom.Rectangle(
      okno.x - os.w / 2, okno.y - os.h / 2, os.w, os.h
    );

    // ---------- люстра ----------
    this.buildChandelier();

    // ---------- мебель ----------
    this.platforms = this.physics.add.staticGroup();
    this.items.forEach(item => {
      const itemSize = sizeOf(item.id);
      const defaults = {
        inset: item.surface?.inset ?? PLATFORM_SURFACE_INSET,
        left: item.surface?.left ?? -itemSize.w / 2,
        right: item.surface?.right ?? itemSize.w / 2
      };
      item.surface = resolveSurfaceGeometry(item.id, itemSize, defaults, this.surfaceOverrides);
      const surfaceY = item.y - itemSize.h / 2 + item.surface.inset;

      // Изображение мебели и её физическая площадка — разные объекты.
      // Так визуальная раскладка не двигается, а линия лап проходит по
      // середине нарисованной верхней плоскости (12 px от верха PNG).
      const image = this.add.image(item.x, item.y, item.id).setDepth(2);
      const body = this.platforms.create(item.x, item.y, item.id).setVisible(false);
      body.setData('item', item);
      // Односторонняя площадка: реагирует только на касание сверху
      body.body.checkCollision.down = false;
      body.body.checkCollision.left = false;
      body.body.checkCollision.right = false;
      labelFor(this, item.id, item.x, item.y);

      const surfaceTarget = {
        id: item.id, label: itemLabel(item.id), item, image, body,
        centerX: item.x, visualTop: item.y - itemSize.h / 2, size: itemSize,
        defaults, surface: item.surface
      };
      this.surfaceDebugTargets.push(surfaceTarget);
      this.applySurfaceTarget(surfaceTarget);

      if (item.lamp) {
        const ls = sizeOf('lampa');
        this.lampa = this.add.image(item.x, surfaceY - ls.h / 2, 'lampa').setDepth(4);
      }
      if (item.fragile === 'tv') {
        this.komodItem = item;
        const ts = sizeOf('tv');
        this.tv = this.add.image(item.x, surfaceY - ts.h / 2, 'tv').setDepth(4);
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
        // Кровать уже нарисована под холст хозяина: оба слоя имеют общий
        // центр. Старая формула ставила реальный PNG над кроватью, потому
        // что была рассчитана на условную прямоугольную заглушку.
        this.ownerHome = item.y;
        this.owner = this.add.sprite(item.x, this.ownerHome, 'hozyain').setDepth(3);
        // Дыхание меняет только участок одеяла. Голова и всё тело остаются
        // базовым неподвижным спрайтом, поэтому человек не «переворачивается»
        // между двумя независимо нарисованными кадрами.
        this.ownerBreath = this.add.image(item.x, this.ownerHome, 'hozyain_breathe')
          .setDepth(3.1).setCrop(52, 0, 126, 48).setAlpha(0);
        this.ownerThrow = this.add.sprite(item.x - 28, this.ownerHome - 12, 'hozyain_throw', 0)
          .setDepth(3.5).setVisible(false);
        this.startOwnerBreathing();
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
    // Физическое тело не меняет размер вместе с кадрами. Видимый персонаж
    // живёт отдельным спрайтом и следует за этим невидимым телом.
    this.cat = this.physics.add.sprite(100, this.floorSurfaceY() - sizeOf('cat').h / 2, 'cat')
      .setDepth(5).setVisible(false);
    this.cat.body.allowGravity = false;
    this.cat.body.setSize(sizeOf('cat').w, sizeOf('cat').h, true);
    this.cat.setCollideWorldBounds(true);
    this.cat.setBounce(BALANCE.BOUNCE_X, BALANCE.BOUNCE_Y);
    // Ограничиваем скорость падения, чтобы кот физически не мог
    // проскочить площадку между двумя кадрами.
    this.cat.body.setMaxVelocityY(1400);

    this.catVisualSprite = this.add.sprite(this.cat.x, this.cat.y, 'cat-Siamese-key-01')
      .setDepth(5).setOrigin(0.5);
    this.setCatVisual('idle', true);

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
    this.buildSurfaceDebug();

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
    const first = !this.fishReleased;

    // Сажаем кота в воду: торчит только верхняя половина.
    this.cat.body.reset(
      Phaser.Math.Clamp(this.cat.x, item.x - s.w * 0.28, item.x + s.w * 0.28),
      waterY + this.catSize().h * 0.18
    );
    const outDelay = first
      ? BALANCE.AQUA_OUT_MS
      : BALANCE.AQUA_OUT_MS_AGAIN;
    this.showCatMoment('wet', outDelay + 220);
    this.cat.setDepth(1.5);              // за передним стеклом аквариума
    this.splash(this.cat.x, waterY);

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

  // Смена визуального состояния не затрагивает физическое тело кота.
  setCatVisual(state, force = false) {
    if (!this.catVisualSprite || (!force && this.catVisualState === state)) return;
    this.catVisualState = state;
    const visual = catVisual(this.character, state);
    this.catVisualSprite.stop();
    if (visual.animation) {
      this.catVisualSprite.play(visual.animation);
    } else {
      this.catVisualSprite.setTexture(visual.texture);
    }
    const size = visual.size || { w: 72, h: 56 };
    this.catVisualSprite.setDisplaySize(size.w, size.h);
    this.syncCatVisual();
  }

  showCatMoment(state, duration) {
    this.catVisualLockUntil = this.time.now + duration;
    this.setCatVisual(state, true);
  }

  syncCatVisual() {
    if (!this.catVisualSprite || !this.cat) return;
    const visual = catVisual(this.character, this.catVisualState || 'idle');
    const size = visual.size || { w: 72, h: 56 };
    const bodyH = sizeOf('cat').h;
    const y = this.catPose === 'cat_hang'
      ? this.cat.y
      : this.cat.y - (size.h - bodyH) / 2 + (visual.offsetY || 0);
    this.catVisualSprite
      .setPosition(this.cat.x, y)
      .setFlipX(this.cat.flipX)
      .setAngle(this.cat.angle)
      .setDepth(this.cat.depth);
  }

  // Совместимый интерфейс для старых мест, где различались две позы.
  setCatPose(key) {
    if (this.catPose === key) return;
    this.catPose = key;
    this.setCatVisual(key === 'cat_hang' ? 'hang' : 'idle', true);
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
    this.syncCatVisual();

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
    this.syncCatVisual();
    this.hangUntil = this.time.now + BALANCE.HANG_COOLDOWN_MS;
  }

  // ============================================================
  //  ИНТЕРФЕЙС
  // ============================================================
  buildHud() {
    this.add.image(0, 0, 'hud_header').setOrigin(0).setDepth(9);
    this.add.image(0, FIELD.h - 55, 'hud_footer').setOrigin(0).setDepth(9);

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

    this.add.text(18, FIELD.h - 37, 'Тяни назад — прыжок  ·  тап рядом — идти', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#F3DFC8'
    }).setDepth(d);

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
  //  СКРЫТАЯ ОТЛАДКА ПОВЕРХНОСТЕЙ
  // ============================================================
  surfaceLine(target) {
    return {
      x1: target.centerX + target.surface.left,
      x2: target.centerX + target.surface.right,
      y: target.visualTop + target.surface.inset
    };
  }

  floorSurfaceY() {
    return FLOOR_Y + this.floorSurface.inset;
  }

  applySurfaceTarget(target) {
    const line = this.surfaceLine(target);
    const width = Math.max(24, line.x2 - line.x1);
    target.body
      .setPosition((line.x1 + line.x2) / 2, line.y + target.size.h / 2)
      .setDisplaySize(width, target.size.h)
      .refreshBody();

    if (!target.item) {
      this.floorSurface = { ...target.surface };
      if (this.cat && !this.standingOn && this.surfaceDebugMode) {
        this.cat.body.reset(this.cat.x, line.y - this.catSize().h / 2);
        this.syncCatVisual();
      }
      return;
    }

    // Сохранённая/живая геометрия становится частью runtime-свойств
    // предмета. Коллизия, ходьба и установленные сверху объекты читают её.
    target.item.surface = { ...target.surface };
    if (this.cat && this.standingBody === target.body && this.surfaceDebugMode) {
      this.cat.body.reset(this.cat.x, line.y - this.catSize().h / 2);
      this.syncCatVisual();
    }
    if (target.item.lamp && this.lampa && !this.fallen.lampa) {
      this.lampa.setY(line.y - sizeOf('lampa').h / 2);
    }
    if (target.item.fragile === 'tv' && this.tv && !this.fallen.tv) {
      this.tv.setY(line.y - sizeOf('tv').h / 2);
    }
  }

  buildSurfaceDebug() {
    this.surfaceDebugGfx = this.add.graphics().setDepth(24).setVisible(false);
    this.surfaceDebugLabels = this.surfaceDebugTargets.map(target =>
      this.add.text(0, 0, target.label, {
        fontFamily: 'monospace', fontSize: '9px', color: '#FFE3A3',
        backgroundColor: '#211923CC', padding: { x: 3, y: 2 }
      }).setDepth(25).setVisible(false)
    );
    this.surfaceDebugTitle = this.add.text(0, 0, 'ПОВЕРХНОСТИ', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#F0B44E', fontStyle: 'bold'
    }).setDepth(26).setVisible(false);
    this.surfaceDebugInfo = this.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#F5EDEF',
      lineSpacing: 3
    }).setDepth(26).setVisible(false);
    this.surfaceDebugHint = this.add.text(0, 0, 'Тяни линию вверх/вниз\nТяни края — меняй длину', {
      fontFamily: 'sans-serif', fontSize: '9px', color: '#BEB2C4', lineSpacing: 2
    }).setDepth(26).setVisible(false);
    this.surfaceDebugSaveText = this.add.text(0, 0, 'Сохранить', {
      fontFamily: 'sans-serif', fontSize: '10px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugResetText = this.add.text(0, 0, 'Сбросить', {
      fontFamily: 'sans-serif', fontSize: '10px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugCloseText = this.add.text(0, 0, '×', {
      fontFamily: 'sans-serif', fontSize: '17px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugPanel = { x: 12, y: 110, w: 260, h: 124 };
    this.layoutSurfaceDebugPanel();
  }

  layoutSurfaceDebugPanel() {
    const p = this.surfaceDebugPanel;
    this.surfaceDebugHeader = { x: p.x, y: p.y, w: p.w - 42, h: 32 };
    this.surfaceDebugSaveBtn = { x: p.x + 12, y: p.y + 91, w: 84, h: 30 };
    this.surfaceDebugResetBtn = { x: p.x + 108, y: p.y + 91, w: 84, h: 30 };
    this.surfaceDebugCloseBtn = { x: p.x + p.w - 40, y: p.y + 2, w: 36, h: 28 };
    this.surfaceDebugTitle.setPosition(p.x + 12, p.y + 10);
    this.surfaceDebugInfo.setPosition(p.x + 12, p.y + 33);
    this.surfaceDebugHint.setPosition(p.x + 12, p.y + 63);
    this.surfaceDebugSaveText.setPosition(p.x + 54, p.y + 106);
    this.surfaceDebugResetText.setPosition(p.x + 150, p.y + 106);
    this.surfaceDebugCloseText.setPosition(p.x + p.w - 22, p.y + 14);
  }

  setSurfaceDebugUiVisible(visible) {
    this.surfaceDebugGfx.setVisible(visible);
    this.surfaceDebugLabels.forEach(label => label.setVisible(visible));
    [
      this.surfaceDebugTitle, this.surfaceDebugInfo, this.surfaceDebugHint,
      this.surfaceDebugSaveText, this.surfaceDebugResetText, this.surfaceDebugCloseText
    ].forEach(node => node.setVisible(visible));
  }

  openSurfaceDebug() {
    if (this.surfaceDebugMode || !this.canAct() || this.state === 'hang') return;
    this.surfaceDebugMode = true;
    this.surfaceDebugPreviousState = this.standingOn ? 'landed' : 'idle';
    this.state = 'debug';
    this.tweens.killTweensOf(this.cat);
    this.cat.setVelocity(0, 0);
    this.cat.body.allowGravity = false;
    this.surfaceDebugTargets.forEach(target => {
      target.savedSurface = { ...target.surface };
      target.dirty = false;
    });
    this.setSurfaceDebugUiVisible(true);
    this.redrawSurfaceDebug();
  }

  closeSurfaceDebug() {
    if (!this.surfaceDebugMode) return;
    // Как в отладке основной комнаты: закрытие не коммитит live-правку.
    this.surfaceDebugTargets.forEach(target => {
      if (!target.dirty || !target.savedSurface) return;
      target.surface = { ...target.savedSurface };
      this.applySurfaceTarget(target);
    });
    this.surfaceDebugMode = false;
    this.surfaceDebugSelected = null;
    this.surfaceDebugDrag = null;
    this.surfaceDebugPanelDrag = null;
    this.setSurfaceDebugUiVisible(false);
    this.surfaceDebugGfx.clear();
    this.state = this.surfaceDebugPreviousState || (this.standingOn ? 'landed' : 'idle');
  }

  registerSurfaceDebugTap() {
    if (this.surfaceDebugMode) return;
    const now = this.time.now;
    if (now - this.surfaceDebugLastTap > 1800) this.surfaceDebugTapCount = 0;
    this.surfaceDebugLastTap = now;
    this.surfaceDebugTapCount++;
    if (this.surfaceDebugTapCount >= 5) {
      this.surfaceDebugTapCount = 0;
      this.openSurfaceDebug();
    }
  }

  redrawSurfaceDebug() {
    if (!this.surfaceDebugMode) return;
    const g = this.surfaceDebugGfx;
    g.clear();

    this.surfaceDebugTargets.forEach((target, index) => {
      const line = this.surfaceLine(target);
      const selected = target === this.surfaceDebugSelected;
      g.lineStyle(selected ? 3 : 2, selected ? 0x72E3F2 : 0xF0B44E, selected ? 1 : 0.75);
      g.lineBetween(line.x1, line.y, line.x2, line.y);
      if (selected) {
        g.fillStyle(0x72E3F2, 1);
        g.fillCircle(line.x1, line.y, 6);
        g.fillCircle(line.x2, line.y, 6);
        g.fillStyle(0xF0B44E, 1);
        g.fillCircle((line.x1 + line.x2) / 2, line.y, 5);
      }
      const labelX = line.x1 + 2;
      const labelY = line.y - 17;
      const panel = this.surfaceDebugPanel;
      const hiddenByPanel = labelX >= panel.x - 4 && labelX <= panel.x + panel.w + 4 &&
        labelY >= panel.y - 4 && labelY <= panel.y + panel.h + 4;
      this.surfaceDebugLabels[index]
        .setPosition(labelX, labelY)
        .setColor(selected ? '#9CF5FF' : '#FFE3A3')
        .setVisible(!hiddenByPanel);
    });

    const p = this.surfaceDebugPanel;
    g.fillStyle(0x211923, 0.96);
    g.fillRoundedRect(p.x, p.y, p.w, p.h, 9);
    g.lineStyle(1.2, 0xF0B44E, 0.8);
    g.strokeRoundedRect(p.x, p.y, p.w, p.h, 9);

    const selected = this.surfaceDebugSelected;
    const dirty = !!(selected && selected.dirty);
    const drawButton = (rect, color, alpha) => {
      g.fillStyle(color, alpha);
      g.fillRoundedRect(rect.x, rect.y, rect.w, rect.h, 6);
      g.lineStyle(1, color, 0.9);
      g.strokeRoundedRect(rect.x, rect.y, rect.w, rect.h, 6);
    };
    drawButton(this.surfaceDebugSaveBtn, dirty ? 0xF0B44E : 0x8D8195, dirty ? 0.25 : 0.08);
    drawButton(this.surfaceDebugResetBtn, 0x8D8195, 0.08);
    drawButton(this.surfaceDebugCloseBtn, 0x8D8195, 0.08);

    this.surfaceDebugInfo.setText(selected
      ? `${selected.label}: y ${Math.round(selected.surface.inset)}  ` +
        `x ${Math.round(selected.surface.left)}…${Math.round(selected.surface.right)}`
      : 'Тапни по линии предмета');
    this.surfaceDebugSaveText.setColor(dirty ? '#FFD071' : '#8D8195');
  }

  surfaceDebugHitTarget(x, y) {
    let best = null;
    let bestDistance = Infinity;
    this.surfaceDebugTargets.forEach(target => {
      const line = this.surfaceLine(target);
      const dx = x < line.x1 ? line.x1 - x : (x > line.x2 ? x - line.x2 : 0);
      const distance = Math.hypot(dx, y - line.y);
      if (distance < 12 && distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    });
    return best;
  }

  surfaceDebugPointerDown(p) {
    const hitRect = rect => p.x >= rect.x && p.x <= rect.x + rect.w &&
      p.y >= rect.y && p.y <= rect.y + rect.h;
    if (hitRect(this.surfaceDebugCloseBtn)) { this.closeSurfaceDebug(); return; }
    if (hitRect(this.surfaceDebugSaveBtn)) {
      const target = this.surfaceDebugSelected;
      if (target && target.dirty) {
        target.surface = saveSurfaceGeometry(target.id, target.surface);
        target.savedSurface = { ...target.surface };
        target.dirty = false;
        this.applySurfaceTarget(target);
        this.surfaceDebugSaveText.setText('Сохранено');
        this.time.delayedCall(520, () => {
          this.surfaceDebugSaveText.setText('Сохранить');
          this.redrawSurfaceDebug();
        });
        this.redrawSurfaceDebug();
      }
      return;
    }
    if (hitRect(this.surfaceDebugResetBtn)) {
      const target = this.surfaceDebugSelected;
      if (target) {
        target.surface = { ...target.defaults };
        target.dirty = !sameSurface(target.surface, target.savedSurface);
        this.applySurfaceTarget(target);
        this.redrawSurfaceDebug();
      }
      return;
    }
    if (hitRect(this.surfaceDebugHeader)) {
      this.surfaceDebugPanelDrag = {
        dx: p.x - this.surfaceDebugPanel.x,
        dy: p.y - this.surfaceDebugPanel.y
      };
      return;
    }
    if (hitRect(this.surfaceDebugPanel)) return;

    const selected = this.surfaceDebugSelected;
    if (selected) {
      const line = this.surfaceLine(selected);
      if (Math.hypot(p.x - line.x1, p.y - line.y) < 13) {
        this.surfaceDebugDrag = { kind: 'left', target: selected };
        return;
      }
      if (Math.hypot(p.x - line.x2, p.y - line.y) < 13) {
        this.surfaceDebugDrag = { kind: 'right', target: selected };
        return;
      }
    }

    const target = this.surfaceDebugHitTarget(p.x, p.y);
    if (target) {
      this.surfaceDebugSelected = target;
      this.surfaceDebugDrag = { kind: 'vertical', target };
      this.redrawSurfaceDebug();
    }
  }

  surfaceDebugPointerMove(p) {
    if (this.surfaceDebugPanelDrag) {
      this.surfaceDebugPanel.x = Phaser.Math.Clamp(
        p.x - this.surfaceDebugPanelDrag.dx, 4, FIELD.w - this.surfaceDebugPanel.w - 4
      );
      this.surfaceDebugPanel.y = Phaser.Math.Clamp(
        p.y - this.surfaceDebugPanelDrag.dy,
        CEILING_Y + 4,
        FIELD.h - 55 - this.surfaceDebugPanel.h - 4
      );
      this.layoutSurfaceDebugPanel();
      this.redrawSurfaceDebug();
      return;
    }
    const drag = this.surfaceDebugDrag;
    if (!drag) return;
    const target = drag.target;
    if (drag.kind === 'vertical') {
      target.surface.inset = Math.round(Phaser.Math.Clamp(
        p.y - target.visualTop, -30, target.size.h + 30
      ));
    } else {
      const relativeX = Math.round(p.x - target.centerX);
      if (drag.kind === 'left') {
        target.surface.left = Phaser.Math.Clamp(
          relativeX, -target.size.w, target.surface.right - 48
        );
      } else {
        target.surface.right = Phaser.Math.Clamp(
          relativeX, target.surface.left + 48, target.size.w
        );
      }
    }
    target.dirty = !sameSurface(target.surface, target.savedSurface);
    this.applySurfaceTarget(target);
    this.redrawSurfaceDebug();
  }

  // ============================================================
  //  УПРАВЛЕНИЕ
  // ============================================================
  canAct() {
    return this.state === 'idle' || this.state === 'landed' || this.state === 'hang';
  }

  onDown(p) {
    if (p.y < CEILING_Y) return;           // не перехватываем нажатия по шапке
    if (this.surfaceDebugMode) { this.surfaceDebugPointerDown(p); return; }
    if (!this.canAct()) return;
    // Тянуть можно из ЛЮБОЙ точки экрана — целиться по коту не нужно.
    // Короткое нажатие без движения останется командой «иди туда».
    this.dragStart = { x: p.x, y: p.y };
    this.stateBeforeAim = this.state;
    this.state = 'aiming';
    this.setCatVisual('aim');
    this.formula = pick(FORMULAS);
  }

  onMove(p) {
    if (this.surfaceDebugMode) { this.surfaceDebugPointerMove(p); return; }
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
    if (p.y < CEILING_Y) { this.registerSurfaceDebugTap(); return; }
    if (this.surfaceDebugMode) {
      this.surfaceDebugDrag = null;
      this.surfaceDebugPanelDrag = null;
      return;
    }
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
        const surface = this.standingOn.surface;
        left  = this.standingOn.x + surface.left + 16;
        right = this.standingOn.x + surface.right - 16;
      } else {
        left = FIELD.w / 2 + this.floorSurface.left + 20;
        right = FIELD.w / 2 + this.floorSurface.right - 20;
      }
      if (Math.abs(p.y - this.cat.y) < 130) this.walkTo(p.x, left, right);
      else this.setCatVisual('idle');
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
    this.setCatVisual('walk');
    this.tweens.killTweensOf(this.cat);
    this.tweens.add({
      targets: this.cat, x: tx,
      duration: (d / BALANCE.WALK_SPEED) * 1000,
      ease: 'Sine.easeInOut',
      onComplete: () => this.setCatVisual('idle')
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
    if (this.time.now >= this.catVisualLockUntil) this.showCatMoment('launch', 110);
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
  startOwnerBreathing() {
    if (!this.owner || this.ownerThrowing || this.fedNow) return;
    this.owner.stop().setTexture('hozyain').clearTint()
      .setPosition(this.owner.x, this.ownerHome).setVisible(true);
    if (this.ownerBreath) {
      this.tweens.killTweensOf(this.ownerBreath);
      this.ownerBreath.setPosition(this.owner.x, this.ownerHome).setVisible(true).setAlpha(0);
      this.tweens.add({
        targets: this.ownerBreath,
        alpha: 1,
        duration: 720,
        hold: 180,
        yoyo: true,
        repeat: -1,
        repeatDelay: 260,
        ease: 'Sine.easeInOut'
      });
    }
    if (this.ownerThrow) this.ownerThrow.setVisible(false);
  }

  wakeOwner(duration = 820) {
    if (!this.owner || this.ownerThrowing || this.fedNow) return;
    if (this.ownerBreath) {
      this.tweens.killTweensOf(this.ownerBreath);
      this.ownerBreath.setVisible(false);
    }
    this.owner.stop().setTexture('hozyain_awake').clearTint();
    this.time.delayedCall(duration, () => {
      if (!this.ownerThrowing && !this.fedNow) this.startOwnerBreathing();
    });
  }

  ownerHandPosition(frame) {
    const local = [
      { x: -22, y: -22 },
      { x: 35, y: -28 },
      { x: 52, y: -5 }
    ][frame];
    return {
      x: this.ownerThrow.x + local.x,
      y: this.ownerThrow.y + local.y
    };
  }

  playOwnerThrow(itemKey, rewardFish = false) {
    if (!this.owner || !this.ownerThrow || this.ownerThrowing || this.state === 'done') return;
    this.ownerThrowing = true;
    this.fedNow = rewardFish;
    const targetX = this.cat.x, targetY = this.cat.y;
    const direction = targetX >= this.owner.x ? 1 : -1;
    const throwFrameMs = Math.round(BALANCE.PILLOW_WARN_MS / 3);

    this.owner.stop().setTexture('hozyain').clearTint();
    if (this.ownerBreath) {
      this.tweens.killTweensOf(this.ownerBreath);
      this.ownerBreath.setVisible(false);
    }
    this.ownerThrow
      // Торс всегда совмещён с неподвижным хозяином. Направление полёта
      // подушки больше не зеркалит и не сдвигает самого персонажа.
      .setPosition(this.owner.x - 28, this.ownerHome - 12)
      .setFlipX(false)
      .setFrame(0)
      .setVisible(true);

    const thrown = this.add.image(0, 0, itemKey).setDepth(9);
    const attach = frame => {
      this.ownerThrow.setFrame(frame);
      const hand = this.ownerHandPosition(frame);
      thrown.setPosition(hand.x, hand.y);
    };
    attach(0);
    this.time.delayedCall(throwFrameMs, () => attach(1));

    this.time.delayedCall(throwFrameMs * 2, () => {
      attach(2);
      this.state = this.standingOn ? 'landed' : 'idle';
      const hand = this.ownerHandPosition(2);
      const dist = Phaser.Math.Distance.Between(hand.x, hand.y, targetX, targetY);

      if (itemKey === 'podushka') {
        this.pillow = thrown;
        this.tweens.add({
          targets: thrown,
          x: targetX, y: targetY, angle: 300 * direction,
          duration: Math.max(260, (dist / BALANCE.PILLOW_SPEED) * 1000),
          ease: 'Linear',
          onComplete: () => {
            if (!this.pillow) return;
            this.pillow = null;
            this.tweens.add({
              targets: thrown, alpha: 0, y: thrown.y + 40, duration: 400,
              onComplete: () => thrown.destroy()
            });
            this.say('Мимо. Он мазила.');
          }
        });
      } else {
        this.tweens.add({
          targets: thrown, x: targetX, y: targetY, angle: 380 * direction,
          duration: 640, ease: 'Quad.easeOut',
          onComplete: () => {
            thrown.destroy();
            this.runFish += BALANCE.FEED_FISH;
            addFish(BALANCE.FEED_FISH);
            this.updateHud();
            this.say(pick(FEEDING.cat));
          }
        });
      }
    });

    this.time.delayedCall(760, () => {
      this.ownerThrowing = false;
      this.fedNow = false;
      this.ownerThrow.setVisible(false);
      this.startOwnerBreathing();
    });
  }

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

  // Первая побудка — открытые глаза, со второй по четвёртую летит
  // подушка, на пятой хозяин сдаётся и бросает рыбу-награду.
  noteWake() {
    this.wakes++;
    if (this.wakes >= BALANCE.WAKES_TO_FEED && !this.fed) {
      this.fed = true;
      this.wakeOwner(900);
      this.time.delayedCall(620, () => this.feedCat());
      return 'feed';
    }
    this.wakeOwner(this.wakes === 1 ? 1050 : 700);
    if (this.wakes > 1) {
      this.time.delayedCall(520, () => {
        this.say('Он сел. Это плохой знак.');
        this.playOwnerThrow('podushka');
      });
      return 'throw';
    }
    return 'wake';
  }

  // Пятая побудка использует ту же анимацию руки, но отдельный спрайт рыбы.
  feedCat() {
    if (!this.owner || this.state === 'done') return;
    this.sayOwner(pick(FEEDING.owner));
    this.playOwnerThrow('ryba', true);
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
      sprite = this.tv;
    }
    if (sprite) {
      this.tweens.add({
        targets: sprite,
        y: this.floorSurfaceY() - 14,
        x: sprite.x + Phaser.Math.Between(-40, 40),
        angle: Phaser.Math.Between(70, 110),
        duration: 520, ease: 'Cubic.easeIn'
      });
    }
    this.say(pick(HAZARDS.padenie.lines));

    // Грохот участвует в том же счётчике побудок, что и прыжок на кровать.
    // Реакция выбирается централизованно: глаза, подушка или рыба.
    const reaction = this.noteWake();
    if (reaction === 'wake') {
      this.time.delayedCall(900, () => {
        this.state = this.standingOn ? 'landed' : 'idle';
      });
    }
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
    this.showCatMoment('hit', 360);
    this.launch(away * 170, -330, false);
  }

  // ============================================================
  //  ПОЛЁТ
  // ============================================================
  update() {
    this.syncCatVisual();
    if (this.bubbleTx.alpha > 0 && this.state !== 'scene') this.placeBubble();
    this.placeThink();
    this.checkPillow();
    if (this.state !== 'flying') return;

    if (this.time.now >= this.catVisualLockUntil) {
      const vy = this.cat.body.velocity.y;
      this.setCatVisual(vy < -170 ? 'rise' : (vy > 170 ? 'fall' : 'apex'));
    }

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
        this.floorSurfaceY() - this.catSize().h / 2
      );
      this.state = 'idle';
      this.standingOn = null;
      this.standingBody = null;
      this.setCatVisual('idle');
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
    this.showCatMoment('land', 150);

    // --- ковёр: не провал, кот просто внизу и может прыгать дальше ---
    if (kind === 'pol') {
      this.state = 'idle';
      this.standingOn = null;
      this.standingBody = null;
      // Ставим кота на ковёр через body.reset, а не через cat.y:
      // присвоение координаты внутри обработчика столкновения физика
      // потом «доигрывает» своим смещением, и кот проваливается в пол
      // на несколько пикселей. reset ставит и тело, и картинку разом.
      this.cat.body.reset(this.cat.x, this.floorSurfaceY() - this.catSize().h / 2);
      const slideTo = Phaser.Math.Clamp(this.cat.x + vx * BALANCE.SLIDE_FACTOR, 30, FIELD.w - 30);
      this.tweens.add({ targets: this.cat, x: slideTo, duration: BALANCE.SLIDE_MS, ease: 'Cubic.easeOut' });
      this.time.delayedCall(150, () => this.setCatVisual('slide'));
      this.time.delayedCall(BALANCE.SLIDE_MS + 170, () => this.setCatVisual('idle'));
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
          this.floorSurfaceY() - this.catSize().h / 2
        );
        this.state = 'idle';
        this.setCatVisual('idle');
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

    const cs = this.catSize();
    const left  = item.x + item.surface.left + cs.w * 0.35;
    const right = item.x + item.surface.right - cs.w * 0.35;
    const slideTo = Phaser.Math.Clamp(this.cat.x + vx * BALANCE.SLIDE_FACTOR, left, right);
    this.tweens.add({
      targets: this.cat, x: slideTo, duration: BALANCE.SLIDE_MS, ease: 'Cubic.easeOut'
    });
    this.time.delayedCall(150, () => this.setCatVisual('slide'));
    this.time.delayedCall(BALANCE.SLIDE_MS + 170, () => {
      if (this.state !== 'flying' && this.state !== 'scene') this.setCatVisual('idle');
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

function sameSurface(a, b) {
  return !!a && !!b &&
    Math.round(a.inset) === Math.round(b.inset) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.right) === Math.round(b.right);
}

function itemLabel(id) {
  return ({
    tumba: 'Тумбочка', krovat: 'Кровать', komod: 'Комод',
    stol: 'Стол', shkaf: 'Шкаф', akvarium: 'Аквариум'
  })[id] || id;
}
