import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameData, Point } from './types';
import { createInitialData, FIXED_DT, overlapsSolid, PLAYER_RADIUS, stepGame } from './simulation';
import { SANCTUARY, WORLDS } from './world';

const idle = { x: 0, z: 0, attack: false, interact: false };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function encounter(start: Point, target: Point): GameData {
  const state = createInitialData();
  state.phase = 'playing';
  Object.assign(state.player, target, { invulnerable: 100 });
  const source = state.enemies.find(enemy => enemy.id === 'orchard-1')!;
  state.enemies = [{ ...source, ...start, spawnX: start.x, spawnZ: start.z,
    progressX: start.x, progressZ: start.z, modeTime: 0 }];
  assert.ok(!WORLDS.overworld.obstacles.some(obstacle => overlapsSolid(start, source.radius, obstacle)));
  assert.ok(!WORLDS.overworld.obstacles.some(obstacle => overlapsSolid(target, PLAYER_RADIUS, obstacle)));
  return state;
}

test('a blob finishes the orchard hedge detour even when the route first leads away from the hero', () => {
  let state = encounter({ x: 38, z: 6.75 }, { x: 39, z: 1.45 });
  let greatestDistance = 0, reachedHero = false;
  // The tree at (39, 7) forces a longer route around the hedge's southern end.
  // Previously crossing the 5.7-tile acquisition radius cancelled the route,
  // so the monster repeatedly walked back toward its spawn instead.
  for (let frame = 0; frame < 600; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    const separation = distance(enemy, state.player);
    greatestDistance = Math.max(greatestDistance, separation);
    assert.equal(enemy.mode, 'chase', 'A necessary detour must not cancel an active chase');
    assert.ok(Math.hypot(enemy.vx, enemy.vz) <= 1.95 + 1e-8, 'Keep the original movement speed');
    assert.ok(!WORLDS.overworld.obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)));
    if (separation < .83) { reachedHero = true; break; }
  }
  assert.ok(greatestDistance > 5.7, 'Exercise the part of the detour outside initial aggro range');
  assert.ok(reachedHero, 'Finish navigating around the real hedge and reach melee range');
});

test('retaining an existing chase does not expand initial aggro or prevent the hero from escaping', () => {
  let state = encounter({ x: 33, z: 13 }, { x: 39, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'idle', 'A hero outside the original 5.7-tile radius must not acquire aggro');

  state = encounter({ x: 33, z: 13 }, { x: 35, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'chase');
  Object.assign(state.player, { x: 13, z: 18 });
  for (let frame = 0; frame < 120; frame++) state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'idle', 'A hero who genuinely leaves the area can still disengage');
});

test('spawn safety cancels a retained overworld chase immediately', () => {
  let state = encounter({ x: 14.6, z: 6 }, { x: 12.8, z: 6 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'chase');
  Object.assign(state.player, { x: SANCTUARY.x, z: SANCTUARY.z });
  for (let frame = 0; frame < 180; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assert.equal(enemy.mode, 'idle');
    assert.ok(distance(enemy, SANCTUARY) >= SANCTUARY.radius + enemy.radius - .001);
  }
  assert.equal(state.player.hp, state.player.maxHp);
});

for (const { name, start, target } of [
  { name: 'the meadow rock against the northern pines', start: { x: 18.5, z: 1.5578811115363413 }, target: { x: 18.5, z: 4.442118888463659 } },
  { name: 'the eastern rock beside the border', start: { x: 46.494, z: 20.5 }, target: { x: 43.306, z: 20.5 } },
  { name: 'the narrow passage between the Elder Stones', start: { x: 37.5, z: 25.38875 }, target: { x: 38.5, z: 23.21125 } },
  { name: 'a hero hugging the meadow rock', start: { x: 15.158444392029196, z: 5.245217344723642 }, target: { x: 18.537218416496966, z: 2.0335287720923563 } },
]) {
  test(`a blob reaches melee range around ${name} without stopping at a partial route`, () => {
    let state = encounter(start, target), reachedHero = false, stoppedFrames = 0;
    for (let frame = 0; frame < 300; frame++) {
      const before = state.enemies[0];
      state = stepGame(state, FIXED_DT, idle);
      const enemy = state.enemies[0];
      assert.equal(enemy.mode, 'chase');
      assert.ok(!WORLDS.overworld.obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)), 'The route must work with actual wall collision');
      if (distance(enemy, state.player) <= enemy.radius + PLAYER_RADIUS + .045) { reachedHero = true; break; }
      stoppedFrames = distance(before, enemy) < .001 ? stoppedFrames + 1 : 0;
      assert.ok(stoppedFrames < 15, 'A clear route must not leave the monster stationary between replans');
    }
    assert.ok(reachedHero, 'Reach contact range instead of stopping near an unreachable grid endpoint');
  });
}
