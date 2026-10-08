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

The field HUD shows your hearts, rupees, current quest, a live minimap with facing and objective markers, and an FPS counter beneath Pause. FPS measures rendered frames over a half-second window, including slow frames; the counter updates twice per second. Tap the minimap to open a larger field map; tap **Satchel** to inspect your sword and quest items. Both menus pause the game and return you to the same adventure. Tap the quest card to see its milestones. Portrait and landscape layouts keep thumb controls clear of the central playfield.

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
- `game/renderer.ts` builds the Babylon scene and reads game data to update its meshes, camera, lighting, and effects. It does not advance gameplay. Static geometry and rigid props are batched, river shimmer uses one vertex-alpha mesh, and combat particles reuse a bounded mesh pool.
- `game/render-batching.ts` combines opaque palette geometry while preserving lighting, normals, and shadow eligibility. Transparent hero pieces and animated joints remain separate.
- `game/frame-stats.ts` samples actual frame cadence and draw-call counts without rerendering the React HUD every frame.
- `game/input.ts` combines keyboard, mouse, and analog touch input with a radial deadzone and normalized diagonals; short action taps survive between simulation ticks.
- `game/camera.ts` keeps the hero in view on narrow screens and frames short landscape playfields.
- `components/TouchControls.tsx` owns separate movement/attack pointers for two-thumb play.
- `components/AdventureMap.tsx` and `components/QuestJournal.tsx` show the live map, objective markers, and quest milestones.
- `game/audio.ts` synthesizes every sound with oscillators, noise, filters, and envelopes. Audio nodes are cleaned up after use.
- `components/GameCanvas.tsx` runs the simulation at a fixed 60 Hz and renders independently with `requestAnimationFrame`.
- `components/Adventure.tsx` contains the React HUD, map, quest hints, help, title, pause, and ending screens.
- `game/simulation.test.ts` checks core game rules and the quest route without a renderer.

World coordinates use **+x for right** and **+z for north**. Collision is calculated in the horizontal world plane, independently of the angled camera. A seeded simulation keeps drops and enemy behavior reproducible for the same input sequence. Progress lives in memory for the current session; refreshing starts a new adventure.

## Performance verification

The original resolution, antialiasing, 2048px blurred shadow map, lighting, geometry, and effects are retained. The renderer freezes only static transforms, updates breakable visibility only when its data or zone changes, and skips rendering in hidden tabs. Simulation collections use copy-on-write so unchanged scenery and routes do not allocate on every tick.

`scripts/render-benchmark.cjs` renders deterministic village, river, dungeon, and particle-heavy combat scenes. It counts actual WebGL draws (including shadow and postprocessing passes), measures CPU submission time, tracks buffer allocation, and saves matching screenshots. Headless SwiftShader timings are comparative measurements, not hardware FPS predictions. The optional browser scripts require Playwright and pngjs in addition to the project's esbuild; set `BENCHMARK_NODE_MODULES` if those are installed outside this project's dependencies, and `CHROME_BIN` to select Chromium.

```sh
node scripts/render-benchmark.cjs --source /path/to/baseline/game --output test-artifacts/render-baseline
node scripts/render-benchmark.cjs --compare test-artifacts/render-baseline --output test-artifacts/render-current
# With the game running locally, check FPS, pause/resume and six responsive layouts:
node scripts/fps-ui-smoke.cjs http://127.0.0.1:3000
```

At 1280×720, the deterministic comparison measured these draw calls per frame, including shadows:

| Scene | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Village | 378 | 113 | 70% |
| River | 567 | 146 | 74% |
| Dungeon | 287 | 128 | 55% |
| Combat with 96 particles | 392 | 248 | 37% |

After warmup, replacing all 96 combat particles creates no additional geometry buffers. Matching screenshots retain the scene palette and detail; mean absolute pixel-channel differences were below 0.1 on the 0–255 scale in these four views. Exact FPS depends on the device, viewport, browser, and current gameplay.
