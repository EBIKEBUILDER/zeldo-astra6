#!/usr/bin/env node
/*
 * Deterministic renderer benchmark, including shadow/postprocess draw calls.
 * Requires esbuild and Playwright (plus pngjs for --compare), either installed
 * locally or under BENCHMARK_NODE_MODULES. Chromium defaults to Google Chrome.
 *
 * node scripts/render-benchmark.cjs --output test-artifacts/render-current
 * node scripts/render-benchmark.cjs --source /tmp/before/game --output test-artifacts/render-before
 * node scripts/render-benchmark.cjs --compare test-artifacts/render-before
 * node scripts/render-benchmark.cjs --scenarios river-effects --frames 5 --output test-artifacts/river-effects
 *
 * Headless SwiftShader timings are comparative software-rendering measurements,
 * not a prediction of hardware FPS. Draw counts include every WebGL pass.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
}
function dependency(name) {
  try { return require(name); } catch {
    const runtime = process.env.BENCHMARK_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
    return createRequire(path.join(runtime, '__benchmark.cjs'))(name);
  }
}
const source = path.resolve(option('source', path.join(root, 'game')));
const output = path.resolve(option('output', path.join(root, 'test-artifacts/render-current')));
const width = Number(option('width', 1280));
const height = Number(option('height', 720));
const frames = Number(option('frames', 30));
const scenarios = option('scenarios', 'village,river,dungeon,combat').split(',');
fs.mkdirSync(output, { recursive: true });

const entry = `
import { createGameRenderer } from ${JSON.stringify(path.join(source, 'renderer.ts'))};
import { createInitialData } from ${JSON.stringify(path.join(source, 'simulation.ts'))};
import { EngineStore } from '@babylonjs/core';
const calls = { draws: 0, buffersCreated: 0, bufferUploads: 0 };
for (const type of [WebGLRenderingContext, WebGL2RenderingContext]) {
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    if (!Object.prototype.hasOwnProperty.call(type.prototype, name)) continue;
    const original = type.prototype[name];
    type.prototype[name] = function (...args) { calls.draws++; return original.apply(this, args); };
  }
  for (const [name, counter] of [['createBuffer', 'buffersCreated'], ['bufferData', 'bufferUploads']]) {
    if (!Object.prototype.hasOwnProperty.call(type.prototype, name)) continue;
    const original = type.prototype[name];
    type.prototype[name] = function (...args) { calls[counter]++; return original.apply(this, args); };
  }
}
const canvas = document.querySelector('canvas');
const renderer = createGameRenderer(canvas);
const scene = EngineStore.LastCreatedScene;
const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const gpu = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
function stateFor(name) {
  const s = createInitialData();
  s.phase = 'playing'; s.elapsed = 12.375;
  Object.assign(s.player, { x: name === 'river' ? 24.8 : name === 'village' ? 8 : 10, z: name === 'river' ? 13.15 : name === 'village' ? 6 : name === 'combat' ? 19 : 8, facingX: .6, facingZ: .8 });
  if (name === 'dungeon' || name === 'combat') s.zone = 'dungeon';
  if (name === 'combat') {
    s.hasKey = true; s.gateOpen = true; s.player.attackTime = .14;
    const boss = s.enemies.find(e => e.kind === 'boss');
    Object.assign(boss, { mode: 'ranged-windup', modeTime: .25, rangedAimX: 10, rangedAimZ: 19 });
    s.projectiles = [0, 1, 2].map(i => ({ id: 300 + i, zone: 'dungeon', ownerId: boss.id, x: 8 + i * 1.6, z: 20 - i * .5, vx: 1, vz: -3, radius: .18, life: 3, age: .2 + i * .07, reflected: i === 1 }));
    s.particles = Array.from({ length: 96 }, (_, i) => ({ id: i + 500, x: 10 + Math.sin(i * 2.4) * (1 + i % 7 * .3), z: 19 + Math.cos(i * 2.4) * (1 + i % 7 * .3), y: .2 + i % 9 * .12, vx: 0, vy: 0, vz: 0, life: .2 + i % 4 * .06, maxLife: .5, color: ['#e6c778', '#d3bc80', '#8eac69'][i % 3], size: .08 + i % 4 * .02, kind: ['spark', 'debris', 'poof'][i % 3] }));
    s.pickups = [0, 1, 2].map(i => ({ id: 'bench-pickup-' + i, zone: 'dungeon', x: 8 + i, z: 18, kind: i === 1 ? 'heart' : 'rupee', age: .4, value: 1 }));
  }
  if (name === 'river-effects') {
    // Overlap floor shimmer with fading particles at several heights, a
    // translucent hero, and the sword trail to catch alpha-sorting regressions.
    Object.assign(s.player, { x: 23.4, z: 11.3, facingX: 1, facingZ: 0, invulnerable: .75, attackTime: .14 });
    s.particles = Array.from({ length: 36 }, (_, i) => {
      const ripple = i < 24 ? 20 + i % 12 : i % 12;
      const waterStart = i < 24 ? .8 : 14.9;
      return { id: 700 + i, x: 24.8 + Math.sin(ripple * 7.6) * 1.26, z: waterStart + ripple / 3,
        y: [.065, .12, .35, .75, 1.2, 1.65][i % 6], vx: 0, vy: 0, vz: 0,
        life: .18 + i % 4 * .07, maxLife: .5, color: ['#e6c778', '#d3bc80', '#8eac69'][i % 3],
        size: .12 + i % 4 * .04, kind: ['spark', 'debris', 'poof'][i % 3] };
    });
    s.projectiles = [0, 1, 2].map(i => ({ id: 900 + i, zone: 'overworld', ownerId: 'river-benchmark',
      x: 24.2 + i * .55, z: 10.8 + i * 1.7, vx: 1, vz: -3, radius: .18, life: 3, age: .2 + i * .07, reflected: i === 1 }));
    s.pickups = [0, 1].map(i => ({ id: 'river-pickup-' + i, zone: 'overworld', x: 24 + i * 1.2,
      z: 12.3, kind: i ? 'heart' : 'rupee', age: .4, value: 1 }));
  }
  return s;
}
let state;
window.benchmark = {
  async prepare(name) {
    state = stateFor(name);
    renderer.render(state, 1);
    await renderer.ready();
    // dt=1 settles camera/gate interpolation without changing simulation time.
    for (let i = 0; i < 8; i++) { await nextFrame(); renderer.render(state, 1); }
    gl.finish();
    return { gpu, meshes: scene.meshes.length, activeMeshes: scene.getActiveMeshes().length, materials: scene.materials.length };
  },
  async measure(count, churn) {
    const samples = [];
    for (let i = 0; i < count; i++) {
      await nextFrame();
      if (churn && i % 4 === 0) for (const particle of state.particles) particle.id += 1000;
      calls.draws = 0; calls.buffersCreated = 0; calls.bufferUploads = 0;
      const start = performance.now();
      renderer.render(state, 1 / 60);
      const submitted = performance.now();
      gl.finish();
      samples.push({ submissionMs: submitted - start, synchronizedMs: performance.now() - start, ...calls });
    }
    return { samples, meshesAfter: scene.meshes.length, activeMeshes: scene.getActiveMeshes().length };
  },
  dispose() { renderer.dispose(); }
};
window.benchmarkReady = true;
`;

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = n => Math.round(n * 100) / 100;
  return { mean: round(values.reduce((a, b) => a + b, 0) / values.length), median: round(sorted[Math.floor(sorted.length / 2)]), p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]), min: round(sorted[0]), max: round(sorted.at(-1)) };
}

function compareImage(beforeFile, afterFile, diffFile) {
  const { PNG } = dependency('pngjs');
  const before = PNG.sync.read(fs.readFileSync(beforeFile));
  const after = PNG.sync.read(fs.readFileSync(afterFile));
  if (before.width !== after.width || before.height !== after.height) throw new Error('Screenshot dimensions differ');
  const diff = new PNG({ width: after.width, height: after.height });
  let changed = 0, perceptible = 0, sum = 0, max = 0;
  for (let p = 0; p < before.data.length; p += 4) {
    let delta = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(before.data[p + c] - after.data[p + c]);
      sum += d; delta = Math.max(delta, d); max = Math.max(max, d);
      diff.data[p + c] = Math.min(255, d * 8);
    }
    diff.data[p + 3] = 255;
    if (delta) changed++;
    if (delta > 12) perceptible++;
  }
  fs.writeFileSync(diffFile, PNG.sync.write(diff));
  const pixels = before.width * before.height;
  return { changedPixelPercent: 100 * changed / pixels, pixelsOver12ChannelsPercent: 100 * perceptible / pixels, meanAbsoluteChannelError: sum / (pixels * 3), maximumChannelError: max };
}

(async () => {
  const { outputFiles } = await dependency('esbuild').build({ stdin: { contents: entry, loader: 'ts', resolveDir: root }, bundle: true, write: false, format: 'iife', platform: 'browser', nodePaths: [path.join(root, 'node_modules')], logLevel: 'warning' });
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? outputFiles[0].contents : '<!doctype html><html><body style="margin:0;overflow:hidden"><canvas style="display:block;width:100vw;height:100vh"></canvas><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await dependency('playwright').chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.benchmarkReady, {}, { timeout: 120000 });
    const result = { source, width, height, frames, browser: browser.version(), rendering: 'Headless Chromium SwiftShader; CPU submission and synchronized GPU timings are not hardware FPS.', scenarios: {} };
    for (const name of scenarios) {
      const initial = await page.evaluate(name => window.benchmark.prepare(name), name);
      const screenshot = path.join(output, name + '.png');
      await page.screenshot({ path: screenshot });
      const measured = await page.evaluate(({ frames, churn }) => window.benchmark.measure(frames, churn), { frames, churn: name === 'combat' });
      const row = { ...initial, meshesAfter: measured.meshesAfter, samples: measured.samples };
      for (const metric of ['draws', 'submissionMs', 'synchronizedMs', 'buffersCreated', 'bufferUploads']) row[metric] = stats(measured.samples.map(sample => sample[metric]));
      if (option('compare')) row.imageComparison = compareImage(path.join(path.resolve(option('compare')), name + '.png'), screenshot, path.join(output, name + '-diff.png'));
      result.scenarios[name] = row;
      console.log(name, JSON.stringify({ draws: row.draws, submissionMs: row.submissionMs, synchronizedMs: row.synchronizedMs, buffersCreated: row.buffersCreated, meshes: row.meshes, imageComparison: row.imageComparison }));
      fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(result, null, 2) + '\n');
    }
    await page.evaluate(() => window.benchmark.dispose());
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Metrics and screenshots:', output);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
