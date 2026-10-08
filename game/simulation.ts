import type { Breakable, Enemy, GameData, InputState, Obstacle, Particle, Point, SoundName, Zone } from './types';
import { areaName, SANCTUARY, WORLDS } from './world';
import { findPath, isPathClear, type NavigationSpace } from './pathfinding';

export const FIXED_DT = 1 / 60;
export const PLAYER_RADIUS = .34;
export const ATTACK_DURATION = .28;
const TAU = Math.PI * 2;
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.z-b.z);
const clamp = (value: number, lo: number, hi: number) => Math.max(lo,Math.min(hi,value));

function enemy(id: string, zone: Zone, x: number, z: number, boss = false): Enemy {
  return { id,zone,x,z,spawnX:x,spawnZ:z,kind:boss?'boss':'blob',hp:boss?8:2,maxHp:boss?8:2,radius:boss?.83:.43,vx:0,vz:0,hitstun:0,flash:0,contactCooldown:0,respawn:0,lastAttackId:-1,wanderAngle:x*.7+z,mode:'idle',modeTime:(x+z)%2+1,path:[],repathTime:0,stuckTime:0,progressX:x,progressZ:z,rangedCooldown:0 };
}
export function createInitialData(muted = false): GameData {
  const p = WORLDS.overworld.spawn;
  const enemies = [
    enemy('clover-1','overworld',16,7),enemy('clover-2','overworld',20,15.7),enemy('pine-1','overworld',8,18),
    enemy('pine-2','overworld',16.5,20.5),enemy('crossing-1','overworld',29.4,13),enemy('orchard-1','overworld',34,7),
    enemy('orchard-2','overworld',42,11),enemy('elder-1','overworld',36,19.8),enemy('elder-2','overworld',41.5,18),
    enemy('hall-1','dungeon',12.4,8.7),enemy('hall-2','dungeon',14.6,10.9),enemy('ember-warden','dungeon',10,21,true),
  ];
  const breakables: Breakable[] = [];
  const grassPatches = [[10.6,5],[11.3,5],[11.9,5.4],[14.3,6.8],[16.5,10.8],[17.4,11],[19.4,11.2],[20,11.5],[7.5,14],[8.2,14.5],[10.7,17.6],[11.5,17.8],[15,19.4],[17.8,23],[19.2,17.3],[27.8,12],[28.5,12],[29.1,12.1],[30,15],[32.2,14.3],[35.9,10.4],[37,10.6],[41,12.8],[42,13],[34,18.8],[35,20.4],[38.3,21.8],[40.3,21],[44,18.8]];
  grassPatches.forEach(([x,z],i)=>breakables.push({id:`grass-${i}`,zone:'overworld',kind:'grass',x,z,broken:false,lastAttackId:-1}));
  [[8,10.6],[8.8,10.6],[40,23.8],[44,23.8]].forEach(([x,z],i)=>breakables.push({id:`pot-field-${i}`,zone:'overworld',kind:'pot',x,z,broken:false,lastAttackId:-1}));
  [[3,3],[3,10.9],[4,11.2],[16.8,3.4],[16,11.8],[3,17],[17,17],[4.5,25],[15.5,25]].forEach(([x,z],i)=>breakables.push({id:`pot-hall-${i}`,zone:'dungeon',kind:'pot',x,z,broken:false,lastAttackId:-1}));
  return {phase:'title',zone:'overworld',player:{...p,vx:0,vz:0,facingX:0,facingZ:1,hp:6,maxHp:6,invulnerable:0,attackTime:0,attackCooldown:0,attackId:0,knockX:0,knockZ:0},enemies,breakables,pickups:[],particles:[],projectiles:[],sounds:[],elapsed:0,rupees:0,hasKey:false,gateOpen:false,bossDefeated:false,chestOpen:false,area:areaName('overworld',p),message:'',messageTime:0,shake:0,damageFlash:0,muted,seed:72819,eventId:0,visited:["Willow’s Rest"]};
}
function random(s: GameData) { s.seed=(Math.imul(s.seed,1664525)+1013904223)>>>0;return s.seed/4294967296; }
function sound(s: GameData, name: SoundName) { s.sounds.push({id:++s.eventId,name});if(s.sounds.length>28)s.sounds.splice(0,s.sounds.length-28); }
function message(s: GameData, text: string, seconds = 4) { s.message=text;s.messageTime=seconds; }
function burst(s: GameData, p: Point, kind: Particle['kind'], color: string, count: number) {
  for(let i=0;i<count;i++) {
    const a=random(s)*TAU, speed=1.1+random(s)*2.4, life=.28+random(s)*.35;
    s.particles.push({id:++s.eventId,x:p.x,z:p.z,y:.3,vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,vy:1.6+random(s)*2.5,life,maxLife:life,color,size:kind==='poof'?.18+random(s)*.12:.06+random(s)*.075,kind});
  }
  if(s.particles.length>140)s.particles.splice(0,s.particles.length-140);
}
function drop(s: GameData,p: Point,kind:'heart'|'rupee',value=1) {
  s.pickups.push({id:`drop-${++s.eventId}`,zone:s.zone,x:p.x,z:p.z,kind,value,age:0});
}
function blockedObstacles(s: GameData): Obstacle[] {
  const obs: Obstacle[] = [...WORLDS[s.zone].obstacles,...s.breakables.filter(b=>b.zone===s.zone&&b.kind==='pot'&&!b.broken).map(b=>({id:b.id,kind:'rock' as const,x:b.x,z:b.z,w:.52,d:.52}))];
  return s.zone==='dungeon'&&!s.gateOpen ? [...obs,{id:'locked-gate',kind:'wall',x:10,z:14,w:3,d:1}] : obs;
}
export function overlapsSolid(p: Point, radius: number, o: Obstacle) {
  const nearX=clamp(p.x,o.x-o.w/2,o.x+o.w/2), nearZ=clamp(p.z,o.z-o.d/2,o.z+o.d/2);
  return (p.x-nearX)**2+(p.z-nearZ)**2 < radius*radius-.000001;
}
// Resolve one axis at a time so running diagonally into a wall keeps the free
// component of movement, rather than making the hero stick to the wall.
function move(s: GameData,p: Point,dx:number,dz:number,radius:number,obs:Obstacle[]) {
  const world=WORLDS[s.zone];
  p.x=clamp(p.x+dx,radius+.05,world.width-radius-.05);
  if(dx!==0) for(const o of obs) if(overlapsSolid(p,radius,o)) {
    const zGap=Math.max(0,Math.abs(p.z-o.z)-o.d/2);
    const correction=Math.sqrt(Math.max(0,radius*radius-zGap*zGap));
    p.x=dx>0 ? o.x-o.w/2-correction : o.x+o.w/2+correction;
  }
  p.z=clamp(p.z+dz,radius+.05,world.height-radius-.05);
  if(dz!==0) for(const o of obs) if(overlapsSolid(p,radius,o)) {
    const xGap=Math.max(0,Math.abs(p.x-o.x)-o.w/2);
    const correction=Math.sqrt(Math.max(0,radius*radius-xGap*xGap));
    p.z=dz>0 ? o.z-o.d/2-correction : o.z+o.d/2+correction;
  }
}
function sanctuaryRepel(e: Enemy) {
  if(e.zone!=='overworld')return;
  const d=distance(e,SANCTUARY),minimum=SANCTUARY.radius+e.radius;
  if(d<minimum) { const a=d>.001?Math.atan2(e.z-SANCTUARY.z,e.x-SANCTUARY.x):0;e.x=SANCTUARY.x+Math.cos(a)*minimum;e.z=SANCTUARY.z+Math.sin(a)*minimum;e.mode='idle'; }
}
function damagePlayer(s: GameData,source: Point,amount: number) {
  const p=s.player;
  if(p.invulnerable>0)return false;
  if(s.zone==='overworld'&&distance(p,SANCTUARY)<SANCTUARY.radius)return false;
  const d=distance(p,source)||1,dx=(p.x-source.x)/d,dz=(p.z-source.z)/d;
  p.hp=Math.max(0,p.hp-amount);p.invulnerable=1.15;p.knockX=dx*6.8;p.knockZ=dz*6.8;
  s.shake=.33;s.damageFlash=.48;sound(s,'hurt');burst(s,p,'spark','#ffd7b2',7);
  if(p.hp===0){s.phase='gameover';message(s,'Even the smallest light can rise again.',99);}
  return true;
}
function hitPlayer(s: GameData,e: Enemy) {
  if(e.contactCooldown>0||e.hitstun>0)return;
  if(damagePlayer(s,e,e.kind==='boss'?2:1))e.contactCooldown=1.25;
}
function navigationSpace(s: GameData,e: Enemy,obstacles: Obstacle[]): NavigationSpace {
  const world=WORLDS[s.zone];
  return {
    width:world.width,height:world.height,obstacles,
    bounds:e.kind==='boss'?{minZ:15.5+e.radius}:undefined,
    exclusions:s.zone==='overworld'?[SANCTUARY]:undefined,
  };
}
function resetProgress(e: Enemy) {e.stuckTime=0;e.progressX=e.x;e.progressZ=e.z;}
function clearPath(e: Enemy) {e.path=[];e.repathTime=0;resetProgress(e);}
function pursue(e: Enemy,target: Point,speed: number,dt: number,space: NavigationSpace) {
  // Keep open-ground steering responsive; A* is only needed when the direct
  // corridor is obstructed. The Guardian refreshes its route four times faster.
  if(isPathClear(e,target,e.radius,space))e.path=[{x:target.x,z:target.z}];
  else if(e.mode!=='chase'||e.repathTime<=0) {
    e.path=findPath(e,target,e.radius,space);
    e.repathTime=e.kind==='boss'?.18:.75;
  }
  e.mode='chase';
  while(e.path.length&&distance(e,e.path[0])<.09) {
    // A nearby corner can still be essential for a wide body to clear a pillar.
    // Reach it exactly unless cutting directly to the next segment is safe.
    if(e.path.length>1&&distance(e,e.path[0])>1e-6&&!isPathClear(e,e.path[1],e.radius,space))break;
    e.path.shift();
  }
  const next=e.path[0];
  if(!next){e.vx=0;e.vz=0;return;}
  // Knockback or another creature can push a pursuer off its old corridor.
  // Replan on the next tick instead of walking into a newly obstructed segment.
  if(!isPathClear(e,next,e.radius,space)){e.repathTime=0;e.vx=0;e.vz=0;return;}
  const d=distance(e,next),travel=Math.min(speed,d/dt);
  e.vx=(next.x-e.x)/d*travel;e.vz=(next.z-e.z)/d*travel;
}
function rangedFallback(s: GameData,e: Enemy,dt: number) {
  const pursuing=e.mode==='chase'&&e.hitstun<=0&&e.hp>0&&s.gateOpen&&s.player.z>=15.1;
  if(!pursuing||distance(e,s.player)<=e.radius+PLAYER_RADIUS+.12){resetProgress(e);return;}
  // Measure actual displacement after wall and body separation, not desired
  // velocity. Windups, recovery, hitstun, and melee contact are deliberate stops.
  if(distance(e,{x:e.progressX,z:e.progressZ})>=.16){resetProgress(e);return;}
  e.stuckTime+=dt;
  if(e.stuckTime+1e-8<.5||e.rangedCooldown>0)return;
  const d=distance(e,s.player);
  s.projectiles.push({id:++s.eventId,zone:s.zone,ownerId:e.id,x:e.x,z:e.z,
    vx:(s.player.x-e.x)/d*7.2,vz:(s.player.z-e.z)/d*7.2,radius:.18,life:4,age:0});
  e.rangedCooldown=3;resetProgress(e);
  sound(s,'swing');burst(s,e,'spark','#b8a4ff',6);
}
function advanceProjectiles(s: GameData,dt: number,obstacles: Obstacle[]) {
  const world=WORLDS[s.zone],space:NavigationSpace={width:world.width,height:world.height,obstacles};
  for(const shot of s.projectiles) {
    const owner=s.enemies.find(e=>e.id===shot.ownerId);
    if(shot.zone!==s.zone||!owner||owner.hp<=0||s.player.z<15.1){shot.life=0;continue;}
    shot.age+=dt;shot.life-=dt;
    // Short swept segments keep even a maximum-delta frame from skipping a
    // thin obstacle or the player. A shot is always consumed on impact.
    const steps=Math.max(1,Math.ceil(Math.hypot(shot.vx,shot.vz)*dt/(shot.radius*.5)));
    for(let i=0;i<steps&&shot.life>0;i++) {
      const next={x:shot.x+shot.vx*dt/steps,z:shot.z+shot.vz*dt/steps};
      if(!isPathClear(shot,next,shot.radius,space)) {
        shot.life=0;burst(s,shot,'spark','#b8a4ff',5);break;
      }
      const previous={x:shot.x,z:shot.z};shot.x=next.x;shot.z=next.z;
      if(distance(shot,s.player)<=shot.radius+PLAYER_RADIUS) {
        damagePlayer(s,previous,2);shot.life=0;
        burst(s,shot,'spark','#b8a4ff',5);
      }
    }
  }
  s.projectiles=s.projectiles.filter(shot=>shot.life>0);
}
function swingHits(s: GameData,target: Point,radius:number) {
  const p=s.player,dx=target.x-p.x,dz=target.z-p.z,range=Math.hypot(dx,dz);
  if(range>1.9+radius)return false;
  const sweep=Math.atan2(p.facingX,p.facingZ)+(1-p.attackTime/ATTACK_DURATION)*2.3-1.15;
  const angle=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(angle-sweep),Math.cos(angle-sweep));
  return Math.abs(delta)<.4+Math.asin(Math.min(.9,radius/Math.max(.4,range)));
}
function attackTargets(s: GameData) {
  const p=s.player;if(p.attackTime<=0)return;
  for(const e of s.enemies) {
    if(e.zone!==s.zone||e.hp<=0||e.lastAttackId===p.attackId||!swingHits(s,e,e.radius))continue;
    if(e.kind==='boss'&&(!s.gateOpen||p.z<15.1))continue;
    e.lastAttackId=p.attackId;e.hp--;e.flash=.15;e.hitstun=e.kind==='boss'?(e.mode==='charge'?.055:.1):.25;e.repathTime=0;
    const d=distance(e,p)||1,recoil=e.kind==='boss'?(e.mode==='charge'?1.8:3.7):7;
    e.vx=(e.x-p.x)/d*recoil;e.vz=(e.z-p.z)/d*recoil;
    // A hit briefly interrupts the Guardian's movement, but does not reset its
    // telegraph. Repeated swings therefore cannot keep it permanently stunned.
    burst(s,{x:(e.x+p.x)/2,z:(e.z+p.z)/2},'spark','#fff4c1',7);sound(s,'hit');s.shake=Math.max(s.shake,.07);
    if(e.hp<=0) {
      burst(s,e,'poof',e.kind==='boss'?'#eaaa73':'#b7dd88',15);sound(s,'death');e.respawn=e.kind==='boss'?0:20;
      if(e.kind==='boss') {s.bossDefeated=true;message(s,'The Guardian rests. The ember is yours to claim.',5);for(let i=0;i<5;i++)drop(s,{x:e.x+(i-2)*.35,z:e.z+.2},'rupee',2);}
      else {drop(s,e,'rupee',1+Math.floor(random(s)*3));if(p.hp<4&&random(s)<.4)drop(s,{x:e.x+.35,z:e.z},'heart',2);}
    }
  }
  for(const b of s.breakables) {
    if(b.zone!==s.zone||b.broken||b.lastAttackId===p.attackId||!swingHits(s,b,.3))continue;
    b.lastAttackId=p.attackId;b.broken=true;sound(s,'break');burst(s,b,'debris',b.kind==='grass'?'#76b747':'#d28c5b',b.kind==='grass'?8:11);
    const roll=random(s);if(b.kind==='pot'||roll<.54)drop(s,b,p.hp<5&&roll<.34?'heart':'rupee',p.hp<5&&roll<.34?2:1);
  }
}
function transition(s: GameData,zone: Zone,point: Point) {
  s.zone=zone;Object.assign(s.player,point,{vx:0,vz:0,knockX:0,knockZ:0,invulnerable:1.4,attackTime:0});s.particles=[];s.projectiles=[];s.shake=0;s.damageFlash=0;
  for(const e of s.enemies) {clearPath(e);if(e.zone===zone)e.contactCooldown=Math.max(e.contactCooldown,1.1);}
  sound(s,'enter');message(s,zone==='dungeon'?'A little courage. A little light. Find the old brass key.':'Fresh air. The pines welcome you home.',4.5);
}
function quest(s: GameData,input: InputState) {
  const world=WORLDS[s.zone],p=s.player;
  if(s.zone==='overworld') {
    if(input.interact&&distance(p,world.entrance)<2)transition(s,'dungeon',WORLDS.dungeon.spawn);
    return;
  }
  if(!s.hasKey&&distance(p,world.key)<1.08) {s.hasKey=true;p.hp=Math.min(p.maxHp,p.hp+2);sound(s,'key');burst(s,world.key,'spark','#fbd67a',14);message(s,'You found the brass key! The old gate awaits.',5);}
  if(!s.gateOpen&&distance(p,world.gate)<2.1) {
    if(s.hasKey){s.gateOpen=true;sound(s,'gate');message(s,'The seal is broken. Face the Hollow Guardian.',4.5);}
    else if(input.interact)message(s,'An old brass lock. There must be a key nearby.',3.5);
  }
  if(input.interact&&distance(p,world.chest)<1.9) {
    if(s.bossDefeated){s.chestOpen=true;s.phase='victory';sound(s,'chest');burst(s,world.chest,'spark','#ffde75',24);message(s,'A small hero. A brighter world.',99);}
    else message(s,'The Guardian guards this last ember.',3);
  }
  if(input.interact&&distance(p,world.exit)<1.7&&p.invulnerable<1.2)transition(s,'overworld',WORLDS.overworld.exit);
}

