import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { CombatController, GUNS, ArenaNavigation, rayBox } from '../src/combat.js';
import { MovementController } from '../src/movement.js';
import { createCharacter } from '../src/character.js';

const dt=1/120;
const floor={id:'floor',minX:-40,maxX:40,minY:-2,maxY:0,minZ:-20,maxZ:40};
const wall={id:'wall',minX:-1,maxX:1,minY:0,maxY:4,minZ:3,maxZ:4};
function setup(extra=[]){
 const world={solids:[floor,...extra],ramps:[],ziplines:[]};
 const p=new MovementController(world);p.reset({x:0,y:0,z:10});p.grounded=true;
 const c=new CombatController(world);p.combat=c;c.setMode('targets');c.step(dt,{},p);
 c.bots.forEach((b,i)=>{b.actor.reset({x:i===0?0:20+i*2,y:0,z:i===0?0:-10});b.actor.grounded=true;});
 return {p,c};
}
function tick(context,input={},count=1,aim){for(let i=0;i<count;i++){const {p,c}=context;p.step(dt,c.prepareInput(input,p));c.step(dt,input,p,aim);}}
const sight={origin:new Vector3(0,1,10),muzzle:new Vector3(0,1,9),direction:new Vector3(0,0,-1)};
function shoot(context,extra={}){tick(context,{firePressed:true,fireHeld:true,aim:true,...extra},1,sight);}

