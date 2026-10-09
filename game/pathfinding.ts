import type { Obstacle, Point } from './types';

export type NavigationSpace = {
  width: number;
  height: number;
  obstacles: readonly Obstacle[];
  /** Increment when mutating navigation geometry while a search is pending. */
  revision?: string | number;
  /** Stable cache identity for callers that recreate otherwise identical spaces. */
  cacheKey?: object;
  /** Optional center-coordinate limits, in addition to the world's edges. */
  bounds?: { minX?: number; maxX?: number; minZ?: number; maxZ?: number };
  /** Geometric exclusion radii; the moving body's radius is added here. */
  exclusions?: readonly (Point & { radius: number })[];
};

const CELL = .5;
const CLEARANCE = .02;
const EPSILON = .000001;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function segmentPointDistanceSquared(start: Point, end: Point, x: number, z: number) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared));
  return (start.x + dx * t - x) ** 2 + (start.z + dz * t - z) ** 2;
}

function pointBoxDistanceSquared(point: Point, minX: number, maxX: number, minZ: number, maxZ: number) {
  const dx = Math.max(minX - point.x, 0, point.x - maxX);
  const dz = Math.max(minZ - point.z, 0, point.z - maxZ);
  return dx * dx + dz * dz;
}

function intersectsBox(start: Point, end: Point, minX: number, maxX: number, minZ: number, maxZ: number) {
  let entry = 0, exit = 1;
  const dx = end.x - start.x, dz = end.z - start.z;
  // This slab check runs for every nearby obstacle during route searches.
  // Scalar axes avoid allocating nested arrays in the collision hot path.
  if (Math.abs(dx) < 1e-12) {
    if (start.x < minX || start.x > maxX) return false;
  } else {
    const first = (minX - start.x) / dx, last = (maxX - start.x) / dx;
    entry = Math.max(entry, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (entry > exit) return false;
  }
  if (Math.abs(dz) < 1e-12) {
    if (start.z < minZ || start.z > maxZ) return false;
  } else {
    const first = (minZ - start.z) / dz, last = (maxZ - start.z) / dz;
    entry = Math.max(entry, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (entry > exit) return false;
  }
  return true;
}

/** Exact swept-circle clearance, including rounded AABB corners and tangency.
 * Checking the whole segment also prevents a fast body from skipping a wall. */
export function isPathClear(start: Point, end: Point, radius: number, space: NavigationSpace): boolean {
  const minX = Math.max(radius + .05, space.bounds?.minX ?? -Infinity);
  const maxX = Math.min(space.width - radius - .05, space.bounds?.maxX ?? Infinity);
  const minZ = Math.max(radius + .05, space.bounds?.minZ ?? -Infinity);
  const maxZ = Math.min(space.height - radius - .05, space.bounds?.maxZ ?? Infinity);
  const leftmost = Math.min(start.x, end.x), rightmost = Math.max(start.x, end.x);
  const bottommost = Math.min(start.z, end.z), topmost = Math.max(start.z, end.z);
  if (leftmost < minX - EPSILON || rightmost > maxX + EPSILON || bottommost < minZ - EPSILON || topmost > maxZ + EPSILON) return false;
  for (const exclusion of space.exclusions ?? []) {
    if (segmentPointDistanceSquared(start, end, exclusion.x, exclusion.z) < (radius + exclusion.radius) ** 2 - EPSILON) return false;
  }
  const threshold = Math.max(0, radius * radius - EPSILON);
  for (const obstacle of space.obstacles) {
    const left = obstacle.x - obstacle.w / 2, right = obstacle.x + obstacle.w / 2;
    const bottom = obstacle.z - obstacle.d / 2, top = obstacle.z + obstacle.d / 2;
    // Most world objects cannot touch this segment, even after radius inflation.
    if (rightmost < left - radius || leftmost > right + radius ||
        topmost < bottom - radius || bottommost > top + radius) continue;
    if (intersectsBox(start, end, left, right, bottom, top)) return false;
    if (pointBoxDistanceSquared(start, left, right, bottom, top) < threshold ||
        pointBoxDistanceSquared(end, left, right, bottom, top) < threshold ||
        segmentPointDistanceSquared(start, end, left, bottom) < threshold ||
        segmentPointDistanceSquared(start, end, left, top) < threshold ||
        segmentPointDistanceSquared(start, end, right, bottom) < threshold ||
        segmentPointDistanceSquared(start, end, right, top) < threshold) return false;
  }
  return true;
}

type SearchNode = { id: number; score: number; cost: number };
function before(a: SearchNode, b: SearchNode) { return a.score < b.score || (a.score === b.score && a.id < b.id); }
class MinHeap {
  private nodes: SearchNode[] = [];
  get length() { return this.nodes.length; }
  push(node: SearchNode) {
    let at = this.nodes.length;
    this.nodes.push(node);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!before(node, this.nodes[parent])) break;
      this.nodes[at] = this.nodes[parent];
      at = parent;
    }
    this.nodes[at] = node;
  }
  pop() {
    const result = this.nodes[0], last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      let at = 0;
      while (at * 2 + 1 < this.nodes.length) {
        let child = at * 2 + 1;
        if (child + 1 < this.nodes.length && before(this.nodes[child + 1], this.nodes[child])) child++;
        if (!before(this.nodes[child], last)) break;
        this.nodes[at] = this.nodes[child];
        at = child;
      }
      this.nodes[at] = last;
    }
    return result;
  }
}

