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
  STASH_POOL, CHANDELIER, WINDOW_HANG, TIP_HINTS, FEEDING
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
  loadSurfaceGeometry, resolveSurfaceGeometry, saveSurfaceGeometry, dumpSurfaceGeometry,
  resolveHangPoint, saveHangPoint, resolveSpriteGeometry, saveSpriteGeometry
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
    this.hangUntil = 0;        // до этого момента точки зацепа кота не ловят
    this.hangPoints = [];      // {id,x,y,fish,lines,wobble,taken,radius} — см. registerHangPoint
    this.activeHang = null;    // на какой точке кот висит сейчас (grabHang/releaseHang)
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
    // item (объект из FURNITURE) -> его surfaceDebugTarget — для ЛЮБОГО
    // предмета (не только item.tippable): статичный наклон линии
    // (surface.tiltLeft/tiltRight) действует у всех, триггер-переворот
    // (triggerTip) — только у tippable. Быстрый доступ без find().
    this.itemTargets = new Map();
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
    this.floorTarget = {
      id: 'pol', label: 'Ковёр', item: null, body: floorBody,
      centerX: FIELD.w / 2, visualTop: FLOOR_Y, size: ps,
      defaults: { inset: FLOOR_SURFACE_Y - FLOOR_Y, left: -ps.w / 2, right: ps.w / 2 },
      surface: this.floorSurface
    };
    this.surfaceDebugTargets.push(this.floorTarget);
    this.applySurfaceTarget(this.floorTarget);

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
    // Зацеп на окне (карниз/верх рамы) — та же механика «повиснуть», что у
    // люстры, см. registerHangPoint/grabHang. Дефолт — верх окна; своей
    // картинки нет (окно уже нарисовано), точка настраивается в отладчике.
    this.registerHangPoint({
      id: 'hang:okno', label: 'Окно (зацеп)',
      defaultX: okno.x, defaultY: okno.y - os.h / 2 + 20,
      fish: WINDOW_HANG.fish, lines: WINDOW_HANG.lines
    });

    // ---------- люстра ----------
    this.buildChandelier();

    // ---------- мебель ----------
    this.platforms = this.physics.add.staticGroup();
    this.items.forEach(item => {
      const itemSize = sizeOf(item.id);
      const defaults = {
        inset: item.surface?.inset ?? PLATFORM_SURFACE_INSET,
        left: item.surface?.left ?? -itemSize.w / 2,
        right: item.surface?.right ?? itemSize.w / 2,
        // slideSpeed общий для всех линий (не только item.tippable) — им
        // пользуется любая «скользкая» линия, см. surface.slippery ниже
        // и LevelScene.slidingTarget.
        slideSpeed: item.surface?.slideSpeed ?? BALANCE.TIP_SLIDE_SPEED_DEFAULT
      };
      item.surface = resolveSurfaceGeometry(item.id, itemSize, defaults, this.surfaceOverrides);
      // Переворачиваемость — состояние ЭТОГО захода (не персистится, см.
      // triggerTip): 0 — обычное положение, -1/1 — завален на бок (в какую
      // сторону). tipContacts — счётчик приземлений «в точку» у каждого
      // края линии, сбрасывается при приземлении на ДРУГОЙ предмет/пол
      // (см. land()), не при простом прыжке-возврате на тот же предмет.
      if (item.tippable) {
        item.tipState = 0; item.tipContacts = { left: 0, right: 0 };
        item.brokenState = false;
        item.tipPivotSide = 0; // сторона последнего завала — читает кнопка «Завал» в отладчике
        // У КАЖДОГО состояния (ровно/завал/сломан) — своя независимая
        // линия/картинка, не вычисляемая друг из друга (см. шапку
        // «ПЕРЕВОРАЧИВАЕМОСТЬ» ниже: раньше линия при завале вычислялась
        // поворотом «ровной» геометрии — не совпадала с эталонным
        // спрайтом того состояния). Пока ничего не отредактировано в
        // отладчике, у tipped/broken те же дефолты, что у flat — разумная
        // отправная точка, а не что-то заведомо неправильное.
        item.surfaceStates = {
          flat: item.surface,
          tipped: resolveSurfaceGeometry(item.id + ':tipped', itemSize, defaults, this.surfaceOverrides),
          broken: resolveSurfaceGeometry(item.id + ':broken', itemSize, defaults, this.surfaceOverrides)
        };
        item.surfaceDefaults = { flat: defaults, tipped: defaults, broken: defaults };
        item.spriteStates = {
          flat: resolveSpriteGeometry('sprite:' + item.id, this.surfaceOverrides),
          tipped: resolveSpriteGeometry('sprite:' + item.id + ':tipped', this.surfaceOverrides),
          broken: resolveSpriteGeometry('sprite:' + item.id + ':broken', this.surfaceOverrides)
        };
      }
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

      // Геометрия картинки (масштаб/зеркало/сдвиг от центра предмета) —
      // независима от логики (item.x/y, surface): чисто художественная
      // поправка, тот же пайплайн (база-файл + localStorage), что и линии,
      // просто свой id-неймспейс 'sprite:<id>'. У tippable уже резолвлена
      // выше (item.spriteStates.flat) — не резолвим второй раз.
      const spriteGeo = item.tippable
        ? item.spriteStates.flat
        : resolveSpriteGeometry('sprite:' + item.id, this.surfaceOverrides);

      const surfaceTarget = {
        id: item.id, stateKey: 'flat', label: itemLabel(item.id), item, image, body,
        centerX: item.x, visualTop: item.y - itemSize.h / 2, size: itemSize,
        defaults, surface: item.surface,
        spriteGeo, spriteDefaults: { scaleMul: 1, mirror: false, offsetX: 0, offsetY: 0 }
      };
      this.surfaceDebugTargets.push(surfaceTarget);
      this.itemTargets.set(item, surfaceTarget);
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

        // Зона «разбудить хозяина» — раньше жёсткий прямоугольник, один
        // раз посчитанный из размера hozyain.png (кот фактически бегал по
        // геометрии СПРАЙТА, не настраиваемой ни в одном отладчике). Теперь
        // настоящая «поверхность предмета» (та же панель, что у линий
        // кровати/стола): верхняя линия — top зоны, left/right — её
        // ширина; высота зоны вниз (ownerRectExtraH) — фиксированный
        // запас, как и раньше, не геометрия для настройки.
        const ownerDefaults = { inset: -(hs.h + 24), left: -hs.w / 2, right: hs.w / 2 };
        item.ownerSurface = resolveSurfaceGeometry('hozyain', hs, ownerDefaults, this.surfaceOverrides);
        const ownerTarget = {
          id: 'hozyain', label: 'Хозяин (зона)', item, isOwnerZone: true, ownerRectExtraH: hs.h + 34,
          centerX: item.x, visualTop: item.y - is.h / 2, size: hs,
          defaults: ownerDefaults, surface: item.ownerSurface
        };
        this.surfaceDebugTargets.push(ownerTarget);
        this.applySurfaceTarget(ownerTarget);
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
    this.cat = this.physics.add.sprite(100, this.floorSurfaceY(100) - sizeOf('cat').h / 2, 'cat')
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
    let chX = Phaser.Math.Clamp(CHANDELIER.x + jit, 140, FIELD.w - 140);
    const chY = CHANDELIER.y;

    // Люстра висит на той же высоте, что и шкаф. Если после перестановки
    // комнаты они оказались рядом — отодвигаем люстру, чтобы не слиплись.
    const shkaf = this.items.find(i => i.id === 'shkaf');
    if (shkaf && Math.abs(chX - shkaf.x) < 145) {
      chX = shkaf.x < FIELD.w / 2
        ? Math.min(FIELD.w - 120, shkaf.x + 165)
        : Math.max(120, shkaf.x - 165);
    }

    // registerHangPoint сам накладывает ручную правку из отладчика
    // (resolveHangPoint) поверх этой процедурной позиции — если её нет,
    // используется chX/chY как есть. Это ТОЛЬКО точка зацепа (где кот
    // хватается лапой) — независимая от картинки самой люстры, см.
    // applySpriteGeometry: та берёт базу из defaults, не из живой точки.
    const point = this.registerHangPoint({
      id: 'hang:chandelier', label: 'Люстра (зацеп)',
      defaultX: chX, defaultY: chY,
      fish: CHANDELIER.fish, lines: CHANDELIER.lines
    });
    this.chX = point.x;
    this.chY = point.y;

    this.chandelierCordGfx = this.add.graphics().setDepth(0);
    this.chandelier = this.add.image(chX, chY, 'lyustra').setDepth(4);
    // wobble (покачивание вместе с котом, см. grabHang) назначается только
    // сейчас — картинки не было в момент registerHangPoint.
    point.wobble = this.chandelier;
    // Ставит картинку по её собственной геометрии (spriteGeo: дефолт chX/
    // chY + сохранённый сдвиг/масштаб/зеркало, НЕ по точке зацепа) и сама
    // же перерисовывает шнур — см. applySpriteGeometry.
    const chandelierTarget = this.surfaceDebugTargets.find(t => t.id === 'hang:chandelier');
    this.applySpriteGeometry(chandelierTarget);
    labelFor(this, 'lyustra', this.chandelier.x, this.chandelier.y);
  }

  // Шнур — от потолка до КАРТИНКИ люстры (её реальная текущая позиция,
  // this.chandelier.x/y), не до точки зацепа: с тех пор как картинка
  // получила свой независимый сдвиг (applySpriteGeometry), шнур обязан
  // визуально идти именно к ней, иначе он «отклеится» от абажура.
  redrawChandelierCord() {
    if (!this.chandelierCordGfx || !this.chandelier) return;
    const g = this.chandelierCordGfx;
    g.clear();
    g.lineStyle(2, 0x7A6C84, 0.7);
    g.beginPath();
    g.moveTo(this.chandelier.x, CEILING_Y);
    g.lineTo(this.chandelier.x, this.chandelier.y);
    g.strokePath();
  }

  // Точка «повиснуть» (люстра/окно, см. config/level.js: CHANDELIER,
  // WINDOW_HANG) — общий механизм вместо старого, завязанного только на
  // люстру: кот цепляется лапой, пролетая рядом, один раз даёт рыбок,
  // дальше просто виснет, пока не оттолкнётся (launch → releaseHang).
  // Регистрирует точку и в this.hangPoints (для проверки касания в
  // update()), и в this.surfaceDebugTargets (kind: 'point') — та же
  // панель отладки, что у линий поверхностей, то же Save/Reset/Export.
  registerHangPoint(spec) {
    const resolved = resolveHangPoint(spec.id, { x: spec.defaultX, y: spec.defaultY }, this.surfaceOverrides);
    const point = {
      id: spec.id, fish: spec.fish, lines: spec.lines, wobble: spec.wobble || null,
      radius: BALANCE.HANG_RADIUS, taken: false,
      // x/y — абсолютная позиция ЭТОГО захода (procedural default + сохр.
      // смещение dx/dy, см. resolveHangPoint) — ей пользуется вся игровая
      // логика (проверка касания, grabHang). dx/dy — то самое смещение,
      // отдельно, чтобы при Save сохранять именно его, не абсолют (иначе
      // точка «прикалывалась» бы к пикселю одного захода, не следуя за
      // люстрой/окном в следующих — была жалоба).
      x: resolved.x, y: resolved.y, dx: resolved.dx, dy: resolved.dy
    };
    this.hangPoints.push(point);
    this.surfaceDebugTargets.push({
      kind: 'point', id: spec.id, label: spec.label, point,
      defaults: { x: spec.defaultX, y: spec.defaultY },
      // Геометрия картинки (только если у точки есть wobble — своя
      // картинка; сейчас это только люстра, у окна её нет и не будет,
      // резолвим всё равно — дёшево, а появится арт когда-нибудь, уже
      // будет готово) — см. spriteGeo у furniture-таргетов выше.
      spriteGeo: resolveSpriteGeometry('sprite:' + spec.id, this.surfaceOverrides),
      spriteDefaults: { scaleMul: 1, mirror: false, offsetX: 0, offsetY: 0 }
    });
    return point;
  }

  // Смена визуального состояния не затрагивает физическое тело кота.
  setCatVisual(state, force = false) {
    if (!this.catVisualSprite || (!force && this.catVisualState === state)) return;
    this.catVisualState = state;
    const visual = catVisual(this.character, state);
    this.catVisualSprite.stop();
    if (visual.animation) {
      this.catVisualSprite.play(visual.animation);
    } else if (visual.frame !== undefined) {
      // Статичный кадр из шита movement.png (state 'sit') — не отдельная
      // картинка, поэтому setTexture с явным номером кадра, не только ключ.
      this.catVisualSprite.setTexture(visual.texture, visual.frame);
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

  // Считается ли предмет сейчас «сползающей поверхностью» — ЕДИНСТВЕННОЕ
  // условие: включённая галка surface.slippery (настраивается в
  // отладчике). Наклон линии НЕ обязателен — на ровной «скользкой» линии
  // updateTipSlide просто едет к одному из её краёв (см. lowX там же).
  // item.tippable+завален сам по себе больше не включает сползание
  // автоматически — раньше включал всегда, из-за чего кот скользил и на
  // невключённых линиях (жалоба: «когда наклон не скользкий, кот не
  // должен скользить»). Ходьба по наклону (walkTo) на slippery не
  // завязана — работает всегда, независимо от этого флага.
  slidingTarget(item) {
    if (!item) return null;
    const target = this.itemTargets.get(item);
    return (target && target.surface.slippery) ? target : null;
  }

  // Есть ли у предмета под котом наклон ПРЯМО СЕЙЧАС — вообще любой (не
  // только «скользкий», см. slidingTarget выше — это разные вопросы:
  // «сползает ли кот» и «должен ли его спрайт визуально повернуться,
  // чтобы лапы лежали на наклонной поверхности»). Раньше поворот спрайта
  // (syncCatVisual) был завязан на slidingTarget — на наклонной, но НЕ
  // скользкой линии кот стоял визуально прямо, хотя поверхность под ним
  // была под углом (жалоба: «на наклонной линии спрайт кота не
  // поворачивается»).
  // item — предмет ИЛИ null/undefined (кот на полу, не на мебели, — тогда
  // проверяем ковёр, this.floorTarget).
  tiltedTarget(item) {
    const target = item ? this.itemTargets.get(item) : this.floorTarget;
    if (!target) return null;
    const line = this.surfaceLine(target);
    return line.y1 !== line.y2 ? target : null;
  }

  // Поза «стоит/сидит на месте»: сидя (state 'sit'), только пока кот
  // сейчас на сползающей поверхности (см. slidingTarget) — на обычной
  // ровной поверхности, даже tippable/скользкой, кот стоит как всегда.
  // Разворот «спиной/лицом к предмету» — не отдельные кадры, а обычный
  // flipX от направления последнего движения (уже хранится в cat.flipX).
  settleCatVisual() {
    if (this.slidingTarget(this.standingOn)) {
      this.setCatVisual('sit', true);
    } else {
      this.setCatVisual('idle');
    }
  }

  syncCatVisual() {
    if (!this.catVisualSprite || !this.cat) return;
    const visual = catVisual(this.character, this.catVisualState || 'idle');
    const size = visual.size || { w: 72, h: 56 };
    const bodyH = sizeOf('cat').h;
    const y = this.catPose === 'cat_hang'
      ? this.cat.y
      : this.cat.y - (size.h - bodyH) / 2 + (visual.offsetY || 0);
    // Лапы должны визуально лежать НА наклонной линии — поворачиваем
    // спрайт на её угол (физическое тело у Arcade Physics всегда угол 0,
    // коллайдер плоский даже у наклонной линии, см. surfaceLine).
    const tipAngle = this.tipLineAngleDeg(this.tiltedTarget(this.standingOn));
    this.catVisualSprite
      .setPosition(this.cat.x, y)
      .setFlipX(this.cat.flipX)
      .setAngle(this.cat.angle + tipAngle)
      .setDepth(this.cat.depth);
  }

  // Совместимый интерфейс для старых мест, где различались две позы.
  setCatPose(key) {
    if (this.catPose === key) return;
    this.catPose = key;
    this.setCatVisual(key === 'cat_hang' ? 'hang' : 'idle', true);
  }

  catSize() { return sizeOf(this.catPose === 'cat_hang' ? 'cat_hang' : 'cat'); }

  // point — запись из this.hangPoints (registerHangPoint): люстра или
  // окно, обе проходят один и тот же путь. wobble (если есть — только у
  // люстры, см. buildChandelier) — картинка, которая покачивается вместе
  // с котом; у окна своей картинки нет, качается только сам кот.
  grabHang(point) {
    this.cat.setVelocity(0, 0);
    this.cat.body.allowGravity = false;
    // Пока кот висит, физическое тело выключено: он держится лапой,
    // а не стоит на чём-то. Так его никуда не сносит и не сдвигает.
    this.cat.body.enable = false;
    if (this.ownerTimer) this.ownerTimer.remove();
    this.ownerArmed = false;
    this.state = 'hang';
    this.activeHang = point;
    this.standingOn = null;
    this.standingBody = null;

    this.setCatPose('cat_hang');
    this.cat.setFlipX(false);
    // Поднятая лапа приходится ровно на точку зацепа
    this.cat.setPosition(point.x + 4, point.y + 2 + this.catSize().h / 2);
    this.syncCatVisual();

    // лёгкое покачивание — точка зацепа под котом «живая»
    this.tweens.add({
      targets: point.wobble ? [this.cat, point.wobble] : [this.cat], angle: 4,
      duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });

    if (!point.taken) {
      point.taken = true;
      this.runFish += point.fish;
      addFish(point.fish);
      this.updateHud();
    }
    this.say(pick(point.lines));
  }

  releaseHang() {
    const point = this.activeHang;
    const wobbleTargets = point && point.wobble ? [this.cat, point.wobble] : [this.cat];
    this.tweens.killTweensOf(wobbleTargets);
    this.cat.setAngle(0);
    if (point && point.wobble) point.wobble.setAngle(0);
    this.setCatPose('cat');
    // возвращаем физику на место ровно там, где кот висел
    this.cat.body.enable = true;
    this.cat.body.reset(this.cat.x, this.cat.y);
    this.syncCatVisual();
    this.hangUntil = this.time.now + BALANCE.HANG_COOLDOWN_MS;
    this.activeHang = null;
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
  // y — центр линии (та же высота что и раньше, ей одной пользуется
  // физика: AABB-тело у Arcade Physics не умеет коллизию под углом, оно
  // остаётся плоским на средней высоте даже у наклонной линии). y1/y2 —
  // реальная высота на каждом краю, ей пользуется всё визуальное и
  // геймплейное, что не завязано на физический коллайдер напрямую:
  // сползание (surfaceYAt), поворот кота (tipLineAngleDeg), приземление
  // на наклонную линию (land()).
  surfaceLine(target) {
    // Точки зацепа (kind:'point', см. registerHangPoint) не имеют линии —
    // сюда их звать незачем, но общие циклы (redrawSurfaceDebug и т.п.)
    // проходят по всем target вперемешку, так что защитный вырожденный
    // случай безопаснее, чем падение на target.surface.left у объекта,
    // где вообще нет .surface.
    if (target.kind === 'point') {
      return { x1: target.point.x, x2: target.point.x, y: target.point.y, y1: target.point.y, y2: target.point.y };
    }
    // У tippable-предметов target.surface — это геометрия ТЕКУЩЕГО
    // состояния (ровно/завал/сломан, см. item.surfaceStates и
    // LevelScene.setItemState) — свой независимый inset/left/right/tilt
    // на каждое, не вычисляется поворотом из «плоской» версии. Раньше
    // линия при завале вычислялась вращением flat-геометрии вокруг пивота
    // картинки — из-за этого она «не совпадала с эталонным спрайтом» в
    // другом состоянии (жалоба): теперь у каждого состояния просто своя,
    // независимо настраиваемая в отладчике линия, картинка крутится сама
    // по себе (triggerTip), с линией больше никак математически не связана.
    const x1 = target.centerX + target.surface.left;
    const x2 = target.centerX + target.surface.right;
    const y = target.visualTop + target.surface.inset;
    const y1 = y + (target.surface.tiltLeft || 0);
    const y2 = y + (target.surface.tiltRight || 0);
    return { x1, x2, y, y1, y2 };
  }

  // Высота линии в произвольной точке x (линейная интерполяция между
  // краями) — для сползания и приземления на наклонную линию; на ровной
  // линии y1===y2, результат не отличается от line.y.
  surfaceYAt(target, x) {
    const line = this.surfaceLine(target);
    const t = Phaser.Math.Clamp((x - line.x1) / Math.max(1, line.x2 - line.x1), 0, 1);
    return line.y1 + (line.y2 - line.y1) * t;
  }

  // Угол линии в градусах — визуальный поворот кота на наклонной
  // поверхности (syncCatVisual). Принимает готовый target (см.
  // tiltedTarget), не item — вызывающая сторона уже разобралась, ковёр
  // это или предмет.
  tipLineAngleDeg(target) {
    if (!target) return 0;
    const line = this.surfaceLine(target);
    return Phaser.Math.RadToDeg(Math.atan2(line.y2 - line.y1, line.x2 - line.x1));
  }

  // x — опционально: высота ковра РОВНО под лапами в этой точке, не общая
  // константа. Раньше это было FLOOR_Y+inset без учёта x вообще — если у
  // ковра выставляли наклон/tiltLeft-Right в отладчике, кот при
  // приземлении на пол всё равно вставал на плоскую высоту, а не на
  // реальную (наклонную) линию — та самая жалоба «кот не встаёт на её
  // линию». Без x (для мест, где под рукой только константа, не x кота)
  // возвращает высоту в центре ковра — как раньше, для плоского пола не
  // отличается от старого поведения вообще.
  floorSurfaceY(x = FIELD.w / 2) {
    return this.floorTarget ? this.surfaceYAt(this.floorTarget, x) : FLOOR_Y + this.floorSurface.inset;
  }

  // Масштаб/зеркало/сдвиг картинки — независимо от логической линии/точки.
  // У точек зацепа база — СТАТИЧНЫЙ дефолт (target.defaults.x/y, тот же,
  // что у самой точки при сбросе), а НЕ живой target.point.x/y: раньше
  // offset считался от текущей точки, и перетаскивание точки тянуло
  // картинку за собой 1-в-1 — та самая жалоба «зацеп всё ещё двигает
  // люстру». Теперь точка и картинка — две независимо перетаскиваемые
  // вещи, обе стартуют из одного места, но дальше не связаны.
  applySpriteGeometry(target) {
    const geo = target.spriteGeo;
    if (!geo) return;
    const img = target.kind === 'point' ? (target.point && target.point.wobble) : target.image;
    if (!img) return;
    // Пока предмет завален/крутится — позицией/origin/углом картинки
    // безраздельно рулит triggerTip (пивот на углу, не в центре) — sprite-
    // геометрия молчит, чтобы не воевать за один transform каждый кадр
    // твина. Как только выровняется (tipState 0), снова её слово.
    if (target.item && target.item.tippable && target.item.tipState) return;
    img.setScale(geo.scaleMul).setFlipX(geo.mirror);
    const baseX = target.kind === 'point' ? target.defaults.x : target.item.x;
    const baseY = target.kind === 'point' ? target.defaults.y : target.item.y;
    img.setPosition(baseX + geo.offsetX, baseY + geo.offsetY);
    if (target.id === 'hang:chandelier') this.redrawChandelierCord();
  }

  // «Грязно» ли что-то у target с прошлого Save — геометрия линии/точки
  // ИЛИ spriteGeo (масштаб/зеркало/сдвиг): один флаг на оба, кнопка Save
  // одна и сохраняет/сбрасывает всё сразу.
  computeTargetDirty(target) {
    const geomDirty = target.kind === 'point'
      ? !samePoint(target.point, target.savedPoint)
      : !sameSurface(target.surface, target.savedSurface);
    const spriteDirty = target.spriteGeo ? !sameSpriteGeo(target.spriteGeo, target.savedSpriteGeo) : false;
    return geomDirty || spriteDirty;
  }

  applySurfaceTarget(target) {
    // Точка зацепа (люстра/окно) — не линия и не физ.тело, просто x/y +
    // визуальные привязки (покачивающаяся картинка люстры, её шнур).
    if (target.kind === 'point') {
      this.applySpriteGeometry(target); // сама перерисует шнур люстры, если это она
      // Кот висит ИМЕННО на этой точке прямо сейчас — проверяем activeHang
      // напрямую, НЕ this.state: пока открыт отладчик, this.state всегда
      // 'debug' (см. openSurfaceDebug), а не 'hang' — старая проверка
      // поэтому никогда не срабатывала во время реальной правки, кот не
      // двигался за точкой (та самая жалоба).
      if (this.activeHang === target.point) {
        this.cat.setPosition(target.point.x + 4, target.point.y + 2 + this.catSize().h / 2);
        this.syncCatVisual();
      }
      return;
    }

    const line = this.surfaceLine(target);

    // Зона «разбудить хозяина» — тоже не физ.тело (это просто rect для
    // point-in-rect проверки в update()/tryArmOwner, кот на ней не стоит
    // и не приземляется), верх зоны — линия, высота вниз — фиксированный
    // запас (ownerRectExtraH), не геометрия для настройки.
    if (target.isOwnerZone) {
      const top = Math.min(line.y1, line.y2);
      this.ownerRect = new Phaser.Geom.Rectangle(
        Math.min(line.x1, line.x2), top, Math.max(1, Math.abs(line.x2 - line.x1)), target.ownerRectExtraH
      );
      target.item.ownerSurface = { ...target.surface };
      return;
    }

    // AABB-коллайдер у Arcade Physics плоский всегда (нет коллизии под
    // углом) — при наклонной линии (статичный tiltLeft/tiltRight или
    // живой tip) ставим его на СРЕДНЮЮ высоту между краями: разумное
    // приближение для физики, а фактическая высота под лапами при
    // приземлении/ходьбе по наклону считается отдельно, см. surfaceYAt.
    const midY = (line.y1 + line.y2) / 2;
    const width = Math.max(24, line.x2 - line.x1);
    target.body
      .setPosition((line.x1 + line.x2) / 2, midY + target.size.h / 2)
      .setDisplaySize(width, target.size.h)
      .refreshBody();

    if (!target.item) {
      this.floorSurface = { ...target.surface };
      if (this.cat && !this.standingOn && this.surfaceDebugMode) {
        this.cat.body.reset(this.cat.x, midY - this.catSize().h / 2);
        this.syncCatVisual();
      }
      return;
    }

    // Сохранённая/живая геометрия становится частью runtime-свойств
    // предмета. Коллизия, ходьба и установленные сверху объекты читают её.
    target.item.surface = { ...target.surface };
    this.applySpriteGeometry(target);
    if (this.cat && this.standingBody === target.body && this.surfaceDebugMode) {
      this.cat.body.reset(this.cat.x, midY - this.catSize().h / 2);
      this.syncCatVisual();
    }
    if (target.item.lamp && this.lampa && !this.fallen.lampa) {
      this.lampa.setY(midY - sizeOf('lampa').h / 2);
    }
    if (target.item.fragile === 'tv' && this.tv && !this.fallen.tv) {
      this.tv.setY(midY - sizeOf('tv').h / 2);
    }
  }

  // ============================================================
  //  ПЕРЕВОРАЧИВАЕМОСТЬ (item.tippable)
  // ============================================================
  //  direction: -1 — завалить влево (левый край линии вниз), 1 — вправо,
  //  0 — выровнять обратно. Своего арта на «предмет на боку» нет (см.
  //  обсуждение) — поворот чисто программный: origin переносится на нижний
  //  угол со стороны заваливания (тот угол визуально остаётся на месте,
  //  остальное вращается вокруг него), у выравнивания — тот же приём в
  //  обратную сторону, на прежнем pivot'е (иначе картинка «прыгнет» на
  //  середине твина), и только в конце origin возвращается в центр.
  triggerTip(item, direction) {
    const target = this.itemTargets.get(item);
    if (!target) return;
    item.tipState = direction;
    item.tipContacts.left = 0;
    item.tipContacts.right = 0;
    if (direction !== 0) item.tipPivotSide = direction; // запоминаем сторону — читает кнопка «Завал» в отладчике

    // Картинка крутится сама по себе (чисто визуально, твин, тот же
    // пивот-приём — нижний угол со стороны заваливания) — линия/
    // коллайдер/поза кота на неё больше НЕ завязаны, у каждого состояния
    // (ровно/завал/сломан) своя независимая геометрия (item.surfaceStates,
    // см. syncTargetToItemState) — переключается сразу, без синхронизации
    // с углом твина. Раньше линия вычислялась вращением flat-геометрии
    // вокруг того же пивота — из-за этого она «не совпадала с эталонным
    // спрайтом» в состоянии завала (жалоба): теперь она просто ДРУГАЯ,
    // независимо настраиваемая линия для этого состояния.
    const img = target.image;
    if (img) {
      this.tweens.killTweensOf(img);
      if (direction === 0) {
        this.tweens.add({
          targets: img, angle: 0, duration: BALANCE.TIP_TWEEN_MS, ease: 'Back.easeOut',
          onComplete: () => img.setOrigin(0.5, 0.5).setPosition(item.x, item.y)
        });
      } else {
        const size = target.size;
        const pivotX = direction === -1 ? item.x - size.w / 2 : item.x + size.w / 2;
        const pivotY = item.y + size.h / 2;
        img.setOrigin(direction === -1 ? 0 : 1, 1).setPosition(pivotX, pivotY).setAngle(0);
        this.tweens.add({
          targets: img, angle: direction === -1 ? -BALANCE.TIP_ANGLE : BALANCE.TIP_ANGLE,
          duration: BALANCE.TIP_TWEEN_MS, ease: 'Back.easeOut'
        });
      }
    }

    this.syncTargetToItemState(item);

    this.say(direction ? pick(['Ого, накренилось!', 'Так, это едет вбок.', 'Ловите равновесие. Не я.'])
      : pick(['Выровнялось обратно.', 'Опять на все четыре ножки.']));
  }

  // Переключает target.surface/spriteGeo/defaults на геометрию ТЕКУЩЕГО
  // состояния предмета (ровно/завал/сломан, см. stateKeyOf) и сразу же
  // применяет её — вызывается и из triggerTip (реальный игровой
  // переворот), и из отладчика (кнопка «Сломан», выбор состояния для
  // редактирования) — один источник истины, не расходятся.
  syncTargetToItemState(item) {
    const target = this.itemTargets.get(item);
    if (!target || !item.surfaceStates) return;
    const key = stateKeyOf(item);
    target.stateKey = key;
    target.surface = item.surfaceStates[key];
    target.defaults = item.surfaceDefaults[key];
    target.spriteGeo = item.spriteStates[key];
    target.spriteDefaults = { scaleMul: 1, mirror: false, offsetX: 0, offsetY: 0 };
    if (this.surfaceDebugMode) {
      // Переключение состояния (в т.ч. кнопками отладчика) — новая точка
      // отсчёта «сохранено»: без этого dirty/Save/Reset после переключения
      // сравнивали бы geometry НОВОГО состояния со снимком СТАРОГО —
      // либо ложно «грязно» сразу, либо Save/закрытие путали состояния.
      target.savedSurface = { ...target.surface };
      target.savedSpriteGeo = target.spriteGeo ? { ...target.spriteGeo } : undefined;
      target.dirty = false;
    }
    this.applySurfaceTarget(target);
    if (this.surfaceDebugMode) this.redrawSurfaceDebug();
    if (this.standingOn === item) {
      const y = this.surfaceYAt(target, this.cat.x);
      this.cat.body.reset(this.cat.x, y - this.catSize().h / 2);
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
    this.surfaceDebugHint = this.add.text(0, 0,
      'Линия: центр — высота, края — длина И наклон\nТочка (люстра/окно) — просто тяни', {
      fontFamily: 'sans-serif', fontSize: '9px', color: '#BEB2C4', lineSpacing: 2
    }).setDepth(26).setVisible(false);
    this.surfaceDebugSaveText = this.add.text(0, 0, 'Сохранить', {
      fontFamily: 'sans-serif', fontSize: '10px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugResetText = this.add.text(0, 0, 'Сбросить', {
      fontFamily: 'sans-serif', fontSize: '10px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    // Экспорт — отдельная строка под Save/Reset (см. exportSurfaceDebug):
    // «Сохранить» тут пишет только в localStorage ЭТОГО браузера — черновик,
    // который другие игроки не увидят вообще, пока его не забрать в файл.
    this.surfaceDebugExportText = this.add.text(0, 0, 'Экспорт → surfaceGeometryData.json', {
      fontFamily: 'sans-serif', fontSize: '9px', color: '#BEB2C4'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugCloseText = this.add.text(0, 0, '×', {
      fontFamily: 'sans-serif', fontSize: '17px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    // «Скользкое» (surface.slippery) — чекбокс у любой линии (не точки, не
    // зоны хозяина): включает пассивное сползание САМО ПО СЕБЕ, не только
    // у item.tippable в заваленном виде, см. LevelScene.slidingTarget.
    this.surfaceDebugSlipperyText = this.add.text(0, 0, 'Скользкое', {
      fontFamily: 'sans-serif', fontSize: '10px', color: '#F5EDEF'
    }).setOrigin(0, 0.5).setDepth(26).setVisible(false);

    // Скорость сползания (surface.slideSpeed) — видна и у item.tippable,
    // и у любой линии с включённым «скользкое» (см. redrawSurfaceDebug),
    // не завязана на общую видимость панели.
    this.surfaceDebugSpeedText = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '9.5px', color: '#BEB2C4'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugSpeedMinusText = this.add.text(0, 0, '−', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugSpeedPlusText = this.add.text(0, 0, '+', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);

    // Геометрия картинки (масштаб/зеркало/сдвиг, см. applySpriteGeometry) —
    // видна у любого target с картинкой (мебель, люстра), не только
    // у tippable, в отличие от строки скорости выше.
    this.surfaceDebugScaleText = this.add.text(0, 0, '', {
      fontFamily: 'sans-serif', fontSize: '9.5px', color: '#BEB2C4'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugScaleMinusText = this.add.text(0, 0, '−', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugScalePlusText = this.add.text(0, 0, '+', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugMirrorText = this.add.text(0, 0, '⇄', {
      fontFamily: 'sans-serif', fontSize: '13px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugOffsetLabelText = this.add.text(0, 0, 'Сдвиг', {
      fontFamily: 'sans-serif', fontSize: '9px', color: '#8D8195'
    }).setOrigin(0, 0.5).setDepth(26).setVisible(false);
    this.surfaceDebugOffsetLeftText = this.add.text(0, 0, '←', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugOffsetRightText = this.add.text(0, 0, '→', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugOffsetUpText = this.add.text(0, 0, '↑', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugOffsetDownText = this.add.text(0, 0, '↓', {
      fontFamily: 'sans-serif', fontSize: '12px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);

    // Переключатель состояния предмета (item.tippable) — «ровно» (tipState
    // 0), «завал» (tipState -1/1, тот же triggerTip, что и от игровых
    // приземлений), «сломан» (item.brokenState — своего арта пока нет,
    // задел на будущее, см. запрос). Три кнопки в ряд.
    this.surfaceDebugStateFlatText = this.add.text(0, 0, 'Ровно', {
      fontFamily: 'sans-serif', fontSize: '9.5px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugStateTipText = this.add.text(0, 0, 'Завал', {
      fontFamily: 'sans-serif', fontSize: '9.5px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);
    this.surfaceDebugStateBrokenText = this.add.text(0, 0, 'Сломан', {
      fontFamily: 'sans-serif', fontSize: '9.5px', color: '#F5EDEF'
    }).setOrigin(0.5).setDepth(26).setVisible(false);

    this.surfaceDebugPanel = { x: 12, y: 110, w: 260, h: 345 };
    this.layoutSurfaceDebugPanel();
  }

  layoutSurfaceDebugPanel() {
    const p = this.surfaceDebugPanel;
    this.surfaceDebugHeader = { x: p.x, y: p.y, w: p.w - 42, h: 32 };
    this.surfaceDebugSaveBtn = { x: p.x + 12, y: p.y + 91, w: 84, h: 30 };
    this.surfaceDebugResetBtn = { x: p.x + 108, y: p.y + 91, w: 84, h: 30 };
    this.surfaceDebugExportBtn = { x: p.x + 12, y: p.y + 129, w: p.w - 24, h: 26 };
    this.surfaceDebugCloseBtn = { x: p.x + p.w - 40, y: p.y + 2, w: 36, h: 28 };
    this.surfaceDebugTitle.setPosition(p.x + 12, p.y + 10);
    this.surfaceDebugInfo.setPosition(p.x + 12, p.y + 33);
    this.surfaceDebugHint.setPosition(p.x + 12, p.y + 63);
    this.surfaceDebugSaveText.setPosition(p.x + 54, p.y + 106);
    this.surfaceDebugResetText.setPosition(p.x + 150, p.y + 106);
    this.surfaceDebugExportText.setPosition(p.x + p.w / 2, p.y + 142);
    this.surfaceDebugCloseText.setPosition(p.x + p.w - 22, p.y + 14);

    // «Скользкое» — чекбокс, отдельная строка, y+163.
    const slipperyY = p.y + 163;
    this.surfaceDebugSlipperyBtn = { x: p.x + 12, y: slipperyY, w: p.w - 24, h: 26 };
    this.surfaceDebugSlipperyText.setPosition(p.x + 40, slipperyY + 13);

    // Скорость сползания (−/N px/с/+) — y+197.
    const speedY = p.y + 197;
    this.surfaceDebugSpeedMinusBtn = { x: p.x + 12, y: speedY, w: 28, h: 26 };
    this.surfaceDebugSpeedPlusBtn = { x: p.x + p.w - 40, y: speedY, w: 28, h: 26 };
    this.surfaceDebugSpeedMinusText.setPosition(p.x + 26, speedY + 13);
    this.surfaceDebugSpeedPlusText.setPosition(p.x + p.w - 26, speedY + 13);
    this.surfaceDebugSpeedText.setPosition(p.x + p.w / 2, speedY + 13);

    // Спрайт: масштаб (−/100%/+) + зеркало — один ряд, y+231.
    const scaleY = p.y + 231;
    this.surfaceDebugScaleMinusBtn = { x: p.x + 12, y: scaleY, w: 26, h: 26 };
    this.surfaceDebugScalePlusBtn = { x: p.x + 76, y: scaleY, w: 26, h: 26 };
    this.surfaceDebugMirrorBtn = { x: p.x + p.w - 12 - 44, y: scaleY, w: 44, h: 26 };
    this.surfaceDebugScaleMinusText.setPosition(p.x + 25, scaleY + 13);
    this.surfaceDebugScaleText.setPosition(p.x + 55, scaleY + 13);
    this.surfaceDebugScalePlusText.setPosition(p.x + 89, scaleY + 13);
    this.surfaceDebugMirrorText.setPosition(this.surfaceDebugMirrorBtn.x + 22, scaleY + 13);

    // Сдвиг спрайта: 4 маленькие стрелки, y+265.
    const offY = p.y + 265;
    this.surfaceDebugOffsetLabelText.setPosition(p.x + 12, offY + 13);
    const arrowW = 26;
    this.surfaceDebugOffsetLeftBtn = { x: p.x + 80, y: offY, w: arrowW, h: 26 };
    this.surfaceDebugOffsetUpBtn = { x: p.x + 80 + arrowW + 4, y: offY, w: arrowW, h: 26 };
    this.surfaceDebugOffsetDownBtn = { x: p.x + 80 + (arrowW + 4) * 2, y: offY, w: arrowW, h: 26 };
    this.surfaceDebugOffsetRightBtn = { x: p.x + 80 + (arrowW + 4) * 3, y: offY, w: arrowW, h: 26 };
    this.surfaceDebugOffsetLeftText.setPosition(this.surfaceDebugOffsetLeftBtn.x + arrowW / 2, offY + 13);
    this.surfaceDebugOffsetUpText.setPosition(this.surfaceDebugOffsetUpBtn.x + arrowW / 2, offY + 13);
    this.surfaceDebugOffsetDownText.setPosition(this.surfaceDebugOffsetDownBtn.x + arrowW / 2, offY + 13);
    this.surfaceDebugOffsetRightText.setPosition(this.surfaceDebugOffsetRightBtn.x + arrowW / 2, offY + 13);

    // Состояние предмета: ровно/завал/сломан — три кнопки в ряд, y+299.
    const stateY = p.y + 299, stateW = (p.w - 24 - 16) / 3;
    this.surfaceDebugStateFlatBtn = { x: p.x + 12, y: stateY, w: stateW, h: 30 };
    this.surfaceDebugStateTipBtn = { x: p.x + 12 + stateW + 8, y: stateY, w: stateW, h: 30 };
    this.surfaceDebugStateBrokenBtn = { x: p.x + 12 + (stateW + 8) * 2, y: stateY, w: stateW, h: 30 };
    this.surfaceDebugStateFlatText.setPosition(this.surfaceDebugStateFlatBtn.x + stateW / 2, stateY + 15);
    this.surfaceDebugStateTipText.setPosition(this.surfaceDebugStateTipBtn.x + stateW / 2, stateY + 15);
    this.surfaceDebugStateBrokenText.setPosition(this.surfaceDebugStateBrokenBtn.x + stateW / 2, stateY + 15);
  }

  setSurfaceDebugUiVisible(visible) {
    this.surfaceDebugGfx.setVisible(visible);
    this.surfaceDebugLabels.forEach(label => label.setVisible(visible));
    [
      this.surfaceDebugTitle, this.surfaceDebugInfo, this.surfaceDebugHint,
      this.surfaceDebugSaveText, this.surfaceDebugResetText, this.surfaceDebugExportText,
      this.surfaceDebugCloseText
    ].forEach(node => node.setVisible(visible));
    // Строка скорости/спрайта/состояния видна только пока панель открыта И
    // выбран подходящий target — второе условие пересчитывает
    // redrawSurfaceDebug, тут только гарантированно прячем на закрытии.
    if (!visible) {
      [
        this.surfaceDebugSlipperyText,
        this.surfaceDebugSpeedText, this.surfaceDebugSpeedMinusText, this.surfaceDebugSpeedPlusText,
        this.surfaceDebugScaleText, this.surfaceDebugScaleMinusText, this.surfaceDebugScalePlusText,
        this.surfaceDebugMirrorText, this.surfaceDebugOffsetLabelText,
        this.surfaceDebugOffsetLeftText, this.surfaceDebugOffsetRightText,
        this.surfaceDebugOffsetUpText, this.surfaceDebugOffsetDownText,
        this.surfaceDebugStateFlatText, this.surfaceDebugStateTipText, this.surfaceDebugStateBrokenText
      ].forEach(node => node.setVisible(false));
    }
  }

  // «Испечь» base-файл + localStorage этой сессии (dumpSurfaceGeometry) в
  // буфер обмена/консоль — вставить результат в
  // src/config/surfaceGeometryData.json и закоммитить, тогда правки увидят
  // ВСЕ игроки после деплоя, а не только этот браузер. delayedCall, а не
  // percent-флеш от времени — та же схема, что у Save чуть выше
  // (surfaceDebugPointerDown): redrawSurfaceDebug зовётся только по
  // событиям, не каждый кадр, поэтому «плавное» затухание по времени тут
  // само не перерисуется — нужен явный второй вызов через таймер.
  exportSurfaceDebug() {
    const json = JSON.stringify(dumpSurfaceGeometry(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).catch(() => {});
    }
    console.log('[surfaceGeometry] Вставьте в src/config/surfaceGeometryData.json и закоммитьте — правки увидят все игроки:\n' + json);
    this.surfaceDebugExportText.setText('Скопировано ✓ (см. консоль)').setColor('#EBF5DE');
    this.time.delayedCall(900, () => {
      this.surfaceDebugExportText.setText('Экспорт → surfaceGeometryData.json').setColor('#BEB2C4');
    });
  }

  openSurfaceDebug() {
    // canAct() уже включает 'hang' (кот висит на люстре/окне) — раньше тут
    // было отдельное исключение специально ДЛЯ hang, из-за него 5 тапов по
    // шапке не открывали отладчик именно в тот момент, когда он нужнее
    // всего — чтобы подвинуть саму точку зацепа, глядя на кота на ней.
    if (this.surfaceDebugMode || !this.canAct()) return;
    this.surfaceDebugMode = true;
    this.surfaceDebugPreviousState = this.state === 'hang' ? 'hang' : (this.standingOn ? 'landed' : 'idle');
    this.state = 'debug';
    this.tweens.killTweensOf(this.cat);
    this.cat.setVelocity(0, 0);
    this.cat.body.allowGravity = false;
    this.surfaceDebugTargets.forEach(target => {
      if (target.kind === 'point') {
        target.savedPoint = { ...target.point };
      } else {
        target.savedSurface = { ...target.surface };
      }
      if (target.spriteGeo) target.savedSpriteGeo = { ...target.spriteGeo };
      target.dirty = false;
    });
    this.setSurfaceDebugUiVisible(true);
    this.redrawSurfaceDebug();
  }

  closeSurfaceDebug() {
    if (!this.surfaceDebugMode) return;
    // Как в отладке основной комнаты: закрытие не коммитит live-правку.
    this.surfaceDebugTargets.forEach(target => {
      if (!target.dirty) return;
      if (target.spriteGeo && target.savedSpriteGeo) {
        target.spriteGeo = { ...target.savedSpriteGeo };
        if (target.item && target.item.spriteStates) target.item.spriteStates[target.stateKey] = target.spriteGeo;
      }
      if (target.kind === 'point') {
        if (!target.savedPoint) return;
        target.point.x = target.savedPoint.x;
        target.point.y = target.savedPoint.y;
      } else {
        if (!target.savedSurface) return;
        target.surface = { ...target.savedSurface };
        if (target.item && target.item.surfaceStates) target.item.surfaceStates[target.stateKey] = target.surface;
      }
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
      const selected = target === this.surfaceDebugSelected;
      const panel = this.surfaceDebugPanel;

      if (target.kind === 'point') {
        const { x, y } = target.point;
        g.fillStyle(selected ? 0x72E3F2 : 0xF0B44E, selected ? 1 : 0.85);
        g.fillCircle(x, y, selected ? 8 : 6);
        g.lineStyle(1.4, 0xFFFFFF, 0.9);
        g.strokeCircle(x, y, selected ? 8 : 6);
        const labelX = x + 10, labelY = y - 10;
        const hiddenByPanel = labelX >= panel.x - 4 && labelX <= panel.x + panel.w + 4 &&
          labelY >= panel.y - 4 && labelY <= panel.y + panel.h + 4;
        this.surfaceDebugLabels[index]
          .setPosition(labelX, labelY)
          .setColor(selected ? '#9CF5FF' : '#FFE3A3')
          .setVisible(!hiddenByPanel);
        return;
      }

      // line.y1/y2, не плоский line.y — иначе наклонная линия рисовалась
      // бы горизонтальной в отладчике (та же ошибка, что и с заваливаемым
      // столом: то, что видно в отладке, обязано совпадать с тем, что
      // реально под лапами).
      const line = this.surfaceLine(target);
      // Наклонная линия со включённым «скользкое» — отдельный (красный)
      // цвет, всегда, даже выбранная: предупреждение «кот тут поедет
      // сам» не должно теряться под обычной подсветкой выбора.
      const tilted = line.y1 !== line.y2;
      const isSlippery = !!(target.surface && target.surface.slippery);
      const slipperyColor = 0xE8534F;
      const color = (tilted && isSlippery) ? slipperyColor : (selected ? 0x72E3F2 : 0xF0B44E);
      g.lineStyle(selected ? 3 : (tilted && isSlippery ? 2.4 : 2), color, selected ? 1 : 0.85);
      g.lineBetween(line.x1, line.y1, line.x2, line.y2);
      if (selected) {
        g.fillStyle(tilted && isSlippery ? slipperyColor : 0x72E3F2, 1);
        g.fillCircle(line.x1, line.y1, 6);
        g.fillCircle(line.x2, line.y2, 6);
        g.fillStyle(0xF0B44E, 1);
        g.fillCircle((line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2, 5);
      }
      const labelX = line.x1 + 2;
      const labelY = Math.min(line.y1, line.y2) - 17;
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
    drawButton(this.surfaceDebugExportBtn, 0x8D8195, 0.08);

    const tippableSelected = !!(selected && selected.item && selected.item.tippable);
    // «Скользкое» — чекбокс у любой линии (не точки, не зоны хозяина):
    // включает пассивное сползание само по себе, не только у tippable в
    // заваленном виде (см. slidingTarget). Зона хозяина не участвует —
    // кот на ней не «стоит» в игровом смысле, скользить там нечему.
    const slipperySelected = !!(selected && selected.kind !== 'point' && selected.item && !selected.isOwnerZone);
    this.surfaceDebugSlipperyText.setVisible(slipperySelected);
    if (slipperySelected) {
      const on = !!selected.surface.slippery;
      drawButton(this.surfaceDebugSlipperyBtn, on ? 0xF0B44E : 0x8D8195, on ? 0.2 : 0.08);
      this.surfaceDebugSlipperyText.setText((on ? '☑ ' : '☐ ') + 'Скользкое');
    }

    // Скорость сползания — у tippable-предметов (там сползание включается
    // автоматом при завале) И у любой линии с галкой «скользкое» выше —
    // у остальных наклон не сползает, регулировать нечего.
    const speedRelevant = tippableSelected || (slipperySelected && selected.surface.slippery);
    [this.surfaceDebugSpeedText, this.surfaceDebugSpeedMinusText, this.surfaceDebugSpeedPlusText]
      .forEach(node => node.setVisible(speedRelevant));
    if (speedRelevant) {
      drawButton(this.surfaceDebugSpeedMinusBtn, 0x8D8195, 0.08);
      drawButton(this.surfaceDebugSpeedPlusBtn, 0x8D8195, 0.08);
      const speed = Math.round(selected.surface.slideSpeed ?? BALANCE.TIP_SLIDE_SPEED_DEFAULT);
      this.surfaceDebugSpeedText.setText(`Сползание: ${speed} px/с`);
    }

    // Спрайт (масштаб/зеркало/сдвиг) — у любого target с картинкой: мебель
    // (target.image) или люстра (target.point.wobble). У окна своей
    // картинки нет — секция скрыта, регулировать нечего.
    const spriteImg = selected && (selected.image || (selected.point && selected.point.wobble));
    [
      this.surfaceDebugScaleText, this.surfaceDebugScaleMinusText, this.surfaceDebugScalePlusText,
      this.surfaceDebugMirrorText, this.surfaceDebugOffsetLabelText,
      this.surfaceDebugOffsetLeftText, this.surfaceDebugOffsetRightText,
      this.surfaceDebugOffsetUpText, this.surfaceDebugOffsetDownText
    ].forEach(node => node.setVisible(!!spriteImg));
    if (spriteImg) {
      drawButton(this.surfaceDebugScaleMinusBtn, 0x8D8195, 0.08);
      drawButton(this.surfaceDebugScalePlusBtn, 0x8D8195, 0.08);
      drawButton(this.surfaceDebugMirrorBtn, selected.spriteGeo.mirror ? 0xF0B44E : 0x8D8195, selected.spriteGeo.mirror ? 0.25 : 0.08);
      this.surfaceDebugScaleText.setText(`${Math.round(selected.spriteGeo.scaleMul * 100)}%`);
      this.surfaceDebugMirrorText.setColor(selected.spriteGeo.mirror ? '#F0B44E' : '#F5EDEF');
      [
        this.surfaceDebugOffsetLeftBtn, this.surfaceDebugOffsetRightBtn,
        this.surfaceDebugOffsetUpBtn, this.surfaceDebugOffsetDownBtn
      ].forEach(rect => drawButton(rect, 0x8D8195, 0.08));
    }

    // Состояние предмета — только у item.tippable (ровно/завал/сломан,
    // см. запрос: «сломан» пока без арта, просто флаг на будущее).
    [this.surfaceDebugStateFlatText, this.surfaceDebugStateTipText, this.surfaceDebugStateBrokenText]
      .forEach(node => node.setVisible(tippableSelected));
    if (tippableSelected) {
      const item = selected.item;
      const isFlat = !item.tipState && !item.brokenState;
      const isTipped = !!item.tipState;
      const isBroken = !!item.brokenState;
      drawButton(this.surfaceDebugStateFlatBtn, isFlat ? 0xF0B44E : 0x8D8195, isFlat ? 0.25 : 0.08);
      drawButton(this.surfaceDebugStateTipBtn, isTipped ? 0xF0B44E : 0x8D8195, isTipped ? 0.25 : 0.08);
      drawButton(this.surfaceDebugStateBrokenBtn, isBroken ? 0xF0B44E : 0x8D8195, isBroken ? 0.25 : 0.08);
      this.surfaceDebugStateFlatText.setColor(isFlat ? '#F0B44E' : '#F5EDEFaa');
      this.surfaceDebugStateTipText.setColor(isTipped ? '#F0B44E' : '#F5EDEFaa');
      this.surfaceDebugStateBrokenText.setColor(isBroken ? '#F0B44E' : '#F5EDEFaa');
    }

    this.surfaceDebugInfo.setText(selected
      ? (selected.kind === 'point'
          ? `${selected.label}: x ${Math.round(selected.point.x)}  y ${Math.round(selected.point.y)}`
          : `${selected.label}: y ${Math.round(selected.surface.inset)}  ` +
            `x ${Math.round(selected.surface.left)}…${Math.round(selected.surface.right)}` +
            ((selected.surface.tiltLeft || selected.surface.tiltRight)
              ? `  накл ${Math.round(selected.surface.tiltLeft || 0)}/${Math.round(selected.surface.tiltRight || 0)}`
              : ''))
      : 'Тапни по линии/точке');
    this.surfaceDebugSaveText.setColor(dirty ? '#FFD071' : '#8D8195');
  }

  surfaceDebugHitTarget(x, y) {
    let best = null;
    let bestDistance = Infinity;
    this.surfaceDebugTargets.forEach(target => {
      let distance;
      if (target.kind === 'point') {
        distance = Math.hypot(x - target.point.x, y - target.point.y);
      } else {
        // Расстояние до ОТРЕЗКА (а не до горизонтали через line.y) — на
        // наклонной линии иначе тап по приподнятому краю мимо неё же
        // и пролетал бы.
        const line = this.surfaceLine(target);
        distance = distanceToSegment(x, y, line.x1, line.y1, line.x2, line.y2);
      }
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
    if (hitRect(this.surfaceDebugExportBtn)) { this.exportSurfaceDebug(); return; }
    // «Скользкое» — чекбокс у любой линии (не точки, не зоны хозяина).
    const slipperyTarget = this.surfaceDebugSelected;
    const slipperyEditable = slipperyTarget && slipperyTarget.kind !== 'point' &&
      slipperyTarget.item && !slipperyTarget.isOwnerZone;
    if (slipperyEditable && hitRect(this.surfaceDebugSlipperyBtn)) {
      slipperyTarget.surface.slippery = !slipperyTarget.surface.slippery;
      slipperyTarget.dirty = this.computeTargetDirty(slipperyTarget);
      this.applySurfaceTarget(slipperyTarget);
      this.redrawSurfaceDebug();
      return;
    }
    // Скорость сползания — у item.tippable ИЛИ у линии с «скользкое»
    // (см. redrawSurfaceDebug: кнопки скрыты и, значит, некликабельны для
    // остальных, но проверяем ещё раз на всякий случай — hitRect сам по
    // себе про это не знает, это просто прямоугольник в фиксированном
    // месте панели).
    const speedTarget = this.surfaceDebugSelected;
    const speedEditable = speedTarget && speedTarget.item &&
      (speedTarget.item.tippable || speedTarget.surface.slippery);
    if (speedEditable && (hitRect(this.surfaceDebugSpeedMinusBtn) || hitRect(this.surfaceDebugSpeedPlusBtn))) {
      const step = hitRect(this.surfaceDebugSpeedMinusBtn) ? -5 : 5;
      const current = speedTarget.surface.slideSpeed ?? BALANCE.TIP_SLIDE_SPEED_DEFAULT;
      speedTarget.surface.slideSpeed = Phaser.Math.Clamp(current + step, 0, 80);
      speedTarget.dirty = this.computeTargetDirty(speedTarget);
      this.applySurfaceTarget(speedTarget);
      this.redrawSurfaceDebug();
      return;
    }
    // Спрайт: масштаб/зеркало/сдвиг — доступны у любого target с картинкой
    // (см. redrawSurfaceDebug: spriteImg), не только у tippable.
    const spriteTarget = this.surfaceDebugSelected;
    const spriteEditable = spriteTarget && (spriteTarget.image || (spriteTarget.point && spriteTarget.point.wobble));
    if (spriteEditable) {
      const geo = spriteTarget.spriteGeo;
      let touched = true;
      if (hitRect(this.surfaceDebugScaleMinusBtn) || hitRect(this.surfaceDebugScalePlusBtn)) {
        const step = hitRect(this.surfaceDebugScaleMinusBtn) ? -0.1 : 0.1;
        geo.scaleMul = Phaser.Math.Clamp(Math.round((geo.scaleMul + step) * 10) / 10, 0.3, 3);
      } else if (hitRect(this.surfaceDebugMirrorBtn)) {
        geo.mirror = !geo.mirror;
      } else if (hitRect(this.surfaceDebugOffsetLeftBtn)) { geo.offsetX -= 4; }
      else if (hitRect(this.surfaceDebugOffsetRightBtn)) { geo.offsetX += 4; }
      else if (hitRect(this.surfaceDebugOffsetUpBtn)) { geo.offsetY -= 4; }
      else if (hitRect(this.surfaceDebugOffsetDownBtn)) { geo.offsetY += 4; }
      else { touched = false; }
      if (touched) {
        spriteTarget.dirty = this.computeTargetDirty(spriteTarget);
        this.applySurfaceTarget(spriteTarget);
        this.redrawSurfaceDebug();
        return;
      }
    }
    // Состояние предмета: ровно/завал/сломан — только у item.tippable.
    // «Ровно»/«Завал» дёргают тот же triggerTip, что и настоящие
    // приземления в игре (см. land()) — отладчик не обходит игровую
    // логику переворота, а просто вызывает её напрямую. «Сломан» — пока
    // только флаг (item.brokenState), своего визуала/физики ещё нет.
    const stateTarget = this.surfaceDebugSelected;
    const stateEditable = stateTarget && stateTarget.item && stateTarget.item.tippable;
    if (stateEditable) {
      const item = stateTarget.item;
      if (hitRect(this.surfaceDebugStateFlatBtn)) {
        item.brokenState = false;
        if (item.tipState) this.triggerTip(item, 0);
        this.redrawSurfaceDebug();
        return;
      }
      if (hitRect(this.surfaceDebugStateTipBtn)) {
        item.brokenState = false;
        if (!item.tipState) this.triggerTip(item, item.tipPivotSide || -1);
        this.redrawSurfaceDebug();
        return;
      }
      if (hitRect(this.surfaceDebugStateBrokenBtn)) {
        item.brokenState = !item.brokenState;
        this.syncTargetToItemState(item); // раньше не трогали surface/spriteGeo вообще — «Сломан» ничего не менял
        this.redrawSurfaceDebug();
        return;
      }
    }
    if (hitRect(this.surfaceDebugSaveBtn)) {
      const target = this.surfaceDebugSelected;
      if (target && target.dirty) {
        // У tippable — сохраняем под id ТЕКУЩЕГО состояния (flat/tipped/
        // broken, см. stateStorageId), не голый target.id: иначе правка
        // одного состояния перезаписывала бы файл остальных.
        const stateId = target.item && target.item.tippable
          ? stateStorageId(target.id, target.stateKey) : target.id;
        if (target.kind === 'point') {
          // Сохраняем СМЕЩЕНИЕ (dx/dy), не весь point — тот же объект,
          // на который смотрит this.hangPoints (grabHang и т.п.), нельзя
          // подменять новым: раньше здесь было `target.point =
          // saveHangPoint(...)`, которое заменяло point на голый {x,y}
          // без wobble/fish/lines — точка переставала быть привязана к
          // картинке люстры сразу после Save.
          saveHangPoint(target.id, { dx: target.point.dx, dy: target.point.dy });
          target.savedPoint = { ...target.point };
        } else {
          target.surface = saveSurfaceGeometry(stateId, target.surface);
          target.savedSurface = { ...target.surface };
          // Слепок пишем обратно в item.surfaceStates — target.surface
          // теперь НОВЫЙ объект (saveSurfaceGeometry его создаёт), а
          // triggerTip/syncTargetToItemState берут геометрию состояния
          // оттуда, не глядя на текущий target.surface.
          if (target.item && target.item.surfaceStates) {
            target.item.surfaceStates[target.stateKey] = target.surface;
          }
        }
        if (target.spriteGeo) {
          target.spriteGeo = saveSpriteGeometry('sprite:' + stateId, target.spriteGeo);
          target.savedSpriteGeo = { ...target.spriteGeo };
          if (target.item && target.item.spriteStates) {
            target.item.spriteStates[target.stateKey] = target.spriteGeo;
          }
        }
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
        if (target.kind === 'point') {
          target.point.x = target.defaults.x;
          target.point.y = target.defaults.y;
          target.point.dx = 0;
          target.point.dy = 0;
        } else {
          target.surface = { ...target.defaults };
          if (target.item && target.item.surfaceStates) {
            target.item.surfaceStates[target.stateKey] = target.surface;
          }
        }
        if (target.spriteGeo) {
          target.spriteGeo = { ...target.spriteDefaults };
          if (target.item && target.item.spriteStates) {
            target.item.spriteStates[target.stateKey] = target.spriteGeo;
          }
        }
        target.dirty = this.computeTargetDirty(target);
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
    if (selected && selected.kind === 'point') {
      if (Math.hypot(p.x - selected.point.x, p.y - selected.point.y) < 16) {
        this.surfaceDebugDrag = { kind: 'point', target: selected };
        return;
      }
    } else if (selected) {
      // Хэндлы у краёв — на РЕАЛЬНЫХ (возможно, уже наклонённых) концах
      // линии, не на плоской line.y: иначе на наклонной линии хэндл
      // окажется не под пальцем, а там, где был бы без наклона.
      const line = this.surfaceLine(selected);
      if (Math.hypot(p.x - line.x1, p.y - line.y1) < 13) {
        this.surfaceDebugDrag = { kind: 'left', target: selected };
        return;
      }
      if (Math.hypot(p.x - line.x2, p.y - line.y2) < 13) {
        this.surfaceDebugDrag = { kind: 'right', target: selected };
        return;
      }
    }

    const target = this.surfaceDebugHitTarget(p.x, p.y);
    if (target) {
      this.surfaceDebugSelected = target;
      this.surfaceDebugDrag = { kind: target.kind === 'point' ? 'point' : 'vertical', target };
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

    if (drag.kind === 'point') {
      target.point.x = Phaser.Math.Clamp(Math.round(p.x), 0, FIELD.w);
      target.point.y = Phaser.Math.Clamp(Math.round(p.y), CEILING_Y, FIELD.h);
      // dx/dy — смещение от процедурного дефолта ЭТОГО захода, именно его
      // (не абсолютные x/y) сохраняет Save, см. registerHangPoint.
      target.point.dx = target.point.x - target.defaults.x;
      target.point.dy = target.point.y - target.defaults.y;
      target.dirty = this.computeTargetDirty(target);
      this.applySurfaceTarget(target);
      this.redrawSurfaceDebug();
      return;
    }

    if (drag.kind === 'vertical') {
      // Тащим середину линии — обе высоты сдвигаются одинаково, наклон
      // (разница между ними) сохраняется как есть.
      const newInset = Math.round(Phaser.Math.Clamp(
        p.y - target.visualTop, -30, target.size.h + 30
      ));
      target.surface.inset = newInset;
    } else {
      const relativeX = Math.round(p.x - target.centerX);
      // Наклон — тянем КОНКРЕТНЫЙ край не только вбок (длина), но и вверх/
      // вниз: высота этого края относительно общего inset — то же самое
      // «абсолютно от пальца», что и у 'vertical' (двигает inset целиком),
      // просто на один край, а не на всю линию сразу.
      const relY = Math.round(Phaser.Math.Clamp(
        p.y - target.visualTop - target.surface.inset, -120, 120
      ));
      if (drag.kind === 'left') {
        target.surface.left = Phaser.Math.Clamp(
          relativeX, -target.size.w, target.surface.right - 48
        );
        target.surface.tiltLeft = relY;
      } else {
        target.surface.right = Phaser.Math.Clamp(
          relativeX, target.surface.left + 48, target.size.w
        );
        target.surface.tiltRight = relY;
      }
    }
    target.dirty = this.computeTargetDirty(target);
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
        // Реальная (возможно, повёрнутая) линия, не плоские
        // surface.left/right — та же причина, что и в land(): у
        // заваленного предмета они не совпадают с фактическим
        // x-диапазоном, куда кота реально можно отправить идти.
        const walkTarget = this.itemTargets.get(this.standingOn);
        const walkLine = walkTarget && this.surfaceLine(walkTarget);
        if (walkLine && walkLine.y1 !== walkLine.y2) {
          const wMin = Math.min(walkLine.x1, walkLine.x2), wMax = Math.max(walkLine.x1, walkLine.x2);
          const wInset = Math.max(0, Math.min(16, (wMax - wMin) / 2 - 1));
          left = wMin + wInset;
          right = wMax - wInset;
        } else {
          const surface = this.standingOn.surface;
          left  = this.standingOn.x + surface.left + 16;
          right = this.standingOn.x + surface.right - 16;
        }
      } else if (this.floorTarget) {
        // Тот же приём, что и для стоящего на предмете кота, — реальная
        // линия ковра, не плоские floorSurface.left/right (та же жалоба,
        // теперь и про пол: «кот не встаёт на его линию»).
        const floorLine = this.surfaceLine(this.floorTarget);
        left = Math.min(floorLine.x1, floorLine.x2) + 20;
        right = Math.max(floorLine.x1, floorLine.x2) - 20;
      } else {
        left = FIELD.w / 2 + this.floorSurface.left + 20;
        right = FIELD.w / 2 + this.floorSurface.right - 20;
      }
      if (Math.abs(p.y - this.cat.y) < 130) this.walkTo(p.x, left, right);
      else this.settleCatVisual();
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
    // Наклонная линия — статичная (surface.tiltLeft/tiltRight) или живая
    // (item.tippable, завален) — в обоих случаях лапы должны идти по её
    // высоте, а не оставаться на одной y всю дорогу. this.floorTarget —
    // ковёр, когда standingOn нет (кот идёт по полу, не по предмету).
    const walkTarget = this.standingOn ? this.itemTargets.get(this.standingOn) : this.floorTarget;
    const walkLine = walkTarget && this.surfaceLine(walkTarget);
    const walkSloped = !!(walkLine && walkLine.y1 !== walkLine.y2);
    this.tweens.add({
      targets: this.cat, x: tx,
      duration: (d / BALANCE.WALK_SPEED) * 1000,
      ease: 'Sine.easeInOut',
      onUpdate: walkSloped ? () => {
        this.cat.y = this.surfaceYAt(walkTarget, this.cat.x) - this.catSize().h / 2;
      } : undefined,
      onComplete: () => this.settleCatVisual()
    });
  }

  launch(vx, vy, spread) {
    if (this.state === 'hang' || this.catPose === 'cat_hang') this.releaseHang();

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
      this.settleCatVisual(); // та же жалоба — без этого кот зависал в позе прыжка
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
        y: this.floorSurfaceY(sprite.x) - 14,
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
        // Без этого кот оставался «висеть» в позе прыжка/приземления —
        // это state не трогал catVisualState, только логику, см. жалобу.
        this.settleCatVisual();
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

  // Пассивное сползание к нижнему краю наклонной линии — либо заваленного
  // (tippable) предмета, либо любой линии со включённым «скользкое»
  // (surface.slippery, см. slidingTarget) — только пока кот стоит и
  // ничего не тащит его сам (settle-твины в land()/walkTo() сами пишут
  // cat.y через onUpdate, тут им не мешаем; по этой же причине сползание
  // не включается во время активной ходьбы — она тоже твин). Скорость —
  // surface.slideSpeed (px/с), настраивается в отладчике, дефолт —
  // BALANCE.TIP_SLIDE_SPEED_DEFAULT, специально низкий.
  updateTipSlide(delta) {
    const item = this.standingOn;
    if (!(this.state === 'landed' || this.state === 'idle') || this.tweens.isTweening(this.cat)) return;
    const target = this.slidingTarget(item);
    if (!target) return;
    const line = this.surfaceLine(target);
    const lowX = line.y1 > line.y2 ? line.x1 : line.x2; // y больше = физически ниже
    const speed = target.surface.slideSpeed ?? BALANCE.TIP_SLIDE_SPEED_DEFAULT;
    const dist = lowX - this.cat.x;
    if (speed <= 0) {
      if (this.catVisualState === 'sitSlide') this.settleCatVisual();
      return;
    }
    if (Math.abs(dist) <= 2) {
      // Доехал до нижнего края наклонной линии — предмет кончился под
      // лапами, дальше держаться не на чем: соскальзывает и падает, как
      // с любого другого края площадки.
      this.fallOffTip(item);
      return;
    }
    const step = Math.sign(dist) * Math.min(Math.abs(dist), speed * (delta / 1000));
    const newX = this.cat.x + step;
    this.cat.body.reset(newX, this.surfaceYAt(target, newX) - this.catSize().h / 2);
    this.cat.setFlipX(step < 0);
    if (this.catVisualState !== 'sitSlide') this.setCatVisual('sitSlide', true);
  }

  // Соскальзывание с конца наклонной линии — те же шаги, что launch()
  // делает при обычном прыжке-вниз (drop-through на старую площадку, чтобы
  // кот не «прилип» обратно к ней же в следующем кадре), но без прыжка:
  // просто отпускаем под гравитацию с небольшим боковым сносом в сторону
  // сползания.
  fallOffTip(item) {
    const fellFrom = this.standingBody;
    if (fellFrom) {
      this.dropThrough = { body: fellFrom, until: this.time.now + BALANCE.DROP_THROUGH_MS };
    }
    this.standingOn = null;
    this.standingBody = null;
    this.state = 'flying';
    this.cat.body.allowGravity = true;
    this.cat.setVelocity(this.cat.flipX ? -60 : 60, 20);
    this.say('Приехали. Дальше только вниз.');
    if (this.time.now >= this.catVisualLockUntil) this.setCatVisual('fall');
    this.armOwner();
  }

  // ============================================================
  //  ПОЛЁТ
  // ============================================================
  update(time, delta) {
    this.syncCatVisual();
    if (this.bubbleTx.alpha > 0 && this.state !== 'scene') this.placeBubble();
    this.placeThink();
    this.checkPillow();
    this.updateTipSlide(delta);
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

    // --- точка зацепа (люстра/окно) ловит кота в полёте ---
    if (this.time.now > this.hangUntil) {
      const hit = this.hangPoints.find(p =>
        Phaser.Math.Distance.Between(this.cat.x, this.cat.y, p.x, p.y + 16) < p.radius
      );
      if (hit) { this.grabHang(hit); return; }
    }

    const pt = new Phaser.Geom.Point(this.cat.x, this.cat.y);

    if (this.ownerArmed && this.ownerRect &&
        Phaser.Geom.Rectangle.ContainsPoint(this.ownerRect, pt)) {
      this.ownerArmed = false;
      this.land(null, 'hozyain');
      return;
    }
    // this.time.now > this.hangUntil — та же короткая передышка, что и у
    // повторного зацепа за точку (releaseHang её выставляет). Без неё
    // прыжок С САМОГО окна (там же зацеп hang:okno, прямо внутри этого
    // прямоугольника) немедленно ловился этим же hazard'ом — кот падал на
    // пол, толком не оттолкнувшись (жалоба: «после виса на окне кот не
    // может прыгнуть»).
    if (this.time.now > this.hangUntil && Phaser.Geom.Rectangle.ContainsPoint(this.windowRect, pt)) {
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
      const safeX = Phaser.Math.Clamp(this.cat.x, 30, FIELD.w - 30);
      this.cat.body.reset(safeX, this.floorSurfaceY(safeX) - this.catSize().h / 2);
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

    // Счётчики контактов у переворачиваемого предмета — только за
    // «сессию нахождения на НЁМ»: приземление на пол или на ДРУГОЙ
    // предмет сбрасывает прогресс (item — новый target, null у пола и
    // прочих не-platform исходов).
    if (this.standingOn && this.standingOn.tippable && this.standingOn !== item) {
      this.standingOn.tipContacts.left = 0;
      this.standingOn.tipContacts.right = 0;
    }

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
      this.cat.body.reset(this.cat.x, this.floorSurfaceY(this.cat.x) - this.catSize().h / 2);
      const slideTo = Phaser.Math.Clamp(this.cat.x + vx * BALANCE.SLIDE_FACTOR, 30, FIELD.w - 30);
      this.tweens.add({
        targets: this.cat, x: slideTo, duration: BALANCE.SLIDE_MS, ease: 'Cubic.easeOut',
        onUpdate: () => { this.cat.y = this.floorSurfaceY(this.cat.x) - this.catSize().h / 2; }
      });
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
        const settleX = Phaser.Math.Clamp(this.cat.x, 40, FIELD.w - 40);
        this.cat.body.reset(settleX, this.floorSurfaceY(settleX) - this.catSize().h / 2);
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

    // Переворачиваемость (item.tippable, см. BALANCE.TIP_*, config/
    // level.js). Приземление у самого края линии (TIP_END_RADIUS) —
    // «контакт» в счётчик ЭТОЙ стороны, но только пока она — верхняя
    // (не опущенная): контакт с уже опущенным краем ничего не делает,
    // выравнивает только противоположный, поднятый. Три подряд (без сброса
    // на другой предмет/пол, см. начало land()) — triggerTip.
    // tipReaction — уже сказана либо реплика-предвестник (1-й/2-й контакт,
    // TIP_HINTS), либо реплика самого triggerTip (3-й, настоящий завал) —
    // в обоих случаях обычная реплика приземления (в конце land()) молчит,
    // чтобы не перекрыть её сразу же.
    let tipReaction = false;
    const tipTarget = item.tippable ? this.itemTargets.get(item) : null;
    if (tipTarget) {
      const line = this.surfaceLine(tipTarget);
      const nearLeft = Math.abs(this.cat.x - line.x1) <= BALANCE.TIP_END_RADIUS;
      const nearRight = Math.abs(this.cat.x - line.x2) <= BALANCE.TIP_END_RADIUS;
      if (nearLeft && item.tipState !== -1) {
        item.tipContacts.left++;
        if (item.tipContacts.left >= BALANCE.TIP_CONTACTS_REQUIRED) {
          this.triggerTip(item, item.tipState === 0 ? -1 : 0);
        } else {
          this.say(pick(TIP_HINTS[item.tipContacts.left - 1] || TIP_HINTS[TIP_HINTS.length - 1]));
        }
        tipReaction = true;
      } else if (nearRight && item.tipState !== 1) {
        item.tipContacts.right++;
        if (item.tipContacts.right >= BALANCE.TIP_CONTACTS_REQUIRED) {
          this.triggerTip(item, item.tipState === 0 ? 1 : 0);
        } else {
          this.say(pick(TIP_HINTS[item.tipContacts.right - 1] || TIP_HINTS[TIP_HINTS.length - 1]));
        }
        tipReaction = true;
      }
    }

    // Ставим лапы ровно на поверхность. Наклонная линия — не только у
    // заваленного tippable-предмета, но и у ЛЮБОГО со статичным наклоном
    // (surface.tiltLeft/tiltRight, см. surfaceGeometry.js — настраивается
    // в отладчике перетаскиванием края линии по вертикали): на ней лапы
    // становятся на высоту ровно под собой, не на среднюю высоту физ.тела
    // (AABB-коллайдер у Arcade Physics плоский всегда, наклон — поверх
    // него, см. surfaceLine). По горизонтали кот остаётся там, куда
    // попал — это не «магнит», а только выравнивание по высоте.
    const slopeTarget = this.itemTargets.get(item);
    const slopeLine = slopeTarget && this.surfaceLine(slopeTarget);
    const sloped = !!(slopeLine && slopeLine.y1 !== slopeLine.y2);
    const topY = sloped
      ? this.surfaceYAt(slopeTarget, this.cat.x)
      : (body ? body.body.top : (item.y - sizeOf(item.id).h / 2));
    this.cat.body.reset(this.cat.x, topY - this.catSize().h / 2);

    // Границы слайда после приземления — тоже по РЕАЛЬНОЙ (возможно,
    // повёрнутой) линии, не по «плоским» item.surface.left/right: у
    // сильно заваленного предмета повёрнутый x-диапазон линии заметно
    // отличается от исходного, и клэмп по старым границам отбрасывал кота
    // к их краю — это и был баг «кидает в начало линии» при приземлении.
    const cs = this.catSize();
    const boundsMinX = sloped ? Math.min(slopeLine.x1, slopeLine.x2) : (item.x + item.surface.left);
    const boundsMaxX = sloped ? Math.max(slopeLine.x1, slopeLine.x2) : (item.x + item.surface.right);
    // У сильно повёрнутой линии (большой угол) горизонтальная проекция
    // сжимается — фиксированный отступ cs.w*0.35 с обеих сторон мог
    // сделать left > right, и Phaser.Math.Clamp(x, left, right) при
    // min > max всегда возвращает min — кота гарантированно кидало к
    // ближнему краю (та самая жалоба, второй раз: первого исправления
    // границ по повёрнутой линии оказалось мало, нужен ещё зажим отступа).
    const boundsWidth = Math.max(1, boundsMaxX - boundsMinX);
    const inset = Math.max(0, Math.min(cs.w * 0.35, boundsWidth / 2 - 1));
    const left  = boundsMinX + inset;
    const right = boundsMaxX - inset;
    const slideTo = Phaser.Math.Clamp(this.cat.x + vx * BALANCE.SLIDE_FACTOR, left, right);
    this.tweens.add({
      targets: this.cat, x: slideTo, duration: BALANCE.SLIDE_MS, ease: 'Cubic.easeOut',
      onUpdate: sloped ? () => {
        this.cat.y = this.surfaceYAt(slopeTarget, this.cat.x) - this.catSize().h / 2;
      } : undefined
    });
    this.time.delayedCall(150, () => this.setCatVisual('slide'));
    this.time.delayedCall(BALANCE.SLIDE_MS + 170, () => {
      if (this.state !== 'flying' && this.state !== 'scene') this.settleCatVisual();
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

    // Обычная реплика приземления молчит, если уже сказан предвестник
    // завала или реплика самого triggerTip (tipReaction) — иначе бы её
    // тут же перекрыло.
    if (!tipReaction) this.say(pick(item.lines));
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
    Math.round(a.right) === Math.round(b.right) &&
    Math.round(a.tiltLeft || 0) === Math.round(b.tiltLeft || 0) &&
    Math.round(a.tiltRight || 0) === Math.round(b.tiltRight || 0) &&
    !!a.slippery === !!b.slippery &&
    Math.round(a.slideSpeed ?? -1) === Math.round(b.slideSpeed ?? -1);
}

function samePoint(a, b) {
  return !!a && !!b && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
}

function sameSpriteGeo(a, b) {
  return !!a && !!b &&
    Math.round(a.scaleMul * 100) === Math.round(b.scaleMul * 100) &&
    !!a.mirror === !!b.mirror &&
    Math.round(a.offsetX) === Math.round(b.offsetX) &&
    Math.round(a.offsetY) === Math.round(b.offsetY);
}

// Расстояние от точки (px,py) до отрезка (x1,y1)-(x2,y2) — попадание по
// наклонной линии в отладчике (surfaceDebugHitTarget): расстояние по
// вертикали до горизонтали через line.y тут не годится, линия реально
// под углом.
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Phaser.Math.Clamp(t, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function itemLabel(id) {
  return ({
    tumba: 'Тумбочка', krovat: 'Кровать', komod: 'Комод',
    stol: 'Стол', shkaf: 'Шкаф', akvarium: 'Аквариум'
  })[id] || id;
}

// Состояние item.tippable сейчас: 'flat' (ровно) | 'tipped' (завален,
// item.tipState -1/1 — сторона, для параметров линии/спрайта не важна,
// см. LevelScene.triggerTip) | 'broken' (сломан, item.brokenState —
// своего арта пока нет, задел на будущее).
function stateKeyOf(item) {
  if (item.brokenState) return 'broken';
  if (item.tipState) return 'tipped';
  return 'flat';
}

// id в общем хранилище геометрии (surfaceGeometry.js) для конкретного
// состояния предмета — 'flat' использует голый id (обратная совместимость
// с уже сохранёнными правками до этой фичи), остальные — с суффиксом.
function stateStorageId(itemId, stateKey) {
  return stateKey === 'flat' ? itemId : itemId + ':' + stateKey;
}
