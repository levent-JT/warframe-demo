import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3, Quaternion, Euler } from 'three';
import { createCharacter } from '../src/scene.js';
import { MovementController } from '../src/movement.js';
import { Spring, PoseBlender, RenderInterpolator, angleDelta } from '../src/motion-math.js';

const dt = 1 / 60;
function setup() {
  const player = new MovementController();
  player.reset({ x: 0, y: 0, z: 27 }); player.grounded = true;
  const scene = new Scene(), character = createCharacter(scene);
  character.update(player, 0, 0);
  return { player, scene, character };
}
function frame(context, input = {}) {
  const { player, character, scene } = context;
  player.step(dt / 2, input);
  player.step(dt / 2, { ...input, jumpPressed: false, crouchPressed: false, rollPressed: false });
  character.update(player, dt, player.clock); scene.updateMatrixWorld(true);
  return { ...character.animator.blender.pose };
}

test('damping is invariant to frame rate for a fixed target and keeps position continuous on reversal', () => {
  const outcomes = [30, 60, 144].map(fps => {
    const spring = new Spring(-2);
    for (let i = 0; i < fps; i++) spring.step(4, 12, 1 / fps);
    return spring.value;
  });
  assert.ok(Math.max(...outcomes) - Math.min(...outcomes) < 1e-12);
  const spring = new Spring(0); spring.step(1, 12, .1);
  const before = spring.value;
  assert.equal(spring.step(-1, 12, 0), before);
  assert.ok(Math.abs(spring.step(-1, 12, 1 / 144) - before) < .05);
});

test('canceling a pose preserves the displayed pose and converges to the new pose within the blend window', () => {
  const blend = new PoseBlender(['rotation', 'height'], ['rotation']);
  blend.reset({ rotation: 3.1, height: 0 });
  blend.update({ rotation: 3.13, height: -.02 }, dt);
  const before = { ...blend.pose };
  blend.transition(.12);
  assert.deepEqual(blend.update({ rotation: -3.1, height: -.6 }, dt), before);
  let previous = blend.pose.rotation;
  for (let i = 0; i < 15; i++) {
    const pose = blend.update({ rotation: -3.1, height: -.6 }, dt);
    assert.ok(Math.abs(pose.rotation - previous) < .1, 'must use the short angular path'); previous = pose.rotation;
  }
  assert.ok(Math.abs(angleDelta(blend.pose.rotation, -3.1)) < 1e-10);
  assert.equal(blend.pose.height, -.6);
});

test('120 Hz movement renders uniform displacement at 144 Hz and teleports discard old positions', () => {
  const current = new Vector3(), interpolator = new RenderInterpolator(current);
  let accumulator = 0, previous = 0;
  for (let i = 0; i < 144; i++) {
    accumulator += 1 / 144;
    while (accumulator + 1e-12 >= 1 / 120) {
      interpolator.capture(current); current.x += 12 / 120; accumulator -= 1 / 120;
    }
    const x = interpolator.sample(current, accumulator * 120).x;
    if (i > 2) assert.ok(Math.abs(x - previous - 12 / 144) < 1e-10);
    previous = x;
  }
  current.set(50, 8, -30); interpolator.reset(current);
  assert.deepEqual(interpolator.sample(current, .3).toArray(), [50, 8, -30]);
});

test('standing and crouching place both soles on the actual floor with anatomically flexed knees', () => {
  for (const input of [{}, { crouch: true }]) {
    const context = setup();
    for (let i = 0; i < 40; i++) frame(context, input);
    for (const side of ['left', 'right']) {
      const foot = context.character.joints[side + 'Foot'].getWorldPosition(new Vector3());
      assert.ok(Math.abs(foot.y - .065) < .006, `sole height ${foot.y - .065}`);
      assert.ok(context.character.joints[side + 'Knee'].rotation.x < 0, 'knee must fold backward');
    }
  }
});

test('steady sprint contacts stay planted without backwards knees or oversized first-step snaps', () => {
  const context = setup(); let contacts = 0, previous = { ...context.character.animator.blender.pose };
  for (let i = 0; i < 110; i++) {
    const pose = frame(context, { z: 1, sprint: true });
    for (const side of ['left', 'right']) {
      assert.ok(Math.abs(pose[side + 'LegX'] - previous[side + 'LegX']) < .55);
      assert.ok(pose[side + 'KneeX'] < 0);
    }
    if (i > 25) for (const [index, side] of ['left', 'right'].entries()) {
      const contact = context.character.animator.feet[index];
      if (!contact.planted) continue;
      const foot = context.character.joints[side + 'Foot'].getWorldPosition(new Vector3());
      assert.ok(Math.hypot(foot.x - contact.x, foot.z - contact.z, foot.y - .065 - contact.y) < .012);
      contacts++;
    }
    previous = pose;
  }
  assert.ok(contacts > 20);
});

