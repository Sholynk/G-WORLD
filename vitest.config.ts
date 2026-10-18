/**
 * Unit test configuration — Node environment.
 *
 * Only runtime-agnostic logic is tested here (hashing, tokens, slugs, scoring,
 * permission maps, validation schemas, formatting). Anything that touches D1,
 * bindings or the Hono router belongs in tests/integration and runs inside
 * workerd via vitest.integration.config.ts.
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
