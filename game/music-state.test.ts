import test from 'node:test';
import assert from 'node:assert/strict';
import { musicForState } from './music-state';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import { useGameStore } from './store';
import { WORLDS } from './world';
import type { GameData, InputState } from './types';

const idle: InputState = { x: 0, z: 0, attack: false, interact: false };

function frames(state: GameData, count: number, input: InputState = idle): GameData {
  for (let frame = 0; frame < count; frame++) state = stepGame(state, FIXED_DT, input);
  return state;
}

test('music follows the quest from the overworld through the Guardian and back', () => {
  let state = createInitialData();
  assert.equal(musicForState(state), null);
  state.phase = 'playing';
  assert.equal(musicForState(state), 'overworld');

  Object.assign(state.player, WORLDS.overworld.entrance);
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.zone, 'dungeon');
  assert.equal(musicForState(state), 'dungeon');

  Object.assign(state.player, { x: 10, z: 12.3 });
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.gateOpen, false);
  assert.equal(musicForState(state), 'dungeon');

  Object.assign(state.player, WORLDS.dungeon.key);
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.hasKey, true);
  Object.assign(state.player, { x: 10, z: 12.3 });
  state = stepGame(state, FIXED_DT, idle);
  assert.equal(state.gateOpen, true);
  assert.equal(musicForState(state), 'dungeon', 'Unlocking the gate does not begin the fight music');

  Object.assign(state.player, { x: 10, z: 15, invulnerable: 10 });
  state = frames(state, 12, { ...idle, z: 1 });
  assert.ok(state.player.z > 15.1);
  assert.equal(musicForState(state), 'boss');
  state = frames(state, 24, { ...idle, z: -1 });
  assert.ok(state.player.z < 15.1);
  assert.equal(musicForState(state), 'dungeon', 'Retreating from the arena restores exploration music');
  state = frames(state, 24, { ...idle, z: 1 });
  assert.ok(state.player.z > 15.1);
  assert.equal(musicForState(state), 'boss');

  const boss = state.enemies.find(enemy => enemy.kind === 'boss')!;
  state.enemies = [boss];
  Object.assign(boss, { hp: 1, x: 10, z: 21, modeTime: 10 });
  Object.assign(state.player, { x: 10, z: 19.5, vx: 0, vz: 0, facingX: 0, facingZ: 1, invulnerable: 10 });
  state = frames(state, 19, { ...idle, attack: true });
  assert.equal(state.bossDefeated, true);
  assert.equal(musicForState(state), 'dungeon', 'The battle theme ends as soon as the Guardian falls');

  Object.assign(state.player, { ...WORLDS.dungeon.exit, invulnerable: 0 });
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.zone, 'overworld');
  assert.equal(musicForState(state), 'overworld');

  Object.assign(state.player, WORLDS.overworld.entrance);
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  Object.assign(state.player, WORLDS.dungeon.chest);
  state = stepGame(state, FIXED_DT, { ...idle, interact: true });
  assert.equal(state.phase, 'victory');
  assert.equal(musicForState(state), null);
});

test('boss music uses the same arena boundary as Guardian activation', () => {
  const state = createInitialData();
  state.phase = 'playing';
  state.zone = 'dungeon';
  state.player.z = 15.1;
  assert.equal(musicForState(state), 'dungeon', 'A sealed arena cannot start the boss theme');
  state.gateOpen = true;
  assert.equal(musicForState(state), 'boss');
  state.player.z = 15.1 - Number.EPSILON * 16;
  assert.equal(musicForState(state), 'dungeon');
});

test('pause, game over, and retry update the music selected from the live store', () => {
  const previous = useGameStore.getState();
  try {
    useGameStore.setState(createInitialData());
    useGameStore.getState().start();
    assert.equal(musicForState(useGameStore.getState()), 'overworld');
    useGameStore.setState({
      zone: 'dungeon', gateOpen: true,
      player: { ...useGameStore.getState().player, z: 16 },
    });
    assert.equal(musicForState(useGameStore.getState()), 'boss');
    useGameStore.getState().togglePause();
    assert.equal(musicForState(useGameStore.getState()), null);
    useGameStore.getState().togglePause();
    assert.equal(musicForState(useGameStore.getState()), 'boss');
    useGameStore.setState({ phase: 'gameover' });
    assert.equal(musicForState(useGameStore.getState()), null);
    useGameStore.getState().retry();
    assert.equal(musicForState(useGameStore.getState()), 'overworld');
    assert.equal(useGameStore.getState().gateOpen, false);
  } finally {
    useGameStore.setState(previous, true);
  }
});
