import test from 'node:test';
import assert from 'node:assert/strict';
import type { Enemy, GameData, InputState, Point } from './types';
import { createInitialData, FIXED_DT, overlapsSolid, PLAYER_RADIUS, stepGame } from './simulation';
import { SANCTUARY, WORLDS } from './world';

const idle: InputState = { x: 0, z: 0, attack: false, interact: false };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function encounter(kind: Enemy['kind'], start: Point, target: Point): GameData {
  const state = createInitialData();
  state.phase = 'playing';
  state.zone = 'dungeon';
  state.gateOpen = true;
  Object.assign(state.player, target, { invulnerable: 100 });
  const source = state.enemies.find(enemy => enemy.kind === kind && enemy.zone === 'dungeon')!;
  state.enemies = [{ ...source, ...start, spawnX: start.x, spawnZ: start.z,
    progressX: start.x, progressZ: start.z, modeTime: 0 }];
  assert.ok(!WORLDS.dungeon.obstacles.some(obstacle => overlapsSolid(start, source.radius, obstacle)), 'Start outside solid scenery');
  assert.ok(!WORLDS.dungeon.obstacles.some(obstacle => overlapsSolid(target, PLAYER_RADIUS, obstacle)), 'Place the hero on walkable ground');
  return state;
}

function advance(state: GameData, count: number): GameData {
  for (let frame = 0; frame < count; frame++) state = stepGame(state, FIXED_DT, idle);
  return state;
}

function assertOutsideWalls(state: GameData) {
  const enemy = state.enemies[0];
  assert.ok(!WORLDS[state.zone].obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)), 'A pursuer must walk around scenery');
}

test('a chasing blob detours around a real dungeon pillar and reaches the hero at its original speed', () => {
  let state = encounter('blob', { x: 2.4, z: 4.7 }, { x: 5.6, z: 4.7 });
  let detour = 0, closest = Infinity;
  for (let frame = 0; frame < 180; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assertOutsideWalls(state);
    assert.ok(Math.abs(Math.hypot(enemy.vx, enemy.vz) - 1.95) < 1e-8);
    detour = Math.max(detour, Math.abs(enemy.z - 4.7));
    closest = Math.min(closest, distance(enemy, state.player));
  }
  assert.ok(detour > 1.1, 'Go around the pillar rather than stopping at its face');
  assert.ok(closest < .8, 'Finish the detour and reach contact range');
});

test('the Guardian walks around a close pillar before rushing, with unchanged chase and charge speeds', () => {
  let state = encounter('boss', { x: 2.2, z: 20.5 }, { x: 6, z: 20.5 });
  let detour = 0, closest = Infinity, chased = false, charged = false, fastestChase = 0;
  for (let frame = 0; frame < 180; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assertOutsideWalls(state);
    if (enemy.mode === 'chase') {
      chased = true;
      const speed = Math.hypot(enemy.vx, enemy.vz);
      fastestChase = Math.max(fastestChase, speed);
      assert.ok(speed <= 2.65 + 1e-8);
      detour = Math.max(detour, Math.abs(enemy.z - 20.5));
    }
    if (enemy.mode === 'charge') {
      charged = true;
      assert.ok(Math.abs(Math.hypot(enemy.vx, enemy.vz) - 7.2) < 1e-8);
    }
    closest = Math.min(closest, distance(enemy, state.player));
  }
  assert.ok(chased && detour > 1.4, 'A nearby hero behind a pillar must provoke a detour, not repeated blocked rushes');
  assert.ok(Math.abs(fastestChase - 2.65) < 1e-8);
  assert.ok(charged, 'Resume the existing telegraphed rush once the route is clear');
  assert.ok(closest < 1.21, 'Reach the hero after navigating around the pillar');
});

