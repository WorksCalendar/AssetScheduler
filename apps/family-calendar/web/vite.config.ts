import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The recurrence maths is shared verbatim with the home server rather
      // than reimplemented here. If the phone expanded "every other Tuesday"
      // differently from the server, the wall display and the phone would show
      // different weeks and there would be no way to tell which was right.
      '@shared': fileURLToPath(new URL('../server/src', import.meta.url)),
    },
  },
  server: {
    // Reachable from other devices on the home network, so you can open the
    // dev build on a phone while working on it.
    host: true,
    port: 5180,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
