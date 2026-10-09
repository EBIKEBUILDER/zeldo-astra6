'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/game/store';
import { WORLDS } from '@/game/world';
import type { GameData } from '@/game/types';
import TouchControls from './TouchControls';
import AdventureMap from './AdventureMap';
import QuestJournal from './QuestJournal';
import { useGameFullscreen } from './useGameFullscreen';
import GameCanvas, { type GameControls } from './GameCanvas';
import { Icon } from './Icons';

function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }

function Hearts() {
  const hp = useGameStore(s => s.player.hp);
  return <div className="hearts" aria-label={`${hp / 2} of 3 hearts`}>{[0, 1, 2].map(i => <span className="heart-slot" key={i}><Icon name="heart" size={24} /><span className="heart-fill" style={{ width: `${Math.max(0, Math.min(1, (hp - i * 2) / 2)) * 100}%` }}><Icon name="heart" size={24} /></span></span>)}</div>;
}

function interactionFor(s: GameData) {
  if (s.phase !== 'playing') return '';
  const w = WORLDS[s.zone];
  const near = (point: {x:number;z:number}, range:number) => Math.hypot(s.player.x-point.x,s.player.z-point.z) < range;
  if (s.zone === 'dungeon' && near(w.chest, 1.9)) return s.bossDefeated ? 'Open' : 'Inspect';
  if (s.zone === 'dungeon' && !s.gateOpen && near(w.gate, 2.1)) return 'Inspect';
  return '';
}

const interactionHints: Record<string,string> = {Open:'Open the ember chest',Inspect:'Inspect the old seal'};

function passageHintFor(s: GameData) {
  if (s.phase !== 'playing') return '';
  const target = s.zone === 'overworld' ? WORLDS.overworld.entrance : WORLDS.dungeon.exit;
  if (Math.hypot(s.player.x - target.x, s.player.z - target.z) >= 3.5) return '';
  return s.zone === 'overworld' ? 'Walk into the shrine to enter' : 'Walk down the steps to leave';
}

function BossHealth() {
  const hp = useGameStore(s => s.enemies.find(e => e.kind === 'boss')?.hp ?? 0);
  const active = useGameStore(s => s.zone === 'dungeon' && s.gateOpen && !s.bossDefeated && s.player.z > 14 && s.phase === 'playing');
  return active ? <div className="boss-health"><div><span>THE HOLLOW GUARDIAN</span><span>{hp} / 8</span></div><div className="boss-track"><div style={{ width: `${hp / 8 * 100}%` }} /></div></div> : null;
}

function DamageFlash() { const flash = useGameStore(s => s.damageFlash); return <div className="damage-vignette" style={{ opacity: Math.min(1, flash * 2) }} />; }