test('the Guardian completes a tight pillar corner instead of endlessly discarding the necessary waypoint', () => {
  let state = encounter('boss',
    { x: 3.630176237039268, z: 18.074227524548768 },
    { x: 5.674181633349508, z: 21.915586518496273 });
  state.breakables = [];
  state.enemies[0].mode = 'chase';
  let reachedHero = false, charged = false;
  // This approach previously stopped just short of (5.5, 19.5): consuming the
  // nearby corner made the next segment intersect the pillar on every replan.
  for (let frame = 0; frame < 240; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    assertOutsideWalls(state);
    charged ||= state.enemies[0].mode === 'charge';
    if (distance(state.enemies[0], state.player) < 1.21) {
      reachedHero = true;
      break;
    }
  }
  assert.ok(charged, 'Finishing the corner should allow the existing rush to begin');
  assert.ok(reachedHero, 'The Guardian must reach the hero rather than repeatedly retry the same blocked corner');
});

test('the Guardian changes its detour sooner than a blob when the hero switches sides of a pillar', () => {
  const makePursuit = (kind: Enemy['kind']) => {
    let state = encounter(kind, { x: 6, z: 20.5 }, { x: 2.2, z: 20.5 });
    state = stepGame(state, FIXED_DT, idle);
    assert.ok(state.enemies[0].vz < 0, 'Initially approach around the lower side');
    state.player.z = 22;
    return state;
  };
  const boss = advance(makePursuit('boss'), 15);
  const blob = advance(makePursuit('blob'), 15);
  assert.ok(boss.enemies[0].vz > 2, 'The Guardian should already be taking the new upper detour');
  assert.ok(blob.enemies[0].vz < 0, 'Normal mobs may continue their older route briefly');
  const refreshedBlob = advance(blob, 35).enemies[0];
  assert.equal(refreshedBlob.path.at(-1)?.z, 22, 'Normal mobs also refresh their route to the new destination');
});

test('new pursuit keeps the Guardian behind its gate and inside its arena', () => {
  let state = encounter('boss', { x: 10, z: 21 }, { x: 10, z: 12 });
  state.gateOpen = false;
  state = advance(state, 120);
  assert.equal(state.enemies[0].x, 10);
  assert.equal(state.enemies[0].z, 21);
  assert.equal(state.enemies[0].mode, 'idle');
  assert.equal(state.projectiles.length, 0);

  state.gateOpen = true;
  state.player.z = 15.2;
  for (let frame = 0; frame < 180; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    assert.ok(state.enemies[0].z >= 15.5 + state.enemies[0].radius - .001);
    assertOutsideWalls(state);
  }
  assert.ok(state.enemies[0].z < 18, 'The Guardian still approaches the edge of its arena');
  state.player.z = 12;
  const position = { x: state.enemies[0].x, z: state.enemies[0].z };
  state = advance(state, 60);
  assert.equal(state.enemies[0].mode, 'idle');
  assert.equal(distance(state.enemies[0], position), 0);
});

test('briefly returning to the spawn sanctuary preserves pursuit without letting the monster inside', () => {
  let state = createInitialData();
  state.phase = 'playing';
  Object.assign(state.player, { x: 12.8, z: 6 });
  const source = state.enemies.find(enemy => enemy.id === 'clover-1')!;
  state.enemies = [{ ...source, x: 14.6, z: 6, spawnX: 14.6, spawnZ: 6, modeTime: 0 }];
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'chase');
  state.player.x = 12;
  for (let frame = 0; frame < 180; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assert.equal(enemy.mode, 'watch');
    assert.equal(enemy.aggro, true);
    assert.ok(distance(enemy, SANCTUARY) >= SANCTUARY.radius + enemy.radius - .001);
  }
  assert.equal(state.player.hp, state.player.maxHp);
});

function freezeDeep(value: unknown) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
}

test('following and replanning a route preserves previous snapshots and deterministic serializable state', () => {
  const initial = stepGame(encounter('blob', { x: 2.4, z: 4.7 }, { x: 5.6, z: 4.7 }), FIXED_DT, idle);
  assert.ok(initial.enemies[0].path.length > 1, 'Exercise a route with actual detour waypoints');
  const snapshot = structuredClone(initial);
  freezeDeep(initial);
  const first = advance(initial, 150), second = advance(initial, 150);
  assert.deepEqual(initial, snapshot, 'Consuming a path must not mutate an earlier store snapshot');
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.ok(first.enemies[0].path.length < initial.enemies[0].path.length);
});
