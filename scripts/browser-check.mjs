#!/usr/bin/env node
/** Local Chromium regression pass. Start `npm run dev` first and install a
 * browser with `npx playwright install chromium`. No production mutations.
 * BROWSER_EXECUTABLE_PATH optionally selects a preinstalled Chromium binary.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = (process.env.WEB_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Browser checks only run against local test data');
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
let checked = 0;
const paths = ['/', '/about.html', '/contact.html', '/help_&_support.html', '/privacy_policy.html',
  '/login.html', '/reset.html', '/403.html', '/404.html', '/500.html',
  '/articles/the-rise-of-quantum-computing/', '/article.html?slug=the-rise-of-quantum-computing', '/admin/'];
async function localContext(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  // Deliberately exercise graceful degradation when third-party fonts/icons/
  // charts are offline. Local assets and live API responses must still work.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin
    ? route.continue() : route.abort());
  return context;
}
async function checkLayout(page, label, errors) {
  await page.waitForTimeout(300);
  assert.deepEqual(errors, [], `${label}: uncaught JavaScript errors`);
  const state = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    brokenImages: [...document.images].filter((image) => image.src.startsWith(location.origin)
      && image.complete && !image.naturalWidth).map((image) => image.getAttribute('src')),
  }));
  assert.equal(state.overflow, false, `${label}: horizontal page overflow`);
  assert.deepEqual(state.brokenImages, [], `${label}: broken loaded local images`);
  checked++;
}
try {
  for (const width of [390, 1440]) {
    const context = await localContext(width);
    try {
      for (const path of paths) {
        const page = await context.newPage();
        const errors = []; page.on('pageerror', (error) => errors.push(error.message));
        const response = await page.goto(base + path);
        assert.equal(response.status(), 200, `${path}: document response`);
        if (path === '/') {
          await page.locator('#cardsContainer .card').first().waitFor({ state: 'visible' });
          await page.locator('#searchInput').fill('quantum');
          await page.waitForFunction(() => {
            const cards = [...document.querySelectorAll('#cardsContainer .card')];
            return cards.length > 0 && cards.some(card => /quantum/i.test(card.textContent));
          });
          await page.locator('#clearSearch').click();
          await page.locator('#cardsContainer .card').first().waitFor({ state: 'visible' });
        }
        if (path === '/admin/') {
          await page.waitForURL('**/login.html?next=*');
          await page.locator('#showRegister').click();
          assert.equal(await page.locator('#registerForm').isVisible(), true);
          await page.locator('#showLogin').click();
          assert.equal(await page.locator('#loginForm').isVisible(), true);
        }
        await checkLayout(page, `${width}px ${path}`, errors);
        await page.close();
      }
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base + '/login.html');
      await page.locator('#email').fill('admin@sholynk.test');
      await page.locator('#password').fill('AdminPassword123!');
      await page.locator('#loginForm button[type=submit]').click();
      await page.waitForURL('**/admin/');
      await page.locator('#adminMain').waitFor({ state: 'visible' });
      for (const panel of ['dashboard', 'articles', 'media', 'authors', 'inbox', 'comments', 'settings']) {
        await page.locator(`[data-panel="${panel}"]`).click();
        assert.equal(await page.locator(`#panel-${panel}`).isVisible(), true);
        await checkLayout(page, `${width}px admin/${panel}`, errors);
      }
      await page.locator('#signOutBtn').click();
      await page.waitForURL(base + '/');
      assert.equal((await context.request.get(base + '/api/v1/auth/me')).status(), 401);
    } finally { await context.close(); }
  }
  console.log(`Browser check: ${checked} desktop/mobile page and panel checks passed; login/register switching and session logout passed.`);
} finally { await browser.close(); }
