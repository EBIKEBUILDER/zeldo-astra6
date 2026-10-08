import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameData, Point, Zone } from './types';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import { SANCTUARY } from './world';

const idle = { x: 0, z: 0, attack: false, interact: false };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function encounter(start: Point, target: Point, zone: Zone = 'overworld'): GameData {
  const state = createInitialData();
  state.phase = 'playing';
  state.zone = zone;
  Object.assign(state.player, target, { invulnerable: 100 });
  const source = state.enemies.find(enemy => enemy.kind === 'blob' && enemy.zone === zone)!;
  state.enemies = [{ ...source, ...start, spawnX: start.x, spawnZ: start.z,
    progressX: start.x, progressZ: start.z, modeTime: 0 }];
  return state;
}

function advance(state: GameData, seconds: number): GameData {
  for (let frame = 0; frame < Math.round(seconds / FIXED_DT); frame++) state = stepGame(state, FIXED_DT, idle);
  return state;
}

test('escaping requires a sustained large gap instead of immediately dropping a distant pursuer', () => {
  let state = encounter({ x: 14.6, z: 6 }, { x: 17, z: 6 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  Object.assign(state.player, { x: 45, z: 13 });
  state = advance(state, 2.5);
  assert.ok(distance(state.enemies[0], state.player) > 22, 'The hero has opened a substantial gap');
  assert.equal(state.enemies[0].aggro, true, 'A far-away target gets a grace period before the monster gives up');
  assert.equal(state.enemies[0].mode, 'chase');
  state = advance(state, .6);
  assert.equal(state.enemies[0].aggro, false, 'Sustaining that large gap for three seconds allows escape');
  assert.notEqual(state.enemies[0].mode, 'chase');
});

test('closing a briefly opened escape gap renews the entire distance grace period', () => {
  let state = encounter({ x: 14.6, z: 6 }, { x: 17, z: 6 });
  state = stepGame(state, FIXED_DT, idle);
  Object.assign(state.player, { x: 45, z: 13 });
  state = advance(state, 2);
  assert.equal(state.enemies[0].aggro, true);
  assert.ok(state.enemies[0].farTime > 1.9);
  Object.assign(state.player, { x: 18, z: 13 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].farTime, 0);
  Object.assign(state.player, { x: 45, z: 13 });
  state = advance(state, 2);
  assert.equal(state.enemies[0].aggro, true, 'Separate short escapes must not accumulate into an abrupt reset');
});

test('a fully hidden distant hero remains remembered for eighteen seconds', () => {
  let state = encounter({ x: 10, z: 12 }, { x: 10, z: 10 }, 'dungeon');
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  // The locked gate blocks both pursuit and sight; the hero is well beyond
  // hearing distance but still much closer than the distance escape threshold.
  Object.assign(state.player, { x: 10, z: 25 });
  state = advance(state, 17.5);
  assert.equal(state.enemies[0].aggro, true);
  assert.equal(state.enemies[0].mode, 'chase');
  assert.ok(state.enemies[0].lostSightTime > 17.4);
  assert.ok(state.enemies[0].z < 13.1, 'Remembering the hero must not bypass the locked gate');
  state = advance(state, .6);
  assert.equal(state.enemies[0].aggro, false, 'Extended complete concealment eventually permits a natural reset');
});

test('a nearby hero behind a wall maintains the pursuer’s attention', () => {
  let state = encounter({ x: 10, z: 12 }, { x: 10, z: 17 }, 'dungeon');
  state = advance(state, 19);
  assert.equal(state.enemies[0].aggro, true, 'A close hero is not lost merely because an obstacle hides them');
  assert.equal(state.enemies[0].mode, 'chase');
  assert.equal(state.enemies[0].lostSightTime, 0);
  assert.ok(state.enemies[0].z < 13.1);
});

test('renewed sight and nearby awareness each refresh pursuit memory', () => {
  let state = encounter({ x: 29, z: 13 }, { x: 40, z: 13 });
  Object.assign(state.enemies[0], { aggro: true, lostSightTime: 17.9 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  assert.equal(state.enemies[0].lostSightTime, 0, 'Seeing the distant hero clears old concealment time');

  state = encounter({ x: 10, z: 12 }, { x: 10, z: 17 }, 'dungeon');
  Object.assign(state.enemies[0], { aggro: true, lostSightTime: 17.9 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  assert.equal(state.enemies[0].lostSightTime, 0, 'Hearing the nearby hero clears old concealment time through a wall');
});

test('water blocks the route without hiding a hero visible across the river', () => {
  let state = encounter({ x: 20, z: 5 }, { x: 30, z: 5 });
  Object.assign(state.enemies[0], { aggro: true, lostSightTime: 17.9 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  assert.equal(state.enemies[0].lostSightTime, 0, 'A river is not an opaque obstacle');
  assert.ok(state.enemies[0].path.length > 1, 'Navigation still takes a detour to the bridge');
});

test('brief sanctuary retreats retain attention, while extended shelter allows escape safely', () => {
  let state = encounter({ x: 14.6, z: 6 }, { x: 12.8, z: 6 });
  state.player.invulnerable = 0;
  state = stepGame(state, FIXED_DT, idle);
  Object.assign(state.player, { x: 12, z: 6 });
  state = advance(state, 5);
  assert.equal(state.enemies[0].aggro, true);
  assert.equal(state.enemies[0].mode, 'watch');
  assert.ok(state.enemies[0].lostSightTime > 4.9);
  assert.equal(state.player.hp, state.player.maxHp);
  assert.ok(distance(state.enemies[0], SANCTUARY) >= SANCTUARY.radius + state.enemies[0].radius - .001);

  // Leave shelter away from the remembered pursuer. This remains beyond the
  // original acquisition radius, so pursuit must resume from retained memory.
  Object.assign(state.player, { x: 8, z: 12 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].aggro, true);
  assert.equal(state.enemies[0].mode, 'chase');
  assert.equal(state.enemies[0].lostSightTime, 0);

  Object.assign(state.player, { x: SANCTUARY.x, z: SANCTUARY.z });
  state = advance(state, 17.5);
  assert.equal(state.enemies[0].aggro, true);
  state = advance(state, .6);
  assert.equal(state.enemies[0].aggro, false, 'Hiding safely for the complete grace period ends pursuit');
  assert.equal(state.player.hp, state.player.maxHp);
});

test('leaving sanctuary immediately replaces a cached guard route with pursuit', () => {
  let state = encounter({ x: 14.6, z: 6 }, { x: 17, z: 6 });
  state = stepGame(state, FIXED_DT, idle);
  Object.assign(state.player, { x: SANCTUARY.x, z: SANCTUARY.z });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'watch');
  assert.ok(state.enemies[0].path.length > 0, 'Exercise an enemy still approaching its guard position');
  const guardRoute = structuredClone(state.enemies[0].path);
  state.enemies[0].repathTime = .6;
  // Exiting below the hedge requires a new detour rather than direct steering.
  Object.assign(state.player, { x: 10, z: 12 });
  state = stepGame(state, FIXED_DT, idle);
  const enemy = state.enemies[0];
  assert.equal(enemy.aggro, true);
  assert.equal(enemy.mode, 'chase');
  assert.notDeepEqual(enemy.path, guardRoute, 'Do not finish a stale guard route while the hero escapes');
  assert.ok(enemy.repathTime > .7, 'Replan immediately instead of waiting for the old cooldown');
  assert.ok(distance(enemy.path[enemy.path.length - 1], state.player) < .01);
});

test('a hero who starts in the sanctuary never attracts an idle monster', () => {
  let state = encounter({ x: 12.7, z: 6 }, { x: SANCTUARY.x, z: SANCTUARY.z });
  state.player.invulnerable = 0;
  state = advance(state, 20);
  assert.equal(state.enemies[0].aggro, false);
  assert.notEqual(state.enemies[0].mode, 'chase');
  assert.equal(state.player.hp, state.player.maxHp);
  assert.ok(distance(state.enemies[0], SANCTUARY) >= SANCTUARY.radius + state.enemies[0].radius - .001);
});
