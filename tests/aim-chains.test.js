import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementController } from '../src/movement.js';
const floor={id:'floor',minX:-100,maxX:100,minZ:-100,maxZ:100,minY:-2,maxY:0};
const dt=1/120;
function make(){const p=new MovementController({solids:[floor],ramps:[],ziplines:[]});p.reset({x:0,y:0,z:0});p.grounded=true;return p;}
function tick(p,input={},count=1){for(let i=0;i<count;i++)p.step(dt,{...input,...(i?{aimPressed:false,jumpPressed:false,rollPressed:false,crouchPressed:false}:{})});}

test('tap aim permanently cancels a bullet spin without restoring jumps or redirecting momentum',()=>{
 const p=make();tick(p,{crouch:true,jumpPressed:true,pitch:.3});tick(p,{},7);const before=p.velocity.clone(),budget=p.glideLeft;
 tick(p,{aimPressed:true,aim:true,yaw:Math.PI/2});assert.equal(p.state,'glide');assert.equal(p.bulletTimer,0);assert.equal(p.lastCancel,'bullet');
 assert.equal(p.velocity.x,before.x);assert.equal(p.velocity.z,before.z);assert.ok(p.glideLeft<budget);
 tick(p,{});assert.notEqual(p.state,'bullet');assert.ok(p.bulletUsed);assert.equal(p.doubleUsed,false);
});
test('aim cancels the double-jump animation without granting a third jump',()=>{
 const p=make();tick(p,{jumpPressed:true});tick(p,{},10);tick(p,{jumpPressed:true});tick(p,{},4);
 tick(p,{aim:true,aimPressed:true});assert.equal(p.doubleTimer,0);assert.equal(p.lastCancel,'double');
 tick(p,{});const before=p.velocity.y;tick(p,{jumpPressed:true});assert.ok(p.velocity.y<before);assert.ok(p.doubleUsed);
});
test('new jump and roll commands beat held aim, including simultaneous double jump plus roll',()=>{
 const p=make();tick(p,{crouch:true,jumpPressed:true});tick(p,{},8);tick(p,{aim:true,aimPressed:true});
 tick(p,{aim:true,jumpPressed:true,rollPressed:true,z:1,yaw:-Math.PI/2});
 assert.ok(p.doubleUsed&&p.airRollUsed);assert.equal(p.state,'airRoll');assert.ok(p.velocity.x>20&&Math.abs(p.velocity.z)<.01);assert.ok(p.velocity.y>9);
 tick(p,{aim:true},55);assert.equal(p.state,'glide');
 const budget=p.glideLeft;tick(p,{aim:true,rollPressed:true});assert.equal(p.rollTimer,0);assert.ok(p.glideLeft<budget);
});
test('an ordinary jump can glide, turn the view, and spend the remaining jump on an airborne bullet jump',()=>{
 const p=make();tick(p,{jumpPressed:true});tick(p,{},12);tick(p,{aim:true,aimPressed:true});
 tick(p,{aim:true,jumpPressed:true,crouch:true,yaw:-Math.PI/2,pitch:.1});
 assert.equal(p.state,'bullet');assert.ok(p.bulletUsed&&p.doubleUsed);assert.ok(p.velocity.x>24&&Math.abs(p.velocity.z)<.01);
});
test('a new air kick can interrupt held glide, then glide resumes without reviving the old action',()=>{
 const p=make();p.position.y=12;p.grounded=false;tick(p,{aim:true});tick(p,{aim:true,crouch:true,crouchPressed:true});
 assert.equal(p.state,'kick');assert.ok(p.speed>2);
 tick(p,{aim:true},20);assert.equal(p.state,'glide');assert.equal(p.bulletTimer,0);
});
test('aim toggles do not reset the glide timer or cancel slam/roll action limits',()=>{
 const p=make();p.position.y=20;p.grounded=false;const initial=p.glideLeft;
 for(let i=0;i<20;i++){tick(p,{aim:true,aimPressed:true},4);tick(p,{},2);}
 assert.ok(Math.abs(p.glideLeft-(initial-80*dt))<1e-9);
 tick(p,{slamPressed:true});tick(p,{aim:true,aimPressed:true});assert.ok(p.slam&&p.velocity.y< -30);
 tick(p,{rollPressed:true,aim:true});assert.ok(!p.slam&&p.airRollUsed);tick(p,{aim:true,aimPressed:true});assert.equal(p.state,'airRoll');
});
test('ground aiming supports camera-relative strafing/backpedaling and suppresses sprint speed',()=>{
 const p=make();tick(p,{aim:true,sprint:true,x:1,yaw:0},120);assert.equal(p.state,'aimWalk');assert.ok(p.velocity.x>4.7&&p.speed<5);assert.equal(p.velocity.z,0);
 tick(p,{aim:true,z:-1},120);assert.ok(p.velocity.z>4.7&&Math.abs(p.velocity.x)<.01);
});

test('entering glide just before contact prevents a hard landing without needing to crouch',()=>{
 const p=make();p.position.y=.08;p.grounded=false;p.velocity.y=-30;
 tick(p,{aim:true,aimPressed:true});assert.ok(p.grounded);assert.equal(p.hardLandTimer,0);
});
