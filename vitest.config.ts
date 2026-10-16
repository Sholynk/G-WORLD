/**
 * Unit test configuration — Node environment.
 *
 * Only runtime-agnostic logic is tested here (hashing, tokens, slugs, scoring,
 * permission maps, validation schemas, formatting). Anything that touches D1,
 * bindings or the Hono router belongs in tests/integration and runs inside
 * workerd via vitest.integration.config.ts.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
