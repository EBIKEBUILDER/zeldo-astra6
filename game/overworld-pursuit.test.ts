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

test('persistent pursuit keeps the original acquisition radius', () => {
  let state = encounter({ x: 33, z: 13 }, { x: 39, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'idle', 'A hero outside the original 5.7-tile radius must not acquire aggro');

  state = encounter({ x: 33, z: 13 }, { x: 38.6, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'chase');
});

test('a blob keeps chasing a moving hero beyond the old distance leash and its spawn area', () => {
  let state = encounter({ x: 29, z: 13 }, { x: 33, z: 13 });
  let greatestDistance = 0;
  for (let frame = 0; frame < 180; frame++) {
    state = stepGame(state, FIXED_DT, { ...idle, x: 1 });
    const enemy = state.enemies[0];
    greatestDistance = Math.max(greatestDistance, distance(enemy, state.player));
    assert.equal(enemy.mode, 'chase', 'Running ahead must not make the pursuer abandon the hero');
    assert.equal(enemy.aggro, true);
    assert.ok(enemy.vx > 0, 'Continue toward the fleeing hero rather than drifting back toward spawn');
    assert.ok(Math.hypot(enemy.vx, enemy.vz) <= 1.95 + 1e-8);
  }
  assert.ok(greatestDistance > 9.5, 'Exercise the old nine-tile disengagement threshold with normal player input');
  assert.ok(distance(state.enemies[0], { x: 29, z: 13 }) > 5, 'Follow the hero well beyond the idle patrol area');

  let reachedHero = false;
  for (let frame = 0; frame < 420; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    assert.equal(state.enemies[0].mode, 'chase');
    if (distance(state.enemies[0], state.player) < .83) { reachedHero = true; break; }
  }
  assert.ok(reachedHero, 'Catch up when the hero stops, without requiring fresh aggro');
});

test('a blob takes the long river crossing even when its detour exceeds the old pursuit radius', () => {
  let state = encounter({ x: 22.5, z: 6 }, { x: 27, z: 3 });
  let greatestDistance = 0, reachedBridge = false, reachedHero = false;
  for (let frame = 0; frame < 1200; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    greatestDistance = Math.max(greatestDistance, distance(enemy, state.player));
    reachedBridge ||= enemy.x > 23.3 && enemy.x < 26.3 && enemy.z > 11.4;
    assert.equal(enemy.mode, 'chase', 'A long obstacle detour must retain the acquired target');
    assert.ok(!WORLDS.overworld.obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)), 'Cross the bridge without cutting through the river');
    if (distance(enemy, state.player) < .83) { reachedHero = true; break; }
  }
  assert.ok(greatestDistance > 9, 'Require a detour farther away than the removed pursuit radius');
  assert.ok(reachedBridge, 'Use the actual bridge connecting the two banks');
  assert.ok(reachedHero, 'Finish the entire detour and reach the hero on the other bank');
});

