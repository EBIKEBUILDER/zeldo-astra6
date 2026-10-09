import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import { BOSS_RANGED_WINDUP } from './boss-attacks';
import type { GameData, InputState } from './types';

const idle: InputState = { x: 0, z: 0, attack: false, interact: false };

function withoutHazards(state: GameData): GameData {
  // Fast Refresh can retain a live store created before this field existed.
  const legacy: Partial<GameData> = { ...state };
  delete legacy.hazards;
  return legacy as GameData;
}

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeSnapshot(child);
  }
  return value;
}

test('an older live state resumes its ranged warning, projectile, and hazard without resetting progress', () => {
  const state = createInitialData();
  Object.assign(state, { phase: 'playing', zone: 'dungeon', hasKey: true, gateOpen: true, rupees: 37, elapsed: 83 });
  Object.assign(state.player, { x: 1.4, z: 24.5, hp: 4, invulnerable: 100 });
  state.enemies = state.enemies.filter(enemy => enemy.kind === 'boss');
  Object.assign(state.enemies[0], { mode: 'ranged-windup', modeTime: BOSS_RANGED_WINDUP,
    rangedAimX: state.player.x, rangedAimZ: state.player.z });
  state.breakables = [];
  const previous = freezeSnapshot(withoutHazards(state));
  const original = JSON.stringify(previous);
  let next = stepGame(previous, FIXED_DT, { ...idle, x: 1 });
  assert.deepEqual(next.hazards, []);
  assert.equal(next.phase, 'playing');
  assert.equal(next.zone, 'dungeon');
  assert.equal(next.rupees, 37);
  assert.equal(next.player.hp, 4);
  assert.equal(next.hasKey, true);
  assert.equal(next.gateOpen, true);
  assert.ok(next.enemies[0].modeTime < BOSS_RANGED_WINDUP);
  assert.ok(next.player.x > previous.player.x, 'The hero can move again immediately');
  for (let frame = 0; frame < 60 && next.projectiles.length === 0; frame++) {
    next = stepGame(next, FIXED_DT, { ...idle, x: 1 });
  }
  assert.equal(next.projectiles.length, 1, 'The preserved telegraph releases its attack');
  assert.ok(next.projectiles[0].lob);
  for (let frame = 0; frame < 90 && next.hazards.length === 0; frame++) next = stepGame(next, FIXED_DT, idle);
  assert.equal(next.hazards.length, 1, 'The new hazard field remains usable through impact');
  assert.equal(next.projectiles.length, 0);
  assert.equal(next.player.hp, 4);
  assert.ok(next.elapsed > 84);
  assert.equal(JSON.stringify(previous), original, 'Upgrading a live state must not mutate older snapshots');
  assert.equal(Object.hasOwn(previous, 'hazards'), false);
});

test('an older overworld state gains the new collection without losing its ongoing adventure', () => {
  const state = createInitialData();
  Object.assign(state, { phase: 'playing', elapsed: 45, rupees: 12 });
  Object.assign(state.player, { x: 9, z: 6, hp: 5 });
  const previous = freezeSnapshot(withoutHazards(state));
  const next = stepGame(previous, FIXED_DT, idle);
  assert.deepEqual(next.hazards, []);
  assert.equal(next.zone, 'overworld');
  assert.equal(next.player.x, 9);
  assert.equal(next.player.z, 6);
  assert.equal(next.player.hp, 5);
  assert.equal(next.rupees, 12);
  assert.ok(next.elapsed > 45);
});

test('an older paused snapshot stays frozen and can resume into the current state shape', () => {
  const state = createInitialData();
  state.phase = 'paused';
  state.elapsed = 71;
  const previous = freezeSnapshot(withoutHazards(state));
  assert.strictEqual(stepGame(previous, FIXED_DT, idle), previous);
  assert.equal(Object.hasOwn(previous, 'hazards'), false);
  const resumed = stepGame({ ...previous, phase: 'playing' }, FIXED_DT, idle);
  assert.deepEqual(resumed.hazards, []);
  assert.ok(resumed.elapsed > 71);
});
