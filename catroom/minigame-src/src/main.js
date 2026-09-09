// ============================================================
//  ТОЧКА ВХОДА
// ============================================================
//  Здесь только настройка игры и список сцен.
//  Никакой игровой логики в этом файле быть не должно.
// ============================================================

import Phaser from 'phaser';
import { FIELD } from './config/level.js';
import { BALANCE } from './config/balance.js';
import MenuScene from './scenes/MenuScene.js';
import LevelScene from './scenes/LevelScene.js';
import ResultScene from './scenes/ResultScene.js';
import { load } from './core/save.js';
import { markSessionStart } from './core/bridge.js';

// Снимок рыбок на момент запуска страницы — от него catroom считает,
// сколько заработано ЗА ЭТОТ заход в мини-игру (см. core/bridge.js).
markSessionStart(load().fish);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#56504B',
  width: FIELD.w,
  height: FIELD.h,
  scale: {
    mode: Phaser.Scale.FIT,          // вписывается в любой экран, пропорции сохраняются
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: BALANCE.GRAVITY }, debug: false }
  },
  scene: [MenuScene, LevelScene, ResultScene]
});

// Доступ к игре из консоли браузера — удобно на время тестов.
// Например: __game.scene.getScene('Level').state
window.__game = game;
