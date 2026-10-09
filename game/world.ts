import type { Decoration, Obstacle, Point, WorldData, Zone } from './types';
import type { NavigationChunk, NavigationPortal } from './navigation-network';

export const SANCTUARY = { x: 8, z: 6, radius: 4.2 };
const obstacles: Obstacle[] = [];
const decorations: Decoration[] = [];
let serial = 0;
function obstacle(kind: Obstacle['kind'], x: number, z: number, w: number, d: number, scale = 1, rotation = 0) {
  obstacles.push({ id: `land-${serial++}`, kind, x, z, w, d, scale, rotation });
}
function tree(x: number, z: number, scale = 1) { obstacle('tree', x, z, 1.05 * scale, 1.05 * scale, scale, x * 1.71 + z); }
function rock(x: number, z: number, scale = 1) { obstacle('rock', x, z, 1.4 * scale, 1.15 * scale, scale, x * .8 + z * .3); }
function path(x: number, z: number, w: number, d: number) { decorations.push({ kind: 'path', x, z, w, d }); }

// The village is nestled in a pine border. The shallow river can only be crossed
// at the old wooden bridge; wide clearings on both banks make combat readable.
for (let x = 1; x <= 47; x += 2.05) { tree(x, .6, .85 + (x % 3) * .08); tree(x, 27.4, .95 + (x % 2) * .12); }
for (let z = 2.8; z < 27; z += 2.1) { tree(.6, z, 1.1); tree(47.4, z, .9); }
obstacles.push({ id: 'cabin', kind: 'wall', x: 5, z: 9, w: 5, d: 4 });
obstacle('water', 24.8, 6.1, 3, 10.6);
obstacle('water', 24.8, 21.05, 3, 12.3);
decorations.push({ kind: 'bridge', x: 24.8, z: 13.15, w: 4.5, d: 3.5 });
path(13.3, 6, 10.6, 1.8); path(17.9, 9.5, 1.8, 7); path(21.3, 13.15, 6.8, 1.8);
path(31, 13.15, 9.8, 1.8); path(35.1, 17.5, 1.8, 8.7); path(38.3, 21.5, 8.1, 1.8); path(42, 22.8, 1.8, 3.5);
path(10, 14.8, 2, 8.8); path(14, 18.5, 9, 1.8); path(18, 16, 1.8, 5);
// An orchard and a darker pine grove, with several deliberate gaps between them.
[[4,15],[6.3,16.1],[3.5,19],[7,21],[10,23.3],[13.1,22],[15.8,24.5],[18.5,22.5],[20.3,25.2],[20.8,19.7],
 [4,24.5],[14.1,11.8],[11.5,12.5],[21.6,4],[20.5,7.5],[29,4],[32,5.2],[36,3.5],[39,7],
 [42.5,5],[45,9],[39.2,12],[44,15],[30.4,19.5],[29.1,24.4],[33,25.1]].forEach(([x,z],i)=>tree(x,z,.82 + (i%4)*.12));
[[13,3.3],[18.5,3],[21.6,10],[14.5,15],[28.6,9.5],[31,16.5],[38.5,18.4],[44.9,20.5],
 [38,24.3],[39,26.4],[41,26.6],[43.6,26.4],[45.3,25],[45.3,22.8],[35.5,25.5]].forEach(([x,z],i)=>rock(x,z,.85+(i%4)*.19));
obstacle('hedge', 12.5, 9.1, 3.7, .75, .85);
obstacle('hedge', 32.4, 9.1, 5.8, .8, .85);
obstacle('hedge', 38.5, 4.1, .75, 4.1, .85);
// Details are deterministic, so loading a save never moves the landscape.
for (let i = 0; i < 160; i++) {
  const x = 2 + ((i * 127 + 71) % 439) / 10;
  const z = 2 + ((i * 73 + 19) % 237) / 10;
  if (obstacles.some(o => Math.abs(o.x-x)<o.w/2+.45 && Math.abs(o.z-z)<o.d/2+.45)) continue;
  if (decorations.some(o => o.kind==='path' && Math.abs(o.x-x)<(o.w??1)/2+.1 && Math.abs(o.z-z)<(o.d??1)/2+.1)) continue;
  decorations.push({ kind: i%5===0?'mushroom':i%3===0?'grass':'flower', x, z, variant: i%4, rotation: i*.91 });
}
decorations.push({kind:'stump',x:10.5,z:9.8},{kind:'banner',x:40.2,z:22.9},{kind:'banner',x:43.8,z:22.9});
for(let i=0;i<12;i++) decorations.push({kind:'lily',x:24.15+(i%3)*.6,z:2.1+i*2.1,variant:i%3});

