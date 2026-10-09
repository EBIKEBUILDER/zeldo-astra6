import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialData, FIXED_DT, stepGame } from './simulation';
import { BOSS_CHARGE_DURATION, BOSS_CHARGE_SPEED, BOSS_RECOVERY, BOSS_RANGED_WINDUP } from './boss-attacks';
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

test('a charge pinned against an existing pillar finishes its rush and recovery before its fallback',()=>{
  let s=arena();
  // The committed southward lunge meets the north face of the existing pillar.
  Object.assign(s.enemies[0],{x:4,z:21.98,progressX:4,progressZ:21.98,mode:'charge',
    modeTime:BOSS_CHARGE_DURATION,wanderAngle:-Math.PI/2,vx:0,vz:-BOSS_CHARGE_SPEED});
  Object.assign(s.player,{x:4,z:18.5});
  let chargeFrames=0;
  let recoveryFrames=0;
  let fired=false;
  for(let frame=0;frame<180;frame++) {
    s=stepGame(s,FIXED_DT,idle);
    if(s.enemies[0].mode==='charge')chargeFrames++;
    if(s.enemies[0].mode==='idle')recoveryFrames++;
    if(!s.sounds.some(sound=>sound.name==='ranged-fire')&&(s.enemies[0].mode==='charge'||s.enemies[0].mode==='idle'))
      assert.equal(s.sounds.some(sound=>sound.name==='ranged-charge'),false);
    if(s.sounds.some(sound=>sound.name==='ranged-fire')) {
      assert.ok(chargeFrames>=Math.floor(BOSS_CHARGE_DURATION/FIXED_DT)-1,'The entire blocked lunge completes');
      assert.ok(recoveryFrames>=Math.floor(BOSS_RECOVERY/FIXED_DT),'The recovery remains a safe punish window');
      assert.ok(Math.hypot(s.enemies[0].x-s.player.x,s.enemies[0].z-s.player.z)>1.29);
      assert.ok(s.enemies[0].rangedCooldown>2.9);
      assert.ok(s.projectiles[0]?.lob,'The lob clears the pillar instead of disappearing on launch');
      fired=true;
      break;
    }
  }
  assert.ok(fired,'A stalled charge queues a lob after recovery');
});

test('the real entrance corner is threatened by a lob that clears the existing pot',()=>{
  let s=cornerWarning();
  assert.equal(s.player.hp,6,'The Guardian cannot reach the player with its body');
  for(let frame=0;frame<120;frame++) {
    s=stepGame(s,FIXED_DT,idle);
    if(s.player.hp<6) {
      assert.equal(s.player.hp,4,'Ignoring the warning costs the normal boss damage');
      assert.ok(s.sounds.some(sound=>sound.name==='ranged-fire'));
      assert.equal(s.projectiles.length,0,'The lob is consumed on landing');
      assert.equal(s.hazards.length,1,'The marked landing remains briefly dangerous');
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
  assert.ok(bolt.lob);
  assert.equal(bolt.lob.targetX,aim.x);assert.equal(bolt.lob.targetZ,aim.z);
  assert.ok(s.player.x>aim.x+2,'Normal movement clears the marked lane before release');
  for(let frame=0;frame<90&&s.projectiles.length;frame++)s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.projectiles.length,0,'The missed shot still lands at its marked point');
  assert.equal(s.hazards[0].x,aim.x);assert.equal(s.hazards[0].z,aim.z);
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

  for(let frame=0;frame<420&&s.enemies[0].mode!=='ranged-windup';frame++)s=stepGame(s,FIXED_DT,{...idle,z:1});
  assert.ok(s.player.z>15.1);
  assert.equal(s.enemies[0].mode,'ranged-windup','Re-entering the arena resumes the threat');
  assert.equal(s.enemies[0].modeTime,BOSS_RANGED_WINDUP,'The abandoned warning does not shorten the next one');
  for(let frame=0;frame<47;frame++)s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.projectiles.length,0);
  s=stepGame(s,FIXED_DT,idle);
  assert.equal(s.projectiles.length,1);
});
