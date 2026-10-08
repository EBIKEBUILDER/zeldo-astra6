/** Measure completed animation frames, including slow frames, without HUD work at 60 Hz. */
export function createFrameStats(intervalMs = 500) {
  let started = 0, frames = 0, draws = 0, meshes = 0;
  return {
    reset(now: number) { started = now; frames = 0; draws = 0; meshes = 0; },
    record(now: number, drawCalls: number, activeMeshes: number) {
      frames++; draws += drawCalls; meshes += activeMeshes;
      const elapsed = now - started;
      if (elapsed < intervalMs) return null;
      const sample = {
        fps: Math.round(frames * 1000 / elapsed),
        frameMs: Math.round(elapsed / frames * 10) / 10,
        drawCalls: Math.round(draws / frames),
        activeMeshes: Math.round(meshes / frames),
      };
      started = now; frames = 0; draws = 0; meshes = 0;
      return sample;
    },
  };
}
