'use client';
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/game/store';
import { GameAudio } from '@/game/audio';
import { createInput } from '@/game/input';

export type GameControls = {
  start: () => void;
  restart: () => void;
  mute: () => void;
  pause: () => void;
  setModalOpen: (open: boolean) => void;
  virtual: (action: 'up' | 'down' | 'left' | 'right' | 'attack' | 'interact', pressed: boolean) => void;
};

export default function GameCanvas({ onReady }: { onReady: (controls: GameControls) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    import('@/game/renderer').then(({ createGameRenderer }) => {
      if (disposed || !canvas.current) return;
      const renderer = createGameRenderer(canvas.current);
      const audio = new GameAudio();
      let soundId = 0;
      let modalOpen = false;
      const start = () => { audio.unlock(); input.clear(); canvas.current?.focus({ preventScroll: true }); soundId = 0; useGameStore.getState().start(); };
      const restart = () => { audio.unlock(); input.clear(); canvas.current?.focus({ preventScroll: true }); soundId = 0; useGameStore.getState().retry(); };
      const mute = () => { audio.unlock(); useGameStore.getState().toggleMute(); audio.setMuted(useGameStore.getState().muted); };
      const pause = () => { audio.unlock(); input.clear(); useGameStore.getState().togglePause(); if (useGameStore.getState().phase === 'playing') canvas.current?.focus({ preventScroll: true }); };
      const input = createInput(canvas.current, () => {
        if (modalOpen) return;
        const p = useGameStore.getState().phase;
        if (p === 'title' || p === 'gameover' || p === 'victory') start();
      }, pause, mute);
      const unlockAudio = () => audio.unlock();
      canvas.current.addEventListener('pointerdown', unlockAudio);
      const resize = new ResizeObserver(() => renderer.resize());
      resize.observe(canvas.current);
      let last = performance.now(), accumulator = 0, frame = 0;
      const loop = (now: number) => {
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        accumulator += dt;
        const state = useGameStore.getState();
        if (state.phase !== 'playing') { accumulator = 0; input.clear(); }
        while (accumulator >= 1 / 60) {
          useGameStore.getState().step(1 / 60, input.read());
          accumulator -= 1 / 60;
        }
        const current = useGameStore.getState();
        audio.setMuted(current.muted);
        current.sounds.forEach(event => { if (event.id > soundId) { audio.play(event.name); soundId = event.id; } });
        renderer.render(current, dt);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
      const visibility = () => { if (document.hidden) { input.clear(); if (useGameStore.getState().phase === 'playing') useGameStore.getState().togglePause(); } };
      document.addEventListener('visibilitychange', visibility);
      void renderer.ready().then(() => {
        if (!disposed) onReady({ start, restart, mute, pause, setModalOpen: open => { modalOpen = open; input.clear(); }, virtual: (action, pressed) => { if (pressed) audio.unlock(); input.setVirtual(action, pressed); } });
      });
      const element = canvas.current;
      cleanup = () => { cancelAnimationFrame(frame); resize.disconnect(); input.dispose(); audio.dispose(); renderer.dispose(); document.removeEventListener('visibilitychange', visibility); element.removeEventListener('pointerdown', unlockAudio); };
    }).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Your browser could not start WebGL.');
    });
    return () => { disposed = true; cleanup?.(); };
  }, [onReady]);
  return <><canvas ref={canvas} className="world-canvas" aria-label="Zeldo 3D adventure. Move with WASD or arrow keys, swing with Space, interact with E." tabIndex={0} />{error && <div className="render-error"><h2>The valley couldn’t wake up.</h2><p>{error}</p><p>Enable hardware acceleration or try another browser, then refresh.</p></div>}</>;
}
