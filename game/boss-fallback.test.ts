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
function cornerWarning():GameData {
  let s=arena();
  Object.assign(s.player,{x:3,z:15.2,invulnerable:0});
  for(let frame=0;frame<420;frame++) {
    s=stepGame(s,FIXED_DT,idle);
    if(s.enemies[0].mode==='ranged-windup')return s;
  }
  assert.fail('The existing entrance pot and boss leash should trigger a ranged warning');
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
  for(let frame=0;frame<120;frame++) {
    s=stepGame(s,FIXED_DT,idle);
    if(s.enemies[0].mode==='charge')chargeFrames++;
    if(s.sounds.some(sound=>sound.name==='ranged-fire')) {
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

test('the real entrance corner is threatened by a bolt that clears the existing pot',()=>{
  let s=cornerWarning();
  assert.equal(s.player.hp,6,'The Guardian cannot reach the player with its body');
  for(let frame=0;frame<120;frame++) {
    s=stepGame(s,FIXED_DT,idle);
    if(s.player.hp<6) {
      assert.equal(s.player.hp,4,'Ignoring the warning costs the normal boss damage');
      assert.ok(s.sounds.some(sound=>sound.name==='ranged-fire'));
      assert.equal(s.projectiles.length,0,'The bolt is consumed by the hit');
      assert.ok(Math.hypot(s.enemies[0].x-s.player.x,s.enemies[0].z-s.player.z)>1.29,
        'The damage comes from the bolt, beyond melee contact');
      return;
    }
  }
  assert.fail('The fallback must reach the camping player instead of breaking against a pot');
});

test('the real corner warning gives the player enough time to sidestep its locked aim',()=>{
  let s=cornerWarning();
  const aim={x:s.enemies[0].rangedAimX,z:s.enemies[0].rangedAimZ};
  for(let frame=0;frame<48;frame++)s=stepGame(s,FIXED_DT,{...idle,x:1});
  assert.equal(s.projectiles.length,1);
  const bolt=s.projectiles[0];
  const boss=s.enemies[0];
  const dx=aim.x-boss.x,dz=aim.z-boss.z,length=Math.hypot(dx,dz);
  assert.ok(Math.abs(bolt.vx-dx/length*7.2)<1e-8);
  assert.ok(Math.abs(bolt.vz-dz/length*7.2)<1e-8);
  assert.ok(s.player.x>aim.x+2,'Normal movement clears the marked lane before release');
  for(let frame=0;frame<60&&s.projectiles.length;frame++)s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.projectiles.length,0,'The missed shot eventually strikes the arena wall');
  assert.equal(s.player.hp,6);
});

test('retreating below the arena cancels the warning and re-entry gets a fresh telegraph',()=>{
  let s=cornerWarning();
  for(let frame=0;frame<12;frame++)s=stepGame(s,FIXED_DT,{...idle,z:-1});
  assert.ok(s.player.z<15.1);
  assert.equal(s.enemies[0].mode,'idle');
  for(let frame=0;frame<60;frame++)s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.projectiles.length,0);
  assert.equal(s.sounds.filter(sound=>sound.name==='ranged-fire').length,0);

  for(let frame=0;frame<12;frame++)s=stepGame(s,FIXED_DT,{...idle,z:1});
  assert.ok(s.player.z>15.1);
  for(let frame=0;frame<420&&s.enemies[0].mode!=='ranged-windup';frame++)s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.enemies[0].mode,'ranged-windup','Re-entering the arena resumes the threat');
  assert.ok(s.enemies[0].modeTime>.79,'The abandoned warning does not shorten the next one');
  for(let frame=0;frame<47;frame++)s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.projectiles.length,0);
  s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.projectiles.length,1);
});
