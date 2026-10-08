import test from 'node:test';
import assert from 'node:assert/strict';
import { getCameraFraming, getGameplayCameraTarget } from './camera';

test('portrait phones keep the hero visible at both dungeon edges', () => {
  for (const viewport of [[320, 568], [393, 780], [430, 850]]) {
    const framing = getCameraFraming(viewport[0], viewport[1]);
    for (const x of [1.4, 18.6]) {
      const target = getGameplayCameraTarget({ x, z: 21 }, 'dungeon', framing);
      assert.equal(target.x, x);
      assert.ok(Math.abs(target.x - x) + 1 < framing.halfWidth);
    }
  }
});

test('portrait phones can explore both overworld boundaries without losing the hero', () => {
  const framing = getCameraFraming(393, 780);
  for (const x of [.5, 47.5]) {
    const target = getGameplayCameraTarget({ x, z: 6 }, 'overworld', framing);
    assert.equal(target.x, x);
  }
});

test('rotating a phone leaves a useful combat view and a visible hero', () => {
  const portrait = getCameraFraming(393, 780);
  const landscape = getCameraFraming(780, 393);
  assert.ok(landscape.halfHeight < portrait.halfHeight, 'Short playfields enlarge characters');
  assert.ok(landscape.halfWidth > 12, 'The boss arena remains visible across landscape');
  for (const framing of [portrait, landscape]) {
    const target = getGameplayCameraTarget({ x: 18.6, z: 21 }, 'dungeon', framing);
    assert.ok(Math.abs(target.x - 18.6) + 1 < framing.halfWidth);
  }
});

test('desktop keeps its existing dungeon composition and overworld boundary framing', () => {
  const framing = getCameraFraming(1440, 780);
  assert.equal(framing.halfHeight, 9.5);
  assert.deepEqual(getGameplayCameraTarget({ x: 2, z: 21 }, 'dungeon', framing), { x: 7.84, z: 22.9 });
  assert.deepEqual(getGameplayCameraTarget({ x: 2, z: 3 }, 'overworld', framing), { x: 7, z: 6.6 });
  assert.deepEqual(getGameplayCameraTarget({ x: 47, z: 28 }, 'overworld', framing), { x: 41, z: 23 });
});