export type PathResult = { route: Point[]; reachedGoal: boolean; cost: number };
export type PathSearchStep = { done: boolean; workUsed: number; invalidated?: boolean } & Partial<PathResult>;
type GridCache = { signature: string; generation: object; walkability: Map<number, Uint8Array> };
const gridCaches = new WeakMap<object, GridCache>();

function geometrySignature(space: NavigationSpace) {
  // Geometry, rather than obstacle IDs or array identity, determines validity.
  // This also catches callers mutating a tile in place between searches.
  return JSON.stringify([
    space.width, space.height, space.revision,
    space.bounds?.minX, space.bounds?.maxX, space.bounds?.minZ, space.bounds?.maxZ,
    space.obstacles.map(({ x, z, w, d }) => [x, z, w, d]),
    space.exclusions?.map(({ x, z, radius }) => [x, z, radius]),
  ]);
}

function navigationCache(space: NavigationSpace): GridCache {
  const key = space.cacheKey ?? space, signature = geometrySignature(space);
  let cache = gridCaches.get(key);
  if (!cache || cache.signature !== signature) {
    cache = { signature, generation: {}, walkability: new Map() };
    gridCaches.set(key, cache);
  }
  return cache;
}

/** Invalidates lazy grid cells and any pending searches using this identity. */
export function invalidateNavigationSpace(space: NavigationSpace) {
  gridCaches.delete(space.cacheKey ?? space);
}

function spaceVersion(space: NavigationSpace) {
  return [space.revision, space.width, space.height,
    space.bounds?.minX, space.bounds?.maxX, space.bounds?.minZ, space.bounds?.maxZ,
    space.obstacles, space.obstacles.length, space.exclusions, space.exclusions?.length] as const;
}

export type PathSearch = {
  /** Search-owned iterator. Use advancePathSearch to apply validity checks. */
  readonly iterator: Generator<void, PathResult, void>;
  readonly space: NavigationSpace;
  readonly version: ReturnType<typeof spaceVersion>;
  readonly generation: object;
  result?: PathResult;
  invalidated?: boolean;
};

/** Each yield represents one bounded candidate/edge operation. This includes
 * graph construction, smoothing and visibility edges in the narrow-gap fallback,
 * so a large fallback cannot escape the simulation's shared per-tick budget.
 * One collision operation scans the supplied scenery using cheap broad-phase
 * rejection; it never performs another path search or a graph-wide scan. */
