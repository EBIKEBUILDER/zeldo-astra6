import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameStats } from './frame-stats';

test('FPS counts actual frames, averages draws, and only publishes twice per second', () => {
  const meter = createFrameStats();
  meter.reset(1000);
  for (let i = 1; i < 30; i++) assert.equal(meter.record(1000 + i * 500 / 30, 40), null);
  assert.deepEqual(meter.record(1500, 70), { fps: 60, drawCalls: 41 });
  // A long frame must lower the measured FPS; simulation dt clamping cannot hide it.
  assert.deepEqual(meter.record(2000, 20), { fps: 2, drawCalls: 20 });
});

test('reset excludes suspended time and discards samples from before resuming', () => {
  const meter = createFrameStats();
  meter.reset(0);
  meter.record(100, 100);
  meter.reset(10000);
  assert.equal(meter.record(10250, 10), null);
  assert.deepEqual(meter.record(10500, 20), { fps: 4, drawCalls: 15 });
});
