import { advancePathSearch, createPathSearch, isPathClear, type NavigationSpace, type PathSearch } from './pathfinding';
import type { Point, Zone } from './types';

export const NAV_TILE_SIZE = .5;

/** Chunk extents are in world units. Their edges are metadata, never walls. */
export type NavigationChunk = {
  id: string;
  zone: Zone;
  origin: Point;
  width: number;
  height: number;
};

/** Directed connection; tile coordinates are integer indices within a chunk. */
export type NavigationPortal = {
  id: string;
  fromChunk: string;
  fromTile: Point;
  toChunk: string;
  toTile: Point;
  traversalCost: number;
  /** Omitted flags are deliberately closed to monsters. */
  traversableByAI?: boolean;
  interactionRadius?: number;
};

export type NavigationPosition = Point & { zone: Zone };
/** A portal marker is on its source. The following waypoint is its destination. */
export type NavigationWaypoint = NavigationPosition & { portalId?: string };
export type NavigationNetwork = {
  chunks: readonly NavigationChunk[];
  portals: readonly NavigationPortal[];
  /** Authoritative stitched geometry. Disconnected areas within one zone must
   * be separated by its obstacles/exclusions; chunk metadata adds no walls. */
  spaces: Record<Zone, NavigationSpace>;
};
export type NavigationSearchOptions = { forAI?: boolean; goalRadius?: number };
export type NavigationSearchResult = {
  done: boolean;
  workUsed: number;
  route?: NavigationWaypoint[];
  reachedGoal?: boolean;
  cost?: number;
  invalidated?: boolean;
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const samePoint = (a: NavigationPosition, b: NavigationPosition) => a.zone === b.zone && distance(a, b) < .000001;
const validPoint = (point: Point | undefined) => !!point && Number.isFinite(point.x) && Number.isFinite(point.z);

/** Convert data coordinates, rejecting unknown chunks and malformed tile data. */
export function portalEndpoint(
  networkOrChunks: NavigationNetwork | readonly NavigationChunk[], chunkId: string, tile: Point,
): NavigationPosition | undefined {
  const chunks = 'chunks' in networkOrChunks ? networkOrChunks.chunks : networkOrChunks;
  const matches = chunks.filter(chunk => chunk.id === chunkId);
  if (matches.length !== 1 || !validPoint(tile) || !Number.isInteger(tile.x) || !Number.isInteger(tile.z)) return;
  const chunk = matches[0];
  if (!validPoint(chunk.origin) || !Number.isFinite(chunk.width) || !Number.isFinite(chunk.height) ||
      chunk.width <= 0 || chunk.height <= 0 || (chunk.zone !== 'overworld' && chunk.zone !== 'dungeon')) return;
  const x = tile.x * NAV_TILE_SIZE, z = tile.z * NAV_TILE_SIZE;
  if (x < 0 || z < 0 || x > chunk.width || z > chunk.height) return;
  return { zone: chunk.zone, x: chunk.origin.x + x, z: chunk.origin.z + z };
}

type PortalEdge = { id: string; from: NavigationPosition; to: NavigationPosition; cost: number; destination: number };
type Vertex = { point: NavigationPosition; portal?: PortalEdge };
type QueueEntry = { id: number; cost: number };

class CostQueue {
  private entries: QueueEntry[] = [];
  get length() { return this.entries.length; }
  private before(a: QueueEntry, b: QueueEntry) { return a.cost < b.cost || (a.cost === b.cost && a.id < b.id); }
  push(entry: QueueEntry) {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(entry, this.entries[parent])) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }
  pop() {
    const first = this.entries[0], last = this.entries.pop()!;
    if (this.entries.length) {
      let index = 0;
      while (index * 2 + 1 < this.entries.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.entries.length && this.before(this.entries[child + 1], this.entries[child])) child++;
        if (!this.before(this.entries[child], last)) break;
        this.entries[index] = this.entries[child];
        index = child;
      }
      this.entries[index] = last;
    }
    return first;
  }
}

function networkSignature(network: NavigationNetwork) {
  return JSON.stringify([
    network.chunks.map(chunk => [chunk.id, chunk.zone, chunk.origin.x, chunk.origin.z, chunk.width, chunk.height]),
    network.portals.map(portal => [portal.id, portal.fromChunk, portal.fromTile?.x, portal.fromTile?.z,
      portal.toChunk, portal.toTile?.x, portal.toTile?.z, portal.traversalCost, portal.traversableByAI, portal.interactionRadius]),
  ]);
}

function snapshotSpace(space: NavigationSpace) {
  return {
    space, revision: space.revision, width: space.width, height: space.height,
    obstacles: space.obstacles, obstacleCount: space.obstacles.length,
    exclusions: space.exclusions, exclusionCount: space.exclusions?.length,
    bounds: JSON.stringify(space.bounds),
  };
}

