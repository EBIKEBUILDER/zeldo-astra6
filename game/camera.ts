import type { Point, Zone } from './types';

export type CameraFraming = { aspect: number; halfHeight: number; halfWidth: number };

/** Use CSS pixels: a phone's rendering resolution can be scaled for its GPU. */
export function getCameraFraming(width: number, height: number): CameraFraming {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const halfHeight = aspect < 1 ? 10.3 : height < 480 ? 7.5 : 9.5;
  return { aspect, halfHeight, halfWidth: halfHeight * aspect };
}

export function getGameplayCameraTarget(player: Point, zone: Zone, framing: CameraFraming): Point {
  // Room centering can put the hero beyond a narrow phone's horizontal view.
  // Follow directly until there is room for the desktop composition and margin.
  const x = framing.halfWidth < 8.5 ? player.x : zone === 'dungeon'
    ? 10 + (player.x - 10) * .27
    : Math.max(7, Math.min(41, player.x));
  const z = zone === 'dungeon'
    ? Math.max(6, Math.min(23, player.z + 1.9))
    : Math.max(6.6, Math.min(23, player.z + 1.7));
  return { x, z };
}
