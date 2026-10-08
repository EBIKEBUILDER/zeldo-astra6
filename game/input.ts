import type { InputState } from './types';

export type VirtualAction = 'up' | 'down' | 'left' | 'right' | 'attack' | 'interact';

export type InputController = {
  read: () => InputState;
  clear: () => void;
  dispose: () => void;
  setVirtual: (action: VirtualAction, pressed: boolean) => void;
  setMovement: (x: number, z: number) => void;
};

/** Radial deadzone keeps the stick still at rest without making diagonals faster. */
export function normalizeMovement(x: number, z: number, deadzone = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { x: 0, z: 0 };
  const length = Math.hypot(x, z);
  const threshold = Math.min(.95, Math.max(0, deadzone));
  if (length <= threshold || length === 0) return { x: 0, z: 0 };
  const strength = (Math.min(length, 1) - threshold) / (1 - threshold);
  return { x: x / length * strength, z: z / length * strength };
}

const keyActions: Record<string, VirtualAction> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'attack', KeyE: 'interact',
};

/** Inputs are independent of React, the simulation, and the Babylon scene. */
export function createInput(
  canvas: HTMLCanvasElement,
  onStart: () => void,
  onPause: () => void,
  onMute: () => void,
  onInteract?: () => void,
): InputController {
  const keys = new Set<string>();
  const virtual = new Set<VirtualAction>();
  const pointers = new Set<number>();
  let movement = { x: 0, z: 0 };
  let attackPending = false;
  let interactPending = false;

  function clear() {
    keys.clear();
    virtual.clear();
    pointers.clear();
    movement = { x: 0, z: 0 };
    attackPending = false;
    interactPending = false;
  }

  function editable(target: EventTarget | null) {
    return target instanceof HTMLElement && (
      target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );
  }

  function activatesControl(event: KeyboardEvent) {
    return (event.code === 'Enter' || event.code === 'Space') &&
      event.target instanceof Element &&
      event.target.closest('button, a[href], [role="button"]') !== null;
  }

  function keydown(event: KeyboardEvent) {
    if (editable(event.target) || activatesControl(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    const action = keyActions[event.code];
    if (action) {
      event.preventDefault();
      if (action === 'attack' && !event.repeat && !keys.has(event.code)) attackPending = true;
      if (action === 'interact' && !event.repeat && !keys.has(event.code)) {
        interactPending = true;
        onInteract?.();
      }
      keys.add(event.code);
      return;
    }
    if (!['Enter', 'Escape', 'KeyM'].includes(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Enter') onStart();
    if (event.code === 'Escape') { clear(); onPause(); }
    if (event.code === 'KeyM') onMute();
  }

  function keyup(event: KeyboardEvent) {
    keys.delete(event.code);
    if (keyActions[event.code] && !editable(event.target) && !activatesControl(event)) event.preventDefault();
  }

  function pointerdown(event: PointerEvent) {
    // Touch movement/actions belong to the mobile controls, never the world canvas.
    if (event.pointerType === 'touch' || event.button !== 0) return;
    event.preventDefault();
    pointers.add(event.pointerId);
    attackPending = true;
    canvas.setPointerCapture(event.pointerId);
  }

  function pointerup(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function visibility() {
    if (document.hidden) clear();
  }

  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', clear);
  window.addEventListener('resize', clear);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('pointerdown', pointerdown);
  canvas.addEventListener('pointerup', pointerup);
  canvas.addEventListener('pointercancel', pointerup);
  canvas.addEventListener('lostpointercapture', pointerup);

  return {
    read() {
      const pressed = new Set<VirtualAction>(virtual);
      for (const key of keys) if (keyActions[key]) pressed.add(keyActions[key]);
      const { x, z } = normalizeMovement(
        movement.x + Number(pressed.has('right')) - Number(pressed.has('left')),
        movement.z + Number(pressed.has('up')) - Number(pressed.has('down')),
      );
      const interact = interactPending;
      const attack = pressed.has('attack') || pointers.size > 0 || attackPending;
      interactPending = false;
      attackPending = false;
      return { x, z, attack, interact };
    },
    clear,
    setMovement(x, z) { movement = normalizeMovement(x, z); },
    setVirtual(action, pressed) {
      if (action === 'attack' && pressed && !virtual.has(action)) attackPending = true;
      if (action === 'interact' && pressed && !virtual.has(action)) {
        interactPending = true;
        onInteract?.();
      }
      if (pressed) virtual.add(action);
      else virtual.delete(action);
    },
    dispose() {
      clear();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', clear);
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointerdown', pointerdown);
      canvas.removeEventListener('pointerup', pointerup);
      canvas.removeEventListener('pointercancel', pointerup);
      canvas.removeEventListener('lostpointercapture', pointerup);
    },
  };
}
