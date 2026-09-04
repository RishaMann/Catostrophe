import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/Catostrophe/phaser-game/" : "/",
  server: { port: 5173, strictPort: false },
}));
