import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { MovementController } from '../src/movement.js';
import { createCharacter } from '../src/character.js';
import { CombatController } from '../src/combat.js';
import { ViewSample } from '../src/view.js';
import { ActionInput } from '../src/input.js';

const dt = 1 / 120;
const floor = { id:'floor', minX:-100,maxX:100,minZ:-100,maxZ:100,minY:-2,maxY:0 };
function make() {
  const p = new MovementController({ solids:[floor], ramps:[], ziplines:[] });
  p.reset({ x:0,y:0,z:0 }); p.grounded=true; p.events.length=0; return p;
}
function advance(p, input, ticks) { for(let i=0;i<ticks;i++)p.step(dt,input); }

test('sprint starts in 150 ms, releases within 750 mm, and reverses decisively in 200 ms', t => {
  const p=make();let ticks=0;
  while(p.speed<12.49&&ticks<120){p.step(dt,{z:1,sprint:true});ticks++;}
  assert.ok(ticks*dt<=.15, `start ${ticks*dt}`);
  const from=p.position.z;let stop=0;
  while(p.speed>.001&&stop<120){p.step(dt,{});stop++;}
  const stoppingDistance=Math.abs(p.position.z-from);
  assert.ok(stoppingDistance<.75);assert.ok(stop*dt<=.12);
  advance(p,{z:1,sprint:true},30);advance(p,{z:-1,sprint:true},24);
  assert.ok(p.velocity.z>9, `reverse speed ${p.velocity.z}`);
  t.diagnostic(`start ${(ticks*dt*1000).toFixed(1)} ms; stop ${(stop*dt*1000).toFixed(1)} ms / ${stoppingDistance.toFixed(3)} m; reverse ${p.velocity.z.toFixed(2)} m/s`);
});

test('aiming brakes to the strafe speed within 75 ms without destroying slide exit momentum',()=>{
  const p=make();advance(p,{z:1,sprint:true},30);advance(p,{z:1,sprint:true,aim:true},9);
  assert.ok(Math.abs(p.speed-p.config.aimSpeed)<.001);
  p.velocity.z=-25;advance(p,{z:1},12);assert.ok(p.speed>23);
});

test('ground acceleration has equal strength along axes and diagonals at every tick',()=>{
  const a=make(),b=make();
  for(let i=0;i<30;i++){a.step(dt,{z:1,sprint:true});b.step(dt,{z:1,x:1,sprint:true});assert.ok(Math.abs(a.speed-b.speed)<1e-9);}
});

test('air steering preserves fast momentum, has no world-axis bias, and does not react to looking alone',()=>{
  const a=make(),b=make();
  for(const p of [a,b]){p.position.y=15;p.grounded=false;p.coyote=0;}
  a.velocity.set(0,0,-24);b.velocity.set(-24,0,0);
  advance(a,{x:1},30);advance(b,{x:1,yaw:Math.PI/2},30);
  assert.ok(Math.abs(a.speed-24)<1e-9&&Math.abs(b.speed-24)<1e-9);
  assert.ok(a.velocity.x>3.5&&a.velocity.z<-23);
  assert.ok(Math.abs(a.velocity.x+b.velocity.z)<1e-9&&Math.abs(a.velocity.z-b.velocity.x)<1e-9);
  const before=a.velocity.clone();advance(a,{yaw:2,pitch:.5},20);
  assert.equal(a.velocity.x,before.x);assert.equal(a.velocity.z,before.z);
});

test('early roll survives cooldown and keeps its pressed direction after the keys are released',()=>{
  const p=make();p.rollCooldown=.09;p.step(dt,{x:1,rollPressed:true});
  assert.equal(p.rollTimer,0);advance(p,{yaw:Math.PI},13);
  assert.ok(p.rollTimer>0&&p.velocity.x>17&&Math.abs(p.velocity.z)<1e-9);
  assert.equal(p.events.filter(e=>e.name==='roll').length,1);assert.equal(p.rollBuffer,0);
});

test('both direct roll and short Shift preserve a directional chord released before the physics tick',()=>{
  for(const key of ['KeyQ','ShiftLeft']){
    const p=make(),input=new ActionInput();input.tapSprintRoll=true;p.rollCooldown=.07;
    input.press('KeyD',0);input.press(key,1);input.release('KeyD',30);input.release(key,40);
    p.step(dt,input.read(0,0,40));input.consumeEdges();advance(p,input.read(0,0,40),12);
    assert.ok(p.velocity.x>17&&Math.abs(p.velocity.z)<1e-9);
  }
});

