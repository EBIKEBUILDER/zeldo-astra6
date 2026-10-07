import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameData, InputState, Obstacle, Point } from './types';
import { createInitialData, FIXED_DT, overlapsSolid, PLAYER_RADIUS, stepGame } from './simulation';
import { SANCTUARY, WORLDS } from './world';

const idle: InputState = { x:0,z:0,attack:false,interact:false };
function playing(): GameData {return {...createInitialData(),phase:'playing'};}
function frames(s:GameData,count:number,input:InputState=idle){for(let i=0;i<count;i++)s=stepGame(s,FIXED_DT,input);return s;}
function dungeon(s:GameData):GameData {s.zone='dungeon';s.player.x=10;s.player.z=8;s.player.invulnerable=100;return s;}

test('the fixed-step simulation is reproducible and keeps serializable state',()=>{
  const input={...idle,x:1,z:.5,attack:true};
  const a=frames(playing(),240,input),b=frames(playing(),240,input);
  assert.deepEqual(a,b);assert.deepEqual(JSON.parse(JSON.stringify(a)),a);
});
test('standing at home stays safe through enemy wander and respawn cycles',()=>{
  const s=frames(playing(),60*90);
  assert.equal(s.player.hp,6);assert.equal(s.phase,'playing');
  for(const e of s.enemies.filter(e=>e.zone==='overworld'))assert.ok(Math.hypot(e.x-SANCTUARY.x,e.z-SANCTUARY.z)>=SANCTUARY.radius+e.radius-.001);
});
test('rightward movement increases x and a water bank allows wall sliding',()=>{
  let s=playing();s.enemies=[];s=frames(s,60,{...idle,x:1});assert.ok(s.player.x>11);
  s.player.x=22.8;s.player.z=6;s.player.vx=0;s.player.vz=0;
  s=frames(s,60,{...idle,x:1,z:1});assert.ok(s.player.x<=23.3-PLAYER_RADIUS+.001);assert.ok(s.player.z>8);
});
test('the sword sweeps in front and cannot strike the enemy behind',()=>{
  let s=dungeon(playing());s.player.facingX=1;s.player.facingZ=0;
  const source=s.enemies.find(e=>e.id==='hall-1')!;
  s.enemies=[{...source,id:'front',x:11.2,z:8,spawnX:11.2,spawnZ:8},{...source,id:'behind',x:8.8,z:8,spawnX:8.8,spawnZ:8}];
  s=frames(s,18,{...idle,attack:true});
  assert.equal(s.enemies[0].hp,1);assert.equal(s.enemies[1].hp,2);assert.ok(s.enemies[0].x>11.2);
});
test('enemy bodies separate from each other and from the hero',()=>{
  let s=dungeon(playing());const source=s.enemies.find(e=>e.id==='hall-1')!;
  s.enemies=[{...source,id:'a',x:9.9,z:8},{...source,id:'b',x:10.1,z:8}];s=frames(s,120);
  for(const e of s.enemies)assert.ok(Math.hypot(e.x-s.player.x,e.z-s.player.z)>=e.radius+PLAYER_RADIUS-.015);
  assert.ok(Math.hypot(s.enemies[0].x-s.enemies[1].x,s.enemies[0].z-s.enemies[1].z)>=s.enemies[0].radius+s.enemies[1].radius-.015);
});
test('damage grants invulnerability, and an ordinary enemy returns after twenty seconds',()=>{
  let s=dungeon(playing());s.player.invulnerable=0;const e=s.enemies.find(e=>e.id==='hall-1')!;s.enemies=[{...e,x:10.7,z:8}];
  s=stepGame(s,FIXED_DT,idle);assert.equal(s.player.hp,5);assert.ok(s.player.invulnerable>1);
  s=frames(s,20);assert.equal(s.player.hp,5);
  s.enemies[0].hp=0;s.enemies[0].respawn=20;s.player.x=3;s.player.z=3;
  s=frames(s,1201);assert.equal(s.enemies[0].hp,2);
});
test('the full quest reaches victory only after the key, gate, boss, and chest',()=>{
  let s=playing();s.player.x=42;s.player.z=24;s=stepGame(s,FIXED_DT,{...idle,interact:true});assert.equal(s.zone,'dungeon');
  s.player.x=10;s.player.z=12.3;s=stepGame(s,FIXED_DT,{...idle,interact:true});assert.equal(s.gateOpen,false);
  s.player.x=5;s.player.z=8;s=stepGame(s,FIXED_DT,idle);assert.equal(s.hasKey,true);
  s.player.x=10;s.player.z=12.3;s=stepGame(s,FIXED_DT,idle);assert.equal(s.gateOpen,true);
  s.player.x=10;s.player.z=25;s=stepGame(s,FIXED_DT,{...idle,interact:true});assert.equal(s.phase,'playing');
  const boss=s.enemies.find(e=>e.kind==='boss')!;s.enemies=[boss];boss.hp=1;boss.x=10;boss.z=21;boss.modeTime=10;
  s.player.x=10;s.player.z=19.5;s.player.facingX=0;s.player.facingZ=1;s.player.invulnerable=10;
  s=frames(s,19,{...idle,attack:true});assert.equal(s.bossDefeated,true);assert.equal(s.enemies[0].hp,0);
  s.player.x=10;s.player.z=25;s=stepGame(s,FIXED_DT,{...idle,interact:true});assert.equal(s.phase,'victory');assert.equal(s.chestOpen,true);
});
test('defeat stops the simulation until the game is reset',()=>{
  let s=dungeon(playing());s.player.hp=1;s.player.invulnerable=0;const e=s.enemies.find(e=>e.id==='hall-1')!;s.enemies=[{...e,x:10.7,z:8}];
  s=stepGame(s,FIXED_DT,idle);assert.equal(s.phase,'gameover');assert.equal(s.player.hp,0);assert.strictEqual(stepGame(s,FIXED_DT,idle),s);
});
test('the Guardian completes its telegraph under repeated sword pressure',()=>{
  let s=dungeon(playing());s.gateOpen=true;s.hasKey=true;s.player.x=10;s.player.z=19.5;s.player.facingX=0;s.player.facingZ=1;
  s.player.invulnerable=0;
  s.enemies=s.enemies.filter(e=>e.kind==='boss');s.enemies[0].modeTime=0;let charged=false;
  for(let i=0;i<180;i++){s=stepGame(s,FIXED_DT,{...idle,attack:true});if(s.enemies[0].mode==='charge')charged=true;}
  assert.equal(charged,true,'Melee hits must not keep the boss permanently stunned');
  assert.ok(s.player.hp<6,'Holding the sword must not cancel every incoming rush');
});
test('the telegraphed Guardian rush can be avoided by sidestepping',()=>{
  let s=dungeon(playing());s.gateOpen=true;s.hasKey=true;s.player.x=10;s.player.z=19.5;s.player.invulnerable=0;
  s.enemies=s.enemies.filter(e=>e.kind==='boss');s.enemies[0].modeTime=0;
  s=frames(s,100,{...idle,x:1});assert.equal(s.player.hp,6);
});
test('a pursuing group remains solid when the hero is pinned against a wall',()=>{
  let s=dungeon(playing());s.player.x=1.34;s.player.z=8;
  const e=s.enemies.find(e=>e.id==='hall-1')!;
  s.enemies=[{...e,x:2.1,z:8},{...e,id:'second',x:2.96,z:8},{...e,id:'third',x:2.5,z:8.8}];
  for(let i=0;i<240;i++) {
    s=stepGame(s,FIXED_DT,{...idle,x:-1});
    for(const body of s.enemies) {
      assert.ok(!WORLDS.dungeon.obstacles.some(o=>overlapsSolid(body,body.radius-.001,o)));
      assert.ok(Math.hypot(body.x-s.player.x,body.z-s.player.z)>=body.radius+PLAYER_RADIUS-.01);
    }
  }
});

