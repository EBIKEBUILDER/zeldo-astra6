import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, getNavigationStats, overlapsSolid, PATHFINDING_WORK_PER_TICK, PLAYER_RADIUS, stepGame } from './simulation';
import { portalEndpoint } from './navigation-network';
import { NAVIGATION_CHUNKS, NAVIGATION_PORTALS, WORLDS } from './world';
import type { GameData, Point } from './types';

const idle = { x: 0, z: 0, attack: false, interact: false };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function encounter(start: Point, target: Point, zone: GameData['zone'] = 'overworld') {
  const state = createInitialData();
  state.phase = 'playing';
  state.zone = zone;
  state.breakables = [];
  Object.assign(state.player, target, { invulnerable: 100 });
  const source = state.enemies.find(enemy => enemy.kind === 'blob' && enemy.zone === zone)!;
  state.enemies = [{ ...source, ...start, spawnX: start.x, spawnZ: start.z,
    progressX: start.x, progressZ: start.z, aggro: true, mode: 'chase', modeTime: 0 }];
  return state;
}

for (const { name, start, target, crossed } of [
  { name: 'the western column seam', start: { x: 14, z: 13.5 }, target: { x: 18, z: 13.5 }, crossed: (p: Point) => p.x > 16 },
  { name: 'the eastern column seam', start: { x: 30, z: 13 }, target: { x: 34, z: 13 }, crossed: (p: Point) => p.x > 32 },
  { name: 'the north/south row seam', start: { x: 28, z: 12 }, target: { x: 28, z: 16 }, crossed: (p: Point) => p.z > 14 },
]) {
  test(`an overworld pursuer crosses ${name} without stopping or losing aggro`, () => {
    let state = encounter(start, target), crossedSeam = false, reachedHero = false;
    for (let frame = 0; frame < 240; frame++) {
      const before = state.enemies[0];
      state = stepGame(state, FIXED_DT, idle);
      const enemy = state.enemies[0];
      crossedSeam ||= crossed(enemy);
      assert.equal(enemy.aggro, true);
      assert.equal(enemy.zone, 'overworld');
      assert.ok(!WORLDS.overworld.obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)));
      if (distance(enemy, state.player) <= enemy.radius + PLAYER_RADIUS + .045) { reachedHero = true; break; }
      assert.ok(distance(before, enemy) > .01, 'An unobstructed chunk edge must not interrupt movement');
    }
    assert.ok(crossedSeam);
    assert.ok(reachedHero);
  });
}

function entrancePortal() {
  const portal = NAVIGATION_PORTALS.find(item =>
    NAVIGATION_CHUNKS.find(chunk => chunk.id === item.fromChunk)?.zone === 'overworld' &&
    NAVIGATION_CHUNKS.find(chunk => chunk.id === item.toChunk)?.zone === 'dungeon');
  assert.ok(portal, 'The dungeon entrance must be defined as portal data');
  return portal;
}

test('dungeon mouths leash monsters by default and clear their obsolete routes', () => {
  const portal = entrancePortal();
  assert.equal(portal.traversableByAI, false);
  let state = encounter({ x: 42, z: 21.4 }, WORLDS.overworld.entrance);
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.zone, 'dungeon');
  assert.equal(state.enemies[0].zone, 'overworld');
  assert.equal(state.enemies[0].aggro, false);
  assert.equal(state.enemies[0].path.length, 0);
  for (let frame = 0; frame < 180; frame++) state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].zone, 'overworld');
});

test('enabling a dungeon portal lets a pursuer walk to the entrance and continue its chase', () => {
  const portal = entrancePortal(), original = portal.traversableByAI;
  portal.traversableByAI = true;
  try {
    let state = encounter({ x: 42, z: 21.4 }, WORLDS.overworld.entrance);
    state = stepGame(state, FIXED_DT, { ...idle, interact: true });
    assert.equal(state.zone, 'dungeon');
    assert.equal(state.enemies[0].zone, 'overworld', 'A remote monster must first walk to the portal');
    assert.equal(state.enemies[0].aggro, true, 'An AI-enabled connection must preserve pursuit');
    Object.assign(state.player, { x: 10, z: 6, invulnerable: 100 });
    let arrived = false, reachedHero = false;
    for (let frame = 0; frame < 900; frame++) {
      state = stepGame(state, FIXED_DT, idle);
      const enemy = state.enemies[0];
      assert.equal(enemy.aggro, true);
      if (enemy.zone === 'dungeon') {
        arrived = true;
        assert.ok(!WORLDS.dungeon.obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)));
        if (distance(enemy, state.player) <= enemy.radius + PLAYER_RADIUS + .045) { reachedHero = true; break; }
      }
    }
    assert.ok(arrived, 'The off-zone pursuer must traverse the enabled portal');
    assert.ok(reachedHero, 'Pursuit must continue after the portal landing');
  } finally {
    portal.traversableByAI = original;
  }
});

