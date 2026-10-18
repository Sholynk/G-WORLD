/**
 * Unit test configuration — Node environment.
 *
 * Includes runtime-agnostic helpers, DOM behavior and full Hono request-stack
 * tests backed by an in-memory SQLite D1 adapter. Live Worker HTTP tests use
 * vitest.integration.config.ts; no unused workerd test-pool dependency is needed.
 */
import { defineConfig } from 'vitest/config';

/**
 * The API worker imports its article shell as text (`*.html`, configured in
 * wrangler.jsonc → rules). This plugin gives Vitest the same behaviour so
 * lib/article-page.ts is importable in unit tests.
 */
const htmlAsText = {
  name: 'html-as-text',
  transform(code: string, id: string) {
    if (id.endsWith('.html')) {
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [htmlAsText],
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'artifacts/junit-unit.xml' },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/unit',
      include: ['apps/api/src/lib/**', 'apps/api/src/schemas/**', 'packages/shared/src/**'],
    },
  },
});
