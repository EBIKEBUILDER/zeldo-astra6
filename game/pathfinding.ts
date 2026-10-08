import type { Obstacle, Point } from './types';

export type NavigationSpace = {
  width: number;
  height: number;
  obstacles: readonly Obstacle[];
  /** Optional center-coordinate limits, in addition to the world's edges. */
  bounds?: { minX?: number; maxX?: number; minZ?: number; maxZ?: number };
  /** Geometric exclusion radii; the moving body's radius is added here. */
  exclusions?: readonly (Point & { radius: number })[];
};

const CELL = .5;
const CLEARANCE = .02;
const EPSILON = .000001;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function segmentPointDistanceSquared(start: Point, end: Point, point: Point) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return (start.x + dx * t - point.x) ** 2 + (start.z + dz * t - point.z) ** 2;
}

function pointBoxDistanceSquared(point: Point, minX: number, maxX: number, minZ: number, maxZ: number) {
  const dx = Math.max(minX - point.x, 0, point.x - maxX);
  const dz = Math.max(minZ - point.z, 0, point.z - maxZ);
  return dx * dx + dz * dz;
}

function intersectsBox(start: Point, end: Point, minX: number, maxX: number, minZ: number, maxZ: number) {
  let entry = 0, exit = 1;
  for (const [origin, delta, min, max] of [
    [start.x, end.x - start.x, minX, maxX],
    [start.z, end.z - start.z, minZ, maxZ],
  ]) {
    if (Math.abs(delta) < 1e-12) {
      if (origin < min || origin > max) return false;
    } else {
      const first = (min - origin) / delta, last = (max - origin) / delta;
      entry = Math.max(entry, Math.min(first, last));
      exit = Math.min(exit, Math.max(first, last));
      if (entry > exit) return false;
    }
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
  for (const point of [start, end]) {
    if (point.x < minX - EPSILON || point.x > maxX + EPSILON || point.z < minZ - EPSILON || point.z > maxZ + EPSILON) return false;
  }
  for (const exclusion of space.exclusions ?? []) {
    if (segmentPointDistanceSquared(start, end, exclusion) < (radius + exclusion.radius) ** 2 - EPSILON) return false;
  }
  const threshold = Math.max(0, radius * radius - EPSILON);
  for (const obstacle of space.obstacles) {
    const left = obstacle.x - obstacle.w / 2, right = obstacle.x + obstacle.w / 2;
    const bottom = obstacle.z - obstacle.d / 2, top = obstacle.z + obstacle.d / 2;
    // Most world objects cannot touch this segment, even after radius inflation.
    if (Math.max(start.x, end.x) < left - radius || Math.min(start.x, end.x) > right + radius ||
        Math.max(start.z, end.z) < bottom - radius || Math.min(start.z, end.z) > top + radius) continue;
    if (intersectsBox(start, end, left, right, bottom, top)) return false;
    if (pointBoxDistanceSquared(start, left, right, bottom, top) < threshold ||
        pointBoxDistanceSquared(end, left, right, bottom, top) < threshold ||
        segmentPointDistanceSquared(start, end, { x: left, z: bottom }) < threshold ||
        segmentPointDistanceSquared(start, end, { x: left, z: top }) < threshold ||
        segmentPointDistanceSquared(start, end, { x: right, z: bottom }) < threshold ||
        segmentPointDistanceSquared(start, end, { x: right, z: top }) < threshold) return false;
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

/** Deterministic eight-way A*. Returned waypoints exclude the start. When the
 * exact goal cannot be occupied, approach the nearest reachable grid position.
 * All search caches are local, so gates and broken pots take effect immediately. */
export function findPath(start: Point, goal: Point, radius: number, space: NavigationSpace): Point[] {
  if (distance(start, goal) < EPSILON) return [];
  if (isPathClear(start, goal, radius, space)) return [{ x: goal.x, z: goal.z }];

  const columns = Math.floor(space.width / CELL) + 1, rows = Math.floor(space.height / CELL) + 1;
  const count = columns * rows;
  const costs = new Float64Array(count).fill(Infinity);
  const parents = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count), walkability = new Uint8Array(count);
  const pointAt = (id: number): Point => ({ x: (id % columns) * CELL, z: Math.floor(id / columns) * CELL });
  const walkable = (id: number) => {
    if (walkability[id] === 0) {
      const point = pointAt(id);
      walkability[id] = isPathClear(point, point, radius + CLEARANCE, space) ? 1 : 2;
    }
    return walkability[id] === 1;
  };
  const open = new MinHeap();
  // Attach the real (non-grid) start to nearby visible nodes. Nominal clearance
  // here lets a body touching a wall leave it before taking the buffered route.
  const startX = Math.round(start.x / CELL), startZ = Math.round(start.z / CELL);
  for (let z = Math.max(0, startZ - 2); z <= Math.min(rows - 1, startZ + 2); z++) {
    for (let x = Math.max(0, startX - 2); x <= Math.min(columns - 1, startX + 2); x++) {
      const id = z * columns + x, point = pointAt(id), cost = distance(start, point);
      if (cost > CELL * 2 || !walkable(id) || !isPathClear(start, point, radius, space)) continue;
      costs[id] = cost;
      open.push({ id, cost, score: cost + distance(point, goal) });
    }
  }
  const goalClear = isPathClear(goal, goal, radius, space);
  let closest = -1, closestDistance = distance(start, goal), closestCost = Infinity, reachedGoal = false;
  while (open.length > 0) {
    const current = open.pop();
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
  if (closest === -1) return [];
  const route: Point[] = [];
  for (let at = closest; at !== -1; at = parents[at]) route.push(pointAt(at));
  route.reverse();
  if (reachedGoal && distance(route[route.length - 1], goal) > EPSILON) route.push({ x: goal.x, z: goal.z });

  // String-pull only across swept-clear segments, preserving the corner space
  // a large boss needs. The first/last links may touch their starting wall.
  const smoothed: Point[] = [];
  let anchor = start, index = 0;
  while (index < route.length) {
    let next = index;
    for (let candidate = route.length - 1; candidate > index; candidate--) {
      const linkRadius = smoothed.length === 0 || (reachedGoal && candidate === route.length - 1) ? radius : radius + CLEARANCE;
      if (isPathClear(anchor, route[candidate], linkRadius, space)) { next = candidate; break; }
    }
    if (distance(anchor, route[next]) > EPSILON) smoothed.push(route[next]);
    anchor = route[next];
    index = next + 1;
  }
  return smoothed;
}
