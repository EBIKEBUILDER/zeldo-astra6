import type { Enemy, GameData, Obstacle, Point, Zone } from './types';
import type { NavigationSpace } from './pathfinding';
import { advanceNavigationSearch, createNavigationSearch, type NavigationNetwork, type NavigationWaypoint } from './navigation-network';
import { NAVIGATION_CHUNKS, NAVIGATION_PORTALS, SANCTUARY, WORLDS } from './world';

// A work unit is one bounded search/collision candidate, including the narrow
// passage fallback. All monsters and recovery probes share this allowance.
export const PATHFINDING_WORK_PER_TICK = 12000;
const QUANTUM = 512;
type Result = { route: NavigationWaypoint[]; reachedGoal: boolean };
type Engine = { search: ReturnType<typeof createNavigationSearch>; work: number; result?: Result };
type Job = { engine: Engine; progress: number; goal: Point; zone: Zone; owner: string };
export type NavigationRuntime = {
  revision: string;
  networks: Record<'blob' | 'boss', NavigationNetwork>;
  obstacles: Record<Zone, Obstacle[]>;
  jobs: Map<string, Job>;
  workUsed: number;
  cursor: number;
  changed: boolean;
};
const runtimes = new WeakMap<GameData, NavigationRuntime>();
const spaces = new Map<string, { signature: string; space: NavigationSpace }>();

export function solidObstacles(state: GameData, zone: Zone): Obstacle[] {
  const obstacles: Obstacle[] = [...WORLDS[zone].obstacles,
    ...state.breakables.filter(item => item.zone === zone && item.kind === 'pot' && !item.broken)
      .map(item => ({ id: item.id, kind: 'rock' as const, x: item.x, z: item.z, w: .52, d: .52 }))];
  if (zone === 'dungeon' && !state.gateOpen) obstacles.push({ id: 'locked-gate', kind: 'wall', x: 10, z: 14, w: 3, d: 1 });
  return obstacles;
}

export function beginNavigation(previous: GameData, state: GameData): NavigationRuntime {
  const old = runtimes.get(previous);
  const obstacles = { overworld: solidObstacles(state, 'overworld'), dungeon: solidObstacles(state, 'dungeon') };
  const signatures = {} as Record<Zone, string>;
  for (const zone of ['overworld', 'dungeon'] as const) {
    // Include geometry values, not just array identity: editing a solid tile,
    // moving scenery, opening the gate or breaking a pot invalidates the grid.
    signatures[zone] = JSON.stringify([WORLDS[zone].width, WORLDS[zone].height,
      obstacles[zone].map(o => [o.x, o.z, o.w, o.d]), zone === 'overworld' ? SANCTUARY : null]);
  }
  const networks = {} as NavigationRuntime['networks'];
  for (const kind of ['blob', 'boss'] as const) {
    const zoneSpaces = {} as Record<Zone, NavigationSpace>;
    for (const zone of ['overworld', 'dungeon'] as const) {
      const key = `${zone}:${kind}`, signature = signatures[zone];
      let cached = spaces.get(key);
      if (!cached || cached.signature !== signature) {
        cached = { signature, space: { width: WORLDS[zone].width, height: WORLDS[zone].height,
          obstacles: obstacles[zone].map(o => ({ ...o })), revision: signature,
          bounds: kind === 'boss' ? { minZ: 15.5 + .83 } : undefined,
          exclusions: zone === 'overworld' ? [{ ...SANCTUARY }] : undefined } };
        spaces.set(key, cached);
      }
      zoneSpaces[zone] = cached.space;
    }
    networks[kind] = { spaces: zoneSpaces,
      chunks: NAVIGATION_CHUNKS.map(c => ({ ...c, origin: { ...c.origin } })),
      portals: NAVIGATION_PORTALS.map(p => ({ ...p, fromTile: { ...p.fromTile }, toTile: { ...p.toTile } })) };
  }
  const revision = JSON.stringify([signatures, NAVIGATION_CHUNKS, NAVIGATION_PORTALS]);
  const changed = !!old && old.revision !== revision;
  const runtime: NavigationRuntime = { revision, networks, obstacles, changed,
    jobs: !changed && old ? new Map([...old.jobs].map(([key, job]) => [key, { ...job }])) : new Map(),
    workUsed: 0, cursor: old?.cursor ?? 0 };
  const alive = new Set(state.enemies.filter(e => e.hp > 0).map(e => e.id));
  for (const [key, job] of runtime.jobs) if (!alive.has(job.owner)) runtime.jobs.delete(key);
  if (changed) for (const enemy of state.enemies) {
    enemy.path = []; enemy.repathTime = 0; enemy.pursuitProbeTime = 0;
  }
  runtimes.set(state, runtime);
  runNavigation(runtime);
  return runtime;
}

function advanceJob(runtime: NavigationRuntime, job: Job, budget: number) {
  const engine = job.engine, desired = job.progress + budget;
  if (!engine.result && desired > engine.work) {
    const advanced = advanceNavigationSearch(engine.search, desired - engine.work);
    engine.work += advanced.workUsed;
    if (advanced.done) engine.result = { route: advanced.route ?? [], reachedGoal: advanced.reachedGoal ?? false };
  }
  // Engines are monotonic caches. Immutable per-snapshot progress cursors let
  // replaying/branching a previous game state observe the same budget and route
  // without mutating that state's queue or advancing its simulated progress.
  const work = Math.min(desired, engine.work) - job.progress;
  job.progress += work;
  runtime.workUsed += work;
}
function complete(job: Job) { return job.engine.result && job.progress >= job.engine.work; }

export function runNavigation(runtime: NavigationRuntime) {
  const pending = [...runtime.jobs.values()].filter(job => !complete(job));
  let index = pending.length ? runtime.cursor % pending.length : 0;
  while (pending.length && runtime.workUsed < PATHFINDING_WORK_PER_TICK) {
    const job = pending[index];
    advanceJob(runtime, job, Math.min(QUANTUM, PATHFINDING_WORK_PER_TICK - runtime.workUsed));
    if (complete(job)) pending.splice(index, 1);
    else index++;
    if (pending.length) index %= pending.length;
    runtime.cursor++;
  }
}

export function cancelNavigation(runtime: NavigationRuntime, owner: string, mode?: string) {
  for (const [key, job] of runtime.jobs) if (job.owner === owner && (!mode || key === `${owner}:${mode}`)) runtime.jobs.delete(key);
}

export function requestNavigation(runtime: NavigationRuntime, enemy: Enemy, goal: Point, zone: Zone, mode: string, goalRadius = 0): Result | undefined {
  const key = `${enemy.id}:${mode}`;
  let job = runtime.jobs.get(key);
  if (job && job.zone !== zone) {
    runtime.jobs.delete(key); job = undefined;
  }
  if (!job) {
    job = { engine: { search: createNavigationSearch({ x: enemy.x, z: enemy.z, zone: enemy.zone },
      { x: goal.x, z: goal.z, zone }, enemy.radius, runtime.networks[enemy.kind], { forAI: true, goalRadius }), work: 0 },
      progress: 0, goal: { x: goal.x, z: goal.z }, zone, owner: enemy.id };
    runtime.jobs.set(key, job);
    runNavigation(runtime);
  }
  if (!complete(job)) return undefined;
  runtime.jobs.delete(key);
  return job.engine.result;
}

export function getNavigationStats(state: GameData) {
  const runtime = runtimes.get(state);
  return { workUsed: runtime?.workUsed ?? 0,
    pending: runtime ? [...runtime.jobs.values()].filter(job => !complete(job)).length : 0 };
}
