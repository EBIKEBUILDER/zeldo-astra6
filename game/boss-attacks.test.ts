import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import { useGameStore } from './store';
import {
  BOSS_CHARGE_DURATION, BOSS_CHARGE_SPEED, BOSS_HAZARD_LIFETIME,
  BOSS_HAZARD_RADIUS, BOSS_MAX_HAZARDS, BOSS_RECOVERY, bossLobDuration, bossLobHeight, bossLobVerticalSpeed,
} from './boss-attacks';
import type { GameData, Hazard, InputState, Projectile } from './types';

const idle: InputState = { x: 0, z: 0, attack: false, interact: false };

test('the thrown projectile rises to an apex and accelerates downward into its landing', () => {
  for (const distance of [3, 12]) {
    const duration = bossLobDuration(distance);
    const heights = [0, .25, .5, .75, 1].map(progress => bossLobHeight(progress * duration, duration));
    assert.ok(heights[0] < heights[1] && heights[1] < heights[2]);
    assert.ok(heights[2] > heights[3] && heights[3] > heights[4]);
    assert.ok(heights[2] - heights[0] > 2, 'The arc must be visibly raised, not a floating straight shot');
    assert.ok(Math.abs(heights[4] - heights[0]) < 1e-9);
    assert.ok(bossLobVerticalSpeed(0, duration) > 0);
    assert.equal(bossLobVerticalSpeed(duration / 2, duration), 0);
    assert.ok(bossLobVerticalSpeed(duration, duration) < 0);
  }
});

function arena(): GameData {
  const state = createInitialData();
  Object.assign(state, { phase: 'playing', zone: 'dungeon', hasKey: true, gateOpen: true });
  Object.assign(state.player, { x: 10, z: 18.5, facingX: 0, facingZ: 1 });
  state.enemies = state.enemies.filter(enemy => enemy.kind === 'boss');
  Object.assign(state.enemies[0], { x: 10, z: 20, progressX: 10, progressZ: 20, modeTime: 0 });
  state.breakables = [];
  return state;
}

function frames(state: GameData, count: number, input = idle): GameData {
  for (let frame = 0; frame < count; frame++) state = stepGame(state, FIXED_DT, input);
  return state;
}

function until(state: GameData, condition: (state: GameData) => boolean, limit: number, input = idle): GameData {
  for (let frame = 0; frame < limit && !condition(state); frame++) state = stepGame(state, FIXED_DT, input);
  assert.ok(condition(state), `Expected combat transition within ${limit} frames`);
  return state;
}

function pool(state: GameData, values: Partial<Hazard> = {}): Hazard {
  return { id: 9000, zone: 'dungeon', ownerId: state.enemies[0].id, x: 10, z: 25,
    radius: BOSS_HAZARD_RADIUS, life: BOSS_HAZARD_LIFETIME, maxLife: BOSS_HAZARD_LIFETIME, ...values };
}

function lob(state: GameData, values: Partial<Projectile> = {}): Projectile {
  const owner = state.enemies[0];
  const duration = bossLobDuration(Math.hypot(10 - owner.x, 25 - owner.z));
  return { id: 9100, zone: 'dungeon', ownerId: owner.id, x: owner.x, z: owner.z,
    vx: 0, vz: 0, radius: .18, life: duration + 1, age: 0, reflected: false,
    lob: { startX: owner.x, startZ: owner.z, targetX: 10, targetZ: 25, duration }, ...values };
}

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeSnapshot(child);
  }
  return value;
}

test('the lunge commits its direction at the start of its warning and exposes a recovery window', () => {
  let state = arena();
  state.player.z = 17;
  state.player.invulnerable = 100;
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'windup');
  const aim = state.enemies[0].wanderAngle;
  assert.ok(Math.abs(aim + Math.PI / 2) < 1e-9);
  state = until(state, next => next.enemies[0].mode === 'charge', 60, { ...idle, x: 1 });
  assert.ok(state.player.x > 12, 'The hero has sidestepped after seeing the warning');
  assert.equal(state.enemies[0].wanderAngle, aim);
  assert.ok(Math.abs(state.enemies[0].vx) < 1e-8);
  assert.ok(state.enemies[0].vz < 0, 'The rush travels along the warned lane, not toward the new hero position');
  state = until(state, next => next.enemies[0].mode !== 'charge', 60);
  assert.equal(state.enemies[0].mode, 'idle');
  assert.ok(state.enemies[0].modeTime >= BOSS_RECOVERY - FIXED_DT);
  const recoveryPosition = { x: state.enemies[0].x, z: state.enemies[0].z };
  state = frames(state, Math.floor((BOSS_RECOVERY - .1) / FIXED_DT));
  assert.equal(state.enemies[0].mode, 'idle');
  assert.ok(Math.hypot(state.enemies[0].x - recoveryPosition.x, state.enemies[0].z - recoveryPosition.z) < .3,
    'Recovery stops the rush and gives the hero a readable opening');
});

