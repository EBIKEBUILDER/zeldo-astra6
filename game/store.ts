'use client';
import { create } from 'zustand';
import type { GameActions, GameData } from './types';
import { createInitialData, stepGame } from './simulation';

export const useGameStore = create<GameData & GameActions>((set,get) => ({
  ...createInitialData(),
  start: () => set({ ...createInitialData(get().muted), phase:'playing', message:'Beyond the old bridge, a forgotten ember waits.', messageTime:5 }),
  retry: () => get().start(),
  toggleMute: () => set({muted:!get().muted}),
  togglePause: () => { const phase=get().phase;if(phase==='playing'||phase==='paused')set({phase:phase==='playing'?'paused':'playing'}); },
  step: (dt,input) => { const before=get();if(before.phase==='playing')set(stepGame(before,dt,input)); },
}));
