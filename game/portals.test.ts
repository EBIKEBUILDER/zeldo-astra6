import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, overlapsSolid, PLAYER_RADIUS, stepGame } from './simulation';
import { solidObstacles } from './navigation-runtime';
import { NAVIGATION_PORTALS, WORLDS } from './world';
import type { GameData, InputState, Zone } from './types';

const idle: InputState = { x: 0, z: 0, attack: false, interact: false };
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function atEntrance(): GameData {
  const state = createInitialData();
  state.phase = 'playing';
  state.enemies = [];
  Object.assign(state.player, { x: 42, z: 21 });
  return state;
}

function frames(state: GameData, count: number, input: InputState = idle): GameData {
  for (let frame = 0; frame < count; frame++) state = stepGame(state, FIXED_DT, input);
  return state;
}

function walkThrough(state: GameData, z: number, destination: Zone): GameData {
  for (let frame = 0; frame < 180 && state.zone !== destination; frame++) {
    state = stepGame(state, FIXED_DT, { ...idle, z });
  }
  assert.equal(state.zone, destination, `Walking must reach ${destination} without an interaction key`);
  return state;
}

test('both dungeon doorways activate on foot and stationary arrivals never bounce back', () => {
  let state = walkThrough(atEntrance(), 1, 'dungeon');
  assert.equal(state.player.x, WORLDS.dungeon.spawn.x);
  assert.equal(state.player.z, WORLDS.dungeon.spawn.z);
  state = frames(state, 180);
  assert.equal(state.zone, 'dungeon');
  assert.equal(state.sounds.filter(event => event.name === 'enter').length, 1);

  state = walkThrough(state, -1, 'overworld');
  assert.equal(state.player.x, WORLDS.overworld.exit.x);
  assert.equal(state.player.z, WORLDS.overworld.exit.z);
  state = frames(state, 180);
  assert.equal(state.zone, 'overworld');
  assert.equal(state.sounds.filter(event => event.name === 'enter').length, 2);
});

test('holding movement across either doorway continues into the destination', () => {
  let state = walkThrough(atEntrance(), 1, 'dungeon');
  state = frames(state, 60, { ...idle, z: 1, interact: true });
  assert.equal(state.zone, 'dungeon');
  assert.ok(state.player.z > WORLDS.dungeon.spawn.z + 3);
  assert.equal(state.sounds.filter(event => event.name === 'enter').length, 1);

  state = walkThrough(state, -1, 'overworld');
  state = frames(state, 60, { ...idle, z: -1, interact: true });
  assert.equal(state.zone, 'overworld');
  assert.ok(state.player.z < WORLDS.overworld.exit.z - 3);
  assert.equal(state.sounds.filter(event => event.name === 'enter').length, 2);
});

test('a deliberate immediate turn back works despite arrival invulnerability', () => {
  let state = walkThrough(atEntrance(), 1, 'dungeon');
  assert.ok(state.player.invulnerable > 1);
  state = walkThrough(state, -1, 'overworld');
  assert.ok(state.player.invulnerable > 1);
  state = walkThrough(state, 1, 'dungeon');
  assert.equal(state.sounds.filter(event => event.name === 'enter').length, 3);
});

test('portal arrivals have collision clearance outside the opposite activation radius', () => {
  const state = createInitialData();
  const enter = NAVIGATION_PORTALS.find(portal => portal.id === 'shrine-enter')!;
  const leave = NAVIGATION_PORTALS.find(portal => portal.id === 'shrine-leave')!;
  assert.ok(distance(WORLDS.dungeon.spawn, WORLDS.dungeon.exit) > leave.interactionRadius! + PLAYER_RADIUS);
  assert.ok(distance(WORLDS.overworld.exit, WORLDS.overworld.entrance) > enter.interactionRadius! + PLAYER_RADIUS);
  for (const [zone, landing] of [['dungeon', WORLDS.dungeon.spawn], ['overworld', WORLDS.overworld.exit]] as const) {
    assert.ok(solidObstacles(state, zone).every(obstacle => !overlapsSolid(landing, PLAYER_RADIUS, obstacle)));
  }
});

test('an obstructed destination cannot teleport the hero into solid scenery', () => {
  let state = atEntrance();
  Object.assign(state.player, WORLDS.overworld.entrance);
  state.breakables.push({ id: 'landing-blocker', kind: 'pot', zone: 'dungeon', ...WORLDS.dungeon.spawn, broken: false, lastAttackId: -1 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.zone, 'overworld');
  assert.equal(state.sounds.some(event => event.name === 'enter'), false);
});

test('the entrance blob has a clear home with room for a safe dungeon arrival', () => {
  let state = createInitialData();
  const guard = state.enemies.find(enemy => enemy.id === 'hall-entry')!;
  assert.equal(guard.zone, 'dungeon');
  assert.equal(guard.kind, 'blob');
  assert.equal(state.enemies.filter(enemy => enemy.zone === 'dungeon' && enemy.kind === 'blob').length, 3);
  assert.ok(distance(guard, WORLDS.dungeon.spawn) > PLAYER_RADIUS + guard.radius + 2);
  assert.ok(distance(guard, WORLDS.dungeon.spawn) < 4);
  assert.ok(solidObstacles(state, 'dungeon').every(obstacle => !overlapsSolid(guard, guard.radius, obstacle)));
  state.phase = 'playing';
  Object.assign(state.player, WORLDS.overworld.entrance);
  state = stepGame(state, FIXED_DT, idle);
  state = frames(state, 60);
  assert.equal(state.zone, 'dungeon');
  assert.equal(state.player.hp, state.player.maxHp);
});

test('walking up to the treasure still requires E to open it', () => {
  let state = atEntrance();
  state.zone = 'dungeon';
  state.bossDefeated = true;
  Object.assign(state.player, WORLDS.dungeon.chest);
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.chestOpen, false);
  assert.equal(state.phase, 'playing');
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.chestOpen, true);
  assert.equal(state.phase, 'victory');
});
