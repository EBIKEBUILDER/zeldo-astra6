import type { Enemy, Point } from './types';

const ACQUIRE_RANGE = 5.7;
const SHELTER_FORGET_SECONDS = 18;
const STALLED_FORGET_SECONDS = 20;
const PROGRESS_DISTANCE = .16;
const REACQUIRE_MOVEMENT = 1.5;
// Keep memory alive at the same contact distance used by the simulation.
const PLAYER_RADIUS = .34;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function resetProgress(enemy: Enemy) {
  enemy.stuckTime = 0;
  enemy.progressX = enemy.x;
  enemy.progressZ = enemy.z;
}

/** A hit or a newly usable route renews pursuit, including a timed-out pursuit. */
export function resumePursuit(enemy: Enemy) {
  enemy.aggro = true;
  enemy.pursuitBlocked = false;
  enemy.pursuitProbeTime = 0;
  enemy.lostSightTime = 0;
  enemy.farTime = 0;
  enemy.mode = 'chase';
  enemy.path = [];
  enemy.repathTime = 0;
  resetProgress(enemy);
}

/** Check awareness before choosing movement. Distance from home and temporary
 * loss of sight never interrupt an existing pursuit: detours are still pursuit. */
export function updatePursuitMemory(enemy: Enemy, player: Point, inSanctuary: boolean, dt: number) {
  enemy.farTime = 0;
  if (!enemy.aggro) {
    enemy.lostSightTime = 0;
    resetProgress(enemy);
    if (enemy.pursuitBlocked && distance(player, { x: enemy.blockedTargetX, z: enemy.blockedTargetZ }) >= REACQUIRE_MOVEMENT) {
      enemy.pursuitBlocked = false;
    }
    if (!inSanctuary && !enemy.pursuitBlocked && distance(enemy, player) < ACQUIRE_RANGE) resumePursuit(enemy);
    return;
  }

  // Home remains a safe place to escape; a short visit only pauses pursuit.
  enemy.lostSightTime = inSanctuary ? enemy.lostSightTime + dt : 0;
  if (enemy.lostSightTime + 1e-8 >= SHELTER_FORGET_SECONDS) {
    enemy.aggro = false;
    enemy.pursuitBlocked = false;
    enemy.pursuitProbeTime = 0;
    enemy.lostSightTime = 0;
    enemy.mode = 'return';
    enemy.path = [];
    enemy.repathTime = 0;
    enemy.vx = 0;
    enemy.vz = 0;
    resetProgress(enemy);
  }
}

/** Measure actual movement after walls, knockback, and body separation. A mob
 * resets only after twenty uninterrupted seconds unable to move out of melee.
 * The anchor rejects tiny collision jitter but accepts a detour in any direction. */
export function recordPursuitProgress(enemy: Enemy, player: Point, inSanctuary: boolean, dt: number, sameZone = true) {
  if (!enemy.aggro || enemy.mode !== 'chase' || inSanctuary || enemy.hitstun > 0 ||
      (sameZone && distance(enemy, player) <= enemy.radius + PLAYER_RADIUS + .055)) {
    resetProgress(enemy);
    return false;
  }
  if (distance(enemy, { x: enemy.progressX, z: enemy.progressZ }) >= PROGRESS_DISTANCE) {
    resetProgress(enemy);
    return false;
  }
  enemy.stuckTime += dt;
  if (enemy.stuckTime + 1e-8 < STALLED_FORGET_SECONDS) return false;

  enemy.aggro = false;
  enemy.pursuitBlocked = true;
  enemy.pursuitProbeTime = 0;
  enemy.blockedTargetX = player.x;
  enemy.blockedTargetZ = player.z;
  enemy.lostSightTime = 0;
  enemy.farTime = 0;
  enemy.mode = 'return';
  enemy.path = [];
  enemy.repathTime = 0;
  enemy.vx = 0;
  enemy.vz = 0;
  resetProgress(enemy);
  return true;
}
