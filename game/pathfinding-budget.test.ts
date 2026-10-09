import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePathSearch, createPathSearch, findPath, invalidateNavigationSpace, isPathClear,
  type NavigationSpace, type PathSearch, type PathSearchStep,
} from './pathfinding';
import type { Obstacle, Point } from './types';

const wall = (id: string, x: number, z: number, w: number, d: number): Obstacle => ({ id, kind: 'wall', x, z, w, d });
const start = { x: 2, z: 2 }, goal = { x: 10, z: 10 };
function drain(search: PathSearch, budget = 11) {
  let steps = 0, work = 0;
  for (;;) {
    const result = advancePathSearch(search, budget);
    assert.ok(result.workUsed <= budget);
    work += result.workUsed;
    steps++;
    if (result.done) return { ...result, steps, work };
    assert.equal(result.route, undefined, 'An unfinished search must not expose an incomplete route');
    assert.ok(steps < 100_000, 'The bounded search must eventually finish');
  }
}
function assertClear(start: Point, route: Point[], space: NavigationSpace) {
  let from = start;
  for (const to of route) { assert.ok(isPathClear(from, to, .43, space)); from = to; }
}

test('resumable searches obey the work allowance and preserve deterministic routes', () => {
  const space: NavigationSpace = {
    width: 14, height: 12,
    obstacles: [wall('lower', 4, 4.5, 1, 9), wall('upper', 8, 8, 1, 8)],
  };
  const search = createPathSearch(start, goal, .43, space);
  for (const budget of [0, -1, NaN, Infinity]) {
    assert.deepEqual(advancePathSearch(search, budget), { done: false, workUsed: 0 });
  }
  const result = drain(search);
  assert.equal(result.reachedGoal, true);
  assert.ok(result.steps > 1);
  assert.deepEqual(result.route, findPath(start, goal, .43, space));
  assertClear(start, result.route!, space);
  const expectedCost = result.route!.reduce((value, point, index, route) => {
    const from = index ? route[index - 1] : start;
    return value + Math.hypot(from.x - point.x, from.z - point.z);
  }, 0);
  assert.equal(result.cost, expectedCost);
  assert.deepEqual(advancePathSearch(search, 1), {
    done: true, workUsed: 0, route: result.route, reachedGoal: true, cost: expectedCost,
  });
});

test('the off-grid fallback also pauses between bounded visibility operations', () => {
  const center = 6.23, gap = .86, left = center - gap / 2, right = center + gap / 2;
  const obstacles = [wall('left', left / 2, 6, left, 1), wall('right', (right + 14) / 2, 6, 14 - right, 1)];
  let geometryReads = 0;
  for (const obstacle of obstacles) {
    const x = obstacle.x;
    Object.defineProperty(obstacle, 'x', { get() { geometryReads++; return x; } });
  }
  const space: NavigationSpace = { width: 14, height: 12, obstacles };
  const search = createPathSearch(start, goal, .43, space);
  let result: PathSearchStep, totalWork = 0;
  do {
    geometryReads = 0;
    result = advancePathSearch(search, 1);
    assert.ok(geometryReads <= 10 * obstacles.length,
      `A single work unit performed an unbounded geometry scan: ${geometryReads} reads`);
    assert.equal(result.workUsed, 1);
    totalWork++;
    assert.ok(totalWork < 100_000);
  } while (!result.done);
  assert.ok(totalWork > 100, 'This fixture must use the grid and narrow-gap fallback');
  assert.equal(result.reachedGoal, true);
  assert.deepEqual(result.route!.at(-1), goal);
  assertClear(start, result.route!, space);
});

test('unreachable destinations return a safe partial route and report failure to reach', () => {
  const space: NavigationSpace = { width: 14, height: 12, obstacles: [wall('divider', 7, 6, 1, 12)] };
  const result = drain(createPathSearch(start, goal, .43, space));
  assert.equal(result.reachedGoal, false);
  assert.ok(result.route!.length > 0);
  assert.ok(result.route!.at(-1)!.x < 6.5);
  assert.ok(Number.isFinite(result.cost));
  assertClear(start, result.route!, space);
});

test('pending routes are discarded when geometry revisions or identities change', () => {
  const block = wall('block', 7, 6, 1, 2);
  const space: NavigationSpace = { width: 14, height: 12, revision: 0, obstacles: [block] };
  const search = createPathSearch(start, goal, .43, space);
  assert.equal(advancePathSearch(search, 3).done, false);
  block.d = 12;
  space.revision = 1;
  assert.deepEqual(advancePathSearch(search, 10), {
    done: true, workUsed: 0, invalidated: true, route: [], reachedGoal: false, cost: Infinity,
  });
  const replaced = createPathSearch(start, goal, .43, space);
  space.obstacles = [...space.obstacles];
  assert.equal(advancePathSearch(replaced, 10).invalidated, true);
  const explicit = createPathSearch(start, goal, .43, space);
  invalidateNavigationSpace(space);
  assert.equal(advancePathSearch(explicit, 10).invalidated, true);
});

test('reused grids refresh when an obstacle changes in place between searches', () => {
  const gate = wall('gate', 7, 6, 1, 2);
  const space: NavigationSpace = { width: 14, height: 12, obstacles: [gate] };
  assert.equal(drain(createPathSearch(start, goal, .43, space)).reachedGoal, true);
  gate.d = 12;
  const closed = drain(createPathSearch(start, goal, .43, space));
  assert.equal(closed.reachedGoal, false);
  assertClear(start, closed.route!, space);
  gate.d = 2;
  const reopened = drain(createPathSearch(start, goal, .43, space));
  assert.equal(reopened.reachedGoal, true);
  assertClear(start, reopened.route!, space);
});

test('searches copy moving targets and isolate walkability for different body sizes', () => {
  const target = { ...goal };
  const clear: NavigationSpace = { width: 14, height: 12, obstacles: [] };
  const search = createPathSearch(start, target, .43, clear);
  target.x = 2;
  assert.deepEqual(drain(search).route, [goal]);
  const gate: NavigationSpace = {
    width: 12, height: 10,
    obstacles: [wall('left', 2.7, 5, 5.4, .5), wall('right', 9.3, 5, 5.4, .5)],
  };
  const from = { x: 5, z: 2 }, to = { x: 7, z: 8 };
  assert.equal(drain(createPathSearch(from, to, .43, gate)).reachedGoal, true);
  assert.equal(drain(createPathSearch(from, to, .83, gate)).reachedGoal, false);
  assert.equal(drain(createPathSearch(from, to, .43, gate)).reachedGoal, true);
});
