'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/game/store';
import { WORLDS } from '@/game/world';
import GameCanvas, { type GameControls } from './GameCanvas';
import { Icon } from './Icons';

function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }

function Hearts() {
  const hp = useGameStore(s => s.player.hp);
  return <div className="hearts" aria-label={`${hp / 2} of 3 hearts`}>{[0, 1, 2].map(i => <span className="heart-slot" key={i}><Icon name="heart" size={24} /><span className="heart-fill" style={{ width: `${Math.max(0, Math.min(1, (hp - i * 2) / 2)) * 100}%` }}><Icon name="heart" size={24} /></span></span>)}</div>;
}

function Minimap() {
  const zone = useGameStore(s => s.zone);
  const x = useGameStore(s => Math.round(s.player.x * 2) / 2);
  const z = useGameStore(s => Math.round(s.player.z * 2) / 2);
  const bossDefeated = useGameStore(s => s.bossDefeated);
  const world = WORLDS[zone];
  return <div className="minimap" aria-label="Map showing your position"><div className="map-header"><span>{zone === 'overworld' ? 'THE MOSSWOOD VALLEY' : 'THE LANTERN VAULT'}</span><span>N ↑</span></div><svg viewBox={`0 0 ${world.width} ${world.height}`} role="img" aria-label="Current area map"><rect width={world.width} height={world.height} fill={zone === 'overworld' ? '#a5b78b' : '#7b8171'} rx="1" />{world.decorations.filter(d => d.kind === 'path' || d.kind === 'bridge').map((d, i) => <rect key={`p${i}`} x={d.x - (d.w || 1) / 2} y={world.height - d.z - (d.d || 1) / 2} width={d.w || 1} height={d.d || 1} fill="#d3c193" />)}{world.obstacles.map((o, i) => <rect key={i} x={o.x - o.w / 2} y={world.height - o.z - o.d / 2} width={o.w} height={o.d} rx={o.kind === 'tree' ? '.7' : '.1'} fill={o.kind === 'water' ? '#74a7a3' : o.kind === 'tree' || o.kind === 'hedge' ? '#648065' : '#8a8b7b'} />)}<path d={`M${world.entrance.x - 1},${world.height - world.entrance.z + .8} l1,-2 l1,2Z`} fill="#f6ebc8"/><circle cx={x} cy={world.height - z} r="1.25" fill="#f9f4d9" stroke="#d16c3c" strokeWidth=".6" />{bossDefeated && zone === 'dungeon' && <circle cx={world.chest.x} cy={world.height - world.chest.z} r="1" fill="#f6cc75" />}</svg><div className="map-caption"><span className="map-you" /> You are here <span className="map-shrine">△</span> The old shrine</div></div>;
}

function ContextHint() {
  const hint = useGameStore(s => {
    if (s.phase !== 'playing') return '';
    const w = WORLDS[s.zone];
    const near = (p: { x: number; z: number }, r = 2.7) => Math.hypot(s.player.x - p.x, s.player.z - p.z) < r;
    if (s.zone === 'overworld' && near(w.entrance)) return 'Enter the Lantern Vault';
    if (s.zone === 'dungeon' && near(w.exit)) return 'Return to the valley';
    if (s.zone === 'dungeon' && !s.gateOpen && near(w.gate, 3.5)) return s.hasKey ? 'Unlock the old gate' : 'A key is needed';
    if (s.zone === 'dungeon' && near(w.chest)) return s.bossDefeated ? 'Open the ember chest' : 'Defeat the guardian first';
    return '';
  });
  return hint ? <div className="context-hint"><kbd>E</kbd>{hint}</div> : null;
}