test('a portal refuses an obstructed landing and resumes after the pot blocking it breaks', () => {
  const portal = entrancePortal(), original = portal.traversableByAI;
  portal.traversableByAI = true;
  try {
    let state = encounter({ x: 42, z: 21.4 }, WORLDS.overworld.entrance);
    state = stepGame(state, FIXED_DT, { ...idle, interact: true });
    assert.equal(state.zone, 'dungeon');
    Object.assign(state.player, { x: 10, z: 6, invulnerable: 100 });
    const landing = portalEndpoint(NAVIGATION_CHUNKS, portal.toChunk, portal.toTile)!;
    assert.ok(landing);
    state.breakables = [{ id: 'landing-pot', kind: 'pot', zone: 'dungeon', x: landing.x, z: landing.z, broken: false, lastAttackId: -1 }];
    for (let frame = 0; frame < 300; frame++) {
      state = stepGame(state, FIXED_DT, idle);
      assert.equal(state.enemies[0].zone, 'overworld', 'Never teleport a body into blocked destination geometry');
      assert.ok(Number.isFinite(state.enemies[0].x) && Number.isFinite(state.enemies[0].z));
    }
    state.breakables = state.breakables.map(item => ({ ...item, broken: true }));
    let arrived = false;
    for (let frame = 0; frame < 900; frame++) {
      state = stepGame(state, FIXED_DT, idle);
      if (state.enemies[0].zone === 'dungeon') { arrived = true; break; }
    }
    assert.ok(arrived, 'A changed landing tile must invalidate the failed route and permit traversal');
  } finally {
    portal.traversableByAI = original;
  }
});

test('a defeated portal follower respawns in its original zone', () => {
  const portal = entrancePortal(), original = portal.traversableByAI;
  portal.traversableByAI = true;
  try {
    const spawn = { x: 42, z: 21.4 };
    let state = encounter(spawn, WORLDS.overworld.entrance);
    state = stepGame(state, FIXED_DT, { ...idle, interact: true });
    Object.assign(state.player, { x: 10, z: 6, invulnerable: 100 });
    for (let frame = 0; frame < 900 && state.enemies[0].zone !== 'dungeon'; frame++) {
      state = stepGame(state, FIXED_DT, idle);
    }
    assert.equal(state.enemies[0].zone, 'dungeon');
    Object.assign(state.enemies[0], { hp: 0, respawn: FIXED_DT });
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assert.equal(enemy.zone, 'overworld', 'Spawn coordinates must be interpreted in the original home zone');
    assert.equal(enemy.hp, enemy.maxHp);
    assert.equal(enemy.aggro, false);
    assert.equal(enemy.path.length, 0);
    assert.equal(enemy.x, spawn.x);
    assert.equal(enemy.z, spawn.z);
  } finally {
    portal.traversableByAI = original;
  }
});

test('an off-zone pursuer gives up on a permanently blocked portal and walks home', () => {
  const portal = entrancePortal(), original = portal.traversableByAI;
  portal.traversableByAI = true;
  try {
    const home = { x: 42, z: 21.4 };
    let state = encounter(home, WORLDS.overworld.entrance);
    Object.assign(state.enemies[0], { x: 42, z: 22.8, progressX: 42, progressZ: 22.8 });
    state = stepGame(state, FIXED_DT, { ...idle, interact: true });
    Object.assign(state.player, { x: 10, z: 6, invulnerable: 100 });
    const landing = portalEndpoint(NAVIGATION_CHUNKS, portal.toChunk, portal.toTile)!;
    state.breakables = [{ id: 'permanent-landing-pot', kind: 'pot', zone: 'dungeon', x: landing.x, z: landing.z, broken: false, lastAttackId: -1 }];
    let gaveUp = false, returnedHome = false;
    for (let frame = 0; frame < 1800; frame++) {
      state = stepGame(state, FIXED_DT, idle);
      const enemy = state.enemies[0];
      assert.equal(enemy.zone, 'overworld');
      gaveUp ||= !enemy.aggro;
      if (gaveUp && distance(enemy, home) < .16) { returnedHome = true; break; }
    }
    assert.ok(gaveUp, 'Unreachable off-zone pursuits must use the same stall timeout as local pursuits');
    assert.ok(returnedHome, 'An off-screen monster must finish walking back to its home');
  } finally {
    portal.traversableByAI = original;
  }
});

