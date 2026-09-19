import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // dwie strony: gra i laboratorium dźwięku
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        soundLab: resolve(import.meta.dirname, 'sound-lab.html'),
      },
    },
  },
});