type SpaceSnapshot = ReturnType<typeof snapshotSpace>;
type ParentEdge = { from: number; route: NavigationWaypoint[] };
type PendingEdge = { target: number; search: PathSearch };

/** Search state is intentionally kept outside serialized game state. */
class NetworkSearch {
  readonly signature: string;
  readonly spaces: Record<Zone, SpaceSnapshot>;
  readonly vertices: Vertex[];
  readonly targets: number[];
  readonly costs: number[];
  readonly closed: boolean[];
  readonly parents: (ParentEdge | undefined)[];
  readonly open = new CostQueue();
  readonly goalId = 1;
  direct?: PathSearch;
  current?: number;
  targetCursor = 0;
  portalStage = 0;
  pending?: PendingEdge;
  fallback?: { route: NavigationWaypoint[]; distance: number; cost: number };
  result?: Omit<NavigationSearchResult, 'workUsed'>;

  constructor(
    readonly start: NavigationPosition, readonly goal: NavigationPosition, readonly radius: number,
    readonly network: NavigationNetwork, readonly options: NavigationSearchOptions,
  ) {
    this.signature = networkSignature(network);
    this.spaces = { overworld: snapshotSpace(network.spaces.overworld), dungeon: snapshotSpace(network.spaces.dungeon) };
    this.vertices = [{ point: start }, { point: goal }];
    this.targets = [this.goalId];
    const ids = new Map<string, number>();
    for (const portal of network.portals) ids.set(portal.id, (ids.get(portal.id) ?? 0) + 1);
    for (const portal of network.portals) {
      if (!portal.id || ids.get(portal.id) !== 1 || (options.forAI !== false && portal.traversableByAI !== true) ||
          !Number.isFinite(portal.traversalCost) || portal.traversalCost < 0 ||
          (portal.interactionRadius !== undefined && (!Number.isFinite(portal.interactionRadius) || portal.interactionRadius < 0))) continue;
      const from = portalEndpoint(network, portal.fromChunk, portal.fromTile);
      const to = portalEndpoint(network, portal.toChunk, portal.toTile);
      if (!from || !to) continue;
      const source = this.vertices.length, destination = source + 1;
      this.vertices.push({ point: from, portal: { id: portal.id, from, to, cost: portal.traversalCost, destination } }, { point: to });
      this.targets.push(source);
    }
    this.costs = this.vertices.map(() => Infinity);
    this.closed = this.vertices.map(() => false);
    this.parents = this.vertices.map(() => undefined);
    this.costs[0] = 0;
    this.open.push({ id: 0, cost: 0 });
    if (!validPoint(start) || !validPoint(goal) || !network.spaces[start.zone] || !network.spaces[goal.zone] ||
        !Number.isFinite(radius) || radius < 0) {
      this.result = { done: true, route: [], reachedGoal: false, cost: Infinity };
    } else if (this.targets.length === 1) {
      if (start.zone === goal.zone) {
        this.direct = createPathSearch(start, goal, radius, network.spaces[start.zone], options.goalRadius ?? 0);
      } else this.result = { done: true, route: [], reachedGoal: false, cost: Infinity };
    }
  }
}

export type NavigationSearch = NetworkSearch;

/** Each zone already contains one stitched grid, so local searches cross chunk
 * seams without special links or bounds. Dijkstra adds directed portal edges;
 * a zero heuristic remains valid even when a warp is cheaper than walking. */
export function createNavigationSearch(
  start: NavigationPosition, goal: NavigationPosition, radius: number, network: NavigationNetwork,
  options: NavigationSearchOptions = {},
): NavigationSearch {
  return new NetworkSearch({ ...start }, { ...goal }, radius, network, { ...options });
}

function stale(search: NetworkSearch) {
  if (networkSignature(search.network) !== search.signature) return true;
  for (const zone of ['overworld', 'dungeon'] as const) {
    const current = search.network.spaces[zone], previous = search.spaces[zone];
    if (current !== previous.space || current.revision !== previous.revision || current.width !== previous.width ||
        current.height !== previous.height || current.obstacles !== previous.obstacles ||
        current.obstacles.length !== previous.obstacleCount || current.exclusions !== previous.exclusions ||
        current.exclusions?.length !== previous.exclusionCount || JSON.stringify(current.bounds) !== previous.bounds) return true;
  }
  return false;
}

function appendRoute(route: NavigationWaypoint[], points: readonly NavigationWaypoint[]) {
  for (const point of points) {
    const last = route[route.length - 1];
    // Keep portal source and arrival distinct, including colocated warps.
    if (last && samePoint(last, point) && !last.portalId && !point.portalId) continue;
    const lastIsArrival = route.length > 1 && !!route[route.length - 2].portalId;
    if (last && samePoint(last, point) && point.portalId && !last.portalId && !lastIsArrival) route[route.length - 1] = { ...point };
    else route.push({ ...point });
  }
}