function routeObstacles(s:GameData):Obstacle[] {
  const pots=s.breakables.filter(b=>b.zone===s.zone&&b.kind==='pot'&&!b.broken).map(b=>({id:b.id,kind:'rock' as const,x:b.x,z:b.z,w:.52,d:.52}));
  const gate:Obstacle[] = s.zone==='dungeon'&&!s.gateOpen?[{id:'gate',kind:'wall',x:10,z:14,w:3,d:1}]:[];
  return [...WORLDS[s.zone].obstacles,...pots,...gate];
}
// Route planning only selects inputs: every part of the journey below is
// performed by the actual accelerating, colliding fixed-step simulation.
function findRoute(s:GameData,target:Point):Point[] {
  const grid=.5,width=Math.round(WORLDS[s.zone].width/grid),height=Math.round(WORLDS[s.zone].height/grid),stride=width+1;
  const encode=(x:number,z:number)=>z*stride+x;
  const decode=(n:number)=>({x:n%stride*grid,z:Math.floor(n/stride)*grid});
  const start=encode(Math.round(s.player.x/grid),Math.round(s.player.z/grid));
  const end=encode(Math.round(target.x/grid),Math.round(target.z/grid));
  const obs=routeObstacles(s),open=[start],closed=new Set<number>(),parent=new Map<number,number>(),cost=new Map([[start,0]]);
  const score=(n:number)=>{const p=decode(n);return (cost.get(n)??Infinity)+Math.abs(p.x-target.x)+Math.abs(p.z-target.z);};
  while(open.length) {
    open.sort((a,b)=>score(b)-score(a));const at=open.pop()!;
    if(at===end) {
      const path:Point[]=[];let cursor=at;while(cursor!==start){path.unshift(decode(cursor));cursor=parent.get(cursor)!;}
      // Preserve corners, remove the intermediate points on straight segments.
      return path.filter((p,i)=>i===0||i===path.length-1||(p.x-path[i-1].x)!==(path[i+1].x-p.x)||(p.z-path[i-1].z)!==(path[i+1].z-p.z));
    }
    if(closed.has(at))continue;closed.add(at);
    const ix=at%stride,iz=Math.floor(at/stride);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=ix+dx,nz=iz+dz;if(nx<1||nx>=width||nz<1||nz>=height)continue;
      const next=encode(nx,nz),p=decode(next);if(closed.has(next)||obs.some(o=>overlapsSolid(p,PLAYER_RADIUS+.18,o)))continue;
      const proposed=cost.get(at)!+grid;if(proposed>=(cost.get(next)??Infinity))continue;
      cost.set(next,proposed);parent.set(next,at);open.push(next);
    }
  }
  assert.fail(`No walkable route in ${s.zone} to ${target.x}, ${target.z}`);
}
function navigate(s:GameData,target:Point):GameData {
  const route=findRoute(s,target),obs=routeObstacles(s);
  for(const waypoint of route) {
    let reached=false;
    for(let i=0;i<900;i++) {
      const dx=waypoint.x-s.player.x,dz=waypoint.z-s.player.z,d=Math.hypot(dx,dz);
      if(d<.095){reached=true;break;}
      const strength=Math.min(1,d*1.6);
      s=stepGame(s,FIXED_DT,{...idle,x:dx/d*strength,z:dz/d*strength});
      assert.ok(!obs.some(o=>overlapsSolid(s.player,PLAYER_RADIUS-.003,o)),`Hero entered solid geometry near ${s.player.x}, ${s.player.z}`);
    }
    assert.ok(reached,`Movement could not reach ${waypoint.x}, ${waypoint.z}`);
  }
  assert.ok(Math.hypot(s.player.x-target.x,s.player.z-target.z)<.3);
  return s;
}
test('the complete landscape is navigable with real movement through bridge, door, key and gate',()=>{
  let s=playing();s.enemies=[];
  s=navigate(s,{x:22,z:13});s=navigate(s,{x:27.5,z:13});
  assert.ok(s.player.x>26.3&&s.player.z>11.4&&s.player.z<14.9,'Cross the river on its bridge');
  s=navigate(s,WORLDS.overworld.entrance);s=stepGame(s,FIXED_DT,{...idle,interact:true});assert.equal(s.zone,'dungeon');
  s=navigate(s,WORLDS.dungeon.key);assert.equal(s.hasKey,true);
  s=navigate(s,{x:10,z:12});assert.equal(s.gateOpen,true);
  s=navigate(s,WORLDS.dungeon.chest);assert.ok(s.player.z>24.7);
  s=stepGame(s,FIXED_DT,{...idle,interact:true});assert.equal(s.phase,'playing','Reaching treasure alone does not bypass the boss');
});
