import type { GameData } from './types';
import type { MusicTrack } from './music';

type MusicState = Pick<GameData, 'phase' | 'zone' | 'gateOpen' | 'bossDefeated'> & {
  player: Pick<GameData['player'], 'z'>;
};

/** The Guardian starts fighting at the same arena threshold in the simulation. */
export function musicForState(state: MusicState): MusicTrack | null {
  if (state.phase !== 'playing') return null;
  if (state.zone === 'overworld') return 'overworld';
  return state.gateOpen && !state.bossDefeated && state.player.z >= 15.1 ? 'boss' : 'dungeon';
}
