# ZELDO

An original, low-poly pocket adventure built with Next.js App Router, React, TypeScript, Tailwind CSS, Babylon.js, Zustand, and the Web Audio API. Explore a mossy valley, cross the old bridge, and recover the last ember from a forgotten shrine.

All models, decorations, effects, icons, and sounds are generated in code. There are no downloaded art or audio assets, external services, API keys, or accounts.

## Run locally

Use a current Node.js LTS release and npm.

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). The game needs a browser with WebGL enabled; sound starts after a user gesture.

```sh
npm run build   # Production build
npm start       # Serve the production build
npm run check   # TypeScript validation
npm test        # Deterministic simulation tests
```

## Controls

| Action | Input |
| --- | --- |
| Start / retry | Enter or the on-screen button |
| Move | WASD or arrow keys |
| Swing sword | Space or hold the pointer on the world |
| Enter / leave shrine, open chest | E |
| Pause / resume | Escape or the pause button |
| Mute / unmute | M or the sound button |

On phones and tablets, drag the left joystick to move; a small tilt walks slowly. Hold the large **Sword** button with your other thumb to attack while moving. The nearby action button becomes **Enter**, **Leave**, **Inspect**, or **Open** when something is in reach. Sword swings follow your facing direction. Releasing a control, rotating the device, opening a menu, or switching apps safely clears held input.

Use **Fullscreen** in the header to give the game the whole screen. The exit button stays beside Pause. On browsers without native fullscreen support, this still hides the site header and footer.

The field HUD shows your hearts, rupees, current quest, and a live minimap with facing and objective markers. Tap the minimap to open a larger field map; tap **Satchel** to inspect your sword and quest items. Both menus pause the game and return you to the same adventure. Tap the quest card to see its milestones. Portrait and landscape layouts keep thumb controls clear of the central playfield.

## The adventure

1. Leave the safe home clearing and follow the pale path east, then north toward the wooden bridge.
2. Cross the river and follow the path northeast to the stone shrine. Press **E** near the entrance.
3. Find the brass key on the western pedestal in the first room. Walk into it to collect it and recover a heart.
4. Approach the northern gate with the key to break its seal.
5. Defeat the Hollow Guardian. Watch its windup, step away from its charge, then move in and swing. If its approach is blocked, a violet warning marks a locked shot: sidestep the line, or swing into the incoming wisp to send it back. Returned wisps hurt the Guardian; stone blocks them in either direction.
6. Press **E** beside the unlocked northern chest to recover the ember and finish. Your time and rupee total appear on the victory screen.

Monsters use obstacle-aware routes and keep chasing once alerted, even through long detours. Only twenty seconds without movement ends a stalled chase; they then turn and walk home. The home clearing remains safe, and staying there for eighteen seconds lets pursuers lose interest.

Cut grass and break pots for rupees and healing hearts. Ordinary monsters return after roughly 20 seconds; the guardian stays defeated. Losing all three hearts opens the retry screen. Leaving the browser tab automatically pauses the game.

## Architecture

- `game/types.ts` defines serializable world and game data.
- `game/world.ts` lays out the overworld, dungeon, obstacles, and decorative details.
- `game/simulation.ts` owns movement, collision and separation, combat, enemies, pickups, particles, quest progression, and seeded randomness.
- `game/pathfinding.ts` finds routes with eight-way A* and a corner-based fallback for narrow gaps.
- `game/pursuit-memory.ts` retains aggression while monsters navigate and handles stalled pursuit recovery.
- `game/store.ts` exposes that data and game actions through Zustand.
- `game/renderer.ts` builds the Babylon scene and reads game data to update its meshes, camera, lighting, and effects. It does not advance gameplay.
- `game/input.ts` combines keyboard, mouse, and analog touch input with a radial deadzone and normalized diagonals; short action taps survive between simulation ticks.
- `game/camera.ts` keeps the hero in view on narrow screens and frames short landscape playfields.
- `components/TouchControls.tsx` owns separate movement/attack pointers for two-thumb play.
- `components/AdventureMap.tsx` and `components/QuestJournal.tsx` show the live map, objective markers, and quest milestones.
- `game/audio.ts` synthesizes every sound with oscillators, noise, filters, and envelopes. Audio nodes are cleaned up after use.
- `components/GameCanvas.tsx` runs the simulation at a fixed 60 Hz and renders independently with `requestAnimationFrame`.
- `components/Adventure.tsx` contains the React HUD, map, quest hints, help, title, pause, and ending screens.
- `game/simulation.test.ts` checks core game rules and the quest route without a renderer.

World coordinates use **+x for right** and **+z for north**. Collision is calculated in the horizontal world plane, independently of the angled camera. A seeded simulation keeps drops and enemy behavior reproducible for the same input sequence. Progress lives in memory for the current session; refreshing starts a new adventure.