function* resultFor(route: Point[], reachedGoal: boolean, start: Point): Generator<void, PathResult, void> {
  let cost = 0, previous = start;
  for (const point of route) {
    cost += distance(previous, point);
    previous = point;
    yield;
  }
  return { route, reachedGoal, cost };
}

/** A coarse grid can miss a perfectly usable gap between two pieces of scenery.
 * Only incomplete grid routes need this geometry-aligned visibility graph. */
function* completeAroundCorners(start: Point, goal: Point, radius: number, space: NavigationSpace, gridRoute: Point[], goalRadius: number): Generator<void, PathResult, void> {
  const goalClear = isPathClear(goal, goal, radius, space);
  yield;
  // A player can stand closer to a wall than a larger monster. A reachable
  // contact position is sufficient; never aim into the wall itself.
  const contactRange = goalRadius > 0 ? Math.max(0, radius + goalRadius - .08) : 0;
  const points: Point[] = [start];
  function* add(point: Point): Generator<void, void, void> {
    if (isPathClear(point, point, radius, space)) points.push({ x: point.x, z: point.z });
    yield;
  }
  if (goalClear) yield* add(goal);
  else if (contactRange > 0) {
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12;
      yield* add({ x: goal.x + Math.cos(angle) * contactRange, z: goal.z + Math.sin(angle) * contactRange });
    }
  }
  for (const point of gridRoute) yield* add(point);
  const buffer = radius + CLEARANCE;
  for (const obstacle of space.obstacles) {
    for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
      const x = obstacle.x + sideX * obstacle.w / 2, z = obstacle.z + sideZ * obstacle.d / 2;
      yield* add({ x: x + sideX * buffer, z: z + sideZ * buffer });
      // The comfort margin must not seal a gap the body can physically fit.
      const tight = { x: x + sideX * radius, z: z + sideZ * radius };
      const bufferedShoulders = [{ x: x + sideX * buffer, z }, { x, z: z + sideZ * buffer }];
      const tightShoulders = [{ x: tight.x, z }, { x, z: tight.z }];
      let needsTightCorner = false;
      for (let i = 0; i < 2; i++) {
        const point = bufferedShoulders[i];
        needsTightCorner = !isPathClear(point, point, radius, space) &&
          isPathClear(tightShoulders[i], tightShoulders[i], radius, space);
        yield;
        if (needsTightCorner) break;
      }
      if (needsTightCorner) yield* add(tight);
    }
  }
  for (const exclusion of space.exclusions ?? []) {
    // The circumscribed ring's chords stay outside the sanctuary as well.
    const ringRadius = (exclusion.radius + buffer) / Math.cos(Math.PI / 32);
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      yield* add({ x: exclusion.x + Math.cos(angle) * ringRadius, z: exclusion.z + Math.sin(angle) * ringRadius });
    }
  }
  const costs = new Float64Array(points.length).fill(Infinity);
  const parents = new Int32Array(points.length).fill(-1), closed = new Uint8Array(points.length);
  const heuristic = (point: Point) => Math.max(0, distance(point, goal) - (goalClear ? 0 : contactRange));
  const open = new MinHeap();
  costs[0] = 0;
  open.push({ id: 0, cost: 0, score: heuristic(start) });
  let closest = 0, reachedGoal = false;
  while (open.length > 0) {
    const current = open.pop();
    yield;
    if (closed[current.id] || current.cost > costs[current.id]) continue;
    closed[current.id] = 1;
    const point = points[current.id], toGoal = distance(point, goal);
    if (toGoal < distance(points[closest], goal) - EPSILON) closest = current.id;
    if (toGoal <= (goalClear ? EPSILON : contactRange + EPSILON)) {
      closest = current.id;
      reachedGoal = true;
      break;
    }
    for (let id = 1; id < points.length; id++) {
      // Yield even for a rejected edge: high-degree visibility nodes are
      // resumed across ticks instead of hiding quadratic work in one expansion.
      yield;
      if (closed[id]) continue;
      const next = points[id], cost = current.cost + distance(point, next);
      if (cost >= costs[id] || !isPathClear(point, next, radius, space)) continue;
      costs[id] = cost;
      parents[id] = current.id;
      open.push({ id, cost, score: cost + heuristic(next) });
    }
  }
  // Preserve a better closest approach found by the grid.
  if (!reachedGoal && gridRoute.length > 0 && distance(points[closest], goal) >= distance(gridRoute[gridRoute.length - 1], goal) - EPSILON) {
    return yield* resultFor(gridRoute, false, start);
  }
  const route: Point[] = [];
  for (let at = closest; at > 0; at = parents[at]) { route.push(points[at]); yield; }
  return yield* resultFor(route.reverse(), reachedGoal, start);
}

