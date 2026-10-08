'use client';

import { memo, useEffect, useId, useRef } from 'react';
import { useGameStore } from '@/game/store';
import type { Point, Zone } from '@/game/types';
import { WORLDS } from '@/game/world';
import { Icon } from './Icons';

type MapProps = { expanded: boolean; onExpand: () => void; onClose: () => void };
type Objective = Point & { kind: 'shrine' | 'key' | 'gate' | 'boss' | 'chest'; label: string; instruction: string };

// World north is +z. In SVG, north is up, so every z coordinate is inverted.
const MapTerrain = memo(function MapTerrain({ zone, gateOpen }: { zone: Zone; gateOpen: boolean }) {
  const world = WORLDS[zone];
  return <g aria-hidden="true">
    <rect width={world.width} height={world.height} fill={zone === 'overworld' ? '#acbd95' : '#8b9080'} rx=".6" />
    {world.decorations.filter(d => d.kind === 'path' || d.kind === 'bridge').map((d, i) => <rect key={`path-${i}`} x={d.x - (d.w ?? 1) / 2} y={world.height - d.z - (d.d ?? 1) / 2} width={d.w ?? 1} height={d.d ?? 1} fill={d.kind === 'bridge' ? '#ab8053' : '#d9cba2'} />)}
    {world.obstacles.map(o => <rect key={o.id} x={o.x - o.w / 2} y={world.height - o.z - o.d / 2} width={o.w} height={o.d} rx={o.kind === 'tree' ? '.55' : '.1'} fill={o.kind === 'water' ? '#729eaa' : o.kind === 'tree' || o.kind === 'hedge' ? '#57765b' : o.kind === 'wall' ? '#59645a' : '#81897b'} />)}
    {zone === 'dungeon' && !gateOpen && <rect x={world.gate.x - 1.5} y={world.height - world.gate.z - .3} width="3" height=".6" fill="#bba36d" />}
    <circle cx={world.spawn.x} cy={world.height - world.spawn.z} r=".75" fill="#edf0d5" opacity=".65" />
    {zone === 'dungeon' && <path d={`M${world.exit.x - .6},${world.height - world.exit.z - .35} h1.2 v.65 h.5 l-1.1,1.1 l-1.1,-1.1 h.5Z`} fill="#f7f1d8" stroke="#4b6354" strokeWidth=".2" />}
  </g>;
});

function ObjectiveMarker({ objective, height }: { objective: Objective; height: number }) {
  return <g transform={`translate(${objective.x} ${height - objective.z})`} aria-hidden="true">
    <circle r="1.55" fill="#fbdf91" opacity=".3" />
    {objective.kind === 'shrine' ? <path d="M-1 1 L0 -1.35 L1 1Z" fill="#ffe4a1" stroke="#775d37" strokeWidth=".3" />
      : objective.kind === 'key' ? <g fill="none" stroke="#ffe4a1" strokeWidth=".55"><circle cx="-.3" cy="-.5" r=".5" /><path d="M0 0 L.8 1 M.35 .4 L.75 0" /></g>
        : objective.kind === 'gate' ? <g fill="#c49d62" stroke="#fff0bd" strokeWidth=".25"><rect x="-1" y="-1" width="2" height="2" rx=".15" /><path d="M-.35 -1 V1 M.35 -1 V1" /></g>
          : objective.kind === 'boss' ? <path d="M0 -1.3 L1.15 0 L0 1.3 L-1.15 0Z" fill="#ba697d" stroke="#ffebc0" strokeWidth=".3" />
            : <g fill="#edc474" stroke="#705333" strokeWidth=".25"><rect x="-1" y="-.75" width="2" height="1.5" rx=".2" /><path d="M-1 -.1 H1 M0 -.6 V.5" /></g>}
  </g>;
}

