import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import type { GameData, InputState } from './types';

const idle: InputState = { x: 0, z: 0, attack: false, interact: false };

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeSnapshot(child);
  }
  return value;
}

function playing(): GameData { return { ...createInitialData(), phase: 'playing' }; }

test('an ordinary tick shares unchanged scenery and histories without mutating its snapshot', () => {
  const previous = freezeSnapshot(playing());
  const next = stepGame(previous, FIXED_DT, idle);
  assert.notStrictEqual(next, previous);
  assert.notStrictEqual(next.player, previous.player);
  assert.strictEqual(next.breakables, previous.breakables);
  assert.strictEqual(next.sounds, previous.sounds);
  assert.strictEqual(next.visited, previous.visited);
  assert.strictEqual(next.enemies[0].path, previous.enemies[0].path);
  assert.equal(previous.elapsed, 0);
  assert.equal(next.elapsed, FIXED_DT);
});

test('breaking scenery copies only changed objects and keeps old sound and visit histories intact', () => {
  const state = playing();
  state.zone = 'dungeon';
  state.enemies = [];
  Object.assign(state.player, { x: 3, z: 1.9, facingX: 0, facingZ: 1, attackTime: .15, attackId: 1 });
  state.sounds = Array.from({ length: 28 }, (_, id) => ({ id, name: 'step' as const }));
  state.eventId = 28;
  const previous = freezeSnapshot(state);
  const next = stepGame(previous, FIXED_DT, idle);
  const brokenIndex = previous.breakables.findIndex(item => item.id === 'pot-hall-0');
  assert.equal(next.breakables[brokenIndex].broken, true);
  assert.equal(previous.breakables[brokenIndex].broken, false);
  assert.notStrictEqual(next.breakables, previous.breakables);
  for (let index = 0; index < next.breakables.length; index++) {
    if (index !== brokenIndex) assert.strictEqual(next.breakables[index], previous.breakables[index]);
  }
  assert.equal(next.sounds.length, 28);
  assert.equal(next.sounds.at(-1)?.name, 'break');
  assert.equal(previous.sounds.at(-1)?.name, 'step');
  assert.notStrictEqual(next.visited, previous.visited);
  assert.deepEqual(previous.visited, ['Willow’s Rest']);
});

test('consuming a route waypoint does not remove it from an earlier snapshot', () => {
  const state = playing();
  state.zone = 'dungeon';
  state.breakables = [];
  Object.assign(state.player, { x: 10, z: 17, invulnerable: 100 });
  const enemy = state.enemies.find(item => item.id === 'hall-1')!;
  Object.assign(enemy, { x: 10, z: 13, aggro: true, mode: 'chase', repathTime: 10,
    path: [{ x: 10, z: 13 }, { x: 9, z: 13 }] });
  state.enemies = [enemy];
  const previous = freezeSnapshot(state);
  const next = stepGame(previous, FIXED_DT, idle);
  assert.equal(previous.enemies[0].path.length, 2);
  assert.deepEqual(next.enemies[0].path, [{ x: 9, z: 13 }]);
});

test('zone transitions can reset routes while earlier snapshots remain frozen', () => {
  const state = playing();
  Object.assign(state.player, { x: 42, z: 24 });
  state.enemies[0].path = [{ x: 20, z: 8 }];
  const previous = freezeSnapshot(state);
  const next = stepGame(previous, FIXED_DT, { ...idle, interact: true });
  assert.equal(next.zone, 'dungeon');
  assert.equal(previous.zone, 'overworld');
  assert.deepEqual(previous.enemies[0].path, [{ x: 20, z: 8 }]);
  assert.ok(next.enemies.every(enemy => enemy.path.length === 0));
});