function* searchWithCache(start: Point, goal: Point, radius: number, space: NavigationSpace, goalRadius: number, cache: GridCache): Generator<void, PathResult, void> {
  if (distance(start, goal) < EPSILON) return { route: [], reachedGoal: true, cost: 0 };
  const direct = isPathClear(start, goal, radius, space);
  yield;
  if (direct) return { route: [{ x: goal.x, z: goal.z }], reachedGoal: true, cost: distance(start, goal) };

  const columns = Math.floor(space.width / CELL) + 1, rows = Math.floor(space.height / CELL) + 1;
  const count = columns * rows;
  const costs = new Float64Array(count).fill(Infinity);
  const parents = new Int32Array(count).fill(-1), closed = new Uint8Array(count);
  let walkability = cache.walkability.get(radius);
  if (!walkability) { walkability = new Uint8Array(count); cache.walkability.set(radius, walkability); }
  const pointAt = (id: number): Point => ({ x: (id % columns) * CELL, z: Math.floor(id / columns) * CELL });
  const walkable = (id: number) => {
    if (walkability[id] === 0) {
      const point = pointAt(id);
      walkability[id] = isPathClear(point, point, radius + CLEARANCE, space) ? 1 : 2;
    }
    return walkability[id] === 1;
  };
  const open = new MinHeap();
  // Attach the real start to nearby visible nodes. Nominal clearance lets a
  // body touching a wall leave it before taking the buffered route.
  const startX = Math.round(start.x / CELL), startZ = Math.round(start.z / CELL);
  for (let z = Math.max(0, startZ - 2); z <= Math.min(rows - 1, startZ + 2); z++) {
    for (let x = Math.max(0, startX - 2); x <= Math.min(columns - 1, startX + 2); x++) {
      yield;
      const id = z * columns + x, point = pointAt(id), cost = distance(start, point);
      if (cost > CELL * 2 || !walkable(id) || !isPathClear(start, point, radius, space)) continue;
      costs[id] = cost;
      open.push({ id, cost, score: cost + distance(point, goal) });
    }
  }
  const goalClear = isPathClear(goal, goal, radius, space);
  yield;
  let closest = -1, closestDistance = distance(start, goal), closestCost = Infinity, reachedGoal = false;
  while (open.length > 0) {
    const current = open.pop();
    yield;
    if (closed[current.id] || current.cost > costs[current.id]) continue;
    closed[current.id] = 1;
    const point = pointAt(current.id), toGoal = distance(point, goal);
    if (toGoal < closestDistance - EPSILON || (Math.abs(toGoal - closestDistance) < EPSILON && current.cost < closestCost)) {
      closest = current.id;
      closestDistance = toGoal;
      closestCost = current.cost;
    }
    if (goalClear && toGoal <= CELL * 2 && isPathClear(point, goal, radius, space)) {
      closest = current.id;
      reachedGoal = true;
      break;
    }
    const x = current.id % columns, z = Math.floor(current.id / columns);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      yield;
      if ((dx === 0 && dz === 0) || x + dx < 0 || x + dx >= columns || z + dz < 0 || z + dz >= rows) continue;
      const next = current.id + dz * columns + dx;
      if (closed[next] || !walkable(next)) continue;
      if (dx !== 0 && dz !== 0 && (!walkable(current.id + dx) || !walkable(current.id + dz * columns))) continue;
      const cost = current.cost + CELL * (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
      if (cost >= costs[next]) continue;
      const nextPoint = pointAt(next);
      if (!isPathClear(point, nextPoint, radius + CLEARANCE, space)) continue;
      costs[next] = cost;
      parents[next] = current.id;
      open.push({ id: next, cost, score: cost + distance(nextPoint, goal) });
    }
  }
  if (closest === -1) return yield* completeAroundCorners(start, goal, radius, space, [], goalRadius);
  const route: Point[] = [];
  for (let at = closest; at !== -1; at = parents[at]) { route.push(pointAt(at)); yield; }
  route.reverse();
  if (reachedGoal && distance(route[route.length - 1], goal) > EPSILON) route.push({ x: goal.x, z: goal.z });

  // String-pull only across swept-clear segments, preserving corner space.
  const smoothed: Point[] = [];
  let anchor = start, index = 0;
  while (index < route.length) {
    let next = index;
    for (let candidate = route.length - 1; candidate > index; candidate--) {
      yield;
      const linkRadius = smoothed.length === 0 || (reachedGoal && candidate === route.length - 1) ? radius : radius + CLEARANCE;
      if (isPathClear(anchor, route[candidate], linkRadius, space)) { next = candidate; break; }
    }
    if (distance(anchor, route[next]) > EPSILON) smoothed.push(route[next]);
    anchor = route[next];
    index = next + 1;
    yield;
  }
  return reachedGoal ? yield* resultFor(smoothed, true, start) : yield* completeAroundCorners(start, goal, radius, space, smoothed, goalRadius);
}