export default function Adventure() {
  const controls = useRef<GameControls | null>(null);
  const { shell, fullscreen, enter: enterFullscreen, exit: exitFullscreen } = useGameFullscreen();
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState<'help'|'map'|'inventory'|null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const resumeAfterModal = useRef(false);
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
  const chestOpen = useGameStore(s => s.chestOpen);
  const interaction = useGameStore(interactionFor);
  const passageHint = useGameStore(passageHintFor);
  const message = useGameStore(s => s.messageTime > 0 ? s.message : '');
  const isTitle = phase === 'title';
  const active = phase === 'playing' || phase === 'paused';
  const openModal = (next: 'help'|'map'|'inventory') => {
    if (!modal) resumeAfterModal.current = phase === 'playing';
    if (phase === 'playing') controls.current?.pause();
    setModal(next);
  };
  const closeModal = useCallback(() => {
    setModal(null);
    if (resumeAfterModal.current && useGameStore.getState().phase === 'paused') controls.current?.pause();
  }, []);
  useEffect(() => { controls.current?.setModalOpen(modal !== null); }, [modal, ready]);
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modal !== 'map') modalRef.current?.querySelector<HTMLElement>('button')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeModal(); }
      if (event.code === 'Tab' && modal !== 'map') {
        const items = [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); if (modal !== 'map') {
      const target = useGameStore.getState().phase === 'playing' ? document.querySelector<HTMLCanvasElement>('.world-canvas') : before;
      target?.focus({preventScroll:true});
    } };
  }, [modal, closeModal]);

  return <div ref={shell} className={`app-shell ${isTitle ? 'at-title' : 'in-adventure'} ${fullscreen ? 'is-fullscreen' : ''}`}>
    <header className="site-header">
      <a href="/" className="wordmark" aria-label="Zeldo home"><span className="brand-mark"><Icon name="flame" size={27} /></span><span>ZELDO<span className="brand-tagline">A LITTLE WORLD. A GRAND ADVENTURE.</span></span></a>
      <div className="header-right"><button className="text-button fullscreen-button" onClick={() => void enterFullscreen()} aria-label="Fullscreen game"><Icon name="expand" size={18}/><span>Fullscreen</span></button><span className="edition">AN ORIGINAL POCKET ADVENTURE <span>№ 001</span></span><button className="text-button help-button" onClick={() => openModal('help')} aria-label="How to play"><Icon name="book" size={17} /><span>How to play</span></button><span className="header-divider" /><button className="text-button sound-button" onClick={() => controls.current?.mute()} disabled={!ready} aria-label={muted ? 'Unmute sound' : 'Mute sound'}><Icon name={muted ? 'mute' : 'sound'} size={18} /><span>Sound {muted ? 'off' : 'on'}</span></button></div>
    </header>

    <main className={`game-stage ${isTitle ? 'is-title' : 'is-adventure'} ${zone === 'dungeon' && gateOpen && !bossDefeated ? 'in-boss-zone' : ''}`}>
      <GameCanvas onReady={onReady} />
      <div className="scene-grain" />
      {isTitle && <div className="title-wash" />}
      <div className="stage-topbar">
        <div className="vitals">
          {active && <div className="hero-portrait" aria-hidden="true"><Icon name="leaf" size={25}/></div>}
          <div className="vitals-content">{active && <div className="hero-name">Wayfarer <span>CHAPTER I</span></div>}<div className="vitals-row"><Hearts /><span className="vitals-divider" /><span className="rupees" aria-label={`${rupees} rupees`}><Icon name="gem" size={20} /><span>{String(rupees).padStart(3, '0')}</span></span>{hasKey && <span className="key-owned" aria-label="Brass key collected"><Icon name="key" size={17} /></span>}</div></div>
        </div>
        {isTitle && <div className="area-badge"><span className="live-dot" /><span>{area || 'Willow’s Rest'}</span><Icon name="sun" size={18} /></div>}
        {active && <button className="stage-pause" onClick={() => controls.current?.pause()} aria-label={phase === 'paused' ? 'Resume game' : 'Pause game'}><Icon name={phase === 'paused' ? 'arrow' : 'pause'} size={19} /></button>}

      </div>

      {isTitle && <section className="title-content">
        <div className="eyebrow"><span className="tiny-line" /> A POCKET-SIZED ADVENTURE</div>
        <h1>ZELDO</h1>
        <p className="title-story">Somewhere beyond the moss,<br />a little light is waiting.</p>
        <p className="title-description">A quiet valley. A forgotten shrine. One brave little soul.<br className="wide-break" /> Take your sword and see what lies beyond the trees.</p>
        <button className="primary-button begin-button" onClick={() => controls.current?.start()} disabled={!ready}><Icon name="sword" size={21} /><span>{ready ? 'Begin adventure' : 'Waking the valley…'}</span><Icon name="arrow" size={21} /></button>
        <div className="enter-hint desktop-copy">or press <kbd>Enter</kbd><span className="hint-rule" /> your story starts here</div>
        <div className="title-meta"><span><Icon name="clock" size={14} />5–10 minute adventure</span><span className="meta-dot">·</span><span>No downloads. Just wander.</span></div>
      </section>}

      {isTitle && <div className="scene-caption"><span className="caption-line" /><span><span className="caption-top">YOUR FIRST CHAPTER</span>Willow’s Rest</span><Icon name="leaf" size={26} /></div>}
      {isTitle && <div className="compass-rose"><span>N</span><Icon name="compass" size={34} /></div>}

      {active && <>
        <BossHealth />
        <QuestJournal />
        <AdventureMap expanded={modal === 'map'} onExpand={() => openModal('map')} onClose={closeModal} />
        {(interaction || passageHint) && <div className="context-hint">{interaction && <kbd className="desktop-copy">E</kbd>}<Icon name={interaction === 'Open' ? 'key' : 'arrow'} size={16}/>{interaction ? interactionHints[interaction] : passageHint}</div>}
        <div className="adventure-toolbar">
          <span className="equipped-sword"><Icon name="sword" size={24}/><span><small>EQUIPPED</small>Worn sword</span><kbd>Space</kbd></span>
          <button className="gear-toggle" onClick={() => openModal('inventory')} aria-label="Open satchel"><Icon name="satchel" size={23}/><span>Satchel</span>{hasKey && <span className="item-notice"/>}</button>
        </div>
        <div className="field-controls"><span><kbd>W A S D</kbd> move</span><span><kbd>Space</kbd> swing</span><span><kbd>E</kbd> interact</span></div>
        <TouchControls controls={controls} enabled={phase === 'playing' && !modal} interactLabel={interaction || 'Interact'} interactAvailable={!!interaction}/>
      </>}

      {message && active && <div className="game-toast" key={message}><Icon name={message.toLowerCase().includes('key') ? 'key' : 'flame'} size={20} /><span>{message}</span></div>}
      <DamageFlash />
      {fullscreen && <button className="fullscreen-exit" onClick={() => void exitFullscreen()} aria-label="Exit fullscreen"><Icon name="contract" size={19}/></button>}

      {phase === 'paused' && !modal && <div className="modal-shade"><section className="story-modal pause-modal"><span className="modal-illustration"><Icon name="leaf" size={35} /></span><span className="eyebrow">A MOMENT IN THE MOSS</span><h2>Take a little breath.</h2><p>The valley will be right here.</p><button className="primary-button" onClick={() => controls.current?.pause()}>Continue adventure <Icon name="arrow" /></button><button className="subtle-button" onClick={() => openModal('help')}>A little help?</button><span className="modal-keyhint desktop-copy"><kbd>Esc</kbd> to return</span></section></div>}
      {(phase === 'gameover' || phase === 'victory') && <div className="modal-shade ending-shade"><section className={`story-modal ending-modal ${phase === 'victory' ? 'victory-modal' : ''}`}><span className="modal-illustration"><Icon name={phase === 'victory' ? 'flame' : 'heart'} size={44} /></span><span className="eyebrow">{phase === 'victory' ? 'EVERY LITTLE LIGHT MATTERS' : 'THIS ISN’T THE END'}</span><h2>{phase === 'victory' ? <>A little ember.<br /><em>A grand adventure.</em></> : <>Even brave souls<br />need another try.</>}</h2><p>{phase === 'victory' ? 'You found the last ember and brought a little warmth back to the valley. The moss will remember you.' : 'The path is still there. Pick up your sword, catch your breath, and make this story yours.'}</p><div className="ending-stats"><div><Icon name="clock" size={18} /><strong>{formatTime(time)}</strong><span>TIME WANDERED</span></div><div><Icon name="gem" size={18} /><strong>{rupees}</strong><span>RUPEES GATHERED</span></div></div><button className="primary-button" onClick={() => { setModal(null); resumeAfterModal.current = false; controls.current?.restart(); }}><Icon name={phase === 'victory' ? 'reset' : 'sword'} size={20} />{phase === 'victory' ? 'Wander once more' : 'Try again'}<Icon name="arrow" size={20} /></button><span className="modal-keyhint desktop-copy">or press <kbd>Enter</kbd></span></section></div>}

      {modal === 'help' && <div className="modal-shade" onClick={closeModal}><section ref={modalRef} className="story-modal help-modal" role="dialog" aria-modal="true" aria-label="How to play" onClick={e => e.stopPropagation()}><button className="close-button" onClick={closeModal} aria-label="Close instructions"><Icon name="close" /></button><span className="eyebrow">A SMALL FIELD GUIDE</span><h2>A little courage.<br /><em>A few simple moves.</em></h2><div className="help-controls"><div><span><strong className="mobile-copy">Drag joystick</strong><span className="desktop-copy"><kbd>W A S D</kbd><small>or arrow keys</small></span></span><p>Find your own way<span>Move freely; a light joystick tilt lets you walk slowly.</span></p></div><div><span><strong className="mobile-copy">Hold attack</strong><span className="desktop-copy"><kbd>Space</kbd><small>or click the world</small></span></span><p>Make a little room<span>Swing toward the way you’re facing.</span></p></div><div><span><strong className="mobile-copy">Tap interact</strong><kbd className="desktop-copy">E</kbd></span><p>See what’s inside<span>Walk through doorways automatically. Use the action to inspect or open treasure.</span></p></div><div><span><strong className="mobile-copy">Map & pause</strong><span className="desktop-copy"><kbd>Esc</kbd> <kbd>M</kbd></span></span><p>Take it easy<span>Opening the map or satchel pauses your adventure.</span></p></div></div><div className="help-tip"><Icon name="leaf" size={20} /><p>Follow the pale path northeast, across the river, to the old shrine. Cut grass and break pots for hearts and rupees. Your home clearing is always safe. Follow the gold marker on your map. Dodge the Guardian’s amber lunge lane and violet landing circles. Low wisps can be returned with your sword.</p></div><button className="primary-button" onClick={closeModal}>I’m ready <Icon name="arrow" size={19} /></button></section></div>}
      {modal === 'inventory' && <div className="modal-shade" onClick={closeModal}><section ref={modalRef} className="story-modal inventory-modal" role="dialog" aria-modal="true" aria-label="Traveler’s satchel" onClick={e => e.stopPropagation()}>
        <button className="close-button" aria-label="Close satchel" onClick={closeModal}><Icon name="close"/></button>
        <span className="eyebrow">YOUR ADVENTURE · CHAPTER I</span><h2>Traveler’s satchel</h2><p>A small collection. A long way to go.</p>
        <div className="inventory-items">
          <div className="inventory-item"><span className="item-art"><Icon name="sword" size={29}/></span><div><h3>Worn sword</h3><p>A trusty blade. Swings toward your facing.</p><span className="item-tag">EQUIPPED</span></div></div>
          <div className={`inventory-item ${hasKey ? '' : 'not-found'}`}><span className="item-art"><Icon name="key" size={29}/></span><div><h3>Old brass key</h3><p>{hasKey ? 'The key to the Guardian’s gate.' : 'Waiting somewhere in the Lantern Vault.'}</p><span className="item-tag">{hasKey ? 'COLLECTED' : 'UNDISCOVERED'}</span></div></div>
          <div className={`inventory-item ${chestOpen ? '' : 'not-found'}`}><span className="item-art"><Icon name="flame" size={29}/></span><div><h3>The last ember</h3><p>{chestOpen ? 'A little warmth for the valley.' : 'The reason for your journey.'}</p><span className="item-tag">{chestOpen ? 'RECOVERED' : 'QUEST ITEM'}</span></div></div>
        </div><div className="satchel-summary"><span><Icon name="gem" size={17}/>{rupees} rupees</span><span><Icon name="clock" size={17}/>{formatTime(time)} wandered</span></div>
        <button className="primary-button" onClick={closeModal}>Back to adventure <Icon name="arrow" size={18}/></button>
      </section></div>}

    </main>

    <footer className="site-footer"><span><span className="footer-dot" /> MADE FOR THE JOY OF GETTING A LITTLE LOST</span><div>{active ? <><Icon name="clock" size={13} /><span>{formatTime(time)}</span><span className="footer-separator">/</span><button onClick={() => { setModal(null); resumeAfterModal.current = false; controls.current?.restart(); }}><Icon name="reset" size={13} />Start over</button></> : <><span>EXPLORE.</span><span>BE BRAVE.</span><span>BRING THE LIGHT HOME.</span><Icon name="flame" size={15} /></>}</div></footer>
  </div>;
}