test('a disengaged follower returns through an enabled portal and finishes walking to its original spawn', () => {
  const originals = NAVIGATION_PORTALS.map(portal => portal.traversableByAI);
  for (const portal of NAVIGATION_PORTALS) portal.traversableByAI = true;
  try {
    const home = { x: 42, z: 21.4 };
    let state = encounter(home, WORLDS.overworld.entrance);
    state = stepGame(state, FIXED_DT, { ...idle, interact: true });
    Object.assign(state.player, { x: 10, z: 6, invulnerable: 100 });
    for (let frame = 0; frame < 900 && state.enemies[0].zone !== 'dungeon'; frame++) {
      state = stepGame(state, FIXED_DT, idle);
    }
    assert.equal(state.enemies[0].zone, 'dungeon');
    Object.assign(state.player, { x: 16, z: 10 });
    Object.assign(state.enemies[0], { aggro: false, mode: 'return', repathTime: 0, path: [],
      pursuitBlocked: true, blockedTargetX: state.player.x, blockedTargetZ: state.player.z });
    let returnedHome = false;
    for (let frame = 0; frame < 900; frame++) {
      state = stepGame(state, FIXED_DT, idle);
      const enemy = state.enemies[0];
      assert.equal(enemy.aggro, false);
      if (enemy.zone === 'overworld' && distance(enemy, home) < .16) { returnedHome = true; break; }
    }
    assert.ok(returnedHome, 'Returning through a portal must not freeze the monster at its off-screen landing');
  } finally {
    NAVIGATION_PORTALS.forEach((portal, index) => { portal.traversableByAI = originals[index]; });
  }
});

test('twelve obstructed pursuers share a bounded search budget without starving later enemies', () => {
  let state = encounter({ x: 2, z: 7 }, { x: 10, z: 17 }, 'dungeon');
  const source = state.enemies[0];
  state.enemies = Array.from({ length: 12 }, (_, index) => {
    const x = 2 + (index % 6) * 3, z = 7 + Math.floor(index / 6) * 3;
    return { ...source, id: `budget-blob-${index}`, x, z, spawnX: x, spawnZ: z, progressX: x, progressZ: z, path: [] };
  });
  const served = new Set<string>();
  let sawPending = false;
  for (let frame = 0; frame < 900; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const stats = getNavigationStats(state);
    assert.ok(stats.workUsed >= 0 && stats.workUsed <= PATHFINDING_WORK_PER_TICK,
      `Tick exceeded its navigation budget: ${stats.workUsed} > ${PATHFINDING_WORK_PER_TICK}`);
    sawPending ||= stats.pending > 0;
    for (const enemy of state.enemies) if (enemy.repathTime > 0) served.add(enemy.id);
    if (served.size === state.enemies.length) break;
  }
  assert.ok(sawPending, 'Exercise queued work rather than twelve cheap direct paths');
  assert.equal(served.size, 12, 'Every pursuer must receive a completed search, including those later in the update order');
});

test('replaying a snapshot with pending searches preserves its result and per-tick budget', () => {
  let state = encounter({ x: 2, z: 7 }, { x: 10, z: 17 }, 'dungeon');
  const source = state.enemies[0];
  state.enemies = Array.from({ length: 12 }, (_, index) => {
    const x = 2 + (index % 6) * 3, z = 7 + Math.floor(index / 6) * 3;
    return { ...source, id: `replay-blob-${index}`, x, z, spawnX: x, spawnZ: z, progressX: x, progressZ: z, path: [] };
  });
  state = stepGame(state, FIXED_DT, idle);
  const snapshot = state;
  assert.ok(getNavigationStats(snapshot).pending > 0, 'Retain actual unfinished work in the snapshot');
  const first = stepGame(snapshot, FIXED_DT, idle), firstStats = getNavigationStats(first);
  let future = first;
  for (let frame = 0; frame < 90; frame++) future = stepGame(future, FIXED_DT, idle);
  const replay = stepGame(snapshot, FIXED_DT, idle);
  assert.deepEqual(replay, first, 'Advancing another branch must not expose completed future paths early');
  assert.deepEqual(getNavigationStats(replay), firstStats, 'Replay uses the original simulated work allowance');
});

test('an unreachable pursuer settles without wall vibration and resumes when the gate opens', () => {
  let state = encounter({ x: 10, z: 12 }, { x: 10, z: 17 }, 'dungeon');
  const settled: Point[] = [];
  for (let frame = 0; frame < 360; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assert.ok(enemy.z <= 13.071, 'The closed gate must remain solid while searches are pending or unsuccessful');
    if (frame >= 300) settled.push({ x: enemy.x, z: enemy.z });
  }
  assert.ok(settled.every(point => distance(point, settled[0]) < .02), 'An unreachable destination should not cause repeated wall vibration');
  state.gateOpen = true;
  let reachedHero = false;
  for (let frame = 0; frame < 600; frame++) {
    state = stepGame(state, FIXED_DT, idle);
    const enemy = state.enemies[0];
    assert.equal(enemy.aggro, true);
    if (distance(enemy, state.player) <= enemy.radius + PLAYER_RADIUS + .045) { reachedHero = true; break; }
  }
  assert.ok(reachedHero, 'Changing the gate state must rebuild navigation and restart the route');
});
