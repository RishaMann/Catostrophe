// ============================================================
//  ИТОГ ЗАХОДА
// ============================================================

import Phaser from 'phaser';
import { FIELD } from '../config/level.js';
import { load } from '../core/save.js';
import { preloadArt, makeTextures } from '../core/greybox.js';
import { isEmbedded, exitToRoom } from '../core/bridge.js';

export default class ResultScene extends Phaser.Scene {
  constructor() { super('Result'); }
  init(data) { this.data_ = data; }
  preload() { preloadArt(this); }

  create() {
    this.cameras.main.setBackgroundColor('#56504B');
    makeTextures(this);
    const d = this.data_;
    const saved = load();

    this.add.text(FIELD.w / 2, 250, 'Задание выполнено', {
      fontFamily: 'sans-serif', fontSize: '28px', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5);

    this.add.text(FIELD.w / 2, 296, d.task.title, {
      fontFamily: 'sans-serif', fontSize: '18px', color: '#C4B8B0'
    }).setOrigin(0.5);

    this.add.text(FIELD.w / 2, 410, '+' + d.reward, {
      fontFamily: 'sans-serif', fontSize: '72px', color: '#E8A33D', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.add.text(FIELD.w / 2, 476, d.clean ? 'чисто — за ' + d.jumps + ' прыжка' : 'за ' + d.jumps + ' прыжков', {
      fontFamily: 'sans-serif', fontSize: '16px', color: d.clean ? '#93BE72' : '#6B5F75'
    }).setOrigin(0.5);

    this.add.text(FIELD.w / 2, 566, 'Всего рыбок: ' + saved.fish, {
      fontFamily: 'sans-serif', fontSize: '19px', color: '#5FA9BB'
    }).setOrigin(0.5);

    const btn = this.add.rectangle(FIELD.w / 2, 670, 260, 60, 0x332D2A)
      .setStrokeStyle(1, 0xE8A33D, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(FIELD.w / 2, 670, 'к заданиям', {
      fontFamily: 'sans-serif', fontSize: '18px', color: '#E8A33D'
    }).setOrigin(0.5);
    btn.on('pointerup', () => this.scene.start('Menu'));

    if (isEmbedded()) {
      const exitBtn = this.add.rectangle(FIELD.w / 2, 742, 260, 44, 0x332D2A)
        .setStrokeStyle(1, 0x8D8195, 0.7).setInteractive({ useHandCursor: true });
      this.add.text(FIELD.w / 2, 742, '← в комнату', {
        fontFamily: 'sans-serif', fontSize: '15px', color: '#C4B8B0'
      }).setOrigin(0.5);
      exitBtn.on('pointerup', () => exitToRoom(load().fish));
    }
  }
}
