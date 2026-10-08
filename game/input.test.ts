import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, normalizeMovement } from './input';

class FakeElement extends EventTarget {
  isContentEditable = false;
  tagName = 'CANVAS';
  captured = new Set<number>();
  closest(): FakeElement | null { return null; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}

function event(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
  const value = Object.assign(new Event(type, { cancelable: true }), properties);
  target.dispatchEvent(value);
  return value;
}

function withInput(run: (context: {
  input: ReturnType<typeof createInput>; canvas: FakeElement; window: EventTarget;
  document: EventTarget & { hidden: boolean }; interactions: () => number;
}) => void) {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const canvas = new FakeElement();
  const globals = { window, document, Element: FakeElement, HTMLElement: FakeElement };
  const descriptors = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  let interactions = 0;
  const input = createInput(canvas as unknown as HTMLCanvasElement, () => {}, () => {}, () => {}, () => interactions++);
  try { run({ input, canvas, window, document, interactions: () => interactions }); }
  finally {
    input.dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('the joystick has a radial deadzone and preserves proportional movement', () => {
  assert.deepEqual(normalizeMovement(.08, -.07, .12), { x: 0, z: 0 });
  const half = normalizeMovement(.56, 0, .12);
  assert.ok(Math.abs(half.x - .5) < 1e-10);
  assert.equal(half.z, 0);
  assert.deepEqual(normalizeMovement(Infinity, 1), { x: 0, z: 0 });
  assert.deepEqual(normalizeMovement(NaN, 1), { x: 0, z: 0 });
});

test('joystick diagonals and long drags never exceed full speed', () => {
  const diagonal = normalizeMovement(3, 3, .12);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-10);
  assert.equal(diagonal.x, diagonal.z);
  assert.deepEqual(normalizeMovement(4, 0, .12), { x: 1, z: 0 });
});

test('analog movement can continue while the sword is held and interaction is tapped', () => withInput(({ input, interactions }) => {
  input.setMovement(.5, -.25);
  input.setVirtual('attack', true);
  input.setVirtual('interact', true);
  input.setVirtual('interact', false);
  const first = input.read();
  assert.equal(first.x, .5);
  assert.equal(first.z, -.25);
  assert.equal(first.attack, true);
  assert.equal(first.interact, true);
  assert.equal(interactions(), 1);
  assert.deepEqual(input.read(), { x: .5, z: -.25, attack: true, interact: false });
  input.setVirtual('attack', false);
  assert.equal(input.read().attack, false);
}));

test('a quick sword tap between simulation ticks is still delivered exactly once', () => withInput(({ input }) => {
  input.setVirtual('attack', true);
  input.setVirtual('attack', false);
  assert.equal(input.read().attack, true);
  assert.equal(input.read().attack, false);
}));

test('a quick Space tap between simulation ticks is delivered exactly once', () => withInput(({ input, window }) => {
  event(window, 'keydown', { code: 'Space', repeat: false });
  event(window, 'keyup', { code: 'Space' });
  assert.equal(input.read().attack, true);
  assert.equal(input.read().attack, false);
}));

test('a repeating Space key does not queue an extra attack after release', () => withInput(({ input, window }) => {
  event(window, 'keydown', { code: 'Space', repeat: false });
  assert.equal(input.read().attack, true);
  event(window, 'keydown', { code: 'Space', repeat: true });
  event(window, 'keyup', { code: 'Space' });
  assert.equal(input.read().attack, false);
}));

test('keyboard and analog controls share the same right/up directions without extra speed', () => withInput(({ input, window }) => {
  event(window, 'keydown', { code: 'KeyD', repeat: false });
  input.setMovement(.75, .75);
  const state = input.read();
  assert.ok(state.x > 0 && state.z > 0);
  assert.ok(Math.abs(Math.hypot(state.x, state.z) - 1) < 1e-10);
  event(window, 'keyup', { code: 'KeyD' });
  input.setMovement(0, 0);
  assert.equal(input.read().x, 0);
  event(window, 'keydown', { code: 'ArrowUp', repeat: false });
  assert.equal(input.read().z, 1);
}));

test('touching the canvas never swings, but desktop mouse clicks still do', () => withInput(({ input, canvas }) => {
  event(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 1, button: 0 });
  assert.equal(input.read().attack, false);
  assert.equal(canvas.captured.size, 0);
  event(canvas, 'pointerdown', { pointerType: 'mouse', pointerId: 2, button: 0 });
  assert.equal(input.read().attack, true);
  assert.equal(canvas.hasPointerCapture(2), true);
  event(canvas, 'pointerup', { pointerType: 'mouse', pointerId: 2 });
  assert.equal(input.read().attack, false);
  assert.equal(canvas.hasPointerCapture(2), false);
}));

test('blur, resize, visibility changes, and explicit clearing stop all held input', () => withInput(({ input, window, document }) => {
  const idle = { x: 0, z: 0, attack: false, interact: false };
  const hold = () => {
    input.setMovement(1, 0);
    input.setVirtual('attack', true);
    input.setVirtual('interact', true);
    event(window, 'keydown', { code: 'KeyW' });
  };
  hold(); event(window, 'blur'); assert.deepEqual(input.read(), idle);
  hold(); event(window, 'resize'); assert.deepEqual(input.read(), idle);
  hold(); document.hidden = true; event(document, 'visibilitychange'); assert.deepEqual(input.read(), idle);
  hold(); input.clear(); assert.deepEqual(input.read(), idle);
}));

test('losing mouse pointer capture clears the held sword', () => withInput(({ input, canvas }) => {
  event(canvas, 'pointerdown', { pointerType: 'mouse', pointerId: 5, button: 0 });
  input.read();
  event(canvas, 'lostpointercapture', { pointerId: 5 });
  assert.equal(input.read().attack, false);
}));

test('keyboard activation of UI buttons does not also swing the sword', () => withInput(({ input, window }) => {
  const button = new FakeElement();
  button.tagName = 'BUTTON';
  button.closest = () => button;
  // The window listener receives a bubbling event whose original target is a button.
  const space = new Event('keydown', { cancelable: true });
  Object.defineProperties(space, { code: { value: 'Space' }, target: { value: button } });
  window.dispatchEvent(space);
  assert.equal(input.read().attack, false);
  assert.equal(space.defaultPrevented, false, 'Let the focused button keep its native keyboard activation');
}));

test('holding interact never repeats the interaction until released and pressed again', () => withInput(({ input, interactions }) => {
  input.setVirtual('interact', true);
  assert.equal(input.read().interact, true);
  input.setVirtual('interact', true);
  assert.equal(input.read().interact, false);
  assert.equal(interactions(), 1);
  input.setVirtual('interact', false);
  input.setVirtual('interact', true);
  assert.equal(input.read().interact, true);
  assert.equal(interactions(), 2);
}));
