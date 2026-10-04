import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __TARGET__: JSON.stringify('store'), __VERSION__: JSON.stringify('0.0.0-test') },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: { include: ['test/unit/**/*.test.ts'], environment: 'node' },
});
