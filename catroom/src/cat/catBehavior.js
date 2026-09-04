/* ============================================================================
   cat/catBehavior.js — состояния и поведение кота: тайминги/вероятности
   берутся из behavior активного персонажа (Cats/<Имя>/config.json), не
   константы в коде — чтобы завести другого кота с другим темпераментом,
   меняется этот JSON, а не JS.
   ========================================================================== */
(function (root) {
  'use strict';

  const D = root.GAMEDATA, I = root.ISO;
  const { clamp, rnd, pick, inPoly } = root.GUTIL;

  // Бакеты экранного направления движения для 8-directional sprites.walk
  // (см. Cats/Labra/config.json) — по углу вектора (sdx, sdy), где sdx/sdy
  // это та же проекция мировой (dx,dy) в экранные оси, что и в I.P()
  // (screenX = (x-y)*TW, screenY = (x+y)*TH): 0° = экранное «вправо»,
  // 90° = «вниз»/к камере, совпадает с существующим sdx-флипом (dir=+1 при
  // sdx>0, т.е. angle≈0). Персонажей со старым (плоским массивом) sprites.walk
  // это не касается — они это поле не читают.
  const DIR8 = ['right', 'downright', 'down', 'downleft', 'left', 'upleft', 'up', 'upright'];

  root.MIXIN_CAT_BEHAVIOR = {

    // playSegment сбрасывается тут по умолчанию на КАЖДЫЙ переход состояния —
    // playHand()/feedHand() выставляют его сами СРАЗУ ПОСЛЕ вызова setSt (не
    // до), иначе обычное кормление из миски/пола (feedBowl/feedFloor тоже
    // зовут setSt('eat'/'dig',...)) унаследовало бы чужую покадровую
    // анимацию «с руки» от предыдущего раза.
    setSt(st, t, after) {
      this.cat.st = st; this.cat.t = t; this.cat.after = after || null;
      this.cat.stateElapsedMs = 0; this.cat.playSegment = null;
    },
    bubble(txt, dur) { this.cat.bubble = txt; this.cat.bt = dur || 3.2; },

    walkTo(x, y, after) {
      const p = I.findPath(this.NAV, this.cat.x, this.cat.y, x, y);
      if (!p.length) { this.setSt('idle', 1.2, after); return; }
      this.cat.path = p; this.setSt('walk', 99, after);
    },
    idleCycle() {
      const B = this.activeCatConfig().behavior;
      this.setSt('idle', rnd(B.idleMinS, B.idleMaxS), () => this.decideNext());
    },
    decideNext() {
      const B = this.activeCatConfig().behavior;
      const r = Math.random();
      if (r < B.wanderChance) this.wander();
      else if (r < B.wanderChance + B.sitChance) this.setSt('sit', rnd(B.sitMinS, B.sitMaxS), () => this.afterRest());
      else this.setSt('lie', rnd(B.lieMinS, B.lieMaxS), () => this.afterRest());
    },
    afterRest() {
      const B = this.activeCatConfig().behavior;
      if (Math.random() < B.restWanderChance) this.wander(); else this.idleCycle();
    },
    wander() {
      const s = I.randomSpot(this.NAV, this.cat, 1.2);
      if (!s) { this.setSt('idle', 2, () => this.idleCycle()); return; }
      this.walkTo(s[0], s[1], () => this.idleCycle());
    },
    // Игрушка — если у персонажа есть покадровая анимация (playToy1/playToy2,
    // сейчас только у сиамского): первое взаимодействие — playToy1, второе В
    // ТЕЧЕНИЕ 5 СЕКУНД после первого — playToy2, дальше по кругу третье уже
    // снова считается «первым» (5с успели истечь). У персонажа без такого
    // арта (рыжий) — как раньше, статичная поза с подскоком, 1.6с.
    playHand() {
      const sprites = this.activeCatConfig().sprites;
      const now = performance.now();
      const withinWindow = now - this.cat.lastPlayAt < 5000;
      const seg = withinWindow && sprites.playToy2 ? 'playToy2' : (sprites.playToy1 ? 'playToy1' : null);
      this.cat.lastPlayAt = now;
      const anim = seg && sprites[seg];
      const dur = anim ? (anim.count * anim.frameMs) / 1000 : 1.6;
      this.cat.path = []; this.cat.jump = 3;
      this.setSt('jump', dur, () => {
        this.bubble(pick(D.SAY.toy)); this.mood = clamp(this.mood + 5, 0, 100);
        this.uiDirty = true; this.idleCycle();
      });
      this.cat.playSegment = seg; // после setSt — она сама сбрасывает playSegment в null
    },
    // Прямой тап по коту (не через донесённую игрушку) — отдельная анимация
    // (playIdle, кадры 1-38 исходного GIF), не playToy1/playToy2: это разные
    // ситуации — там «поиграли игрушкой», тут просто погладили/тронули.
    // lastPlayAt/окно 5с игрушки этот тап не трогает и не сбрасывает.
    petCat() {
      const anim = this.activeCatConfig().sprites.playIdle;
      const dur = anim ? (anim.count * anim.frameMs) / 1000 : 1.6;
      this.cat.path = []; this.cat.jump = 3;
      this.setSt('jump', dur, () => {
        this.bubble(pick(D.SAY.toy)); this.mood = clamp(this.mood + 5, 0, 100);
        this.uiDirty = true; this.idleCycle();
      });
      this.cat.playSegment = anim ? 'playIdle' : null;
    },
    // Корм/игрушка из «Запасов» — перенос drag'а из исходного app.js: берём в
    // руку (onDown уже завёл this.drag={kind:'supply',...}), тащим, и то, КУДА
    // донесли, решает, что произойдёт (см. resolveSupplyDrop, вызывается из
    // onUp). Одним тапом больше ничего не срабатывает.
    // Кормление «с руки» (еду донесли до кота, не до миски/пола) — если у
    // персонажа есть покадровая анимация (playFed, сейчас только у
    // сиамского), играем её; иначе как раньше — статичная поза с покачиванием.
    // feedBowl/feedFloor намеренно этим не пользуются: там кот ест из миски
    // или закапывает на полу, не «с руки» — своя, отдельная от play-арта
    // ситуация, даже когда она тоже заканчивается состоянием 'eat'/'dig'.
    feedHand() {
      const anim = this.activeCatConfig().sprites.playFed;
      const dur = anim ? (anim.count * anim.frameMs) / 1000 : 1.8;
      this.cat.path = [];
      this.bubble(pick(D.SAY.hand));
      this.setSt('eat', dur, () => {
        this.mood = clamp(this.mood + 8, 0, 100); this.uiDirty = true; this.idleCycle();
      });
      this.cat.playSegment = anim ? 'playFed' : null;
    },
    feedFloor(x, y) {
      this.bubble(pick(D.SAY.floor));
      const sp = I.nearSpot(this.NAV, x, y);
      this.walkTo(sp[0], sp[1], () => {
        this.setSt('dig', 2.2, () => {
          this.bubble(pick(D.SAY.buried));
          this.mood = clamp(this.mood - 6, 0, 100); this.uiDirty = true; this.idleCycle();
        });
      });
    },
    feedBowl() {
      const f = this.st.floor.bowls ? I.floorFootprint(D.ITEMS, this.st.floor, 'bowls') : null;
      if (!f) { this.bubble(pick(D.SAY.floor)); return; }
      const sp = I.nearSpot(this.NAV, f.c[0], f.c[1]);
      this.walkTo(sp[0], sp[1], () => {
        this.bubble(pick(D.SAY.bowl));
        this.setSt('eat', 2, () => {
          this.mood = clamp(this.mood + 10, 0, 100); this.uiDirty = true; this.idleCycle();
        });
      });
    },
    // Куда донесли корм/игрушку — тот же разбор случаев, что в endDrag
    // исходного app.js: на кота — покормить с руки (корм) или поиграть
    // (игрушка); на миски — к миске; на любой пол — закопать. Игрушка,
    // брошенная не рядом с котом, не срабатывает вовсе — по просьбе заказчика
    // (в отличие от исходника, где она играла с любой зоны).
    resolveSupplyDrop(x, y) {
      const sup = D.SUPPLIES[this.drag.iid];
      const cp = I.P(this.cat.x, this.cat.y);
      const onCat = this.catOn && Math.hypot(x - cp[0], y - cp[1]) < 46;
      if (onCat) {
        this.setMode('view');
        if (sup.food) this.feedHand(); else this.playHand();
        return;
      }
      if (!sup.food) return;
      const F = I.PROJ.F;
      const bowlsPos = this.st.floor.bowls;
      if (bowlsPos) {
        const poly = I.floorPoly(I.floorRect(D.ITEMS.bowls, bowlsPos.x, bowlsPos.y));
        if (inPoly([x, y], poly)) { this.setMode('view'); this.feedBowl(); return; }
      }
      const [tx, ty] = I.unP(x, y);
      if (tx >= 0 && ty >= 0 && tx <= F && ty <= F) {
        this.setMode('view');
        this.feedFloor(tx, ty);
      }
    },

    tick(dt) {
      const cat = this.cat;
      if (cat.bt > 0) { cat.bt -= dt; if (cat.bt <= 0) cat.bubble = null; }
      if (!this.catOn) return;
      cat.stateElapsedMs += dt * 1000;
      cat.ph += dt * (cat.st === 'walk' ? 9 : cat.st === 'dig' ? 14 : 2);

      if (cat.st === 'walk') {
        if (!cat.path.length) {
          const f = cat.after; cat.after = null;
          if (f) f(); else this.idleCycle();
          return;
        }
        const [tx, ty] = cat.path[0];
        const dx = tx - cat.x, dy = ty - cat.y, dist = Math.hypot(dx, dy);
        const sp = this.catSpeed * dt;
        if (dist <= sp || dist < 1e-6) { cat.x = tx; cat.y = ty; cat.path.shift(); }
        else { cat.x += dx / dist * sp; cat.y += dy / dist * sp; }
        const sdx = dx - dy, sdy = dx + dy;         // направление в экранных координатах
        if (Math.abs(sdx) > 0.002) cat.dir = sdx > 0 ? 1 : -1;
        if (Math.hypot(sdx, sdy) > 0.002) {
          let deg = Math.atan2(sdy, sdx) * 180 / Math.PI;
          if (deg < 0) deg += 360;
          cat.dir8 = DIR8[Math.round(deg / 45) % 8];
        }
      } else {
        cat.t -= dt;
        if (cat.t <= 0) { const f = cat.after; cat.after = null; if (f) f(); else this.idleCycle(); }
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
