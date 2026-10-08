import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, overlapsSolid, PLAYER_RADIUS, stepGame } from './simulation';
import type { Obstacle } from './types';
import { WORLDS } from './world';

for (const gap of [.86, .87]) {
  test(`a pursuing blob physically crosses an off-grid ${gap}-wide passage`, () => {
    const center = 6.23, left = center - gap / 2, right = center + gap / 2;
    const obstacles: Obstacle[] = [
      { id: 'left', kind: 'wall', x: left / 2, z: 6, w: left, d: 1 },
      { id: 'right', kind: 'wall', x: (right + 20) / 2, z: 6, w: 20 - right, d: 1 },
    ];
    const original = WORLDS.dungeon.obstacles;
    WORLDS.dungeon.obstacles = obstacles;
    try {
      let state = createInitialData();
      state.phase = 'playing';
      state.zone = 'dungeon';
      state.gateOpen = true;
      state.breakables = [];
      Object.assign(state.player, { x: 10, z: 10, invulnerable: 100 });
      const source = state.enemies.find(enemy => enemy.id === 'hall-1')!;
      state.enemies = [{ ...source, x: 2, z: 2, spawnX: 2, spawnZ: 2,
        progressX: 2, progressZ: 2, aggro: true, mode: 'chase', modeTime: 0 }];
      let reachedHero = false;

      for (let frame = 0; frame < 900; frame++) {
        state = stepGame(state, FIXED_DT, { x: 0, z: 0, attack: false, interact: false });
        const enemy = state.enemies[0];
        assert.equal(enemy.aggro, true);
        assert.ok(!obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius, obstacle)),
          'Axis-separated movement must stay clear of both walls');
        if (Math.hypot(enemy.x - state.player.x, enemy.z - state.player.z) <= enemy.radius + PLAYER_RADIUS + .045) {
          reachedHero = true;
          break;
        }
      }

      assert.ok(reachedHero, 'Follow the tight route through the passage and reach melee range');
    } finally {
      WORLDS.dungeon.obstacles = original;
    }
  });
}