test('sword and reflected-projectile hits cannot damage, flash, stun, or knock back an active charge', () => {
  for (const attack of ['sword', 'reflected wisp'] as const) {
    const state = arena();
    state.player.invulnerable = 100;
    Object.assign(state.enemies[0], { mode: 'charge', modeTime: BOSS_CHARGE_DURATION, wanderAngle: 0, vx: BOSS_CHARGE_SPEED, vz: 0 });
    const control = stepGame(state, FIXED_DT, idle);
    if (attack === 'sword') Object.assign(state.player, { attackTime: .16, attackId: 1, attackCooldown: 1 });
    else state.projectiles = [{ id: 9200, zone: 'dungeon', ownerId: state.enemies[0].id,
      x: 10, z: 19.15, vx: 0, vz: 7.2, radius: .18, life: 4, age: 0, reflected: true }];
    const next = stepGame(state, FIXED_DT, idle);
    const boss = next.enemies[0], unhit = control.enemies[0];
    assert.equal(boss.hp, unhit.hp, `${attack}: no damage during the active rush`);
    assert.equal(boss.flash, 0, `${attack}: no damage flash`);
    assert.equal(boss.hitstun, 0, `${attack}: no stagger`);
    assert.equal(boss.mode, 'charge');
    assert.equal(boss.modeTime, unhit.modeTime);
    assert.equal(boss.vx, unhit.vx, `${attack}: preserve charge velocity`);
    assert.equal(boss.vz, unhit.vz, `${attack}: preserve charge velocity`);
    assert.equal(boss.x, unhit.x);
    assert.equal(boss.z, unhit.z);
    if (attack === 'reflected wisp') assert.equal(next.projectiles.length, 0, 'An immune hit still consumes the returning shot');
  }
});

test('the same sword strike damages the Guardian during warning and recovery', () => {
  for (const mode of ['windup', 'idle'] as const) {
    const state = arena();
    state.player.invulnerable = 100;
    Object.assign(state.player, { attackTime: .16, attackId: 1, attackCooldown: 1 });
    Object.assign(state.enemies[0], { mode, modeTime: BOSS_RECOVERY });
    const next = stepGame(state, FIXED_DT, idle);
    assert.equal(next.enemies[0].hp, state.enemies[0].hp - 1, `${mode} remains vulnerable`);
    assert.ok(next.enemies[0].flash > 0);
    assert.ok(next.enemies[0].hitstun > 0);
  }
});

test('being pinned does not let the ranged fallback interrupt a committed rush or its recovery', () => {
  let state = arena();
  state.player.z = 25;
  state.player.invulnerable = 100;
  Object.assign(state.enemies[0], { mode: 'charge', modeTime: BOSS_CHARGE_DURATION, wanderAngle: 0,
    vx: BOSS_CHARGE_SPEED, vz: 0, stuckTime: .49 });
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    state.breakables.push({ id: `ring-${index}`, zone: 'dungeon', kind: 'pot',
      x: 10 + Math.cos(angle) * 1.35, z: 20 + Math.sin(angle) * 1.35, broken: false, lastAttackId: -1 });
  }
  let chargeFrames = 0;
  while (state.enemies[0].mode === 'charge' && chargeFrames < 90) {
    state = stepGame(state, FIXED_DT, idle);
    chargeFrames++;
    assert.equal(state.projectiles.length, 0);
    assert.equal(state.sounds.some(sound => sound.name === 'ranged-charge'), false);
  }
  assert.ok(chargeFrames * FIXED_DT >= BOSS_CHARGE_DURATION);
  assert.equal(state.enemies[0].mode, 'idle');
  state = frames(state, Math.floor((BOSS_RECOVERY - .1) / FIXED_DT));
  assert.equal(state.enemies[0].mode, 'idle');
  assert.equal(state.sounds.some(sound => sound.name === 'ranged-charge'), false);
});

test('a distant hero triggers a lob whose warning, flight, and lingering pool share one fixed target', () => {
  let state = arena();
  Object.assign(state.enemies[0], { z: 17, progressZ: 17 });
  state.player.z = 25;
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.enemies[0].mode, 'ranged-windup', 'Open ground at range should not require a stuck pursuit');
  const target = { x: state.enemies[0].rangedAimX, z: state.enemies[0].rangedAimZ };
  state = until(state, next => next.projectiles.length > 0, 65, { ...idle, x: 1 });
  const shot = state.projectiles[0];
  assert.ok(shot.lob, 'The attack travels in an arc rather than becoming an instant ground hit');
  assert.equal(shot.lob.targetX, target.x);
  assert.equal(shot.lob.targetZ, target.z);
  assert.ok(shot.lob.duration >= .8 && shot.lob.duration <= 1.2);
  assert.equal(state.hazards.length, 0);
  state.enemies[0].mode = 'idle';
  state.enemies[0].modeTime = 10;
  state = until(state, next => next.hazards.length > 0, 90);
  assert.equal(state.projectiles.length, 0);
  assert.equal(state.hazards.length, 1);
  assert.ok(Math.hypot(state.hazards[0].x - target.x, state.hazards[0].z - target.z) < 1e-9);
  assert.equal(state.hazards[0].radius, BOSS_HAZARD_RADIUS);
  assert.ok(state.hazards[0].life > 0 && state.hazards[0].life <= BOSS_HAZARD_LIFETIME);
  assert.equal(state.player.hp, 6, 'Sidestepping the warning avoids both impact and the pool');
});

