import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import { BOSS_RANGED_COOLDOWN, BOSS_RANGED_WINDUP } from './boss-attacks';
import type { GameData, InputState, Projectile } from './types';

const idle:InputState={x:0,z:0,attack:false,interact:false};
function arena() {
  const s=createInitialData();
  s.phase='playing';s.zone='dungeon';s.hasKey=true;s.gateOpen=true;
  s.player.x=10;s.player.z=24.5;
  s.enemies=s.enemies.filter(e=>e.kind==='boss');
  Object.assign(s.enemies[0],{x:10,z:20,mode:'chase',modeTime:0,progressX:10,progressZ:20});
  s.breakables=[];
  return s;
}
function frames(s:GameData,n:number) {for(let i=0;i<n;i++)s=stepGame(s,FIXED_DT,idle);return s;}
function trapBoss(s:GameData) {
  // These pots leave the boss physically clear, but no body-sized way out.
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4;
    s.breakables.push({id:`trap-${i}`,zone:'dungeon',kind:'pot',x:10+Math.cos(a)*1.35,z:20+Math.sin(a)*1.35,broken:false,lastAttackId:-1});
  }
  return s;
}
function shot(s:GameData,values:Partial<Projectile>={}) {
  return {id:9000,zone:'dungeon' as const,ownerId:s.enemies[0].id,x:8,z:24.5,vx:7.2,vz:0,radius:.18,life:4,age:0,reflected:false,...values};
}

test('a stalled pursuit warns for 0.8 seconds before firing, then respects its cooldown',()=>{
  let s=trapBoss(arena());
  s=frames(s,29);assert.equal(s.projectiles.length,0);
  assert.equal(s.sounds.filter(e=>e.name==='ranged-charge').length,0);
  s=frames(s,1);assert.equal(s.enemies[0].mode,'ranged-windup');assert.equal(s.projectiles.length,0);
  assert.equal(s.sounds.filter(e=>e.name==='ranged-charge').length,1);
  s=frames(s,47);assert.equal(s.projectiles.length,0,'The entire warning is safe');
  s=frames(s,1);assert.equal(s.projectiles.length,1);
  const first=s.projectiles[0];
  assert.ok(first.lob);
  assert.equal(first.lob.targetX,10);assert.equal(first.lob.targetZ,24.5);
  assert.ok(Math.abs(first.vz-(first.lob.targetZ-first.lob.startZ)/first.lob.duration)<1e-9);
  assert.ok(first.vz>0&&Math.abs(first.vx)<1e-9);
  s=frames(s,Math.ceil(BOSS_RANGED_COOLDOWN/FIXED_DT)-1);assert.equal(s.sounds.filter(e=>e.name==='ranged-fire').length,1);
  s=frames(s,Math.ceil(BOSS_RANGED_WINDUP/FIXED_DT)+2);assert.equal(s.sounds.filter(e=>e.name==='ranged-fire').length,2);
});

test('the warning locks its aim so sidestepping before release dodges the shot',()=>{
  let s=trapBoss(arena());s=frames(s,30);
  assert.equal(s.enemies[0].rangedAimX,10);assert.equal(s.enemies[0].rangedAimZ,24.5);
  const moveRight={...idle,x:1};
  for(let frame=0;frame<48;frame++)s=stepGame(s,FIXED_DT,moveRight);
  assert.equal(s.projectiles.length,1);assert.ok(Math.abs(s.projectiles[0].vx)<1e-9);
  s=frames(s,60);assert.equal(s.player.hp,6,'The bolt never homes onto the new position');
});

test('moving pursuits, intentional windups, recovery, hitstun, and inactive fights never count as stuck',()=>{
  let moving=arena();moving.player.invulnerable=100;moving.enemies[0].z=17;moving.enemies[0].progressZ=17;
  moving.enemies[0].rangedCooldown=100; // Isolate stall detection from the deliberate long-range attack.
  moving=frames(moving,120);assert.equal(moving.sounds.filter(e=>e.name==='ranged-fire').length,0);
  for(const mode of ['windup','idle'] as const) {
    let s=trapBoss(arena());s.enemies[0].mode=mode;s.enemies[0].modeTime=2;s.enemies[0].stuckTime=.49;
    s=frames(s,40);assert.equal(s.sounds.filter(e=>e.name==='ranged-fire').length,0);assert.equal(s.enemies[0].stuckTime,0);
  }
  let stunned=trapBoss(arena());stunned.enemies[0].hitstun=2;stunned.enemies[0].stuckTime=.49;
  stunned=frames(stunned,40);assert.equal(stunned.sounds.filter(e=>e.name==='ranged-fire').length,0);
  let inactive=trapBoss(arena());inactive.player.z=12;inactive.enemies[0].stuckTime=.49;
  inactive=frames(inactive,120);assert.equal(inactive.projectiles.length,0);assert.equal(inactive.enemies[0].stuckTime,0);
});

