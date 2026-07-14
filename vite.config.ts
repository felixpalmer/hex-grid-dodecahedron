import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works when served from a subpath,
  // e.g. GitHub Pages at https://<user>.github.io/<repo>/.
  base: './',
  plugins: [react()],
});
