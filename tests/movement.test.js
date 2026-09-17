import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementController, DEFAULTS } from '../src/movement.js';
import { solids, ramps, ziplines, spawns } from '../src/world.js';

const floor = { id: 'floor', minX: -100, maxX: 100, minY: -2, maxY: 0, minZ: -100, maxZ: 100 };
const wall = { id: 'wall', minX: 2, maxX: 3, minY: 0, maxY: 30, minZ: -50, maxZ: 50 };
const fixed = 1 / 120;
function make(extra = []) {
  const p = new MovementController({ solids: [floor, ...extra], ramps: [], ziplines: [] });
  p.reset({ x: 0, y: 0, z: 0 }); tick(p, {}, 3); p.events.length = 0; return p;
}
function tick(p, input, count = 1) {
  for (let n = 0; n < count; n++) p.step(fixed, { ...input, ...(n > 0 ? { jumpPressed: false, rollPressed: false, crouchPressed: false, interactPressed: false, slamPressed: false } : {}) });
}

test('sprint accelerates to configured speed and release brakes without drift', () => {
  const p = make(); tick(p, { z: 1, sprint: true }, 120);
  assert.ok(Math.abs(p.speed - DEFAULTS.sprintSpeed) < .01); assert.ok(p.position.z < -10);
  tick(p, {}, 120); assert.equal(p.speed, 0); assert.equal(p.position.y, 0); assert.equal(p.grounded, true);
});
test('diagonal movement has the same speed as straight movement', () => {
  const a = make(), b = make(); tick(a, { z: 1 }, 120); tick(b, { z: 1, x: 1 }, 120);
  assert.ok(Math.abs(a.speed - b.speed) < .01);
});
test('slide receives one boost and holds momentum across frames', () => {
  const p = make(); tick(p, { z: 1, sprint: true }, 50); const before = p.speed;
  tick(p, { z: 1, crouch: true, crouchPressed: true }); const boost = p.speed;
  assert.ok(boost > before + 4); tick(p, { crouch: true, z: 1 }, 20);
  assert.ok(p.speed < boost); assert.ok(p.speed > before); assert.equal(p.height, p.lowHeight);
});
test('bullet → double → air roll → aim glide is legal and preserves momentum', () => {
  const p = make(); tick(p, { crouch: true, jumpPressed: true, z: 1, pitch: .2 });
  assert.equal(p.bulletUsed, true); assert.equal(p.doubleUsed, false); assert.ok(p.speed > 20);
  tick(p, {}, 15); tick(p, { jumpPressed: true, z: 1 });
  assert.equal(p.doubleUsed, true); assert.ok(p.velocity.y > 9); assert.ok(p.speed > 20);
  tick(p, { rollPressed: true, z: 1 }); assert.equal(p.airRollUsed, true);
  tick(p, {}, 55); const glideBefore = p.glideLeft; tick(p, { aim: true }, 30);
  assert.equal(p.state, 'glide'); assert.ok(p.glideLeft < glideBefore); assert.ok(p.speed > 20);
});
test('jump limits prevent infinite midair jumping and rolling', () => {
  const p = make(); tick(p, { jumpPressed: true }); tick(p, {}, 6); tick(p, { jumpPressed: true });
  tick(p, {}, 10); const y = p.velocity.y; tick(p, { jumpPressed: true, crouch: true });
  assert.equal(p.bulletUsed, false); assert.ok(p.velocity.y < y);
  tick(p, { rollPressed: true }); tick(p, {}, 70); const before = p.speed;
  tick(p, { rollPressed: true }); assert.ok(p.speed <= before + .01);
});
test('midair bullet jump consumes the second jump slot', () => {
  const p = make(); tick(p, { jumpPressed: true }); tick(p, {}, 8);
  tick(p, { crouch: true, jumpPressed: true, pitch: .3 }); assert.ok(p.bulletUsed && p.doubleUsed);
  tick(p, {}, 4); const y = p.velocity.y; tick(p, { jumpPressed: true }); assert.ok(p.velocity.y < y);
});
test('camera pitch controls vertical and downward bullet jumps', () => {
  const p = make(); tick(p, { crouch: true, jumpPressed: true, pitch: 1.4 });
  assert.ok(p.velocity.y > 23); assert.ok(p.speed < 5);
  const q = make(); q.position.y = 12; q.grounded = false; q.coyote = 0;
  tick(q, { crouch: true, jumpPressed: true, pitch: -.8 }); assert.ok(q.velocity.y < -15);
});
test('standing cannot pass a tunnel; sliding can; standing up requires clearance', () => {
  const roof = { id: 'roof', minX: -3, maxX: 3, minY: 1.02, maxY: 3, minZ: -9, maxZ: -2 };
  const p = make([roof]); tick(p, { z: 1, sprint: true }, 60); assert.ok(p.position.z >= -1.681);
  tick(p, { z: 1, crouch: true, crouchPressed: true }, 24); assert.ok(p.position.z < -2.2);
  tick(p, {}); assert.equal(p.height, p.lowHeight);
  tick(p, { z: 1, crouch: true }, 350); tick(p, {}); assert.equal(p.height, p.standingHeight);
});
test('high-speed movement cannot tunnel through a thin wall', () => {
  const thin = { id: 'thin', minX: -10, maxX: 10, minY: 0, maxY: 30, minZ: -4.02, maxZ: -4 };
  const p = make([thin]); p.velocity.z = -38;
  tick(p, { crouch: true, z: 1 }, 80); assert.ok(p.position.z >= -3.681); assert.ok(p.position.z < -3.5);
});
test('wall climb restores aerial actions and gains height', () => {
  const p = make([wall]); p.position.set(1.66, 2, 0); p.grounded = false; p.coyote = 0;
  p.bulletUsed = true; p.doubleUsed = true; p.airRollUsed = true;
  tick(p, { x: 1, jumpHeld: true }, 90);
  assert.equal(p.state, 'wallClimb'); assert.ok(p.position.y > 7);
  assert.equal(p.bulletUsed, false); assert.equal(p.doubleUsed, false); assert.equal(p.airRollUsed, false);
  assert.ok(p.position.x <= 1.681);
});
test('horizontal wall dash moves along the surface', () => {
  const p = make([wall]); p.position.set(1.66, 5, 0); p.grounded = false; p.coyote = 0;
  tick(p, { z: 1, jumpHeld: true }, 80); assert.equal(p.state, 'wallRun'); assert.ok(p.position.z < -7);
});
test('wall latch is stationary, time-limited and can jump outward', () => {
  const p = make([wall]); p.position.set(1.66, 6, 0); p.grounded = false; p.coyote = 0;
  tick(p, { aim: true }, 120); assert.equal(p.state, 'latch'); assert.equal(p.position.y, 6);
  tick(p, { aim: true, jumpPressed: true }); assert.ok(p.velocity.x < -8); assert.ok(p.velocity.y > 0);
  const q = make([wall]); q.position.set(1.66, 10, 0); q.grounded = false; q.coyote = 0;
  tick(q, { aim: true }, 850); assert.ok(q.latchLeft <= .001); assert.ok(q.position.y < 10);
});
test('glide has a finite budget and does not recharge when aim is released', () => {
  const p = make(); p.position.y = 30; p.grounded = false; p.coyote = 0;
  tick(p, { aim: true }, Math.ceil(p.config.glideDuration / fixed) + 2); assert.equal(p.glideLeft, 0); assert.notEqual(p.state, 'glide');
  tick(p, {}, 10); tick(p, { aim: true }); assert.equal(p.glideLeft, 0);
});
test('ground contact resets aerial budgets and crouch cancels hard landing', () => {
  for (const crouch of [false, true]) {
    const p = make(); p.position.y = 15; p.velocity.y = -30; p.grounded = false; p.coyote = 0;
    p.bulletUsed = p.doubleUsed = p.airRollUsed = true;
    for (let n = 0; n < 100 && !p.grounded; n++) tick(p, { crouch });
    assert.ok(p.grounded); assert.ok(!p.bulletUsed && !p.doubleUsed && !p.airRollUsed);
    assert.equal(p.hardLandTimer > 0, !crouch);
  }
});
test('ledge mantle reaches a clear top and rejects a blocked destination', () => {
  const ledge = { id: 'ledge', minX: 2, maxX: 6, minY: 0, maxY: 3, minZ: -3, maxZ: 3 };
  const p = make([ledge]); p.position.set(1.66, 1.5, 0); p.grounded = false; p.coyote = 0;
  tick(p, { x: 1, jumpHeld: true }, 40); assert.ok(p.position.y >= 3); assert.ok(p.position.x > 2);
  const ceiling = { id: 'ceiling', minX: 2, maxX: 6, minY: 4, maxY: 5, minZ: -3, maxZ: 3 };
  const q = make([ledge, ceiling]); q.position.set(1.66, 1.5, 0); q.grounded = false; q.coyote = 0;
  tick(q, { x: 1, jumpHeld: true }); assert.equal(q.mantle, null);
});
test('zipline mounting, traversal, jump-off and remount use a real line', () => {
  const p = make(); p.world.ziplines = [{ a: { x: 0, y: 1, z: 0 }, b: { x: 20, y: 3, z: 0 } }];
  tick(p, { interactPressed: true }); assert.ok(p.rope);
  tick(p, { x: 1 }, 60); assert.ok(p.position.x > 3); assert.ok(p.position.y > 1);
  tick(p, { jumpPressed: true }); assert.equal(p.rope, null); assert.ok(p.velocity.y > 9);
});
test('slam descends and roll cancels it without granting an extra air roll', () => {
  const p = make(); p.position.y = 12; p.grounded = false; p.coyote = 0;
  tick(p, { slamPressed: true }); assert.equal(p.slam, true); assert.ok(p.velocity.y < -30);
  tick(p, { rollPressed: true }); assert.equal(p.slam, false); assert.equal(p.airRollUsed, true); assert.ok(p.velocity.y > 0);
});
test('real map spawns are valid, ramp is climbable and leaving the map resets safely', () => {
  const p = new MovementController({ solids, ramps, ziplines });
  for (const s of spawns) { p.reset(s); tick(p, {}, 8); assert.ok(p.canOccupy(p.position), s.name); assert.ok(p.grounded, s.name); }
  p.reset(spawns[5]); tick(p, { z: 1 }, 300); assert.ok(p.position.y > 4.5, `ramp height ${p.position.y}`);
  assert.equal(p.height, p.standingHeight, 'slopes must not force crouching');
  p.checkpoint = 1; p.position.y = -30; tick(p, {}); assert.ok(p.position.distanceTo({ x: -14, y: .03, z: 18 }) < .1);
});
test('equivalent wall-clock input is stable at different render frame rates', () => {
  const results = [30, 60, 144].map(fps => {
    const p = make(); let accumulator = 0;
    for (let f = 0; f < fps * 2; f++) {
      accumulator += 1 / fps;
      while (accumulator + 1e-9 >= fixed) { p.step(fixed, { z: 1, sprint: true }); accumulator -= fixed; }
    }
    return p.position.z;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-7);
});
test('holding toward a latched wall cannot cancel the outward jump impulse', () => {
  const p = make([wall]); p.position.set(1.66, 6, 0); p.grounded = false; p.coyote = 0;
  tick(p, { x: 1, aim: true }, 3); tick(p, { x: 1, aim: true, jumpPressed: true });
  tick(p, { x: 1, aim: true }, 8); assert.ok(p.velocity.x < -8); assert.ok(p.position.x < 1);
});
test('mantling clears the lip before moving the lower body across it', () => {
  const ledge = { id: 'ledge', minX: 2, maxX: 6, minY: 0, maxY: 3, minZ: -3, maxZ: 3 };
  const p = make([ledge]); p.position.set(1.66, 1.5, 0); p.grounded = false; p.coyote = 0;
  tick(p, { x: 1, jumpHeld: true });
  for (let i = 0; i < 34; i++) { tick(p, {}); assert.ok(p.canOccupy(p.position), `mantle intersection at step ${i}`); }
});
test('sliding downhill gains speed while sliding uphill loses speed', () => {
  const ramp = ramps[0];
  function slide(direction) {
    const p = new MovementController({ solids, ramps, ziplines });
    p.reset({ x: 26.5, y: 2.5, z: 0 }); p.grounded = true; p.velocity.z = direction * 10;
    tick(p, { crouch: true }, 30); return p.speed;
  }
  assert.ok(slide(1) > 10); assert.ok(slide(-1) < 10);
});

test('a second jump preserves the incoming horizontal direction while steering remains available', () => {
  const p = make(); p.position.y = 8; p.grounded = false; p.coyote = 0; p.velocity.set(0, -2, -24);
  tick(p, { x: 1, jumpPressed: true });
  assert.ok(p.velocity.z < -23.8 && p.velocity.x < .2);
  assert.ok(p.velocity.y > 9);
  tick(p, { x: 1 }, 30); assert.ok(p.velocity.x > 3, 'steering must still respond after the jump');
});

test('releasing slide or making a soft landing carries speed instead of immediately clamping to running speed', () => {
  const p = make(); p.velocity.z = -25;
  tick(p, { z: 1 }, 12); assert.ok(p.speed > 23);
  tick(p, {}, 60); assert.equal(p.speed, 0, 'release must still brake');
  const q = make(); q.position.y = .08; q.velocity.set(0, -2, -25); q.grounded = false; q.coyote = 0;
  tick(q, { z: 1 }, 20); assert.ok(q.grounded && q.speed > 24);
});

test('the crouch posture at the jump press survives release before the physics tick', () => {
  const p = make(); tick(p, { jumpPressed: true, jumpCrouch: true, crouch: false });
  assert.ok(p.bulletUsed && p.velocity.y > 10);
  const q = make(); tick(q, { jumpPressed: true, jumpCrouch: false, crouch: true });
  assert.equal(q.bulletUsed, false); assert.equal(q.action, 'jump');
});

test('mantles retain approach momentum and a newly pressed crouch cancels without reattaching', () => {
  const ledge = { id: 'ledge', minX: 2, maxX: 6, minY: 0, maxY: 3, minZ: -3, maxZ: 3 };
  function approachLedge() {
    const p = make([ledge]); p.position.set(1.66, 1.5, 0); p.velocity.set(8, 3, 0); p.grounded = false; p.coyote = 0;
    tick(p, { x: 1, jumpHeld: true }); assert.ok(p.mantle); return p;
  }
  const p = approachLedge();
  for (let i = 0; i < 40 && p.mantle; i++) tick(p, { x: 1 });
  assert.ok(p.grounded && p.velocity.x >= 7.9);
  const q = approachLedge(); tick(q, { crouch: true }, 2);
  assert.ok(q.mantle, 'held crouch is not a cancellation edge');
  tick(q, { crouch: true, crouchPressed: true }); assert.equal(q.mantle, null);
  tick(q, { x: 1, jumpHeld: true }, 6); assert.equal(q.mantle, null);
});
