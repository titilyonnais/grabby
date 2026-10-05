import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  define: { __VERSION__: JSON.stringify('1.0.0') },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  server: { port: 5199, strictPort: true },
});
