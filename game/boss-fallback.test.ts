import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import type { GameData, InputState } from './types';

const idle:InputState={x:0,z:0,attack:false,interact:false};
function arena():GameData {
  const s=createInitialData();
  s.phase='playing';s.zone='dungeon';s.hasKey=true;s.gateOpen=true;
  s.player.invulnerable=100;
  s.enemies=s.enemies.filter(e=>e.kind==='boss');
  s.enemies[0].modeTime=0;
  return s;
}

test('a charge pinned against an existing pillar can fire its stalled fallback',()=>{
  let s=arena();
  Object.assign(s.enemies[0],{x:5.4504,z:21.8175,progressX:5.4504,progressZ:21.8175});
  Object.assign(s.player,{x:5.54645,z:19.89448});
  s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.enemies[0].mode,'windup');

  // Slip left along the pillar during the telegraph. The committed charge now
  // meets its rounded corner instead of the previously unobstructed corridor.
  const dodge={...idle,x:Math.cos(2.90213),z:Math.sin(2.90213)};
  for(let frame=0;frame<13;frame++)s=stepGame(s,FIXED_DT,dodge);
  let chargeFrames=0;
  let fired=false;
  for(let frame=0;frame<70;frame++) {
    s=stepGame(s,FIXED_DT,idle);
    if(s.enemies[0].mode==='charge')chargeFrames++;
    if(s.sounds.some(sound=>sound.name==='swing')) {
      assert.ok(chargeFrames>=30,'The fallback waits for about half a second of failed movement');
      assert.ok(Math.hypot(s.enemies[0].x-s.player.x,s.enemies[0].z-s.player.z)>1.29);
      assert.ok(s.enemies[0].rangedCooldown>2.9);
      assert.equal(s.projectiles.length,1,'The bolt clears the pillar instead of disappearing on launch');
      fired=true;
      break;
    }
  }
  assert.ok(fired,'A stalled charge should launch a bolt just like a stalled chase');
});

test('the original arena provides a real stalled-pursuit fallback without an artificial trap',()=>{
  let s=arena();
  Object.assign(s.player,{x:3,z:15.2});
  let fired=false;
  for(let frame=0;frame<420;frame++) {
    s=stepGame(s,FIXED_DT,idle);
    if(s.sounds.some(sound=>sound.name==='swing')) {
      fired=true;
      assert.ok(s.enemies[0].rangedCooldown>2.9);
      break;
    }
  }
  assert.ok(fired,'The existing entrance pot and boss leash can obstruct a pursuit');
});
