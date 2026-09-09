import { defineConfig } from 'vite';

export default defineConfig({
  base: './',          // относительные пути — работает и на GitHub Pages, и внутри Telegram
  server: { host: true }, // чтобы можно было открыть с телефона в той же сети
  // Собранная игра лежит рядом, в catroom/minigame/ — оттуда её грузит
  // <iframe> catroom (см. catroom/src/minigame.js). emptyOutDir — чтобы
  // старые файлы сборки не копились при пересборке.
  build: { outDir: '../minigame', emptyOutDir: true }
});
