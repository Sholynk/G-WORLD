/**
 * Integration test configuration — Node environment, live HTTP.
 *
 * These tests talk to a *running* API (`npm run dev:api`) over HTTP and assert
 * the behaviour a real client sees: status codes, envelopes, cookies, and the
 * authorisation boundary. They are deliberately read-only so they can run
 * against a seeded database without destroying it — the destructive,
 * end-to-end pass lives in `scripts/smoke-test.mjs`.
 *
 * When the API is not reachable the suites skip themselves with a message
 * instead of failing, so `npm test` stays useful in a clean checkout.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    // A cold `wrangler dev` can take a moment to answer the first request.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'artifacts/junit-integration.xml' },
  },
});
