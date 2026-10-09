#!/usr/bin/env node
// Run against a local server: node scripts/focus-ui-smoke.cjs [url]
// Playwright can be installed locally or supplied through BENCHMARK_NODE_MODULES.
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
let playwright;
try { playwright = require('playwright'); } catch {
  const runtime = process.env.BENCHMARK_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  playwright = createRequire(path.join(runtime, '__focus-smoke.cjs'))('playwright');
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.focusProbe = { hidden: false };
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.focusProbe.hidden });
    });
    await page.goto(process.argv[2] || 'http://127.0.0.1:3107', { timeout: 120000 });
    const begin = page.getByRole('button', { name: 'Begin adventure', exact: true });
    const resume = page.getByRole('button', { name: 'Continue adventure', exact: false });
    await begin.waitFor({ timeout: 120000 });
    const progress = () => page.evaluate(() => ({
      position: document.querySelector('.minimap .map-world > g:last-child')?.getAttribute('transform'),
      hearts: document.querySelector('.hearts')?.getAttribute('aria-label'),
      rupees: document.querySelector('.rupees')?.getAttribute('aria-label'),
      objective: document.querySelector('.minimap')?.getAttribute('aria-label'),
      elapsed: document.querySelector('.site-footer > div > span')?.textContent,
    }));

    // Losing focus on the title screen must not begin a game or show a pause menu.
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    assert.equal(await begin.isVisible(), true);
    assert.equal(await resume.isVisible(), false);
    await begin.click();
    const spawn = await progress();
    await page.keyboard.down('KeyD');
    await page.waitForFunction(initial => document.querySelector('.minimap .map-world > g:last-child')?.getAttribute('transform') !== initial, spawn.position, { timeout: 30000 });
    await page.keyboard.up('KeyD');
    await page.getByRole('button', { name: 'Pause game', exact: true }).click();
    await resume.waitFor();
    const checkpoint = await progress();
    assert.notEqual(checkpoint.position, spawn.position, 'The test must preserve a moved player, not the initial spawn');
    await resume.click();

    // A window switch may blur the browser without hiding the tab (for example
    // when two applications are side by side). It must still stop gameplay.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', altKey: true, bubbles: true }));
      window.dispatchEvent(new Event('blur'));
    });
    await resume.waitFor({ timeout: 10000 });
    assert.equal(await begin.isVisible(), false, 'Focus loss must not return to the title screen');
    const blurred = await progress();
    assert.equal(blurred.position, checkpoint.position);
    assert.equal(blurred.hearts, checkpoint.hearts);
    assert.equal(blurred.rupees, checkpoint.rupees);
    assert.equal(blurred.objective, checkpoint.objective);
    // Wait more than one displayed second to prove the simulation remains paused.
    await page.waitForTimeout(1200);
    assert.deepEqual(await progress(), blurred);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await resume.isVisible(), true, 'Repeated focus events cannot resume or reset the adventure');
    assert.deepEqual(await progress(), blurred);
    await resume.click();

    await page.evaluate(() => {
      window.focusProbe.hidden = true;
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await resume.waitFor();
    const hidden = await progress();
    await page.waitForTimeout(1200);
    assert.deepEqual(await progress(), hidden);
    await page.evaluate(() => {
      window.focusProbe.hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    assert.equal(await resume.isVisible(), true, 'Returning to the tab leaves the adventure paused');
    assert.equal(await begin.isVisible(), false);
    assert.deepEqual(await progress(), hidden);
    await resume.click();
    await page.keyboard.down('KeyD');
    await page.waitForFunction(previous => document.querySelector('.minimap .map-world > g:last-child')?.getAttribute('transform') !== previous, hidden.position, { timeout: 30000 });
    await page.keyboard.up('KeyD');
    assert.deepEqual(errors, []);
    console.log('Window blur, repeated focus events, hidden tab, and explicit resume preserve adventure progress.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