export function stepGame(previous: GameData,dt: number,input: InputState): GameData {
  if(previous.phase!=='playing')return previous;
  // GameCanvas owns the fixed-step accumulator. This cap also makes accidental
  // tab-resume deltas harmless when the simulation is used by another host.
  dt=Math.min(.05,Math.max(0,dt));if(dt===0)return previous;
  const s: GameData={...previous,player:{...previous.player},enemies:previous.enemies.map(e=>({...e,path:[...e.path]})),breakables:previous.breakables.map(b=>({...b})),pickups:previous.pickups.map(p=>({...p})),particles:previous.particles.map(p=>({...p})),projectiles:previous.projectiles.map(shot=>({...shot})),sounds:[...previous.sounds],visited:[...previous.visited]};
  const p=s.player,obs=blockedObstacles(s);s.elapsed+=dt;s.shake=Math.max(0,s.shake-dt);s.damageFlash=Math.max(0,s.damageFlash-dt);s.messageTime=Math.max(0,s.messageTime-dt);
  p.invulnerable=Math.max(0,p.invulnerable-dt);p.attackTime=Math.max(0,p.attackTime-dt);p.attackCooldown=Math.max(0,p.attackCooldown-dt);
  const inputLength=Math.hypot(input.x,input.z),ix=inputLength>1?input.x/inputLength:input.x,iz=inputLength>1?input.z/inputLength:input.z;
  if(inputLength>.05&&p.attackTime<=0) { const angle=Math.round(Math.atan2(ix,iz)/(Math.PI/4))*Math.PI/4;p.facingX=Math.sin(angle);p.facingZ=Math.cos(angle); }
  const speed=p.attackTime>0?3.1:4.3,response=1-Math.exp(-(inputLength>0?15:19)*dt);
  p.vx+=(ix*speed-p.vx)*response;p.vz+=(iz*speed-p.vz)*response;
  move(s,p,(p.vx+p.knockX)*dt,(p.vz+p.knockZ)*dt,PLAYER_RADIUS,obs);p.knockX*=Math.exp(-10*dt);p.knockZ*=Math.exp(-10*dt);
  if(input.attack&&p.attackCooldown<=0) {p.attackTime=ATTACK_DURATION;p.attackCooldown=.43;p.attackId++;sound(s,'swing');}
  attackTargets(s);
  const active=s.enemies.filter(e=>e.zone===s.zone&&e.hp>0);
  for(const e of s.enemies) {
    if(e.hp<=0) {
      if(e.kind==='boss')continue;
      e.respawn=Math.max(0,e.respawn-dt);
      if(e.respawn===0&&(e.zone!==s.zone||distance(p,{x:e.spawnX,z:e.spawnZ})>3.5)){Object.assign(e,{x:e.spawnX,z:e.spawnZ,hp:e.maxHp,vx:0,vz:0,hitstun:0,flash:0,contactCooldown:1,lastAttackId:-1,mode:'idle',rangedCooldown:0});clearPath(e);}
      continue;
    }
    if(e.zone!==s.zone)continue;
    e.hitstun=Math.max(0,e.hitstun-dt);e.flash=Math.max(0,e.flash-dt);e.contactCooldown=Math.max(0,e.contactCooldown-dt);e.modeTime-=dt;
    e.repathTime=Math.max(0,e.repathTime-dt);e.rangedCooldown=Math.max(0,e.rangedCooldown-dt);
    if(e.kind==='boss'&&(!s.gateOpen||p.z<15.1)){e.mode='idle';e.vx=0;e.vz=0;clearPath(e);continue;}
    const d=distance(e,p),inSanctuary=s.zone==='overworld'&&distance(p,SANCTUARY)<SANCTUARY.radius;
    const navigation=navigationSpace(s,e,obs);
    if(e.hitstun<=0) {
      if(e.kind==='boss') {
        if(e.mode==='windup') {
          e.vx*=Math.exp(-18*dt);e.vz*=Math.exp(-18*dt);
          if(e.modeTime<=0) {e.mode='charge';e.modeTime=.56;e.wanderAngle=Math.atan2(p.z-e.z,p.x-e.x);e.vx=Math.cos(e.wanderAngle)*7.2;e.vz=Math.sin(e.wanderAngle)*7.2;}
        } else if(e.mode==='charge') {
          if(e.modeTime<=0){e.mode='idle';e.modeTime=.5;}
          else {
            // Recover the committed rush after a hit's brief recoil. Otherwise
            // holding the sword reverses every charge and removes all danger.
            const recover=1-Math.exp(-18*dt);
            e.vx+=(Math.cos(e.wanderAngle)*7.2-e.vx)*recover;
            e.vz+=(Math.sin(e.wanderAngle)*7.2-e.vz)*recover;
          }
        }
        else if(e.mode==='idle'&&e.modeTime>0){e.vx*=Math.exp(-9*dt);e.vz*=Math.exp(-9*dt);}
        else if(d<5.6&&isPathClear(e,p,e.radius,navigation)){e.mode='windup';e.modeTime=.65;e.vx=0;e.vz=0;}
        else pursue(e,p,2.65,dt,navigation);
      } else if(!inSanctuary&&d<5.7) pursue(e,p,1.95,dt,navigation);
      else {
        e.mode='idle';if(e.modeTime<=0){e.wanderAngle=random(s)*TAU;e.modeTime=1.2+random(s)*2;}
        if(distance(e,{x:e.spawnX,z:e.spawnZ})>2.1)e.wanderAngle=Math.atan2(e.spawnZ-e.z,e.spawnX-e.x);
        e.vx=Math.cos(e.wanderAngle)*.52;e.vz=Math.sin(e.wanderAngle)*.52;
      }
    } else {e.vx*=Math.exp(-5*dt);e.vz*=Math.exp(-5*dt);}
    if(e.mode!=='chase')clearPath(e);
    move(s,e,e.vx*dt,e.vz*dt,e.radius,obs);sanctuaryRepel(e);if(e.kind==='boss')e.z=Math.max(15.5+e.radius,e.z);
  }
  // Several relaxed passes prevent a cluster from sharing a position while
  // preserving static-wall collision. Contact occurs before separating bodies.
  for(let pass=0;pass<4;pass++) {
    for(const e of active) {
      const d=distance(p,e),minimum=PLAYER_RADIUS+e.radius;
      if(d<minimum+.045&&pass===0)hitPlayer(s,e);
      if(d<minimum) {
        const dx=d>.0001?(p.x-e.x)/d:1,dz=d>.0001?(p.z-e.z)/d:0,push=(minimum-d)+.002;
        const oldP={x:p.x,z:p.z};move(s,p,dx*push*.45,dz*push*.45,PLAYER_RADIUS,obs);
        const amount=push-distance(p,oldP);move(s,e,-dx*amount,-dz*amount,e.radius,obs);sanctuaryRepel(e);
      }
    }
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++) {
      const a=active[i],b=active[j],d=distance(a,b),minimum=a.radius+b.radius;
      if(d>=minimum)continue;const dx=d>.0001?(a.x-b.x)/d:1,dz=d>.0001?(a.z-b.z)/d:0,push=(minimum-d)/2+.001;
      move(s,a,dx*push,dz*push,a.radius,obs);move(s,b,-dx*push,-dz*push,b.radius,obs);sanctuaryRepel(a);sanctuaryRepel(b);
    }
  }
  if(s.phase==='playing') {
    for(const e of active)if(e.kind==='boss')rangedFallback(s,e,dt);
    advanceProjectiles(s,dt,obs);
  }
  for(const pickup of s.pickups) {
    pickup.age+=dt;if(pickup.zone!==s.zone||pickup.age<.14)continue;
    const d=distance(p,pickup);
    if(d<2.1&&d>.001){const pull=Math.min(d,(2.3+(2.1-d)*4)*dt);pickup.x+=(p.x-pickup.x)/d*pull;pickup.z+=(p.z-pickup.z)/d*pull;}
    if(distance(p,pickup)<.56){if(pickup.kind==='rupee'){s.rupees+=pickup.value;sound(s,'rupee');}else {p.hp=Math.min(p.maxHp,p.hp+pickup.value);sound(s,'heart');}pickup.age=-999;}
  }
  s.pickups=s.pickups.filter(pickup=>pickup.age>=0&&pickup.age<90);
  for(const part of s.particles){part.life-=dt;part.x+=part.vx*dt;part.z+=part.vz*dt;part.y=Math.max(.02,part.y+part.vy*dt);part.vy-=9*dt;}
  s.particles=s.particles.filter(part=>part.life>0);
  if(s.phase==='playing')quest(s,input);
  s.area=areaName(s.zone,p);if(!s.visited.includes(s.area))s.visited.push(s.area);
  return s;
}
