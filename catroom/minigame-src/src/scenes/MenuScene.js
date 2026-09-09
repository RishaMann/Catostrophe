// ============================================================
//  МЕНЮ  —  три задания на сегодня
// ============================================================

import Phaser from 'phaser';
import { FIELD } from '../config/level.js';
import { load, resetAll } from '../core/save.js';
import { tasksForToday } from '../config/tasks.js';
import { makeTextures } from '../core/greybox.js';
import { isEmbedded, exitToRoom } from '../core/bridge.js';

export default class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    this.cameras.main.setBackgroundColor('#56504B');
    makeTextures(this);
    const saved = load();
    const tasks = tasksForToday(saved.day);

    this.add.text(FIELD.w / 2, 110, 'КОТ', {
      fontFamily: 'sans-serif', fontSize: '52px', color: '#E8A33D', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.add.text(FIELD.w / 2, 168, 'три задания на сегодня', {
      fontFamily: 'sans-serif', fontSize: '17px', color: '#C4B8B0'
    }).setOrigin(0.5);

    this.add.text(FIELD.w / 2, 216, 'Рыбки  ' + saved.fish, {
      fontFamily: 'sans-serif', fontSize: '24px', color: '#5FA9BB'
    }).setOrigin(0.5);

    tasks.forEach((t, i) => {
      const y = 330 + i * 140;
      const done = saved.tasksDoneToday.includes(t.id);

      const box = this.add.rectangle(FIELD.w / 2, y, FIELD.w - 60, 112,
        done ? 0x413B37 : 0x332D2A)
        .setStrokeStyle(1, done ? 0x372B44 : 0xE8A33D, done ? 1 : 0.6);

      this.add.text(52, y - 36, t.title, {
        fontFamily: 'sans-serif', fontSize: '22px',
        color: done ? '#8D827B' : '#ffffff', fontStyle: 'bold'
      });
      this.add.text(52, y - 4, t.hint, {
        fontFamily: 'sans-serif', fontSize: '15px',
        color: done ? '#6E635C' : '#C4B8B0', fontStyle: 'italic',
        wordWrap: { width: FIELD.w - 130 }
      });
      this.add.text(52, y + 34, done ? 'выполнено' : 'нажми, чтобы начать', {
        fontFamily: 'sans-serif', fontSize: '14px',
        color: done ? '#8CB86E' : '#F0B44E'
      });

      if (!done) {
        box.setInteractive({ useHandCursor: true });
        box.on('pointerup', () => this.scene.start('Level', { task: t }));
      }
    });

    const allDone = tasks.every(t => saved.tasksDoneToday.includes(t.id));
    this.add.text(FIELD.w / 2, FIELD.h - 140,
      allDone ? 'На сегодня всё. Кот доволен. Наверное.'
              : 'Заходы не ограничены. Награда за задание — один раз.', {
      fontFamily: 'sans-serif', fontSize: '15px', color: '#9A8F87',
      align: 'center', wordWrap: { width: FIELD.w - 80 }
    }).setOrigin(0.5);

    this.buildResetButton();
    this.buildExitButton();
  }

  // Кнопка возврата в catroom — есть только когда игра реально открыта
  // внутри его <iframe> (см. core/bridge.js: isEmbedded). При обычном
  // самостоятельном запуске (npm run dev, GitHub Pages) возвращаться
  // некуда, кнопка не показывается.
  buildExitButton() {
    if (!isEmbedded()) return;
    const box = this.add.rectangle(78, 40, 132, 44, 0x332D2A)
      .setStrokeStyle(1, 0xE8A33D, 0.7).setInteractive({ useHandCursor: true });
    this.add.text(78, 40, '← в комнату', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#E8A33D'
    }).setOrigin(0.5);
    box.on('pointerup', () => exitToRoom(load().fish));
  }

  // ------------------------------------------------------------
  //  ВРЕМЕННАЯ КНОПКА СБРОСА  —  только на время тестов
  // ------------------------------------------------------------
  //  Задания за день выполняются один раз, и без сброса пришлось бы
  //  ждать следующего дня, чтобы пройти их заново. Кнопка обнуляет
  //  рыбок, выполненные задания и собранные заначки.
  //  Первое нажатие спрашивает подтверждение, второе — сбрасывает.
  //  Перед публикацией удаляем этот метод и его вызов.
  buildResetButton() {
    const y = FIELD.h - 66;
    const box = this.add.rectangle(FIELD.w / 2, y, 260, 40, 0x332D2A)
      .setStrokeStyle(1, 0x6E635C, 0.9)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(FIELD.w / 2, y, '⟲  сбросить прогресс', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#9A8F87'
    }).setOrigin(0.5);

    this.add.text(FIELD.w / 2, FIELD.h - 30, 'кнопка для тестов, в релизе её не будет', {
      fontFamily: 'sans-serif', fontSize: '11px', color: '#6E635C'
    }).setOrigin(0.5);

    let armed = false;
    box.on('pointerup', () => {
      if (!armed) {
        armed = true;
        label.setText('точно? нажми ещё раз').setColor('#F0B44E');
        box.setStrokeStyle(1, 0xF0B44E, 1);
        this.time.delayedCall(2500, () => {
          if (!armed) return;
          armed = false;
          label.setText('⟲  сбросить прогресс').setColor('#9A8F87');
          box.setStrokeStyle(1, 0x6E635C, 0.9);
        });
        return;
      }
      resetAll();
      this.scene.restart();
    });
  }
}
