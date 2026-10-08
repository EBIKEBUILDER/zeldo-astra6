/** Measure completed animation frames, including slow frames, without HUD work at 60 Hz. */
export function createFrameStats(intervalMs = 500) {
  let started = 0, frames = 0, draws = 0;
  return {
    reset(now: number) { started = now; frames = 0; draws = 0; },
    record(now: number, drawCalls: number) {
      frames++; draws += drawCalls;
      const elapsed = now - started;
      if (elapsed < intervalMs) return null;
      const sample = { fps: Math.round(frames * 1000 / elapsed), drawCalls: Math.round(draws / frames) };
      started = now; frames = 0; draws = 0;
      return sample;
    },
  };
}
