#!/usr/bin/env node
// Run against a local dev/production server: node scripts/fps-ui-smoke.cjs [url]
// Playwright can be installed locally or supplied through BENCHMARK_NODE_MODULES.
// Add --visibility-only to test loading hidden before the first animation frame.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
let playwright;
try { playwright = require('playwright'); } catch {
  const runtime = process.env.BENCHMARK_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  playwright = createRequire(path.join(runtime, '__fps-smoke.cjs'))('playwright');
}
const output = path.resolve(__dirname, '../test-artifacts/fps-ui');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const visibilityOnly = process.argv.includes('--visibility-only');
    await page.addInitScript(({ initiallyHidden }) => {
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      const pending = new Set();
      const probe = { pending, completed: 0, maximumPending: 0, hidden: initiallyHidden, request };
      window.rafProbe = probe;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => probe.hidden });
      window.requestAnimationFrame = callback => {
        const id = request(time => { pending.delete(id); probe.completed++; callback(time); });
        pending.add(id); probe.maximumPending = Math.max(probe.maximumPending, pending.size);
        return id;
      };
      window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
    }, { initiallyHidden: visibilityOnly });
    await page.goto(process.argv[2] || 'http://127.0.0.1:3100', { timeout: 120000 });
    await page.getByRole('button', { name: 'Begin adventure' }).waitFor({ timeout: 120000 });
    assert.equal(await page.locator('.fps-counter').isHidden(), true, 'Performance stats stay hidden on the title screen');
    if (visibilityOnly) {
      assert.equal(await page.evaluate(() => window.rafProbe.pending.size), 0, 'An initially hidden game must not start a rendering loop');
      await page.evaluate(() => {
        window.rafProbe.hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    await page.getByRole('button', { name: 'Begin adventure' }).click();
    await page.waitForFunction(() => {
      const counter = document.querySelector('.fps-counter');
      const expected = { fps: /^\d+ FPS$/, 'frame-ms': /^\d+(?:\.\d+)? ms$/, 'draw-calls': /^\d+ draws$/, 'active-meshes': /^\d+ meshes$/ };
      return Object.entries(expected).every(([name, pattern]) => {
        const text = counter?.querySelector(`[data-perf-stat="${name}"]`)?.textContent || '';
        return pattern.test(text) && (!['draw-calls', 'active-meshes'].includes(name) || parseFloat(text) > 0);
      });
    }, {}, { timeout: 60000 });
    await page.evaluate(() => {
      window.fpsUpdates = 0;
      new MutationObserver(() => window.fpsUpdates++).observe(document.querySelector('.fps-counter'), { childList: true, characterData: true, subtree: true });
    });
    const results = [];
    for (const [name, width, height] of visibilityOnly ? [] : [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390], ['narrow-portrait', 320, 740], ['narrow-landscape', 667, 375], ['small-landscape', 568, 320]]) {
      await page.setViewportSize({ width, height });
      for (const fullscreen of [false, true]) {
        if (fullscreen) {
          await page.getByRole('button', { name: 'Fullscreen game', exact: true }).click();
          await page.locator('.app-shell.is-fullscreen').waitFor();
        }
        // Observe sampling assignments, since a steady scene can retain the same values.
        const previousUpdates = await page.evaluate(() => window.fpsUpdates);
        await page.waitForFunction(previous => window.fpsUpdates > previous, previousUpdates, { timeout: 60000 });
        const result = await page.evaluate(() => {
          const counter = document.querySelector('.fps-counter');
          const rect = element => {
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          };
          const box = rect(counter);
          const overlap = other => box.x < other.right && box.right > other.x && box.y < other.bottom && box.bottom > other.y;
          const peers = ['.vitals', '.stage-pause', '.minimap', '.quest-card', '.fullscreen-exit', '.virtual-joystick', '.touch-actions', '.adventure-toolbar', '.boss-health'];
          const overlaps = peers.filter(selector => {
            const element = document.querySelector(selector);
            return element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && overlap(rect(element));
          });
          const stats = [...counter.querySelectorAll('[data-perf-stat]')].map(element => ({
            name: element.dataset.perfStat,
            text: element.textContent,
            box: rect(element),
            visible: !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden',
          }));
          return { text: counter.textContent, role: counter.getAttribute('role'), label: counter.getAttribute('aria-label'), stats, hidden: counter.hidden, box, stage: rect(document.querySelector('.game-stage')), viewport: { width: innerWidth, height: innerHeight }, overlaps, updates: window.fpsUpdates };
        });
        const label = name + (fullscreen ? '-fullscreen' : '');
        await page.screenshot({ path: path.join(output, label + '.png') });
        console.log(label, JSON.stringify(result));
        assert.equal(result.role, 'group');
        assert.equal(result.label, 'Rendering performance');
        const expected = { fps: /^\d+ FPS$/, 'frame-ms': /^\d+(?:\.\d+)? ms$/, 'draw-calls': /^\d+ draws$/, 'active-meshes': /^\d+ meshes$/ };
        assert.deepEqual(result.stats.map(stat => stat.name).sort(), Object.keys(expected).sort(), 'All four stats appear exactly once');
        for (const stat of result.stats) {
          assert.match(stat.text, expected[stat.name]);
          const value = parseFloat(stat.text);
          assert.ok(Number.isFinite(value) && value >= 0, `${stat.name} is a nonnegative number`);
          if (['draw-calls', 'active-meshes'].includes(stat.name)) assert.ok(value > 0, `${stat.name} measures active gameplay`);
          assert.equal(stat.visible, true, `${stat.name} is visible without opening a tooltip`);
          assert.ok(stat.box.width > 0 && stat.box.height > 0, `${stat.name} has a visible size`);
          assert.ok(stat.box.x >= result.box.x && stat.box.y >= result.box.y && stat.box.right <= result.box.right && stat.box.bottom <= result.box.bottom, `${stat.name} fits the performance HUD`);
        }
        assert.equal(result.hidden, false);
        assert.deepEqual(result.overlaps, [], `${name} fullscreen=${fullscreen}: Performance stats overlap another control`);
        assert.ok(result.box.x >= 0 && result.box.y >= 0 && result.box.right <= result.viewport.width && result.box.bottom <= result.viewport.height, 'Performance stats fit viewport');
        assert.ok(result.box.x >= result.stage.x && result.box.y >= result.stage.y && result.box.right <= result.stage.right && result.box.bottom <= result.stage.bottom, 'Performance stats fit game stage');
        await page.getByRole('button', { name: 'Pause game', exact: true }).click();
        await page.getByRole('button', { name: 'Continue adventure', exact: false }).waitFor();
        assert.equal(await page.locator('.fps-counter').isVisible(), true);
        await page.getByRole('button', { name: 'Continue adventure', exact: false }).click();
        await page.getByRole('button', { name: 'Pause game', exact: true }).waitFor();
        results.push({ name: label, ...result, pauseResume: 'passed' });
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2) + '\n');
        if (fullscreen) {
          await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
          await page.locator('.app-shell.is-fullscreen').waitFor({ state: 'hidden' });
        }
      }
    }
    await page.evaluate(() => {
      window.rafProbe.hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByRole('button', { name: 'Continue adventure', exact: false }).waitFor();
    const hidden = await page.evaluate(() => ({ updates: window.fpsUpdates, completed: window.rafProbe.completed, pending: window.rafProbe.pending.size }));
    // Native RAFs let queued browser/layout work settle while bypassing our probe.
    await page.evaluate(() => new Promise(resolve => {
      let frames = 0;
      const tick = () => ++frames === 6 ? resolve() : window.rafProbe.request(tick);
      window.rafProbe.request(tick);
    }));
    const stillHidden = await page.evaluate(() => ({ updates: window.fpsUpdates, completed: window.rafProbe.completed, pending: window.rafProbe.pending.size }));
    assert.deepEqual(stillHidden, hidden, 'Hidden gameplay must stop rendering and performance stat updates');
    assert.equal(hidden.pending, 0);
    await page.evaluate(() => {
      window.rafProbe.hidden = false; window.rafProbe.maximumPending = 0;
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Timer polling avoids counting Playwright's own RAF poller as a game loop.
    await page.waitForFunction(previous => window.fpsUpdates > previous, hidden.updates, { timeout: 60000, polling: 100 });
    const resumed = await page.evaluate(() => ({ pending: window.rafProbe.pending.size, maximumPending: window.rafProbe.maximumPending }));
    assert.equal(resumed.pending, 1);
    assert.equal(resumed.maximumPending, 1, 'Repeated visibility events must retain exactly one render loop');
    await page.getByRole('button', { name: 'Continue adventure', exact: false }).click();
    await page.getByRole('button', { name: 'Pause game', exact: true }).waitFor();
    console.log('Visibility lifecycle passed:', JSON.stringify({ initiallyHidden: visibilityOnly, hidden, resumed }));
    fs.writeFileSync(path.join(output, visibilityOnly ? 'visibility.json' : 'results.json'), JSON.stringify({ results, visibility: { initiallyHidden: visibilityOnly, hidden, resumed }, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []);
    console.log(visibilityOnly ? 'Initial hidden load and visibility lifecycle passed.' : 'Performance stats, visibility, updates, layout and pause/resume passed in all twelve layouts. Screenshots:', output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
