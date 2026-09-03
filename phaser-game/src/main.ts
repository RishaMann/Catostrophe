import Phaser from "phaser";
import { RoomScene, RENDER_SCALE } from "./room/RoomScene";
import { UIScene } from "./ui/UIScene";
import { DEFAULT_ROOM } from "./room/RoomSpec";

// Временный способ проверить §12 шаг 2 («меняем W и D слайдером — мебель
// переезжает по якорным правилам») до появления настоящего debug-слайдера:
// ?w=&d= в URL.
const qs = new URLSearchParams(location.search);
const qw = Number(qs.get("w"));
const qd = Number(qs.get("d"));
if (qw > 0) DEFAULT_ROOM.size[0] = qw;
if (qd > 0) DEFAULT_ROOM.size[1] = qd;

// §9.3 — DebugGridScene вырезается из продакшн-сборки по флагу бандлера:
// импортируется динамически и только при import.meta.env.DEV. Vite
// статически подставляет это булево значение на этапе сборки, поэтому в
// prod-бандле ветка с import() не выполняется. Регистрируем сцену ДО
// создания игры (а не после), чтобы RoomScene.create() не словил гонку и
// не пропустил launch("DebugGridScene") в dev-режиме.
async function boot() {
  const scenes: Phaser.Types.Scenes.SceneType[] = [RoomScene, UIScene];
  if (import.meta.env.DEV) {
    const { DebugGridScene } = await import("./debug/DebugGridScene");
    scenes.push(DebugGridScene);
  }

  // Логический холст 270×480 (§15) — вписывается в реальный вьюпорт через
  // Scale Manager (FIT), а не фиксированным zoom:4, чтобы корректно работать
  // на разных экранах при разработке и тестировании.
  //
  // Бэкбуфер — в RENDER_SCALE раз больше (см. RoomScene.ts): FIT подгоняет
  // CSS-размер под вьюпорт по аспекту независимо от абсолютного числа
  // пикселей, так что width×RENDER_SCALE/height×RENDER_SCALE даёт тот же
  // видимый размер на экране, что и 270×480, но с честным запасом реальных
  // пикселей. Каждая сцена компенсирует это через applyRenderScale()
  // (RoomScene.ts) — camera.zoom = RENDER_SCALE + пересчитанный scroll по
  // формуле из исходника Phaser, так что все координаты в коде (origin,
  // §3/§5 формулы, раскладка UI) остаются как есть.
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    pixelArt: true,
    backgroundColor: "#1a1620",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 270 * RENDER_SCALE,
      height: 480 * RENDER_SCALE,
    },
    scene: scenes,
  });
  (window as any).__game = game; // временно, для отладки в консоли
}

boot();
