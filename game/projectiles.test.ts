import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
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
  return {id:9000,zone:'dungeon' as const,ownerId:s.enemies[0].id,x:8,z:24.5,vx:7.2,vz:0,radius:.18,life:4,age:0,...values};
}

test('a stalled pursuit fires after half a second and respects its three-second cooldown',()=>{
  let s=trapBoss(arena());
  s=frames(s,29);assert.equal(s.projectiles.length,0);assert.equal(s.sounds.filter(e=>e.name==='swing').length,0);
  s=frames(s,1);assert.equal(s.projectiles.length,1);
  const first=s.projectiles[0];
  assert.ok(Math.abs(Math.hypot(first.vx,first.vz)-7.2)<1e-9);
  assert.ok(first.vz>0&&Math.abs(first.vx)<1e-9,'Aim at the player at launch');
  s=frames(s,178);assert.equal(s.sounds.filter(e=>e.name==='swing').length,1);
  s=frames(s,3);assert.equal(s.sounds.filter(e=>e.name==='swing').length,2);
});

test('moving pursuits, intentional windups, recovery, hitstun, and inactive fights never count as stuck',()=>{
  let moving=arena();moving.player.invulnerable=100;moving.enemies[0].z=17;moving.enemies[0].progressZ=17;
  moving=frames(moving,120);assert.equal(moving.sounds.filter(e=>e.name==='swing').length,0);
  for(const mode of ['windup','idle'] as const) {
    let s=trapBoss(arena());s.enemies[0].mode=mode;s.enemies[0].modeTime=2;s.enemies[0].stuckTime=.49;
    s=frames(s,40);assert.equal(s.sounds.filter(e=>e.name==='swing').length,0);assert.equal(s.enemies[0].stuckTime,0);
  }
  let stunned=trapBoss(arena());stunned.enemies[0].hitstun=2;stunned.enemies[0].stuckTime=.49;
  stunned=frames(stunned,40);assert.equal(stunned.sounds.filter(e=>e.name==='swing').length,0);
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