test('a spent airborne roll can buffer into actual landing without hard-landing lock or extra air resources',()=>{
  const p=make();p.position.y=.2;p.velocity.y=-30;p.grounded=false;p.coyote=0;p.airRollUsed=true;
  p.step(dt,{rollPressed:true,z:1});assert.equal(p.rollTimer,0);assert.ok(p.grounded);
  p.step(dt,{});assert.ok(p.rollTimer>0&&p.hardLandTimer===0);assert.equal(p.action,'roll');
});

test('expired roll buffers, replacement inputs and resets never replay an unwanted dodge',()=>{
  for(const action of ['expiry','jump','reset']){
    const p=make();p.position.y=15;p.grounded=false;p.coyote=0;p.airRollUsed=true;
    p.step(dt,{rollPressed:true});
    if(action==='expiry')advance(p,{},20);
    if(action==='jump')p.step(dt,{jumpPressed:true});
    if(action==='reset')p.reset({x:0,y:0,z:0});
    assert.equal(p.rollBuffer,0);p.position.y=0;p.grounded=true;p.velocity.set(0,0,0);p.step(dt,{});
    assert.equal(p.rollTimer,0);
  }
});

test('an early crouch jump retains its chord through touchdown and launches once',()=>{
  const p=make();p.position.y=.20;p.velocity.y=-6;p.grounded=false;p.coyote=0;p.bulletUsed=p.doubleUsed=true;
  p.step(dt,{jumpPressed:true,jumpCrouch:true});advance(p,{},6);
  assert.equal(p.action,'bullet');assert.ok(p.velocity.y>9&&p.bulletUsed);assert.equal(p.jumpBuffer,0);
  assert.equal(p.events.filter(e=>e.name==='bullet').length,1);
});

test('view samples turn immediately, keep shoulder offsets and clip against new-view obstacles',()=>{
  const view=new ViewSample(),position=new Vector3(0,0,0),options={yaw:0,pitch:0,height:1.4,distance:3.4,shoulder:.65};
  view.sample(position,options);assert.ok(view.direction.distanceTo(new Vector3(0,0,-1))<1e-9);
  view.sample(position,{...options,yaw:Math.PI/2});assert.ok(view.direction.x<-.999&&Math.abs(view.origin.z+.65)<1e-9);
  const wall=new Mesh(new BoxGeometry(.2,5,6),new MeshBasicMaterial());wall.position.x=2;wall.updateMatrixWorld();
  view.sample(position,{...options,yaw:Math.PI/2},[wall]);assert.ok(view.origin.x<1.9&&view.origin.x>1.4);
});

test('shot muzzle follows an immediate view turn, translation and gun swap without rendering again',()=>{
  const p=make(),c=new CombatController(p.world),character=createCharacter(new Scene());p.combat=c;
  p.aiming=true;for(let i=0;i<90;i++)character.update(p,dt,i*dt);
  const origin=character.sampleMuzzle(p),rendered=character.firearm.muzzle.clone();
  assert.ok(origin.distanceTo(rendered)<.02);
  p.yaw=Math.PI/2;p.position.x+=3;const turned=character.sampleMuzzle(p);
  assert.ok(turned.x>2&&turned.x<2.4);assert.ok(Math.abs(turned.z+.16)<.02);
  c.selected=1;const pistol=character.sampleMuzzle(p);assert.ok(pistol.x>turned.x+.30);
  p.pitch=1.1;assert.ok(character.sampleMuzzle(p).y>pistol.y+.20);
});

test('combat samples the latest view only when an eligible shot actually fires',()=>{
  const p=make(),c=new CombatController(p.world);c.setMode('off');let samples=0;
  const aim=()=>{samples++;return {origin:new Vector3(0,1,0),direction:new Vector3(-1,0,0),muzzle:new Vector3(-.6,1,0)};};
  c.step(dt,{},p,aim);assert.equal(samples,0);
  c.step(dt,{firePressed:true},p,aim);assert.equal(samples,1);
  const tracer=c.events.find(e=>e.type==='tracer');assert.ok(tracer.to.x<-100);
  c.step(dt,{firePressed:true},p,aim);assert.equal(samples,1);
});