/** Composable deterministic eight-way search. Callers advancing this generator
 * directly must keep geometry immutable; createPathSearch guards revisions. */
export function searchPath(start: Point, goal: Point, radius: number, space: NavigationSpace, goalRadius = 0): Generator<void, PathResult, void> {
  return searchWithCache({ ...start }, { ...goal }, radius, space, goalRadius, navigationCache(space));
}

export function createPathSearch(start: Point, goal: Point, radius: number, space: NavigationSpace, goalRadius = 0): PathSearch {
  const cache = navigationCache(space);
  return {
    iterator: searchWithCache({ ...start }, { ...goal }, radius, space, goalRadius, cache),
    space, version: spaceVersion(space), generation: cache.generation,
  };
}

/** Advance at most maxWork candidate/edge operations, including fallback work.
 * Partial searches deliberately expose no route until a complete safe result is
 * available. Callers can continue following their previous clear route. */
export function advancePathSearch(search: PathSearch, maxWork: number): PathSearchStep {
  if (search.result) return { done: true, workUsed: 0, ...search.result, ...(search.invalidated ? { invalidated: true } : {}) };
  const version = spaceVersion(search.space);
  if (version.some((value, index) => value !== search.version[index]) ||
      gridCaches.get(search.space.cacheKey ?? search.space)?.generation !== search.generation) {
    search.invalidated = true;
    search.result = { route: [], reachedGoal: false, cost: Infinity };
    return { done: true, workUsed: 0, invalidated: true, ...search.result };
  }
  const budget = Number.isFinite(maxWork) ? Math.max(0, Math.floor(maxWork)) : 0;
  let workUsed = 0;
  while (workUsed < budget) {
    const next = search.iterator.next();
    workUsed++;
    if (next.done) {
      search.result = next.value;
      return { done: true, workUsed, ...next.value };
    }
  }
  return { done: false, workUsed };
}

/** Synchronous compatibility wrapper for tooling and deterministic fixtures.
 * Simulation callers should share a fixed work budget across resumable searches. */
export function findPath(start: Point, goal: Point, radius: number, space: NavigationSpace, goalRadius = 0): Point[] {
  const search = createPathSearch(start, goal, radius, space, goalRadius);
  for (;;) {
    const result = advancePathSearch(search, 8192);
    if (result.done) return result.route!;
  }
}
