import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, overlapsSolid, PLAYER_RADIUS, stepGame } from './simulation';
import { BOSS_CHARGE_DURATION, BOSS_RANGED_WINDUP } from './boss-attacks';
import { solidObstacles } from './navigation-runtime';
import type { GameData, InputState } from './types';

const idle: InputState = { x: 0, z: 0, attack: false, interact: false };

function arena(): GameData {
  const state = createInitialData();
  Object.assign(state, { phase: 'playing', zone: 'dungeon', gateOpen: true, hasKey: true });
  state.enemies = state.enemies.filter(enemy => enemy.kind === 'boss');
  state.enemies[0].modeTime = 0;
  state.player.invulnerable = 100;
  return state;
}

function tick(state: GameData, input: InputState = idle): GameData {
  const next = stepGame(state, FIXED_DT, input);
  assert.equal(next.phase, 'playing');
  assert.ok(next.elapsed > state.elapsed, 'The simulation advances even when a body touches a wall');
  for (const body of [{ ...next.player, radius: PLAYER_RADIUS }, ...next.enemies]) {
    assert.ok(Number.isFinite(body.x) && Number.isFinite(body.z));
    assert.ok(solidObstacles(next, 'dungeon').every(obstacle => !overlapsSolid(body, body.radius - .001, obstacle)),
      `A body at ${body.x}, ${body.z} must stay outside solid walls and pots`);
  }
  return next;
}

test('a boss charge cannot embed the hero in either side wall, and sidestepping permits escape', () => {
  for (const left of [true, false]) {
    let state = arena();
    Object.assign(state.player, { x: left ? 1.34 : 18.66, z: 23 });
    Object.assign(state.enemies[0], { x: left ? 2.7 : 17.3, z: 23, mode: 'charge',
      modeTime: BOSS_CHARGE_DURATION, wanderAngle: left ? Math.PI : 0 });
    for (let frame = 0; frame < 60; frame++) state = tick(state);
    assert.ok(Math.abs(state.player.x - (left ? 1.34 : 18.66)) < .05, 'Exercise contact while pinned against the side wall');

    // Step along the wall past the boss before steering back toward open floor.
    for (let frame = 0; frame < 40; frame++) state = tick(state, { ...idle, z: -1 });
    for (let frame = 0; frame < 75; frame++) state = tick(state, { ...idle, x: left ? 1 : -1, z: -.7 });
    assert.ok(left ? state.player.x > 2.3 : state.player.x < 17.7, 'Movement can leave the wall after the charge');
    assert.ok(state.player.z < 21, 'The hero can sidestep instead of remaining trapped against the boss');
  }
});

test('boss contact in either upper arena corner stays finite and preserves a route back out', () => {
  for (const left of [true, false]) {
    let state = arena();
    Object.assign(state.player, { x: left ? 1.34 : 18.66, z: 26.66 });
    const boss = state.enemies[0];
    Object.assign(boss, { x: left ? 2.5 : 17.5, z: 25.8, mode: 'charge', modeTime: BOSS_CHARGE_DURATION });
    boss.wanderAngle = Math.atan2(state.player.z - boss.z, state.player.x - boss.x);
    for (let frame = 0; frame < 60; frame++) state = tick(state);
    for (let frame = 0; frame < 90; frame++) state = tick(state, { ...idle, z: -1 });
    assert.ok(state.player.z < 23, 'The free axis remains usable after two-wall contact');
  }
});

test('a ranged warning aimed at a side wall completes, lands, and leaves movement responsive', () => {
  for (const left of [true, false]) {
    let state = arena();
    Object.assign(state.player, { x: left ? 1.34 : 18.66, z: 24 });
    Object.assign(state.enemies[0], { x: 10, z: 20 });
    state = tick(state);
    assert.equal(state.enemies[0].mode, 'ranged-windup');
    const target = { x: state.enemies[0].rangedAimX, z: state.enemies[0].rangedAimZ };
    for (let frame = 0; frame < Math.ceil(BOSS_RANGED_WINDUP / FIXED_DT); frame++) state = tick(state);
    assert.equal(state.sounds.filter(sound => sound.name === 'ranged-fire').length, 1,
      'Touching the side wall cannot leave the ranged warning stuck forever');
    assert.equal(state.projectiles.length, 1);
    assert.equal(state.projectiles[0].lob?.targetX, target.x);
    assert.equal(state.projectiles[0].lob?.targetZ, target.z);

    for (let frame = 0; frame < 75; frame++) state = tick(state);
    assert.equal(state.projectiles.length, 0);
    assert.equal(state.hazards.length, 1);
    for (let frame = 0; frame < 60; frame++) state = tick(state, { ...idle, x: left ? 1 : -1 });
    assert.ok(Math.abs(state.player.x - target.x) > 3, 'Ordinary input still moves away from the marked wall location');
  }
});
