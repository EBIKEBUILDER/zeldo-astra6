import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, isPathClear, type NavigationSpace } from './pathfinding';
import type { Obstacle, Point } from './types';

const wall = (id: string, x: number, z: number, w: number, d: number): Obstacle => ({ id, kind: 'wall', x, z, w, d });
const space = (obstacles: Obstacle[] = []): NavigationSpace => ({ width: 14, height: 12, obstacles });
function assertClearRoute(start: Point, route: Point[], radius: number, world: NavigationSpace) {
  let previous = start;
  for (const waypoint of route) {
    assert.ok(isPathClear(previous, waypoint, radius, world), `Blocked segment: ${JSON.stringify(previous)} to ${JSON.stringify(waypoint)}`);
    previous = waypoint;
  }
}
const last = (route: Point[]) => route[route.length - 1];

test('open terrain takes a direct route and excludes the starting point', () => {
  const start = { x: 2.13, z: 2.27 }, goal = { x: 11.11, z: 9.32 };
  assert.deepEqual(findPath(start, goal, .83, space()), [goal]);
  assert.deepEqual(findPath(start, start, .83, space()), []);
});

test('a deterministic eight-way route winds around staggered walls', () => {
  const world = space([wall('lower-wall', 4, 4.5, 1, 9), wall('upper-wall', 8, 8, 1, 8)]);
  const start = { x: 2.13, z: 2.27 }, goal = { x: 12, z: 2 };
  const route = findPath(start, goal, .43, world);
  assert.deepEqual(last(route), goal);
  assert.ok(route.some(point => point.z > 9.43));
  assert.ok(route.some(point => point.x > 4.5 && point.x < 7.5 && point.z < 3.57));
  assertClearRoute(start, route, .43, world);
  assert.deepEqual(findPath(start, goal, .43, world), route);
});

test('monster radius determines whether a narrow gate can be crossed', () => {
  const world: NavigationSpace = { width: 12, height: 10, obstacles: [wall('left', 2.7, 5, 5.4, .5), wall('right', 9.3, 5, 5.4, .5)] };
  const start = { x: 6, z: 2 }, goal = { x: 6, z: 8 };
  assert.deepEqual(last(findPath(start, goal, .43, world)), goal);
  const bossRoute = findPath(start, goal, .83, world);
  assert.ok(bossRoute.length > 0, 'A sealed route still approaches its reachable side');
  assert.ok(last(bossRoute).z < 5, 'The destination must stay on the reachable side of the gate');
  assertClearRoute(start, bossRoute, .83, world);
});

test('diagonal routes cannot clip corners or tunnel through thin obstacles', () => {
  const world = space([wall('thin', 5, 5, .08, .08), wall('corner', 8, 8, 2, 2)]);
  const start = { x: 2, z: 2 }, goal = { x: 11, z: 10 };
  assert.equal(isPathClear({ x: 4, z: 4 }, { x: 6, z: 6 }, .1, world), false);
  assert.equal(isPathClear({ x: 6, z: 7 }, { x: 7, z: 6 }, .83, world), false);
  const route = findPath(start, goal, .83, world);
  assert.deepEqual(last(route), goal);
  assertClearRoute(start, route, .83, world);
});

test('swept clearance allows tangential wall escape and respects rounded corners', () => {
  const world = space([wall('block', 5, 5, 2, 2)]);
  assert.equal(isPathClear({ x: 3, z: 5 }, { x: 3, z: 8 }, 1, world), true);
  assert.equal(isPathClear({ x: 3, z: 5 }, { x: 3.01, z: 8 }, 1, world), false);
  assert.equal(isPathClear({ x: 3, z: 3 }, { x: 2, z: 2 }, Math.SQRT2, world), true);
  const start = { x: 3, z: 5 }, goal = { x: 8, z: 5 };
  const route = findPath(start, goal, 1, world);
  assert.deepEqual(last(route), goal);
  assertClearRoute(start, route, 1, world);
});

test('opening a gate and breaking a pot immediately changes supplied navigation geometry', () => {
  const permanent = [wall('left', 2.25, 6, 4.5, 1), wall('right', 10.75, 6, 6.5, 1)];
  const gate = wall('gate', 6, 6, 3, 1), pot = wall('pot', 6, 6, .52, .52);
  const start = { x: 6, z: 2 }, goal = { x: 6, z: 10 };
  const closed = findPath(start, goal, .83, space([...permanent, gate]));
  assert.ok(last(closed).z < 6);
  const open = findPath(start, goal, .83, space(permanent));
  assert.deepEqual(open, [goal]);
  const intactPot = findPath(start, goal, .83, space([...permanent, pot]));
  assert.ok(last(intactPot).z < 6, 'The pot blocks the large boss from squeezing past');
  assert.deepEqual(findPath(start, goal, .83, space(permanent)), [goal]);
});

test('an unreachable player beside a wall gets the closest reachable endpoint', () => {
  const world = space([wall('divider', 7, 6, 1, 12)]);
  const start = { x: 2, z: 3 }, goal = { x: 7.85, z: 8.1 };
  const route = findPath(start, goal, .83, world);
  const endpoint = last(route);
  assert.ok(endpoint.x < 6, 'Do not choose a nearby node on the far side of the wall');
  assert.ok(Math.abs(endpoint.z - goal.z) <= .25);
  assert.ok(endpoint.x >= 5.5);
  assertClearRoute(start, route, .83, world);
});

test('boss arena center limits and world edges remain impassable', () => {
  const radius = .83;
  const world: NavigationSpace = { width: 20, height: 28, obstacles: [], bounds: { minZ: 15.5 + radius } };
  const start = { x: 10, z: 20 }, goal = { x: 10, z: 14 };
  const route = findPath(start, goal, radius, world);
  assert.ok(route.length > 0);
  assert.ok(route.every(point => point.z >= 15.5 + radius));
  assert.equal(isPathClear(start, goal, radius, world), false);
  assert.equal(isPathClear(start, { x: .5, z: 20 }, radius, world), false);
  assertClearRoute(start, route, radius, world);
});

test('paths route around the circular spawn sanctuary with body clearance', () => {
  const world: NavigationSpace = { ...space(), exclusions: [{ x: 7, z: 6, radius: 2 }] };
  const start = { x: 3, z: 6 }, goal = { x: 11, z: 6 };
  assert.equal(isPathClear(start, goal, .43, world), false);
  const route = findPath(start, goal, .43, world);
  assert.deepEqual(last(route), goal);
  assertClearRoute(start, route, .43, world);
  assert.ok(route.some(point => Math.abs(point.z - 6) > 2));
  const inside = findPath(start, { x: 7, z: 6 }, .43, world);
  assert.ok(Math.hypot(last(inside).x - 7, last(inside).z - 6) >= 2.43);
  assertClearRoute(start, inside, .43, world);
});
