import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameStats } from './frame-stats';

test('stats count actual frames, average draws and meshes, and only publish twice per second', () => {
  const meter = createFrameStats();
  meter.reset(1000);
  for (let i = 1; i < 30; i++) assert.equal(meter.record(1000 + i * 500 / 30, 40, 20), null);
  assert.deepEqual(meter.record(1500, 70, 50), { fps: 60, frameMs: 16.7, drawCalls: 41, activeMeshes: 21 });
  // A long frame must lower the measured FPS; simulation dt clamping cannot hide it.
  assert.deepEqual(meter.record(2000, 20, 10), { fps: 2, frameMs: 500, drawCalls: 20, activeMeshes: 10 });
});

test('frame time uses the full sampling interval before FPS is rounded', () => {
  const meter = createFrameStats();
  meter.reset(0);
  assert.equal(meter.record(245, 12, 5), null);
  assert.deepEqual(meter.record(510.5, 13, 6), { fps: 4, frameMs: 255.3, drawCalls: 13, activeMeshes: 6 });
});

test('reset excludes suspended time and discards samples from before resuming', () => {
  const meter = createFrameStats();
  meter.reset(0);
  meter.record(100, 100, 200);
  meter.reset(10000);
  assert.equal(meter.record(10250, 10, 4), null);
  assert.deepEqual(meter.record(10500, 20, 8), { fps: 4, frameMs: 250, drawCalls: 15, activeMeshes: 6 });
});
