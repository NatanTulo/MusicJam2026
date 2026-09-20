import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // trzy strony: gra, laboratorium dźwięku i podgląd muzyczny (piano-roll)
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        soundLab: resolve(import.meta.dirname, 'sound-lab.html'),
        musicRoll: resolve(import.meta.dirname, 'music-roll.html'),
      },
    },
  },
});
