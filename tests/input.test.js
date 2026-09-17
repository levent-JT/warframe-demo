import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionInput, mouseLook } from '../src/input.js';
import { MovementController } from '../src/movement.js';

test('a fast crouch-jump tap retains its input edge and posture after both keys are released', () => {
  const input = new ActionInput(); input.press('KeyC'); input.press('Space'); input.release('Space'); input.release('KeyC');
  const state = input.read(0, .3); assert.ok(state.jumpPressed && state.jumpCrouch && !state.crouch);
  input.consumeEdges(); assert.equal(input.read(0, .3).jumpPressed, false);
});
test('custom keyboard and mouse bindings operate actual movement through the same action map', () => {
  const input = new ActionInput(); assert.ok(input.bind('jump', 0, 'Mouse1').ok); assert.ok(input.bind('forward', 0, 'KeyI').ok);
  const p = new MovementController(); p.reset({x:0,y:0,z:25}); p.grounded=true;
  input.press('KeyI'); for(let i=0;i<60;i++){p.step(1/120,input.read(0,0));input.consumeEdges();}
  assert.ok(p.position.z<23);
  input.press('Mouse1'); p.step(1/120,input.read(0,0)); assert.ok(p.velocity.y>9);
  input.clear();input.press('Space');assert.equal(input.read(0,0).jumpPressed,false,'old key must stop firing');
});
test('primary binding conflicts swap instead of leaving an action inaccessible', () => {
  const input=new ActionInput();const result=input.bind('jump',0,'KeyQ');assert.ok(result.ok);
  input.press('Space');assert.ok(input.pressed('roll'));assert.equal(input.pressed('jump'),false);
  input.consumeEdges();input.press('KeyQ');assert.ok(input.pressed('jump'));
  assert.equal(input.bind('aim',1,'KeyQ').ok,false,'an empty alternate cannot steal a primary');
});
test('bindings round trip through persistent storage and malformed saves fall back safely', () => {
  const input=new ActionInput();input.bind('aim',0,'Mouse3');input.bind('crouch',1,'KeyZ');
  const restored=new ActionInput(input.serialize());restored.press('Mouse3');restored.press('KeyZ');
  assert.ok(restored.read(0,0).aim && restored.read(0,0).crouch);
  const invalid=new ActionInput('{bad json');assert.deepEqual(invalid.bindings.jump,['Space',null]);
  const duplicate=JSON.parse(input.serialize());duplicate.jump=['KeyW',null];assert.equal(restored.load(duplicate),false);
});
test('right modifiers work, optional sprint-tap rolls work, and clear prevents stuck buttons', () => {
  const input=new ActionInput();input.press('ControlRight');assert.ok(input.down('crouch'));input.release('ControlRight');
  input.press('ShiftRight',100);input.release('ShiftRight',180);assert.ok(input.pressed('roll'));
  input.clear();input.tapSprintRoll=false;input.press('ShiftLeft',200);input.release('ShiftLeft',250);assert.equal(input.pressed('roll'),false);
  input.press('Mouse2');input.clear();assert.equal(input.read(0,0).aim,false);
});
test('reserved keys cannot replace pause, reload, browser devtools, or an essential primary', () => {
  const input=new ActionInput();for(const code of ['Escape','F5','F11','F12','MetaLeft',null])assert.equal(input.bind('jump',0,code).ok,false);
  assert.ok(input.bind('aim',1,'KeyB').ok);assert.ok(input.bind('aim',1,null).ok);
});
test('mouse aim responds directly, supports multiplier and Y inversion, and clamps vertical look', () => {
  const normal=mouseLook(0,0,200,-100,.0022),ads=mouseLook(0,0,200,-100,.0022,.5);
  assert.equal(normal.yaw,-.44);assert.equal(normal.pitch,.22);assert.equal(ads.yaw,normal.yaw*.5);
  assert.equal(mouseLook(0,0,0,-100,.0022,1,true).pitch,-.22);
  assert.equal(mouseLook(0,0,0,-100000,.0022).pitch,1.5);
  assert.deepEqual(mouseLook(.7,.2,NaN,0,.0022),{yaw:.7,pitch:.2});
});

test('250 ms sprint gesture toggles once, survives release, and a second hold toggles off', () => {
  const input=new ActionInput();input.press('ShiftLeft',100);
  assert.equal(input.read(0,0,349).sprint,false);
  assert.equal(input.read(0,0,350).sprint,true);
  for(const time of [500,1200,3000])assert.equal(input.read(0,0,time).sprint,true);
  input.release('ShiftLeft',3100);assert.equal(input.pressed('roll'),false);assert.equal(input.read(0,0,3200).sprint,true);
  input.press('ShiftRight',4000);input.release('ShiftRight',4250);
  assert.equal(input.read(0,0,4300).sprint,false);assert.equal(input.pressed('roll'),false);
});

test('short sprint taps roll once without changing the sprint latch, and pause clears pending gestures', () => {
  const input=new ActionInput();input.press('ShiftLeft',0);input.release('ShiftLeft',300);input.consumeEdges();
  input.press('ShiftLeft',400);input.release('ShiftLeft',480);
  assert.ok(input.read(0,0,500).rollPressed);assert.ok(input.sprintToggled);input.consumeEdges();assert.equal(input.pressed('roll'),false);
  input.press('ShiftLeft',600);input.clear();input.release('ShiftLeft',900);
  assert.equal(input.pressed('roll'),false);assert.equal(input.read(0,0,1000).sprint,false);
});

test('combat control migration preserves unrelated custom keys and keeps every action uniquely reachable', () => {
  const input=new ActionInput();input.bind('forward',0,'KeyI');input.bind('sprint',0,'ControlLeft');input.bind('melee',0,'Mouse0');
  input.upgradeCombatControls();assert.equal(input.bindings.forward[0],'KeyI');
  for(const [id,code] of [['fire','Mouse0'],['sprint','ShiftLeft'],['reload','KeyR'],['melee','KeyE'],['reset','Backspace'],['gun1','Digit1'],['zone1','Numpad1']])assert.equal(input.bindings[id][0],code);
  const assigned=Object.values(input.bindings).flat().filter(Boolean);assert.equal(new Set(assigned).size,assigned.length);
  input.bind('fire',0,'Mouse3');input.press('Mouse3');assert.ok(input.read(0,0).firePressed&&input.read(0,0).fireHeld);
  input.release('Mouse3');assert.equal(input.read(0,0).fireHeld,false);
});
