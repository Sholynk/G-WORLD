/**
 * @sholynk/shared — runtime-agnostic contracts used by the API, the tests and
 * (for reference) the frontend.
 *
 * Nothing in this package may import Cloudflare, Hono or Node built-ins, so the
 * same code runs in workerd, in Node-based unit tests and in browser-targeted
 * tooling.
 */
export * from './roles.js';
export * from './status.js';
export * from './api-contract.js';
export * from './validation.js';
