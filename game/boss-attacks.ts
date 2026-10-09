/** Shared combat and telegraph dimensions, in world units and seconds. */
export const BOSS_MELEE_WINDUP = .65;
export const BOSS_CHARGE_DURATION = .56;
export const BOSS_CHARGE_SPEED = 7.2;
export const BOSS_CHARGE_DISTANCE = BOSS_CHARGE_SPEED * BOSS_CHARGE_DURATION;
export const BOSS_RECOVERY = .5;
export const BOSS_RANGED_WINDUP = .8;
export const BOSS_RANGED_DISTANCE = 6;
export const BOSS_RANGED_COOLDOWN = 3.5;
export const BOSS_HAZARD_RADIUS = 1.3;
export const BOSS_HAZARD_LIFETIME = 2.4;
export const BOSS_MAX_HAZARDS = 2;
export const BOSS_LOB_ARC_HEIGHT = 2.4;

export function bossLobDuration(distance: number): number {
  return Math.max(.8, Math.min(1.2, distance / 8));
}

/** Absolute projectile height, shared by sword parries and the rendered arc. */
export function bossLobHeight(age: number, duration: number): number {
  const progress = Math.max(0, Math.min(1, age / duration));
  return .55 + 4 * BOSS_LOB_ARC_HEIGHT * progress * (1 - progress);
}

/** Tangent of the same ballistic arc, so the projectile points along its flight. */
export function bossLobVerticalSpeed(age: number, duration: number): number {
  const progress = Math.max(0, Math.min(1, age / duration));
  return 4 * BOSS_LOB_ARC_HEIGHT * (1 - 2 * progress) / duration;
}
