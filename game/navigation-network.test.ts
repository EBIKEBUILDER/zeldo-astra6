import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceNavigationSearch, createNavigationSearch, portalEndpoint,
  type NavigationNetwork, type NavigationPortal, type NavigationPosition, type NavigationSearch,
} from './navigation-network';
import { isPathClear } from './pathfinding';
import type { Obstacle } from './types';

const point = (x: number, z: number, zone: 'overworld' | 'dungeon' = 'overworld'): NavigationPosition => ({ x, z, zone });
const wall = (x: number, z: number, w: number, d: number): Obstacle => ({ id: 'wall', kind: 'wall', x, z, w, d });
const portal = (id: string, from: number, to: number, cost = 1, crossZone = true): NavigationPortal => ({
  id, fromChunk: 'west', fromTile: { x: from * 2, z: 4 }, toChunk: crossZone ? 'room' : 'west',
  toTile: { x: to * 2, z: 4 }, traversalCost: cost, traversableByAI: true,
});
function network(portals: NavigationPortal[] = []): NavigationNetwork {
  return {
    chunks: [
      { id: 'west', zone: 'overworld', origin: { x: 0, z: 0 }, width: 10, height: 10 },
      { id: 'east', zone: 'overworld', origin: { x: 10, z: 0 }, width: 10, height: 10 },
      { id: 'room', zone: 'dungeon', origin: { x: 0, z: 0 }, width: 20, height: 10 },
    ], portals,
    spaces: { overworld: { width: 20, height: 10, obstacles: [] }, dungeon: { width: 20, height: 10, obstacles: [] } },
  };
}
function finish(search: NavigationSearch, budget = 100) {
  for (let step = 0; step < 100000; step++) {
    const result = advanceNavigationSearch(search, budget);
    assert.ok(result.workUsed <= budget, `Consumed ${result.workUsed} work with ${budget} available`);
    if (result.done) return result;
  }
  throw new Error('Search did not finish');
}

test('adjacent chunks share one continuous space, including a seam endpoint', () => {
  const world = network();
  assert.deepEqual(portalEndpoint(world, 'west', { x: 20, z: 4 }), point(10, 2));
  const goal = point(18, 2);
  const result = finish(createNavigationSearch(point(2, 2), goal, .43, world), 1);
  assert.equal(result.reachedGoal, true);
  assert.deepEqual(result.route, [goal]);
  assert.equal(result.cost, 16);
});

test('a directed portal has an explicit source marker and arrival waypoint', () => {
  const world = network([portal('entrance', 4, 2)]);
  const result = finish(createNavigationSearch(point(2, 2), point(6, 2, 'dungeon'), .43, world), 1);
  assert.equal(result.reachedGoal, true);
  assert.deepEqual(result.route, [
    { ...point(4, 2), portalId: 'entrance' }, point(2, 2, 'dungeon'), point(6, 2, 'dungeon'),
  ]);
  assert.equal(result.cost, 7);
  const reverse = finish(createNavigationSearch(point(6, 2, 'dungeon'), point(2, 2), .43, world));
  assert.equal(reverse.reachedGoal, false);
  assert.deepEqual(reverse.route, []);
});

test('cheap same-zone warps compete with walking and portal traversal costs', () => {
  const world = network([portal('expensive', 3, 9, 20, false), portal('cheap', 4, 9, 0, false)]);
  const result = finish(createNavigationSearch(point(2, 2), point(10, 2), .43, world));
  assert.equal(result.reachedGoal, true);
  assert.equal(result.cost, 3);
  assert.deepEqual(result.route?.filter(point => point.portalId).map(point => point.portalId), ['cheap']);
});

test('dungeon mouths exclude monsters by default but remain usable for player routing', () => {
  const entrance = portal('entrance', 4, 2);
  delete entrance.traversableByAI;
  const world = network([entrance]);
  const start = point(2, 2), goal = point(6, 2, 'dungeon');
  assert.equal(finish(createNavigationSearch(start, goal, .43, world)).reachedGoal, false);
  assert.equal(finish(createNavigationSearch(start, goal, .43, world, { forAI: false })).reachedGoal, true);
  entrance.traversableByAI = true;
  assert.equal(finish(createNavigationSearch(start, goal, .43, world)).reachedGoal, true);
});

test('an inaccessible portal approach cannot teleport from a partial path', () => {
  const world = network([portal('behind-wall', 8, 2)]);
  world.spaces.overworld.obstacles = [wall(5, 5, 1, 10)];
  const result = finish(createNavigationSearch(point(2, 2), point(6, 2, 'dungeon'), .43, world), 7);
  assert.equal(result.reachedGoal, false);
  assert.ok(result.route?.every(point => point.zone === 'overworld' && !point.portalId));
});

test('portal arrival clearance is checked before relaxing its edge', () => {
  const world = network([portal('blocked-arrival', 4, 2)]);
  world.spaces.dungeon.obstacles = [wall(2, 2, 2, 2)];
  const result = finish(createNavigationSearch(point(2, 2), point(6, 2, 'dungeon'), .43, world));
  assert.equal(result.reachedGoal, false);
  assert.ok(result.route?.every(point => !point.portalId));
});