function routeTo(search: NetworkSearch, id: number) {
  const edges: ParentEdge[] = [];
  for (let at = id; search.parents[at]; at = search.parents[at]!.from) edges.push(search.parents[at]!);
  const route: NavigationWaypoint[] = [];
  for (let index = edges.length - 1; index >= 0; index--) appendRoute(route, edges[index].route);
  return route;
}

function relax(search: NetworkSearch, from: number, to: number, cost: number, route: NavigationWaypoint[]) {
  const total = search.costs[from] + cost;
  if (search.closed[to] || total >= search.costs[to]) return;
  search.costs[to] = total;
  search.parents[to] = { from, route };
  search.open.push({ id: to, cost: total });
}

/** Consume at most budget local-search/collision/graph work units. All local
 * searches yield to this shared budget; no portal approach is drained eagerly. */
export function advanceNavigationSearch(search: NavigationSearch, budget: number): NavigationSearchResult {
  let workUsed = 0;
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  if (stale(search)) search.result = { done: true, route: [], reachedGoal: false, cost: Infinity, invalidated: true };
  if (search.result) return { ...search.result, workUsed };
  if (search.direct) {
    const result = advancePathSearch(search.direct, limit);
    if (!result.done) return { done: false, workUsed: result.workUsed };
    search.result = { ...result, route: result.route?.map(point => ({ ...point, zone: search.start.zone })) };
    return { ...search.result, workUsed: result.workUsed };
  }
  while (workUsed < limit && !search.result) {
    if (search.pending) {
      const result = advancePathSearch(search.pending.search, limit - workUsed);
      workUsed += result.workUsed;
      if (result.invalidated) {
        search.result = { done: true, route: [], reachedGoal: false, cost: Infinity, invalidated: true };
        break;
      }
      if (!result.done) break;
      const from = search.current!, target = search.pending.target;
      const zone = search.vertices[from].point.zone;
      const route = (result.route ?? []).map(point => ({ ...point, zone }));
      if (result.reachedGoal) relax(search, from, target, result.cost ?? Infinity, route);
      else if (target === search.goalId) {
        const endpoint = route[route.length - 1] ?? search.vertices[from].point;
        const remaining = distance(endpoint, search.goal), cost = search.costs[from] + (result.cost ?? 0);
        if (!search.fallback || remaining < search.fallback.distance || (remaining === search.fallback.distance && cost < search.fallback.cost)) {
          const partial = routeTo(search, from);
          appendRoute(partial, route);
          search.fallback = { route: partial, distance: remaining, cost };
        }
      }
      search.pending = undefined;
      continue;
    }
    if (search.current === undefined) {
      workUsed++;
      if (!search.open.length) {
        search.result = { done: true, route: search.fallback?.route ?? [], reachedGoal: false, cost: search.fallback?.cost ?? Infinity };
        break;
      }
      const next = search.open.pop();
      if (search.closed[next.id] || next.cost !== search.costs[next.id]) continue;
      if (next.id === search.goalId) {
        search.result = { done: true, route: routeTo(search, next.id), reachedGoal: true, cost: next.cost };
        break;
      }
      search.closed[next.id] = true;
      search.current = next.id;
      search.targetCursor = 0;
      search.portalStage = 0;
      continue;
    }
    const vertex = search.vertices[search.current], portal = vertex.portal;
    if (portal && search.portalStage < 3) {
      workUsed++;
      if (search.portalStage === 0) {
        search.portalStage = isPathClear(portal.from, portal.from, search.radius, search.network.spaces[portal.from.zone]) ? 1 : 3;
      } else if (search.portalStage === 1) {
        search.portalStage = isPathClear(portal.to, portal.to, search.radius, search.network.spaces[portal.to.zone]) ? 2 : 3;
      } else {
        relax(search, search.current, portal.destination, portal.cost, [{ ...portal.from, portalId: portal.id }, { ...portal.to }]);
        search.portalStage = 3;
      }
      continue;
    }
    workUsed++;
    if (search.targetCursor >= search.targets.length) {
      search.current = undefined;
      continue;
    }
    const target = search.targets[search.targetCursor++], destination = search.vertices[target].point;
    if (target === search.current || search.closed[target] || destination.zone !== vertex.point.zone) continue;
    search.pending = {
      target,
      search: createPathSearch(vertex.point, destination, search.radius, search.network.spaces[vertex.point.zone], target === search.goalId ? search.options.goalRadius ?? 0 : 0),
    };
  }
  return search.result ? { ...search.result, workUsed } : { done: false, workUsed };
}