test('ray casts select the nearest positive surface and handle parallel and inside origins',()=>{
 assert.equal(rayBox(new Vector3(0,1,8),new Vector3(0,0,-1),wall),4);
 assert.equal(rayBox(new Vector3(2,1,8),new Vector3(0,0,-1),wall),null);
 assert.equal(rayBox(new Vector3(0,1,3.5),new Vector3(0,0,-1),wall),0);
 assert.equal(rayBox(new Vector3(0,1,8),new Vector3(0,0,-1),wall,3),null);
});
test('aimed rifle hits consume ammunition and headshots do double body damage',()=>{
 const body=setup();shoot(body);assert.equal(body.c.bots[0].hp,82);assert.equal(body.c.magazine,29);assert.equal(body.c.hits,1);
 const head=setup();tick(head,{firePressed:true,fireHeld:true,aim:true},1,{...sight,origin:new Vector3(0,1.65,10),muzzle:new Vector3(0,1.65,9)});
 assert.equal(head.c.bots[0].hp,64);assert.ok(head.c.headMarker);
});
test('walls block both reticle rays and a muzzle hidden behind a corner',()=>{
 const context=setup([wall]);shoot(context);assert.equal(context.c.bots[0].hp,100);
 // Reticle and target are visible along x=2, but the muzzle begins behind the wall.
 context.c.bots[0].actor.position.x=2;context.c.cooldown=0;
 tick(context,{firePressed:true,fireHeld:true,aim:true},1,{origin:new Vector3(2,1,10),direction:new Vector3(0,0,-1),muzzle:new Vector3(0,1,5)});
 assert.equal(context.c.bots[0].hp,100);assert.equal(context.c.shots,2);
});
test('automatic fire repeats while held; pistol and shotgun require a fresh trigger',()=>{
 for(const slot of [0,1,2]){
  const context=setup();context.c.selectGun(slot,context.p);tick(context,{},40);
  shoot(context);const start=context.c.shots;
  tick(context,{fireHeld:true,aim:true},120,sight);
  assert.equal(context.c.shots-start,slot===0?8:0);
  shoot(context);assert.ok(context.c.shots>=start+1);
 }
});
test('reload completes only after its timer and gun swaps cancel unfinished reloads with independent magazines',()=>{
 const context=setup(),{c,p}=context;shoot(context);c.reload();tick(context,{},60);assert.equal(c.magazine,29);
 c.selectGun(1,p);assert.equal(c.reloadLeft,0);tick(context,{},40);shoot(context);assert.equal(c.magazine,11);
 tick(context,{quickSwapPressed:true});assert.equal(c.selected,0);assert.equal(c.magazine,29);tick(context,{},30);
 tick(context,{reloadPressed:true});tick(context,{},180);assert.equal(c.magazine,30);
 c.selectGun(1,p);assert.equal(c.magazine,11);
});
test('empty automatic magazine triggers one reload and resumes when held; no shot occurs during swapping',()=>{
 const context=setup();context.c.ammo[0]=1;shoot(context);tick(context,{fireHeld:true},20,sight);
 assert.ok(context.c.reloadLeft>0);assert.equal(context.c.shots,1);
 tick(context,{fireHeld:true},200,sight);assert.ok(context.c.shots>1);
 context.c.selectGun(1,context.p);const previous=context.c.shots;shoot(context);assert.equal(context.c.shots,previous);
});
test('fire cancels a bullet jump pose without replenishing air resources or cancelling a new roll',()=>{
 const context=setup(),{p,c}=context;p.position.y=6;p.grounded=false;p.coyote=0;
 p.bulletTimer=.4;p.bulletUsed=true;p.doubleUsed=true;p.airRollUsed=true;
 shoot(context);assert.equal(p.bulletTimer,0);assert.ok(p.bulletUsed&&p.doubleUsed&&p.airRollUsed);assert.equal(c.shots,1);
 p.airRollUsed=false;c.cooldown=0;shoot(context,{rollPressed:true});assert.ok(p.rollTimer>0);assert.equal(c.shots,1);
});
test('a melee press beats held fire, cancels reload, and cannot be immediately replaced by the held trigger',()=>{
 const context=setup(),{p,c}=context;shoot(context);c.reload();
 tick(context,{meleePressed:true,meleeHeld:true,fireHeld:true});assert.equal(c.reloadLeft,0);assert.ok(p.melee.active);const shots=c.shots;
 tick(context,{meleeHeld:true,fireHeld:true},90);assert.equal(c.shots,shots);assert.ok(p.melee.drawn);
 tick(context,{});shoot(context);assert.equal(p.melee.drawn,false);assert.equal(c.shots,shots+1);
});
test('melee contact damages each opponent once per swing and respects intervening walls',()=>{
 for(const blocked of [false,true]){
  const context=setup(blocked?[{...wall,minZ:8.5,maxZ:8.6}]:[]);context.c.bots[0].actor.position.z=8;
  tick(context,{meleePressed:true});tick(context,{},42);
  assert.equal(context.c.bots[0].hp,blocked?100:68);
 }
});
test('a killed robot increments score once and respawns after six seconds',()=>{
 const context=setup(),{c}=context,b=c.bots[0];c.damageBot(b,110);c.damageBot(b,100);
 assert.equal(c.kills,1);assert.equal(b.alive,false);tick(context,{},650);assert.equal(b.alive,false);
 tick(context,{},75);assert.ok(b.alive);assert.equal(b.hp,100);
});
test('shields absorb first, regenerate after the delay, and lethal damage leads to a fresh spawn',()=>{
 const context=setup(),{p,c}=context;c.mode='battle';c.bots.forEach(b=>{b.alive=false;b.respawn=100;});c.spawnProtection=0;
 c.damagePlayer(90);assert.equal(c.shield,0);assert.equal(c.health,90);tick(context,{},470);assert.equal(c.shield,0);
 tick(context,{},40);assert.ok(c.shield>0);c.damagePlayer(200);assert.equal(c.alive,false);
 const serial=p.resetSerial;tick(context,{},301);assert.ok(c.alive);assert.equal(c.health,100);assert.equal(c.shield,80);assert.ok(p.resetSerial>serial);assert.equal(c.deaths,1);
});
test('spawn protection, stationary targets, and disabled bots cannot damage the player',()=>{
 const {c}=setup();c.mode='battle';c.damagePlayer(200);assert.equal(c.health,100);
 c.spawnProtection=0;for(const mode of ['targets','off']){c.setMode(mode);c.damagePlayer(200);assert.equal(c.shield,80);}
});
test('fast enemy projectiles use swept hits and cannot pass through walls',()=>{
 for(const blocked of [false,true]){
  const context=setup(blocked?[wall]:[]),{c,p}=context;c.mode='battle';c.spawnProtection=0;
  c.projectiles.push({position:new Vector3(0,1,0),velocity:new Vector3(0,0,23),life:3});c.updateProjectiles(.5,p);
  assert.equal(c.shield,blocked?80:70);assert.equal(c.projectiles.length,0);
 }
});
test('navigation routes around solid cover and battle robots acquire targets and fire visible projectiles',()=>{
 const nav=new ArenaNavigation({solids:[floor,wall]});const route=nav.path(new Vector3(0,0,0),new Vector3(0,0,10));
 assert.ok(route.length>5);assert.ok(route.some(n=>Math.abs(n.x)>=2));assert.ok(route.every(n=>nav.walkable(n.x,n.z)));
 const context=setup();context.c.mode='battle';tick(context,{},300);
 assert.ok(context.c.events.some(e=>e.type==='botShot'));assert.ok(context.c.bots[0].actor.position.distanceTo(new Vector3(0,0,0))>.5);
});
test('each firearm stays in both hands through aiming and reloads, with finite transforms after swaps',()=>{
 const {p,c}=setup(),character=createCharacter(new Scene());p.aiming=true;
 for(const gun of [0,1,2])for(const progress of [0,.2,.5,.8]){
  c.selected=gun;c.swapLeft=0;c.ammo[gun]=GUNS[gun].magazine-1;c.reloadLeft=progress?GUNS[gun].reload*(1-progress):0;
  for(let i=0;i<70;i++)character.update(p,1/60,i/60);
  const targets=character.firearm.update(p,1);character.root.updateWorldMatrix(true,true);
  for(const side of ['left','right']){
   const grip=targets[side+'Grip'].clone().applyMatrix4(character.weapon.matrixWorld),hand=character.joints[side+'Hand'].getWorldPosition(new Vector3());
   assert.ok(hand.distanceTo(grip)<.04,`${GUNS[gun].id} ${progress} ${side} grip ${hand.distanceTo(grip)}`);
  }
  assert.ok(Object.values(character.joints).every(j=>j.quaternion.toArray().every(Number.isFinite)));
 }
});

test('navigation edges reject a thin wall lying between otherwise clear grid nodes',()=>{
 const cover={...wall,minX:-5,maxX:5,minZ:4.9,maxZ:5.1};
 const nav=new ArenaNavigation({solids:[floor,cover]});
 assert.ok(nav.walkable(0,4)&&nav.walkable(0,6));assert.equal(nav.clearEdge({x:0,z:4},{x:0,z:6}),false);
 const route=nav.path(new Vector3(0,0,2),new Vector3(0,0,10));assert.ok(route.some(n=>Math.abs(n.x)>=6));
});
