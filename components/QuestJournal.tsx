'use client';

import { useId, useState } from 'react';
import { useGameStore } from '@/game/store';
import { Icon } from './Icons';

export default function QuestJournal() {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const zone = useGameStore(s => s.zone);
  const foundShrine = useGameStore(s => s.zone === 'dungeon' || s.visited.includes('The Sunken Hall') || s.hasKey || s.gateOpen);
  const hasKey = useGameStore(s => s.hasKey);
  const gateOpen = useGameStore(s => s.gateOpen);
  const bossDefeated = useGameStore(s => s.bossDefeated);
  const chestOpen = useGameStore(s => s.chestOpen);
  const steps = [
    { label: 'Find the old shrine', done: foundShrine },
    { label: 'Claim the brass key', done: hasKey || gateOpen },
    { label: 'Defeat the Guardian', done: bossDefeated },
    { label: 'Retrieve the last ember', done: chestOpen },
  ];
  const completed = steps.filter(step => step.done).length;
  const objective = chestOpen ? 'The last ember is safe.'
    : zone === 'overworld' ? foundShrine ? 'Return to the shrine in the northeast.' : 'Cross the river. Find the shrine to the northeast.'
      : bossDefeated ? 'Open the ember chest in the northern chamber.'
        : gateOpen ? 'Defeat the Hollow Guardian.'
          : hasKey ? 'Carry the brass key to the northern gate.'
            : 'Find the brass key on the western pedestal.';

  return <aside className={`quest-card${expanded ? ' is-expanded' : ''}`} aria-label="Quest journal">
    <button className="quest-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined}>
      <span className="quest-emblem"><Icon name={bossDefeated ? 'flame' : hasKey ? 'key' : 'compass'} size={22} /></span>
      <span className="quest-copy">
        <span className="quest-label">MAIN QUEST <span>{completed} / 4</span></span>
        <span className="quest-title">The last little light</span>
        <span className="quest-objective">{objective}</span>
        <span className="quest-steps" role="img" aria-label={`${completed} of 4 quest steps complete`}>
          {steps.map((step, index) => <span key={step.label} className={`quest-step${step.done ? ' is-complete' : index === completed ? ' is-current' : ''}`} aria-hidden="true" />)}
        </span>
      </span>
      <span className="quest-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div id={detailsId} className="quest-details">
      <ol className="quest-checklist">
        {steps.map((step, index) => <li key={step.label} className={step.done ? 'is-complete' : index === completed ? 'is-current' : ''}>
          <span className="quest-check" aria-hidden="true">{step.done ? <Icon name="check" size={13} /> : index + 1}</span>
          <span>{step.label}{step.done && <span className="sr-only"> — complete</span>}</span>
        </li>)}
      </ol>
      <p className="quest-tip">{gateOpen && !bossDefeated ? 'Violet glow? Sidestep the wisp, or swing your sword to send it back.' : 'Follow the gold map marker. Cut grass and break pots to find hearts and rupees.'}</p>
    </div>}
  </aside>;
}