test('projectiles stop at stone before reaching a player behind it, even on a long frame',()=>{
  let s=arena();s.player.x=6;s.player.z=20.5;s.enemies[0].mode='idle';s.enemies[0].modeTime=10;
  s.projectiles=[shot(s,{x:3,z:20.5})];
  s=stepGame(s,.05,idle);
  assert.equal(s.projectiles.length,0);assert.equal(s.player.hp,6);
  assert.ok(s.particles.some(p=>p.color==='#b8a4ff'));
});

test('a bolt deals the existing boss damage once and uses the existing hurt invulnerability',()=>{
  let s=arena();s.enemies[0].mode='idle';s.enemies[0].modeTime=10;
  s.projectiles=[shot(s,{x:9.4}),shot(s,{id:9001,x:9.3})];
  s=frames(s,5);
  assert.equal(s.player.hp,4,'Boss damage remains one heart');
  assert.equal(s.projectiles.length,0);
  assert.ok(s.player.invulnerable>1);
  assert.ok(Math.hypot(s.player.knockX,s.player.knockZ)>0);
  assert.equal(s.sounds.filter(e=>e.name==='hurt').length,1);
});

test('a shot is consumed by an invulnerable player without causing damage',()=>{
  let s=arena();s.player.invulnerable=2;s.enemies[0].mode='idle';s.enemies[0].modeTime=10;
  s.projectiles=[shot(s,{x:9.5})];s=frames(s,3);
  assert.equal(s.projectiles.length,0);assert.equal(s.player.hp,6);
});

test('projectiles expire, disappear with their owner, and are cleared on leaving the dungeon',()=>{
  let s=arena();s.projectiles=[shot(s,{life:.001})];s=frames(s,1);assert.equal(s.projectiles.length,0);
  s=arena();s.projectiles=[shot(s)];s.enemies[0].hp=0;s.bossDefeated=true;
  s=frames(s,1);assert.equal(s.projectiles.length,0);
  s=arena();s.projectiles=[shot(s)];s.player.x=10;s.player.z=2;
  s=stepGame(s,FIXED_DT,{...idle,interact:true});assert.equal(s.zone,'overworld');assert.equal(s.projectiles.length,0);
  assert.equal(createInitialData().projectiles.length,0);
});

test('a paused game freezes the new pursuit timers and projectiles',()=>{
  const s=arena();s.projectiles=[shot(s)];s.phase='paused';
  const snapshot=JSON.stringify(s);
  assert.equal(stepGame(s,FIXED_DT,idle),s);assert.equal(JSON.stringify(s),snapshot);
});


test('a timed sword sweep reflects a bolt, which hurts the Guardian once',()=>{
  let s=arena();s.player.x=10;s.player.z=24;s.player.facingX=0;s.player.facingZ=-1;
  s.player.attackTime=.16;s.player.attackId=1;
  s.enemies[0].mode='idle';s.enemies[0].modeTime=10;
  s.projectiles=[shot(s,{x:10,z:22.9,vx:0,vz:7.2})];
  s=frames(s,1);assert.equal(s.projectiles[0].reflected,true);
  assert.ok(s.projectiles[0].vz<0);assert.equal(s.player.hp,6);
  assert.equal(s.sounds.filter(e=>e.name==='ranged-parry').length,1);
  s=frames(s,30);assert.equal(s.enemies[0].hp,7);assert.equal(s.projectiles.length,0);
});

test('a returned wisp can defeat the Guardian and unlock the treasure',()=>{
  let s=arena();s.enemies[0].hp=1;s.enemies[0].mode='idle';s.enemies[0].modeTime=10;
  s.projectiles=[shot(s,{x:10,z:21.1,vx:0,vz:-7.2,reflected:true})];
  s=frames(s,5);assert.equal(s.enemies[0].hp,0);assert.equal(s.bossDefeated,true);
  assert.equal(s.pickups.length,5);assert.equal(s.sounds.filter(e=>e.name==='death').length,1);
});

test('reflected wisps also die on walls and cannot be reflected through scenery',()=>{
  let s=arena();s.enemies[0].mode='idle';s.enemies[0].modeTime=10;
  s.projectiles=[shot(s,{x:3,z:20.5,reflected:true})];s=stepGame(s,.05,idle);
  assert.equal(s.projectiles.length,0);assert.equal(s.enemies[0].hp,8);
  s=arena();Object.assign(s.player,{x:5.1,z:20.5,facingX:-1,facingZ:0,attackTime:.16});
  s.enemies[0].mode='idle';s.enemies[0].modeTime=10;
  s.projectiles=[shot(s,{x:3.15,z:20.5})];s=frames(s,2);
  assert.equal(s.sounds.filter(e=>e.name==='ranged-parry').length,0,'Stone blocks the sword from returning a bolt on the far side');
  assert.equal(s.projectiles.length,0);
});

test('leaving the arena cancels a ranged warning and the next encounter starts fresh',()=>{
  let s=trapBoss(arena());s=frames(s,30);assert.equal(s.enemies[0].mode,'ranged-windup');
  s.player.z=12;s=frames(s,60);assert.equal(s.enemies[0].mode,'idle');
  assert.equal(s.projectiles.length,0);assert.equal(s.sounds.filter(e=>e.name==='ranged-fire').length,0);
});