test('run, slide, bullet, double, roll and glide can cancel each other with finite, continuous poses', () => {
  const context = setup(); let previous = { ...context.character.animator.blender.pose }, previousState = context.player.state;
  const encountered = new Set();
  for (let i = 0; i < 170; i++) {
    const input = i < 40 ? { z: 1, sprint: true } : i < 60 ? { z: 1, crouch: true, crouchPressed: i === 40 } :
      i < 75 ? { z: 1, jumpPressed: i === 60, jumpCrouch: i === 60 } :
      i < 92 ? { z: 1, jumpPressed: i === 75 } : i < 125 ? { z: 1, rollPressed: i === 92 } : { z: 1, aim: true };
    const pose = frame(context, input), state = context.character.animator.state;
    for (const value of Object.values(pose)) assert.ok(Number.isFinite(value));
    if (state !== previousState) {
      // Blending starts at the pose already displayed, including an interrupted spin.
      for (const key of Object.keys(pose)) assert.ok(Math.abs(pose[key] - previous[key]) < .02, `${previousState} → ${state}: ${key}`);
    }
    assert.ok(pose.leftKneeX < 0 && pose.rightKneeX < 0);
    previous = pose; previousState = state; encountered.add(state);
  }
  for (const state of ['sprint', 'slide', 'bullet', 'double', 'airRoll', 'glide']) assert.ok(encountered.has(state), state);
});

test('landing compresses then recovers, pausing freezes pose, and a reset clears residual momentum', () => {
  const context = setup(); const { player, character } = context;
  player.position.y = 2; player.velocity.y = -15; player.grounded = false;
  for (let i = 0; i < 30 && !player.grounded; i++) frame(context);
  for (let i = 0; i < 3; i++) frame(context);
  assert.ok(character.animator.landing.value < -.02);
  const before = { ...character.animator.blender.pose };
  character.update(player, 0, player.clock);
  assert.deepEqual(character.animator.blender.pose, before);
  for (let i = 0; i < 80; i++) frame(context);
  assert.ok(Math.abs(character.animator.landing.value) < .001);
  player.reset({ x: 2, y: 0, z: 25, yaw: Math.PI }); player.grounded = true;
  character.update(player, dt, player.clock);
  assert.ok(Math.abs(character.animator.facing.value - Math.PI) < 1e-9);
  assert.equal(character.animator.landing.value, 0);
});

test('aimed strafing keeps the body and weapon facing the view while the legs step laterally', () => {
  const context=setup();for(let i=0;i<80;i++)frame(context,{aim:true,x:1,yaw:.6,pitch:.4});
  const {character}=context,forward=new Vector3(0,0,-1).applyQuaternion(character.weapon.getWorldQuaternion(new Quaternion()));
  const expected=new Vector3(0,0,-1).applyEuler(new Euler(.4,.6,0,'YXZ'));
  assert.ok(forward.distanceTo(expected)<1e-5);
  assert.ok(Math.abs(angleDelta(character.animator.facing.value,.6))<.01);
  assert.ok(Math.abs(character.animator.blender.pose.leftLegZ)+Math.abs(character.animator.blender.pose.rightLegZ)>.03);
  for(const side of ['left','right']){
    const grip=side==='right'?new Vector3(0,-.085,.048):new Vector3(0,-.04,-.27);character.weapon.localToWorld(grip);
    const hand=character.joints[side+'Hand'].getWorldPosition(new Vector3());assert.ok(hand.distanceTo(grip)<.045,`${side} grip error ${hand.distanceTo(grip)}`);
  }
});

test('aiming through extreme pitch and rapid heading changes keeps every joint transform finite',()=>{
  const context=setup();for(const yaw of [0,2.9,-2.9,Math.PI/2])for(const pitch of [-1.5,0,1.5]){
    for(let i=0;i<25;i++)frame(context,{aim:true,yaw,pitch});
    for(const joint of Object.values(context.character.joints))assert.ok(joint.quaternion.toArray().every(Number.isFinite));
  }
});
