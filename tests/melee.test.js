import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MovementController } from '../src/movement.js';
import { MELEE_SETS } from '../src/melee.js';
import { createCharacter } from '../src/character.js';
import { ActionInput } from '../src/input.js';

const dt=1/120;
const floor={id:'floor',minX:-100,maxX:100,minZ:-100,maxZ:100,minY:-2,maxY:0};
function player(solids=[floor]){const p=new MovementController({solids,ramps:[],ziplines:[]});p.reset({x:0,y:0,z:0});p.grounded=true;return p;}
function tick(p,input={},frames=1){for(let i=0;i<frames;i++)p.step(dt,{...input,...(i?{meleePressed:false,heavyPressed:false,jumpPressed:false,rollPressed:false,aimPressed:false,switchWeaponPressed:false,slamPressed:false}:{})});}

test('a tap makes one attack, held input cycles all three stages, and a late tap buffers only one follow-up',()=>{
 const p=player();tick(p,{meleePressed:true});const first=p.melee.serial;tick(p,{},160);assert.equal(p.melee.active,null);assert.equal(p.melee.serial,first);
 const indices=[];for(let i=0;i<210;i++){tick(p,{meleeHeld:true});if(indices.at(-1)!==p.melee.active?.index)indices.push(p.melee.active?.index);}
 assert.deepEqual(indices.slice(0,4),[0,1,2,0]);
 p.reset({x:0,y:0,z:0});p.grounded=true;tick(p,{meleePressed:true});tick(p,{},39);tick(p,{meleePressed:true});tick(p,{},20);
 assert.equal(p.melee.active.index,1);tick(p,{},100);assert.equal(p.melee.active,null);
});
test('forward and aim modifiers choose a new branch at the next attack boundary',()=>{
 const p=player();tick(p,{meleeHeld:true},12);assert.equal(p.melee.active.branch,'neutral');
 tick(p,{meleeHeld:true,z:1,aim:true},58);assert.equal(p.melee.active.branch,'forwardTactical');assert.ok(p.position.z< -1);
 tick(p,{meleeHeld:true,aim:true},80);assert.equal(p.melee.active.branch,'tactical');
});
test('dodge and jump immediately cancel melee without held input re-starting behind the parkour action',()=>{
 const p=player();tick(p,{meleeHeld:true},20);tick(p,{meleeHeld:true,rollPressed:true});
 assert.equal(p.melee.active,null);assert.equal(p.state,'roll');tick(p,{meleeHeld:true},70);assert.equal(p.melee.active,null);
 tick(p,{});tick(p,{meleePressed:true});assert.ok(p.melee.active);tick(p,{jumpPressed:true});assert.equal(p.melee.active,null);assert.ok(!p.grounded&&p.velocity.y>9);
});
test('a fresh aim press exits quick melee and aerial melee never grants extra parkour resources',()=>{
 const p=player();tick(p,{crouch:true,jumpPressed:true,pitch:.3});tick(p,{},12);const before=p.velocity.clone();
 tick(p,{meleePressed:true});assert.equal(p.melee.active.branch,'aerial');assert.equal(p.bulletTimer,0);assert.equal(p.velocity.x,before.x);assert.equal(p.velocity.z,before.z);
 tick(p,{aimPressed:true,aim:true});assert.equal(p.melee.active,null);assert.equal(p.state,'glide');assert.equal(p.melee.drawn,false);assert.ok(p.bulletUsed&&!p.doubleUsed);
});
test('sliding selects a spin, looking down selects a slam, and heavy input works on ground and in the air',()=>{
 const p=player();p.velocity.z=-14;tick(p,{crouch:true,meleePressed:true});assert.equal(p.melee.active.branch,'slide');assert.equal(p.state,'slide');
 p.reset({x:0,y:0,z:0});p.grounded=true;tick(p,{heavyPressed:true});assert.equal(p.melee.active.branch,'heavy');tick(p,{},150);assert.equal(p.melee.active,null);
 p.position.y=4;p.grounded=false;p.coyote=0;tick(p,{meleePressed:true,pitch:-1});assert.equal(p.melee.active.branch,'slam');assert.ok(p.slam&&p.velocity.y< -25);
 tick(p,{},75);assert.ok(p.grounded);assert.equal(p.melee.impactSerial,1);assert.equal(p.melee.active,null);
 p.position.y=4;p.grounded=false;p.coyote=0;tick(p,{heavyPressed:true,pitch:.4});assert.equal(p.melee.active.branch,'slam');assert.ok(p.melee.active.heavy);
 tick(p,{rollPressed:true});assert.ok(!p.slam);assert.equal(p.melee.active,null);
});
test('aim, unavailable air actions, and weapon switching preserve an ongoing slam until real landing',()=>{
 const p=player();p.position.y=20;p.grounded=false;p.coyote=0;p.doubleUsed=true;p.airRollUsed=true;
 tick(p,{heavyPressed:true});const serial=p.melee.impactSerial;
 tick(p,{aimPressed:true,aim:true});assert.ok(p.slam);assert.equal(p.melee.active.branch,'slam');
 tick(p,{rollPressed:true});tick(p,{jumpPressed:true});assert.ok(p.slam);assert.equal(p.melee.active.stage,'fall');
 tick(p,{switchWeaponPressed:true});assert.equal(p.melee.weapon,'sword');assert.equal(p.melee.active.weapon,'sword');assert.equal(p.melee.active.branch,'slam');assert.equal(p.melee.impactSerial,serial);
 tick(p,{},72);assert.ok(p.grounded);assert.equal(p.melee.impactSerial,serial+1);
});
test('aimed melee slams follow the downward view while direct slam keeps its original steep trajectory',()=>{
 for(const pitch of [-.8,-1.4]){
  const p=player();p.position.y=15;p.grounded=false;p.coyote=0;
  tick(p,{meleePressed:true,pitch,yaw:Math.PI/2});
  assert.ok(p.slam);assert.ok(p.velocity.x<0);assert.ok(Math.abs(p.velocity.z)<1e-5);
  assert.ok(Math.abs(p.speed-Math.cos(pitch)*35)<.01);
 }
 const p=player();p.position.y=15;p.grounded=false;p.coyote=0;tick(p,{slamPressed:true,pitch:-.8});assert.equal(p.speed,7);assert.ok(p.velocity.y< -34);
});
test('lunges are resolved through world collision, including a thin wall',()=>{
 const wall={id:'wall',minX:-4,maxX:4,minZ:-1.6,maxZ:-1.5,minY:0,maxY:5};
 const p=player([floor,wall]);tick(p,{z:1,aim:true,meleeHeld:true},180);assert.ok(p.position.z>=-1.5+p.radius-1e-4);
});
test('switching weapon cancels the old combo and reset keeps weapon selection but clears action state',()=>{
 const p=player();tick(p,{meleeHeld:true},10);tick(p,{switchWeaponPressed:true,meleeHeld:true});assert.equal(p.melee.weapon,'sword');assert.equal(p.melee.active,null);
 tick(p,{meleeHeld:true},15);assert.equal(p.melee.active,null);tick(p,{});tick(p,{meleePressed:true});assert.equal(p.melee.active.move.name,'斜斩');
 p.reset();assert.equal(p.melee.weapon,'sword');assert.equal(p.melee.active,null);assert.equal(p.melee.drawn,false);
});
test('old custom bindings survive new melee actions even when their default keys are occupied',()=>{
 const saved=JSON.parse(new ActionInput().serialize());
 for(const id of ['melee','heavy','switchWeapon','fire','reload','quickSwap','nextGun','prevGun','gun1','gun2','gun3'])delete saved[id];
 saved.slam=['KeyE',null];saved.jump=['KeyF',null];saved.aim=['Mouse1',null];
 const input=new ActionInput(saved);assert.deepEqual(input.bindings.slam,['KeyE',null]);assert.deepEqual(input.bindings.jump,['KeyF',null]);assert.deepEqual(input.bindings.aim,['Mouse1',null]);
 const keys=Object.values(input.bindings).flat().filter(Boolean);assert.equal(new Set(keys).size,keys.length);
 input.press(input.bindings.melee[0]);assert.ok(input.read(0,0).meleePressed);
});
test('both weapon grips track the articulated hands throughout their authored strikes',()=>{
 const p=player(),character=createCharacter(new THREE.Scene());let worst=0;
 for(const kind of ['staff','sword'])for(const branch of ['neutral','tactical','heavy'])for(let index=0;index<MELEE_SETS[kind][branch].length;index++)for(const progress of [.1,.3,.5,.7,.9]){
  p.reset({x:0,y:0,z:0});p.grounded=true;p.melee.weapon=kind;p.melee.lastBranch=branch;p.melee.chainAge=0;p.melee.nextIndex=index;p.melee.start(branch,{},p);
  p.melee.active.elapsed=p.melee.active.move.duration*progress;
  for(let i=0;i<65;i++)character.update(p,dt,i*dt);
  character.root.updateWorldMatrix(true,true);const model=character.meleeVisual.models[kind];
  for(const side of kind==='staff'?['left','right']:['right']){
   const grip=new THREE.Vector3(kind==='staff'?(side==='left'?-.22:.22):0,kind==='staff'?0:-.025,0).applyMatrix4(model.matrixWorld);
   const hand=character.joints[side+'Hand'].getWorldPosition(new THREE.Vector3());worst=Math.max(worst,hand.distanceTo(grip));
  }
  assert.ok(Object.values(character.animator.blender.pose).every(Number.isFinite));
 }
 assert.ok(worst<.025,`largest hand-to-grip distance: ${worst}`);
});
test('melee visuals pause without advancing weapon poses or trails, and resume after a cancel without a root teleport',()=>{
 const p=player(),character=createCharacter(new THREE.Scene());tick(p,{meleePressed:true});
 for(let i=0;i<32;i++){tick(p,{});character.update(p,dt,i*dt);}
 const before=character.meleeVisual.models.staff.matrixWorld.clone();for(let i=0;i<5;i++)character.update(p,0,1);
 assert.deepEqual(character.meleeVisual.models.staff.matrixWorld.elements,before.elements);
 const pos=p.position.clone();tick(p,{rollPressed:true});character.update(p,dt,1);assert.ok(character.root.position.distanceTo(pos)<.2);
 assert.ok(Object.values(character.animator.blender.pose).every(Number.isFinite));
});