test('spawn safety cancels a retained overworld chase immediately', () => {
  let state = encounter({ x: 14.6, z: 6 }, { x: 12.8, z: 6 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'chase');
  Object.assign(state.player, { x: SANCTUARY.x, z: SANCTUARY.z });
  for (let frame = 0; frame < 180; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assert.equal(enemy.aggro, false, 'The sanctuary still ends aggression immediately');
    assert.notEqual(enemy.mode, 'chase');
    assert.ok(distance(enemy, SANCTUARY) >= SANCTUARY.radius + enemy.radius - .001);
  }
  assert.equal(state.player.hp, state.player.maxHp);
});

test('a disengaged blob turns and walks home around a hedge instead of sliding backward into it', () => {
  const home = { x: 33, z: 7 };
  let state = encounter(home, { x: 35, z: 7 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  // The chase has carried the monster to the other side of the orchard hedge.
  Object.assign(state.enemies[0], { x: 33, z: 12.5, facingX: -1, facingZ: 0 });
  Object.assign(state.player, { x: SANCTUARY.x, z: SANCTUARY.z });
  let detour = 0, backwardFrames = 0, returnedHome = false;
  for (let frame = 0; frame < 2400; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0], speed = Math.hypot(enemy.vx, enemy.vz);
    assert.equal(enemy.aggro, false);
    assert.ok(speed <= .52 + 1e-8, 'Keep the existing unalerted walking speed');
    assert.ok(!WORLDS.overworld.obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)));
    assert.ok(Math.abs(Math.hypot(enemy.facingX, enemy.facingZ) - 1) < 1e-8);
    if (speed > .01) {
      const forward = (enemy.facingX * enemy.vx + enemy.facingZ * enemy.vz) / speed;
      backwardFrames = forward < 0 ? backwardFrames + 1 : 0;
      assert.ok(backwardFrames < 16, 'Turn to face the route promptly rather than backing home while watching the hero');
    }
    detour = Math.max(detour, Math.abs(enemy.x - home.x));
    if (distance(enemy, home) < .16) { returnedHome = true; break; }
    assert.equal(enemy.mode, 'return');
  }
  assert.ok(detour > 2.7, 'Navigate around an end of the hedge on the way home');
  assert.ok(returnedHome, 'Complete the return route instead of beelining into the hedge');
});

test('an obstructed blob keeps focus and resumes its route when the way opens', () => {
  let state = createInitialData();
  state.phase = 'playing';
  state.zone = 'dungeon';
  Object.assign(state.player, { x: 10, z: 17, invulnerable: 100 });
  const source = state.enemies.find(enemy => enemy.id === 'hall-1')!;
  state.enemies = [{ ...source, x: 10, z: 12, spawnX: 10, spawnZ: 12, modeTime: 0 }];
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  state.player.z = 25;
  for (let frame = 0; frame < 300; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assert.equal(enemy.aggro, true, 'A failed route must not discard the acquired hero');
    assert.equal(enemy.mode, 'chase');
    assert.ok(enemy.z < 13.1, 'Respect the closed gate while waiting for a viable route');
  }
  state.gateOpen = true;
  let reachedHero = false;
  for (let frame = 0; frame < 600; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    assert.equal(state.enemies[0].aggro, true);
    if (distance(state.enemies[0], state.player) < .83) { reachedHero = true; break; }
  }
  assert.ok(reachedHero, 'Retry navigation and follow through the gate without reacquiring nearby');
});

test('entering and leaving the dungeon clears old pursuit rather than carrying it between visits', () => {
  let state = encounter({ x: 33, z: 13 }, { x: 35, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  Object.assign(state.player, WORLDS.overworld.entrance);
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.zone, 'dungeon');
  assert.equal(state.enemies[0].aggro, false);
  assert.notEqual(state.enemies[0].mode, 'chase');
  assert.equal(state.enemies[0].path.length, 0);

  Object.assign(state.player, WORLDS.dungeon.exit, { invulnerable: 0 });
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.zone, 'overworld');
  for (let frame = 0; frame < 120; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    assert.equal(state.enemies[0].aggro, false, 'A distant monster must acquire the hero anew after a zone change');
    assert.notEqual(state.enemies[0].mode, 'chase');
  }
});

test('a defeated pursuer respawns without retaining its former target', () => {
  let state = encounter({ x: 33, z: 13 }, { x: 35, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  Object.assign(state.enemies[0], { hp: 0, respawn: FIXED_DT });
  Object.assign(state.player, { x: 44, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].hp, state.enemies[0].maxHp);
  assert.equal(state.enemies[0].aggro, false);
  assert.equal(state.enemies[0].path.length, 0);
  for (let frame = 0; frame < 120; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    assert.equal(state.enemies[0].aggro, false, 'Respawned enemies use the original acquisition range');
    assert.notEqual(state.enemies[0].mode, 'chase');
  }
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
