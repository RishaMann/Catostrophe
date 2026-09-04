import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/Catostrophe/" : "/",
  server: { port: 5173, strictPort: false },
}));