export default function AdventureMap({ expanded, onExpand, onClose }: MapProps) {
  const zone = useGameStore(s => s.zone);
  const area = useGameStore(s => s.area);
  const x = useGameStore(s => Math.round(s.player.x * 4) / 4);
  const z = useGameStore(s => Math.round(s.player.z * 4) / 4);
  const facing = useGameStore(s => Math.atan2(s.player.facingX, s.player.facingZ) * 180 / Math.PI);
  const hasKey = useGameStore(s => s.hasKey);
  const gateOpen = useGameStore(s => s.gateOpen);
  const bossDefeated = useGameStore(s => s.bossDefeated);
  const bossX = useGameStore(s => Math.round((s.enemies.find(e => e.kind === 'boss')?.x ?? 10) * 2) / 2);
  const bossZ = useGameStore(s => Math.round((s.enemies.find(e => e.kind === 'boss')?.z ?? 21) * 2) / 2);
  const world = WORLDS[zone];
  const title = zone === 'overworld' ? 'Mosswood Valley' : 'Lantern Vault';
  const objective: Objective = zone === 'overworld' ? { ...world.entrance, kind: 'shrine', label: 'Old shrine', instruction: 'Cross the old bridge and follow the path northeast to the shrine.' }
    : bossDefeated ? { ...world.chest, kind: 'chest', label: 'Ember chest', instruction: 'Open the chest in the northern chamber to claim the last ember.' }
      : !hasKey && !gateOpen ? { ...world.key, kind: 'key', label: 'Brass key', instruction: 'Find the brass key on the western pedestal.' }
        : !gateOpen ? { ...world.gate, kind: 'gate', label: 'Sealed gate', instruction: 'Carry the brass key to the gate between the two chambers.' }
          : { x: bossX, z: bossZ, kind: 'boss', label: 'Hollow Guardian', instruction: 'Defeat the Guardian. Sidestep violet wisps, or return them with your sword.' };
  const dialogId = useId();
  const headingId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const buttons = dialog.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handleKey, true);
    const triggerElement = trigger.current;
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      if (useGameStore.getState().phase === 'playing') document.querySelector<HTMLCanvasElement>('.world-canvas')?.focus({ preventScroll: true });
      else triggerElement?.focus({ preventScroll: true });
    };
  }, [expanded]);

  const map = (large: boolean) => <svg className={`map-world${large ? ' map-world-large' : ''}`} viewBox={`0 0 ${world.width} ${world.height}`} role="img" aria-label={`${title}. You are in ${area}. Your objective is ${objective.label}. North is up.`}>
    <MapTerrain zone={zone} gateOpen={gateOpen} />
    <ObjectiveMarker objective={objective} height={world.height} />
    <g transform={`translate(${x} ${world.height - z})`} aria-hidden="true">
      <circle r="1.15" fill="#fffbed" stroke="#304f43" strokeWidth=".25" />
      <path d="M0 -1.45 L.7 .75 L0 .35 L-.7 .75Z" transform={`rotate(${facing})`} fill="#355e4b" stroke="#fffbed" strokeWidth=".15" />
    </g>
  </svg>;

  return <>
    <div className="map-container">
      <button ref={trigger} className="minimap map-toggle" onClick={onExpand} aria-label={`Open map. ${area}. Objective: ${objective.label}`} aria-expanded={expanded} aria-controls={expanded ? dialogId : undefined} aria-haspopup="dialog">
        <span className="map-header"><span>{area}</span><span aria-label="North is up">N ↑</span></span>
        {map(false)}
        <span className="map-caption"><span className="map-objective-dot" />{objective.label}<span className="map-expand"><Icon name="compass" size={12} /><span>Map</span></span></span>
      </button>
    </div>
    {expanded && <div className="modal-shade map-dialog" onClick={onClose}>
      <section ref={dialog} id={dialogId} className="map-modal" role="dialog" aria-modal="true" aria-labelledby={headingId} onClick={event => event.stopPropagation()}>
        <button ref={closeButton} className="close-button" onClick={onClose} aria-label="Close map"><Icon name="close" /></button>
        <span className="eyebrow">YOUR FIELD MAP · GAME PAUSED</span>
        <h2 id={headingId}>{title}</h2>
        <div className="map-location"><Icon name="pin" size={16} /><span>{area}</span><span className="map-north">N ↑</span></div>
        {map(true)}
        <div className="map-legend"><span><span className="map-you" /> You</span><span><span className="map-objective-dot" /> {objective.label}</span>{zone === 'dungeon' && <span>↓ Valley exit</span>}<span>North is up</span></div>
        <div className="map-objective"><Icon name={objective.kind === 'key' || objective.kind === 'gate' ? 'key' : objective.kind === 'boss' ? 'sword' : objective.kind === 'chest' ? 'flame' : 'compass'} size={22} /><div><strong>{objective.label}</strong><p>{objective.instruction}</p></div></div>
        <button className="primary-button map-return" onClick={onClose}>Back to adventure <Icon name="arrow" size={18} /></button>
      </section>
    </div>}
  </>;
}
