import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT } from './simulation';
import { recordPursuitProgress, resumePursuit, updatePursuitMemory } from './pursuit-memory';
import type { Enemy, Point } from './types';

const target = { x: 18, z: 12 };

function pursuing(): Enemy {
  const source = createInitialData().enemies.find(enemy => enemy.kind === 'blob')!;
  return { ...source, x: 14, z: 12, spawnX: 14, spawnZ: 12, progressX: 14, progressZ: 12,
    mode: 'chase', aggro: true, path: [{ ...target }] };
}

function hold(enemy: Enemy, seconds: number, player: Point = target) {
  for (let frame = 0; frame < Math.round(seconds / FIXED_DT); frame++) {
    updatePursuitMemory(enemy, player, false, FIXED_DT);
    recordPursuitProgress(enemy, player, false, FIXED_DT);
  }
}

test('even a distant detour away from the hero preserves aggression while the mob is moving', () => {
  const enemy = pursuing();
  for (let frame = 0; frame < 2400; frame++) {
    updatePursuitMemory(enemy, target, false, FIXED_DT);
    enemy.x -= 1.95 * FIXED_DT;
    recordPursuitProgress(enemy, target, false, FIXED_DT);
  }
  assert.equal(enemy.aggro, true);
  assert.equal(enemy.mode, 'chase');
  assert.equal(enemy.farTime, 0);
  assert.ok(Math.abs(enemy.x - enemy.spawnX) > 70);
});

test('twenty seconds of continuously stalled pursuit triggers a stationary, remembered reset', () => {
  const enemy = pursuing();
  enemy.vx = 1.95;
  hold(enemy, 19.9);
  assert.equal(enemy.aggro, true, 'Allow a generous time to solve a blocked route');
  hold(enemy, .1);
  assert.equal(enemy.aggro, false);
  assert.equal(enemy.mode, 'return');
  assert.equal(enemy.pursuitBlocked, true);
  assert.equal(enemy.blockedTargetX, target.x);
  assert.equal(enemy.blockedTargetZ, target.z);
  assert.deepEqual(enemy.path, []);
  assert.equal(enemy.vx, 0);
  assert.equal(enemy.vz, 0);
  hold(enemy, 5);
  assert.equal(enemy.aggro, false, 'Do not immediately reacquire the same nearby, unreachable hero');
});

test('fresh movement resets the complete stall timer while collision jitter does not', () => {
  const enemy = pursuing();
  hold(enemy, 19);
  enemy.z += .2;
  recordPursuitProgress(enemy, target, false, FIXED_DT);
  assert.equal(enemy.stuckTime, 0);
  hold(enemy, 19);
  assert.equal(enemy.aggro, true);
  const anchor = enemy.x;
  for (let frame = 0; frame < 60; frame++) {
    enemy.x = anchor + (frame % 2 ? .01 : -.01);
    recordPursuitProgress(enemy, target, false, FIXED_DT);
  }
  assert.equal(enemy.aggro, false);
});

test('contact and hitstun are combat, not failed navigation', () => {
  const enemy = pursuing();
  hold(enemy, 19);
  hold(enemy, 30, { x: enemy.x + enemy.radius + .34, z: enemy.z });
  assert.equal(enemy.aggro, true);
  assert.equal(enemy.stuckTime, 0);
  enemy.hitstun = .2;
  hold(enemy, 30);
  assert.equal(enemy.aggro, true);
  assert.equal(enemy.stuckTime, 0);
});

test('a timed-out mob can reacquire when the hero changes position or a route opens', () => {
  const enemy = pursuing();
  hold(enemy, 20);
  updatePursuitMemory(enemy, { x: target.x, z: target.z + .4 }, false, FIXED_DT);
  assert.equal(enemy.aggro, false, 'Tiny movement must not repeatedly revive the same failing chase');
  updatePursuitMemory(enemy, { x: target.x, z: target.z + 1.6 }, false, FIXED_DT);
  assert.equal(enemy.aggro, true);
  assert.equal(enemy.pursuitBlocked, false);

  hold(enemy, 20);
  assert.equal(enemy.aggro, false);
  resumePursuit(enemy);
  assert.equal(enemy.aggro, true, 'A confirmed usable route or sword hit can restart pursuit');
  assert.equal(enemy.pursuitBlocked, false);
  assert.equal(enemy.stuckTime, 0);
  assert.equal(enemy.repathTime, 0);
});

test('shelter pauses remembered pursuit and permits escape after eighteen seconds', () => {
  const enemy = pursuing();
  for (let frame = 0; frame < 600; frame++) {
    updatePursuitMemory(enemy, target, true, FIXED_DT);
    recordPursuitProgress(enemy, target, true, FIXED_DT);
  }
  assert.equal(enemy.aggro, true);
  assert.equal(enemy.stuckTime, 0);
  updatePursuitMemory(enemy, target, false, FIXED_DT);
  assert.equal(enemy.lostSightTime, 0);
  for (let frame = 0; frame < 1080; frame++) updatePursuitMemory(enemy, target, true, FIXED_DT);
  assert.equal(enemy.aggro, false);
  assert.equal(enemy.mode, 'return');
  updatePursuitMemory(enemy, target, true, FIXED_DT);
  assert.equal(enemy.aggro, false, 'A nearby sheltered hero cannot trigger fresh aggression');
});