function BossHealth() {
  const hp = useGameStore(s => s.enemies.find(e => e.kind === 'boss')?.hp ?? 0);
  const active = useGameStore(s => s.zone === 'dungeon' && s.gateOpen && !s.bossDefeated && s.player.z > 14 && s.phase === 'playing');
  return active ? <div className="boss-health"><div><span>THE HOLLOW GUARDIAN</span><span>{hp} / 8</span></div><div className="boss-track"><div style={{ width: `${hp / 8 * 100}%` }} /></div></div> : null;
}

function DamageFlash() { const flash = useGameStore(s => s.damageFlash); return <div className="damage-vignette" style={{ opacity: Math.min(1, flash * 2) }} />; }

export default function Adventure() {
  const controls = useRef<GameControls | null>(null);
  const [ready, setReady] = useState(false);
  const [help, setHelp] = useState(false);
  const [mapOpen, setMapOpen] = useState(true);
  const resumeAfterHelp = useRef(false);
  const onReady = useCallback((c: GameControls) => { controls.current = c; setReady(true); }, []);
  const phase = useGameStore(s => s.phase);
  const muted = useGameStore(s => s.muted);
  const rupees = useGameStore(s => s.rupees);
  const area = useGameStore(s => s.area);
  const time = useGameStore(s => Math.floor(s.elapsed));
  const hasKey = useGameStore(s => s.hasKey);
  const gateOpen = useGameStore(s => s.gateOpen);
  const bossDefeated = useGameStore(s => s.bossDefeated);
  const zone = useGameStore(s => s.zone);
  const message = useGameStore(s => s.messageTime > 0 ? s.message : '');
  const isTitle = phase === 'title';
  const active = phase === 'playing' || phase === 'paused';
  const openHelp = () => { resumeAfterHelp.current = phase === 'playing'; if (phase === 'playing') controls.current?.pause(); setHelp(true); };
  const closeHelp = () => { setHelp(false); if (resumeAfterHelp.current && useGameStore.getState().phase === 'paused') controls.current?.pause(); };
  useEffect(() => { controls.current?.setModalOpen(help); }, [help, ready]);
  useEffect(() => {
    if (!help) return;
    const handler = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.stopImmediatePropagation(); setHelp(false); if (resumeAfterHelp.current && useGameStore.getState().phase === 'paused') controls.current?.pause(); } };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [help]);
  const quest = bossDefeated ? ['The last little light', 'The guardian rests. Open the ember chest.'] : gateOpen ? ['A keeper in the dark', 'Dodge its charge. Sidestep violet wisps—or swing to return them.'] : hasKey ? ['A door worth opening', 'Use the old key at the northern gate.'] : zone === 'dungeon' ? ['Something left behind', 'Find the old key on the western pedestal.'] : ['Follow the forgotten path', 'Cross the river. Find the shrine to the northeast.'];
  const touchButton = (action: Parameters<GameControls['virtual']>[0], label: string, content: React.ReactNode, extra = '') => <button aria-label={label} className={extra} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls.current?.virtual(action, true); }} onPointerUp={() => controls.current?.virtual(action, false)} onPointerCancel={() => controls.current?.virtual(action, false)} onLostPointerCapture={() => controls.current?.virtual(action, false)}>{content}</button>;

  return <div className="app-shell">
    <header className="site-header">
      <a href="/" className="wordmark" aria-label="Zeldo home"><span className="brand-mark"><Icon name="flame" size={27} /></span><span>ZELDO<span className="brand-tagline">A LITTLE WORLD. A GRAND ADVENTURE.</span></span></a>
      <div className="header-right"><span className="edition">AN ORIGINAL POCKET ADVENTURE <span>№ 001</span></span><button className="text-button help-button" onClick={openHelp} aria-label="How to play"><Icon name="book" size={17} /><span>How to play</span></button><span className="header-divider" /><button className="text-button sound-button" onClick={() => controls.current?.mute()} disabled={!ready} aria-label={muted ? 'Unmute sound' : 'Mute sound'}><Icon name={muted ? 'mute' : 'sound'} size={18} /><span>Sound {muted ? 'off' : 'on'}</span></button></div>
    </header>

    <main className={`game-stage ${isTitle ? 'is-title' : ''}`}>
      <GameCanvas onReady={onReady} />
      <div className="scene-grain" />
      {isTitle && <div className="title-wash" />}
      <div className="stage-topbar">
        <div className="vitals"><Hearts /><span className="vitals-divider" /><span className="rupees"><Icon name="gem" size={22} /><span>{String(rupees).padStart(3, '0')}</span></span>{hasKey && <span className="key-owned" title="The old key"><Icon name="key" size={19} /></span>}</div>
        <div className="area-badge"><span className="live-dot" /><span>{area || 'Willow’s Rest'}</span><span className="area-divider" /><Icon name={zone === 'dungeon' ? 'flame' : 'sun'} size={18} /></div>
        {active && <button className="stage-pause" onClick={() => controls.current?.pause()} aria-label={phase === 'paused' ? 'Resume game' : 'Pause game'}><Icon name="pause" size={18} /></button>}
      </div>

      {isTitle && <section className="title-content">
        <div className="eyebrow"><span className="tiny-line" /> A POCKET-SIZED ADVENTURE</div>
        <h1>ZELDO</h1>
        <p className="title-story">Somewhere beyond the moss,<br />a little light is waiting.</p>
        <p className="title-description">A quiet valley. A forgotten shrine. One brave little soul.<br className="wide-break" /> Take your sword and see what lies beyond the trees.</p>
        <button className="primary-button begin-button" onClick={() => controls.current?.start()} disabled={!ready}><Icon name="sword" size={21} /><span>{ready ? 'Begin adventure' : 'Waking the valley…'}</span><Icon name="arrow" size={21} /></button>
        <div className="enter-hint">or press <kbd>Enter</kbd><span className="hint-rule" /> your story starts here</div>
        <div className="title-meta"><span><Icon name="clock" size={14} />5–10 minute adventure</span><span className="meta-dot">·</span><span>No downloads. Just wander.</span></div>
      </section>}

      {isTitle && <div className="scene-caption"><span className="caption-line" /><span><span className="caption-top">YOUR FIRST CHAPTER</span>Willow’s Rest</span><Icon name="leaf" size={26} /></div>}
      {isTitle && <div className="compass-rose"><span>N</span><Icon name="compass" size={34} /></div>}

      {active && <><BossHealth /><div className="quest-card"><div className="quest-emblem"><Icon name={bossDefeated ? 'flame' : hasKey ? 'key' : 'compass'} size={23} /></div><div><span className="quest-label">{bossDefeated ? 'ONE LAST THING' : 'YOUR ADVENTURE'}</span><h2>{quest[0]}</h2><p>{quest[1]}</p></div></div><div className="map-container"><button className="map-toggle" onClick={() => setMapOpen(!mapOpen)} aria-expanded={mapOpen}><Icon name="compass" size={15} />{mapOpen ? 'Hide map' : 'Show map'}</button>{mapOpen && <Minimap />}</div><ContextHint /><div className="field-controls"><span><kbd>W A S D</kbd> move</span><span><kbd>Space</kbd> swing</span><span><kbd>E</kbd> interact</span></div><div className="touch-controls"><div className="touch-dpad">{touchButton('up', 'Move north', '↑', 'touch-up')}{touchButton('left', 'Move left', '←', 'touch-left')}{touchButton('down', 'Move south', '↓', 'touch-down')}{touchButton('right', 'Move right', '→', 'touch-right')}</div><div className="touch-actions">{touchButton('interact', 'Interact', 'E')}{touchButton('attack', 'Swing sword', <Icon name="sword" size={26} />, 'touch-sword')}</div></div></>}
      {message && active && <div className="game-toast" key={message}><Icon name={message.toLowerCase().includes('key') ? 'key' : 'flame'} size={20} /><span>{message}</span></div>}
      <DamageFlash />

      {phase === 'paused' && !help && <div className="modal-shade"><section className="story-modal pause-modal"><span className="modal-illustration"><Icon name="leaf" size={35} /></span><span className="eyebrow">A MOMENT IN THE MOSS</span><h2>Take a little breath.</h2><p>The valley will be right here.</p><button className="primary-button" onClick={() => controls.current?.pause()}>Continue adventure <Icon name="arrow" /></button><button className="subtle-button" onClick={openHelp}>A little help?</button><span className="modal-keyhint"><kbd>Esc</kbd> to return</span></section></div>}
      {(phase === 'gameover' || phase === 'victory') && <div className="modal-shade ending-shade"><section className={`story-modal ending-modal ${phase === 'victory' ? 'victory-modal' : ''}`}><span className="modal-illustration"><Icon name={phase === 'victory' ? 'flame' : 'heart'} size={44} /></span><span className="eyebrow">{phase === 'victory' ? 'EVERY LITTLE LIGHT MATTERS' : 'THIS ISN’T THE END'}</span><h2>{phase === 'victory' ? <>A little ember.<br /><em>A grand adventure.</em></> : <>Even brave souls<br />need another try.</>}</h2><p>{phase === 'victory' ? 'You found the last ember and brought a little warmth back to the valley. The moss will remember you.' : 'The path is still there. Pick up your sword, catch your breath, and make this story yours.'}</p><div className="ending-stats"><div><Icon name="clock" size={18} /><strong>{formatTime(time)}</strong><span>TIME WANDERED</span></div><div><Icon name="gem" size={18} /><strong>{rupees}</strong><span>RUPEES GATHERED</span></div></div><button className="primary-button" onClick={() => controls.current?.restart()}><Icon name={phase === 'victory' ? 'reset' : 'sword'} size={20} />{phase === 'victory' ? 'Wander once more' : 'Try again'}<Icon name="arrow" size={20} /></button><span className="modal-keyhint">or press <kbd>Enter</kbd></span></section></div>}

      {help && <div className="modal-shade" onClick={closeHelp}><section className="story-modal help-modal" role="dialog" aria-modal="true" aria-label="How to play" onClick={e => e.stopPropagation()}><button className="close-button" onClick={closeHelp} aria-label="Close instructions"><Icon name="close" /></button><span className="eyebrow">A SMALL FIELD GUIDE</span><h2>A little courage.<br /><em>A few simple moves.</em></h2><div className="help-controls"><div><span><kbd>W A S D</kbd><small>or arrow keys</small></span><p>Find your own way<span>Move through the valley.</span></p></div><div><span><kbd>Space</kbd><small>or click the world</small></span><p>Make a little room<span>Swing toward the way you’re facing.</span></p></div><div><span><kbd>E</kbd></span><p>See what’s inside<span>Enter the shrine, unlock gates, open treasure.</span></p></div><div><span><kbd>Esc</kbd><kbd>M</kbd></span><p>Take it easy<span>Pause your adventure or toggle sound.</span></p></div></div><div className="help-tip"><Icon name="leaf" size={20} /><p>Follow the pale path northeast, across the river, to the old shrine. Cut grass and break pots for hearts and rupees. Your little home clearing is always safe.</p></div><button className="primary-button" onClick={closeHelp}>I’m ready <Icon name="arrow" size={19} /></button></section></div>}
    </main>

    <footer className="site-footer"><span><span className="footer-dot" /> MADE FOR THE JOY OF GETTING A LITTLE LOST</span><div>{active ? <><Icon name="clock" size={13} /><span>{formatTime(time)}</span><span className="footer-separator">/</span><button onClick={() => controls.current?.restart()}><Icon name="reset" size={13} />Start over</button></> : <><span>EXPLORE.</span><span>BE BRAVE.</span><span>BRING THE LIGHT HOME.</span><Icon name="flame" size={15} /></>}</div></footer>
  </div>;
}