test('budgeted portal paths yield and invalidate when navigation or portal data changes', () => {
  const world = network([portal('entrance', 4, 2)]);
  const search = createNavigationSearch(point(2, 2), point(6, 2, 'dungeon'), .43, world);
  assert.deepEqual(advanceNavigationSearch(search, 0), { done: false, workUsed: 0 });
  assert.equal(advanceNavigationSearch(search, 1).done, false);
  world.spaces.dungeon.revision = 1;
  assert.equal(advanceNavigationSearch(search, 1).invalidated, true);
  const edited = createNavigationSearch(point(2, 2), point(6, 2, 'dungeon'), .43, world);
  world.portals[0].traversableByAI = false;
  assert.equal(advanceNavigationSearch(edited, 1).invalidated, true);
});

test('malformed portal data is ignored instead of producing invalid routes', () => {
  const valid = portal('entrance', 4, 2);
  for (const invalid of [
    { ...valid, fromChunk: 'missing' }, { ...valid, traversalCost: -1 },
    { ...valid, traversalCost: Infinity }, { ...valid, fromTile: { x: 2.5, z: 4 } },
    { ...valid, toTile: { x: 1000, z: 4 } },
  ]) {
    const result = finish(createNavigationSearch(point(2, 2), point(6, 2, 'dungeon'), .43, network([invalid])));
    assert.equal(result.reachedGoal, false);
    assert.deepEqual(result.route, []);
  }
});

test('consecutive colocated portals retain both source-arrival pairs', () => {
  const first = portal('first', 4, 2);
  const second: NavigationPortal = { ...portal('second', 2, 9), fromChunk: 'room', toChunk: 'west' };
  const world = network([first, second]);
  const result = finish(createNavigationSearch(point(3, 2), point(10, 2), .43, world));
  assert.equal(result.cost, 4);
  assert.deepEqual(result.route, [
    { ...point(4, 2), portalId: 'first' }, point(2, 2, 'dungeon'),
    { ...point(2, 2, 'dungeon'), portalId: 'second' }, point(9, 2), point(10, 2),
  ]);
});

test('a same-zone warp crosses disconnected geometry without smoothing away its marker', () => {
  const world = network([portal('warp', 4, 8, 0, false)]);
  world.spaces.overworld.obstacles = [wall(6, 5, 1, 10)];
  const start = point(2, 2), goal = point(10, 2);
  assert.equal(isPathClear(start, goal, .43, world.spaces.overworld), false);
  const result = finish(createNavigationSearch(start, goal, .43, world), 31);
  assert.equal(result.reachedGoal, true);
  assert.equal(result.cost, 4);
  assert.deepEqual(result.route, [{ ...point(4, 2), portalId: 'warp' }, point(8, 2), goal]);
});

test('an unreachable goal retains a useful clear partial route after a legal portal crossing', () => {
  const world = network([portal('entrance', 4, 2)]);
  world.spaces.dungeon.obstacles = [wall(5, 5, 1, 10)];
  const result = finish(createNavigationSearch(point(2, 2), point(8, 2, 'dungeon'), .43, world), 29);
  assert.equal(result.reachedGoal, false);
  assert.equal(result.route?.[0].portalId, 'entrance');
  assert.deepEqual(result.route?.[1], point(2, 2, 'dungeon'));
  const endpoint = result.route!.at(-1)!;
  assert.equal(endpoint.zone, 'dungeon');
  assert.ok(endpoint.x > 2 && endpoint.x < 4.5);
  assert.ok(isPathClear(point(2, 2, 'dungeon'), endpoint, .43, world.spaces.dungeon));
});

test('interleaved searches and zero-cost portal cycles preserve routes and each call budget', () => {
  const first = portal('out', 4, 2, 0);
  const second: NavigationPortal = { ...portal('back', 2, 4, 0), fromChunk: 'room', toChunk: 'west' };
  const world = network([first, second]);
  const start = point(2, 2), goal = point(8, 2, 'dungeon');
  const expected = finish(createNavigationSearch(start, goal, .43, world));
  const searches = [createNavigationSearch(start, goal, .43, world), createNavigationSearch(goal, start, .43, world)];
  const results: ReturnType<typeof advanceNavigationSearch>[] = [];
  for (let tick = 0; (!results[0]?.done || !results[1]?.done) && tick < 10000; tick++) {
    for (let id = 0; id < searches.length; id++) {
      if (results[id]?.done) continue;
      const budget = 1 + tick % 7, result = advanceNavigationSearch(searches[id], budget);
      assert.ok(result.workUsed <= budget);
      if (result.done) results[id] = result;
    }
  }
  assert.equal(results[0]?.reachedGoal, true);
  assert.equal(results[1]?.reachedGoal, true);
  assert.deepEqual(results[0]?.route, expected.route);
  assert.equal(results[0]?.cost, expected.cost);
});
