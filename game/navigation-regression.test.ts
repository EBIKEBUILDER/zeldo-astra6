import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, overlapsSolid, PLAYER_RADIUS, stepGame } from './simulation';
import { WORLDS } from './world';

test('a blob keeps navigating while the hero runs a full circuit around a pillar, then catches up', () => {
  let state = createInitialData();
  state.phase = 'playing';
  state.zone = 'dungeon';
  state.gateOpen = true;
  state.breakables = [];
  Object.assign(state.player, { x: 6.5, z: 20.5, invulnerable: 100 });
  const source = state.enemies.find(enemy => enemy.id === 'hall-1')!;
  state.enemies = [{ ...source, x: 2.2, z: 20.5, spawnX: 2.2, spawnZ: 20.5,
    progressX: 2.2, progressZ: 20.5, modeTime: 0 }];
  let stoppedFrames = 0, reachedHero = false;
  let passedNorth = false, passedSouth = false;

  for (let frame = 0; frame < 600; frame++) {
    const input = { x: 0, z: 0, attack: false, interact: false };
    if (frame < 300) {
      // Use ordinary movement input, continuously moving the goal around the
      // real arena pillar rather than teleporting between fixed destinations.
      const angle = (frame + 15) * Math.PI * 2 / 300;
      const dx = 4 + Math.cos(angle) * 2.5 - state.player.x;
      const dz = 20.5 + Math.sin(angle) * 2.5 - state.player.z;
      const length = Math.hypot(dx, dz);
      input.x = dx / length;
      input.z = dz / length;
    }
    const before = state.enemies[0];
    state = stepGame(state, FIXED_DT, input);
    const enemy = state.enemies[0];
    const separation = Math.hypot(enemy.x - state.player.x, enemy.z - state.player.z);
    assert.equal(enemy.mode, 'chase', 'Changing sides of scenery must not cancel pursuit');
    assert.equal(enemy.aggro, true);
    assert.ok(!WORLDS.dungeon.obstacles.some(obstacle => overlapsSolid(enemy, enemy.radius - .001, obstacle)),
      'Replanned paths must stay clear of the real pillar and walls');
    passedNorth ||= state.player.z > 22.5;
    passedSouth ||= state.player.z < 18.5;

    const inMelee = separation < enemy.radius + PLAYER_RADIUS + .045;
    const moved = Math.hypot(enemy.x - before.x, enemy.z - before.z);
    stoppedFrames = !inMelee && moved < .001 ? stoppedFrames + 1 : 0;
    assert.ok(stoppedFrames < 30, 'A moving target must not leave a pursuer stalled on an obsolete waypoint');
    if (frame >= 300 && inMelee) { reachedHero = true; break; }
  }

  assert.ok(passedNorth && passedSouth, 'Exercise both sides of the pillar using player input');
  assert.ok(reachedHero, 'Finish the detour and reach the hero after they stop running');
});