test('the landing burst and pool honor hurt invulnerability while moving out avoids further damage', () => {
  let state = arena();
  Object.assign(state.player, { x: 10, z: 25 });
  Object.assign(state.enemies[0], { mode: 'idle', modeTime: 10 });
  const shot = lob(state);
  shot.age = shot.lob!.duration - FIXED_DT / 2;
  state.projectiles = [shot];
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.player.hp, 4, 'Landing costs one heart without stacking pool damage on the same tick');
  assert.equal(state.hazards.length, 1);
  const landed = state;
  state = frames(state, 30);
  assert.equal(state.player.hp, 4, 'The pool cannot bypass existing hurt invulnerability');
  state = frames(state, 42);
  assert.equal(state.player.hp, 3, 'Standing in the pool after invulnerability ends costs half a heart');
  const escaped = frames(landed, 85, { ...idle, x: 1 });
  assert.ok(Math.abs(escaped.player.x - landed.hazards[0].x) > BOSS_HAZARD_RADIUS + .34);
  assert.equal(escaped.player.hp, 4, 'Walking out during the grace period avoids the lingering damage');
});

test('pools expire and successive impacts retain only a bounded number of hazard areas', () => {
  let state = arena();
  Object.assign(state.enemies[0], { mode: 'idle', modeTime: 10 });
  state.hazards = Array.from({ length: BOSS_MAX_HAZARDS }, (_, index) => pool(state, { id: 9000 + index }));
  const shot = lob(state);
  shot.age = shot.lob!.duration - FIXED_DT / 2;
  state.projectiles = [shot];
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.hazards.length, BOSS_MAX_HAZARDS);
  assert.equal(state.hazards.some(hazard => hazard.id === 9000), false, 'The oldest pool is retired when the cap is reached');
  state = frames(state, Math.ceil(BOSS_HAZARD_LIFETIME / FIXED_DT) + 1);
  assert.equal(state.hazards.length, 0);
});

test('boss death, arena retreat, zone exit, and retry clear both airborne and lingering attacks', () => {
  for (const exit of ['death', 'arena', 'zone'] as const) {
    const state = arena();
    state.projectiles = [lob(state)];
    state.hazards = [pool(state)];
    Object.assign(state.enemies[0], { mode: 'idle', modeTime: 10 });
    if (exit === 'death') {
      state.enemies[0].hp = 1;
      Object.assign(state.player, { attackTime: .16, attackId: 1, attackCooldown: 1 });
    } else Object.assign(state.player, { x: 10, z: exit === 'arena' ? 15 : 2 });
    const next = stepGame(state, FIXED_DT, idle);
    if (exit === 'death') assert.equal(next.bossDefeated, true);
    if (exit === 'zone') assert.equal(next.zone, 'overworld');
    assert.equal(next.projectiles.length, 0, `${exit}: no airborne attacks survive`);
    assert.equal(next.hazards.length, 0, `${exit}: no hazard pools survive`);
  }
  const original = useGameStore.getState();
  try {
    const state = arena();
    state.projectiles = [lob(state)];
    state.hazards = [pool(state)];
    useGameStore.setState(state);
    useGameStore.getState().retry();
    assert.equal(useGameStore.getState().projectiles.length, 0);
    assert.equal(useGameStore.getState().hazards.length, 0);
  } finally { useGameStore.setState(original, true); }
});

test('pausing freezes attacks and active updates preserve frozen earlier snapshots', () => {
  const state = arena();
  Object.assign(state.enemies[0], { mode: 'idle', modeTime: 10 });
  state.projectiles = [lob(state)];
  state.hazards = [pool(state, { x: 13, z: 24 })];
  const previous = freezeSnapshot(state);
  const snapshot = JSON.stringify(previous);
  const next = stepGame(previous, FIXED_DT, idle);
  assert.equal(JSON.stringify(previous), snapshot);
  assert.notStrictEqual(next.hazards, previous.hazards);
  assert.notStrictEqual(next.hazards[0], previous.hazards[0]);
  assert.ok(next.hazards[0].life < previous.hazards[0].life);
  assert.ok(next.projectiles[0].age > previous.projectiles[0].age);
  const paused = freezeSnapshot({ ...next, phase: 'paused' as const });
  assert.strictEqual(stepGame(paused, FIXED_DT, idle), paused);
});
