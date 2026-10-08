'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { normalizeMovement } from '@/game/input';
import type { GameControls } from './GameCanvas';
import { Icon } from './Icons';

type Props = {
  controls: RefObject<GameControls | null>;
  enabled: boolean;
  interactLabel: string;
  interactAvailable: boolean;
};

/** Each control owns its pointer so walking and swinging work with two thumbs. */
export default function TouchControls({ controls, enabled, interactLabel, interactAvailable }: Props) {
  const joystick = useRef<HTMLDivElement>(null);
  const attack = useRef<HTMLButtonElement>(null);
  const stickPointer = useRef<number | null>(null);
  const attackPointer = useRef<number | null>(null);
  const attackKeys = useRef(new Set<string>());
  const instructionsId = useId();

  const stopStick = useCallback(() => {
    const pointer = stickPointer.current;
    stickPointer.current = null;
    const element = joystick.current;
    if (element) {
      element.style.setProperty('--stick-x', '0px');
      element.style.setProperty('--stick-y', '0px');
      element.dataset.active = 'false';
      if (pointer !== null && element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    }
    controls.current?.move(0, 0);
  }, [controls]);

  const updateAttack = useCallback(() => {
    const pressed = attackPointer.current !== null || attackKeys.current.size > 0;
    if (attack.current) attack.current.dataset.pressed = String(pressed);
    controls.current?.virtual('attack', pressed);
  }, [controls]);

  const stopAttack = useCallback(() => {
    const pointer = attackPointer.current;
    attackPointer.current = null;
    attackKeys.current.clear();
    if (pointer !== null && attack.current?.hasPointerCapture(pointer)) attack.current.releasePointerCapture(pointer);
    updateAttack();
  }, [updateAttack]);

  useEffect(() => {
    const clear = () => {
      stopStick();
      stopAttack();
      controls.current?.virtual('interact', false);
    };
    const visibility = () => { if (document.hidden) clear(); };
    if (!enabled) clear();
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clear();
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', clear);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [controls, enabled, stopAttack, stopStick]);

  function moveStick(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || stickPointer.current !== event.pointerId) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * .32;
    if (radius <= 0) return;
    const dx = (event.clientX - bounds.left - bounds.width / 2) / radius;
    const dy = (event.clientY - bounds.top - bounds.height / 2) / radius;
    const visual = normalizeMovement(dx, dy);
    const movement = normalizeMovement(dx, -dy, .12);
    event.currentTarget.style.setProperty('--stick-x', `${visual.x * radius}px`);
    event.currentTarget.style.setProperty('--stick-y', `${visual.z * radius}px`);
    controls.current?.move(movement.x, movement.z);
  }

  function beginStick(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || stickPointer.current !== null || event.button !== 0) return;
    event.preventDefault();
    stickPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.active = 'true';
    moveStick(event);
  }

  function endStick(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId === stickPointer.current) stopStick();
  }

  function beginAttack(event: PointerEvent<HTMLButtonElement>) {
    if (!enabled || attackPointer.current !== null || event.button !== 0) return;
    event.preventDefault();
    attackPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateAttack();
  }

  function endAttack(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerId !== attackPointer.current) return;
    attackPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    updateAttack();
  }

  function attackKey(event: KeyboardEvent<HTMLButtonElement>, pressed: boolean) {
    if (!enabled || !['Space', 'Enter'].includes(event.code)) return;
    event.preventDefault();
    if (pressed) attackKeys.current.add(event.code);
    else attackKeys.current.delete(event.code);
    updateAttack();
  }

  if (!enabled) return null;

  return <div className="touch-controls" aria-label="Touch game controls">
    <p id={instructionsId} className="sr-only">Drag the joystick to move. Hold Sword to keep swinging. Use the action button near doors and treasure. A keyboard can also move with arrow keys or W A S D.</p>
    <div ref={joystick} className="virtual-joystick" role="group" tabIndex={0}
      aria-label="Movement joystick" aria-describedby={instructionsId}
      onPointerDown={beginStick} onPointerMove={moveStick} onPointerUp={endStick}
      onPointerCancel={endStick} onLostPointerCapture={endStick} onContextMenu={event => event.preventDefault()}>
      <span className="joystick-base" aria-hidden="true"><span className="joystick-knob" /></span>
      <span className="joystick-label" aria-hidden="true">Move</span>
    </div>
    <div className="touch-actions">
      <button className="touch-action touch-interact" type="button" disabled={!interactAvailable}
        aria-label={`${interactLabel}${interactAvailable ? '' : ' — approach a door or treasure'}`}
        onClick={() => {
          if (!interactAvailable) return;
          controls.current?.virtual('interact', true);
          controls.current?.virtual('interact', false);
        }}>
        <Icon name="key" size={24} /><span>{interactLabel}</span>
      </button>
      <button ref={attack} className="touch-action touch-attack" type="button"
        aria-label="Sword — hold to attack" aria-describedby={instructionsId}
        onPointerDown={beginAttack} onPointerUp={endAttack} onPointerCancel={endAttack}
        onLostPointerCapture={endAttack} onKeyDown={event => attackKey(event, true)}
        onKeyUp={event => attackKey(event, false)} onBlur={stopAttack}
        onContextMenu={event => event.preventDefault()}
        onClick={event => {
          // Screen-reader activation has no pointer or physical key event.
          if (event.detail !== 0) return;
          controls.current?.virtual('attack', true);
          controls.current?.virtual('attack', false);
        }}>
        <Icon name="sword" size={35} /><span>Sword</span>
      </button>
    </div>
  </div>;
}