const dungeonObstacles: Obstacle[] = [
  { id:'west-wall',kind:'wall',x:.5,z:14,w:1,d:28 },
  { id:'east-wall',kind:'wall',x:19.5,z:14,w:1,d:28 },
  { id:'north-wall',kind:'wall',x:10,z:27.5,w:20,d:1 },
  { id:'south-wall',kind:'wall',x:10,z:.5,w:20,d:1 },
  { id:'divider-west',kind:'wall',x:4.75,z:14,w:7.5,d:1 },
  { id:'divider-east',kind:'wall',x:15.25,z:14,w:7.5,d:1 },
  { id:'pillar-a',kind:'rock',x:4,z:4.7,w:1.2,d:1.2,scale:1.1 },
  { id:'pillar-b',kind:'rock',x:16,z:4.7,w:1.2,d:1.2,scale:1.1 },
  { id:'pillar-c',kind:'rock',x:4,z:20.5,w:1.3,d:1.3,scale:1.2 },
  { id:'pillar-d',kind:'rock',x:16,z:20.5,w:1.3,d:1.3,scale:1.2 },
];
const dungeonDecorations: Decoration[] = [];
for(const z of [4,10,17,24]) for(const x of [1.2,18.8]) dungeonDecorations.push({kind:'torch',x,z,rotation:x<10?Math.PI/2:-Math.PI/2});
dungeonDecorations.push({kind:'banner',x:7.9,z:14.8},{kind:'banner',x:12.1,z:14.8});

export const WORLDS: Record<Zone, WorldData> = {
  overworld: { width:48,height:28,obstacles,decorations,spawn:{x:8,z:6},entrance:{x:42,z:24},exit:{x:42,z:21.5},key:{x:-100,z:-100},gate:{x:-100,z:-100},chest:{x:-100,z:-100} },
  dungeon: { width:20,height:28,obstacles:dungeonObstacles,decorations:dungeonDecorations,spawn:{x:10,z:4.5},entrance:{x:10,z:2},exit:{x:10,z:2},key:{x:5,z:8},gate:{x:10,z:14},chest:{x:10,z:25} },
};

// Chunks describe placement, never collision boundaries. All six overworld
// chunks share the same world-coordinate grid, including cells on their seams.
export const NAVIGATION_CHUNKS: NavigationChunk[] = [
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `overworld-${index % 3}-${Math.floor(index / 3)}`,
    zone: 'overworld' as const,
    origin: { x: (index % 3) * 16, z: Math.floor(index / 3) * 14 },
    width: 16, height: 14,
  })),
  { id: 'dungeon', zone: 'dungeon', origin: { x: 0, z: 0 }, width: 20, height: 28 },
];

// Directed links; tile indices are local half-unit navigation cells. Return
// links are explicit so doors and warps can have different rules in each direction.
// Arrival tiles lie outside the opposite trigger, preventing automatic return trips.
export const NAVIGATION_PORTALS: NavigationPortal[] = [
  { id: 'shrine-enter', fromChunk: 'overworld-2-1', fromTile: { x: 20, z: 20 },
    toChunk: 'dungeon', toTile: { x: 20, z: 9 }, traversalCost: 1,
    traversableByAI: false, interactionRadius: 2 },
  { id: 'shrine-leave', fromChunk: 'dungeon', fromTile: { x: 20, z: 4 },
    toChunk: 'overworld-2-1', toTile: { x: 20, z: 15 }, traversalCost: 1,
    traversableByAI: false, interactionRadius: 1.7 },
];

export function areaName(zone: Zone, position: Point): string {
  if(zone==='dungeon') return position.z>14 ? 'The Ember Sanctum' : 'The Sunken Hall';
  if(position.x<16) return position.z<14 ? "Willow’s Rest" : 'Whispering Pines';
  if(position.x<32) return position.z<14 ? 'Clover Meadow' : 'Willow Crossing';
  return position.z<14 ? 'Honeydew Orchard' : 'The Elder Stones';
}
