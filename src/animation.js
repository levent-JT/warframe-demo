import { Spring, PoseBlender, angleDelta, clamp, smoothstep, solveLeg } from './motion-math.js';
import { ramps, rampHeight, solids } from './world.js';
import { applyMeleePose } from './melee-pose.js';

export const JOINTS = ['torso', 'head', 'leftArm', 'rightArm', 'leftElbow', 'rightElbow', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftKnee', 'rightKnee', 'leftFoot', 'rightFoot'];
const ANGLES = ['rigX', 'rigY', 'rigZ', ...JOINTS.flatMap(j => ['X', 'Y', 'Z'].map(axis => j + axis))];
export const POSE_KEYS = ['bodyX', 'bodyY', 'bodyZ', ...ANGLES];
const groundStates = new Set(['idle', 'run', 'sprint', 'crouch', 'hardLand', 'aim', 'aimWalk']);
const wallStates = new Set(['wallClimb', 'wallRun', 'latch', 'mantle']);

function supportHeight(x, z, feetY) {
  let height = -Infinity;
  for (const b of solids) {
    if (b.kind !== 'ramp-collider' && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= feetY + .42) height = Math.max(height, b.maxY);
  }
  for (const r of ramps) if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) height = Math.max(height, rampHeight(r, z));
  return Number.isFinite(height) ? clamp(height - feetY, -.24, .36) : 0;
}

export class CharacterAnimator {
  constructor() {
    this.blender = new PoseBlender(POSE_KEYS, ANGLES);
    this.target = Object.fromEntries(POSE_KEYS.map(k => [k, 0]));
    this.facing = new Spring(); this.speed = new Spring(); this.bank = new Spring();
    this.accelerationLean = new Spring(); this.landing = new Spring();
    this.aimWeight = new Spring();
    this.gunWeight = new Spring();
    this.meleeWeight = new Spring(); this.meleeSerial = -1;
    this.phase = 0; this.time = 0; this.stateTime = 0; this.state = null;
    this.previousSpeed = 0; this.previousFacing = 0; this.wasGrounded = true;
    this.resetSerial = -1; this.feet = [{ planted: false }, { planted: false }];
    this.previousPosition = null;
  }
  reset(player) {
    this.facing.reset(player.facing); this.speed.reset(player.speed); this.bank.reset(0);
    this.accelerationLean.reset(0); this.landing.reset(0);
    this.aimWeight.reset(0);
    this.gunWeight.reset(0);
    this.meleeWeight.reset(0); this.meleeSerial = -1;
    this.state = null; this.stateTime = 0; this.phase = 0;
    this.previousFacing = player.facing; this.previousSpeed = player.speed;
    this.wasGrounded = player.grounded; this.resetSerial = player.resetSerial;
    this.blender.initialized = false;
    this.previousPosition = player.position.clone();
    this.feet.forEach(f => { f.planted = false; });
  }
  update(p, dt, position = p.position) {
    if (p.resetSerial !== this.resetSerial || !this.blender.initialized) this.reset(p);
    if (dt <= 0 && this.blender.initialized) return this.blender.pose;
    const traveled = Math.hypot(position.x - this.previousPosition.x, position.z - this.previousPosition.z);
    this.previousPosition.copy(position);
    this.time += dt;
    let state = p.combat && !p.combat.alive ? 'down' : p.state;
    // Distinguish a low-ceiling crouch even if physics has just landed this tick.
    if (p.grounded && p.height < 1 && !['slide', 'roll'].includes(state)) state = 'crouch';
    const changed = state !== this.state;
    const meleeChanged = p.melee && p.melee.serial !== this.meleeSerial;
    if (changed || meleeChanged) {
      this.stateTime = 0;
      if (this.blender.initialized) this.blender.transition(meleeChanged ? .075 : state === 'glide' ? .07 : state === 'bullet' ? .10 : ['roll', 'airRoll', 'double'].includes(state) ? .12 : state === 'slide' ? .11 : .16);
      if (!(groundStates.has(state) && groundStates.has(this.state)) || this.state === 'idle' || state === 'crouch') this.feet.forEach(f => { f.planted = false; });
      this.state = state;
      this.meleeSerial = p.melee?.serial;
    } else this.stateTime += dt;

    const busy = ['bullet', 'double', 'roll', 'airRoll', 'wallClimb', 'wallRun', 'mantle', 'zipline'].includes(state);
    const meleePose = p.melee?.drawn && !busy;
    const meleeWeight = this.meleeWeight.step(meleePose ? 1 : 0, 36, dt);
    const gunHold = p.combat?.alive && !p.melee?.drawn && !busy && state !== 'slam';
    const aimPose = (p.aiming || gunHold && !p.combat.sprinting) && !p.melee?.active && !busy && state !== 'slam' && state !== 'down';
    const aimWeight = this.aimWeight.step(aimPose ? 1 : 0, aimPose ? 35 : 24, dt);
    this.gunWeight.step(gunHold || aimPose ? 1 : 0, 35, dt);
    let heading = p.speed > .4 ? Math.atan2(-p.velocity.x, -p.velocity.z) : this.facing.value;
    if (wallStates.has(state) && p.wall && state !== 'wallRun') heading = Math.atan2(p.wall.normal.x, p.wall.normal.z);
    if (state === 'glide' || state === 'latch' || aimPose) heading = p.yaw;
    if (p.melee?.active && !busy) heading = p.melee.active.yaw;
    this.facing.step(this.facing.value + angleDelta(this.facing.value, heading), 24, dt);
    const turnRate = dt > 0 ? angleDelta(this.previousFacing, this.facing.value) / dt : 0;
    this.bank.step(clamp(-turnRate * p.speed * .0045, -.24, .24), 14, dt);
    const speed = this.speed.step(p.speed, 22, dt);
    const acceleration = dt > 0 ? (speed - this.previousSpeed) / dt : 0;
    this.accelerationLean.step(clamp(-acceleration * .007, -.16, .10), 15, dt);
    if (p.grounded && !this.wasGrounded) this.landing.velocity = -clamp((p.lastImpact || 8) * .15, .5, 3);
    this.landing.step(0, 17, dt);
    this.previousSpeed = speed; this.previousFacing = this.facing.value; this.wasGrounded = p.grounded;
    const q = this.target;
    for (const key of POSE_KEYS) q[key] = 0;
    q.bodyY = -.09; q.leftArmZ = -.08; q.rightArmZ = .08;
    q.leftElbowX = q.rightElbowX = .18;
    const breathe = Math.sin(this.time * 2.1);
    q.torsoX = -.035 + breathe * .009; q.headX = -q.torsoX * .55;

    if (groundStates.has(state)) {
      const low = state === 'crouch', run = clamp(speed / 7, 0, 1);
      const sprint = clamp((speed - 7) / 6, 0, 1);
      const cycleDistance = low ? 1.9 : 2.4 + Math.min(speed, 14) * .20;
      this.phase += traveled / cycleDistance;
      const cycle = (this.phase % 1) * Math.PI * 2;
      const travelHeading = p.speed > .1 ? Math.atan2(-p.velocity.x, -p.velocity.z) : this.facing.value;
      const relativeTravel = angleDelta(this.facing.value, travelHeading);
      const forwardStride = 1 + (Math.cos(relativeTravel) - 1) * aimWeight;
      const sideStride = Math.sin(relativeTravel) * .72 * aimWeight;
      q.bodyY = (low ? -.67 : -.09 - run * .08) + Math.sin(cycle * 2 - .5) * .018 * run + this.landing.value;
      q.bodyX = Math.sin(cycle) * .020 * run + Math.sin(this.time*.8)*.006*(1-run);
      q.torsoX = (low ? -.93 : -.055 - run * .08 - sprint * .04) + this.accelerationLean.value + this.landing.value * 1.7;
      q.torsoY = Math.sin(cycle) * .09 * run; q.rigZ = this.bank.value;
      q.headX = -q.torsoX * .7; q.headY = -q.torsoY * .55;
      if (!run) q.bodyY += breathe * .006;
      for (const [index, side, sign] of [[0, 'left', -1], [1, 'right', 1]]) {
        const phase = (this.phase + index * .5) % 1;
        const duty = low ? .48 : clamp(.72 / cycleDistance, .14, .48);
        const stride = low ? .22 : .36;
        let footZ, lift = 0;
        if (phase < duty) footZ = -stride + 2 * stride * phase / duty;
        else {
          const swing = (phase - duty) / (1 - duty);
          footZ = stride - 2 * stride * smoothstep(swing);
          lift = Math.sin(Math.PI * swing) ** 2 * (low ? .08 : .13 + sprint * .15) * run;
        }
        if (speed < .1) { footZ = 0; lift = 0; }
        let footX = sign * .135 + footZ * sideStride, terrain = 0;
        footZ *= forwardStride;
        const lock = this.feet[index], yaw = this.facing.value, c = Math.cos(yaw), s = Math.sin(yaw);
        const contact = phase < duty || speed < .1;
        if (contact) {
          if (!lock.planted) {
            lock.x = position.x + c * footX + s * footZ;
            lock.z = position.z - s * footX + c * footZ;
            lock.y = position.y + supportHeight(lock.x, lock.z, position.y);
          }
          const dx = lock.x - position.x, dz = lock.z - position.z;
          const lockedZ = s * dx + c * dz;
          // Release overstretched contacts on fast turns/stops instead of dragging a leg.
          if (Math.abs(lockedZ) < .58 && Math.abs(c * dx - s * dz - footX) < .40) {
            footZ = lockedZ; footX = c * dx - s * dz;
            terrain = clamp(lock.y - position.y, -.22, .32);
            lock.planted = true;
          } else {
            lock.planted = false;
            terrain = supportHeight(position.x + c * footX + s * footZ, position.z - s * footX + c * footZ, position.y);
          }
        } else {
          lock.planted = false;
          terrain = supportHeight(position.x + c * footX + s * footZ, position.z - s * footX + c * footZ, position.y);
        }
        const down = 1.04 + q.bodyY - (.065 + lift + terrain), lateral = footX - sign * .135 - q.bodyX;
        const leg = solveLeg(Math.hypot(down, lateral), footZ);
        q[side + 'LegX'] = leg.hip; q[side + 'KneeX'] = leg.knee;
        q[side + 'LegZ'] = clamp(Math.atan2(lateral, down), -.5, .5) - q.rigZ;
        q[side + 'FootX'] = leg.ankle;
        q[side + 'ArmX'] = Math.sin(cycle + index * Math.PI) * (.55 + sprint * .18) * run;
        q[side + 'ElbowX'] = .22 + run * .85 + sprint * .15;
        q[side + 'ArmZ'] = sign * (.08 + sprint * .06);
      }
    } else if(state==='down') {
      q.bodyY=-.62;q.torsoX=-.6;q.headX=-.18;
      q.leftLegX=1.0;q.rightLegX=.3;q.leftKneeX=-2.4;q.rightKneeX=-2.2;
      q.leftArmX=.25;q.rightArmX=.4;q.leftElbowX=q.rightElbowX=.5;
    } else if (state === 'slide' || state === 'kick') {
      q.bodyY = state === 'slide' ? -.68 : -.3; q.torsoX = -1.02; q.headX = .68;
      const left = solveLeg(1.04 + q.bodyY - .065, -.65);
      const right = solveLeg(1.04 + q.bodyY - .065, .16);
      q.leftLegX = left.hip; q.leftKneeX = left.knee; q.leftFootX = left.ankle;
      q.rightLegX = right.hip; q.rightKneeX = right.knee; q.rightFootX = right.ankle;
      q.leftLegZ = -.1; q.rightLegZ = .16; q.rigZ = this.bank.value * .5;
      q.leftArmX = .8; q.leftElbowX = .8; q.rightArmX = -.5; q.rightElbowX = .4;
    } else if (state === 'bullet') {
      const t = clamp((.5 - p.bulletTimer) / .5, 0, 1);
      q.rigX = -Math.PI / 2 + Math.atan2(p.velocity.y, Math.max(1, p.speed));
      q.rigY = smoothstep(t) * Math.PI * 2; q.bodyY = -.05;
      q.leftArmX = 2.9; q.leftElbowX = .12; q.rightArmX = -.3; q.rightElbowX = .6;
      q.leftLegX = -.08; q.leftKneeX = -.15; q.rightLegX = .45; q.rightKneeX = -.8;
      q.torsoX = -.05; q.headX = .22;
    } else if (state === 'roll' || state === 'airRoll' || state === 'double') {
      const t = state === 'double' ? clamp(1 - p.doubleTimer / .42, 0, 1) : clamp(1 - p.rollTimer / .42, 0, 1);
      q.rigX = -Math.PI * 2 * smoothstep(t); q.bodyY = state === 'roll' ? -.25 : -.06;
      q.torsoX = -.8; q.headX = -.3;
      q.leftLegX = 1.7; q.rightLegX = 1.6; q.leftKneeX = q.rightKneeX = -2.4;
      q.leftArmX = q.rightArmX = 1.1; q.leftElbowX = q.rightElbowX = 1.65;
    } else if (state === 'glide') {
      q.torsoX = -.26; q.headX = .18; q.rigZ = this.bank.value * .5;
      q.leftArmX = 1.1; q.rightArmX = 1.35; q.leftElbowX = .95; q.rightElbowX = .8;
      q.leftArmY = -.3; q.rightArmY = .2;
      q.leftLegX = -.38; q.leftKneeX = -.8; q.rightLegX = .30; q.rightKneeX = -.25;
      q.bodyY = .04 + breathe * .012;
    } else if (wallStates.has(state)) {
      const cycle = p.clock * 15, latch = state === 'latch';
      q.torsoX = -.16; q.headX = .12;
      q.leftArmX = 2.45 + (latch ? 0 : Math.sin(cycle) * .35); q.rightArmX = 2.5 + (latch ? 0 : Math.sin(cycle + Math.PI) * .35);
      q.leftElbowX = .4; q.rightElbowX = .35;
      q.leftLegX = 1.05 + (latch ? 0 : Math.sin(cycle) * .4); q.rightLegX = .6 - (latch ? 0 : Math.sin(cycle) * .4);
      q.leftKneeX = -1.45; q.rightKneeX = -1.1;
      if (state === 'wallRun') {
        const normal = p.wall?.normal;
        const side = normal ? Math.cos(this.facing.value) * normal.x - Math.sin(this.facing.value) * normal.z : 1;
        q.rigZ = clamp(-side * .35, -.35, .35);
        q.leftArmX = 1.4; q.rightArmX = .8;
      }
      if (state === 'mantle') { q.torsoX = -.65; q.bodyY = -.18; q.leftLegX = 1.5; }
    } else if (state === 'zipline') {
      this.phase += speed * dt / 2.5;
      q.leftArmZ = -1.05; q.rightArmZ = 1.05; q.torsoZ = Math.sin(this.time * 2.7) * .035;
      q.leftLegX = .25 + Math.sin(this.phase * Math.PI * 2) * .4; q.rightLegX = .25 - Math.sin(this.phase * Math.PI * 2) * .4;
      q.leftKneeX = q.rightKneeX = -.4;
    } else if (state === 'slam') {
      q.torsoX = -.6; q.leftArmX = 2.8; q.rightArmX = 2.6; q.leftLegX = .9; q.leftKneeX = -1.4;
      q.rightLegX = -.2; q.rightKneeX = -.1;
    } else {
      const rising = clamp(p.velocity.y / 10, -1, 1);
      q.torsoX = -.08 - Math.max(0, rising) * .09; q.headX = .10;
      q.leftLegX = .35 + Math.max(0, rising) * .4; q.leftKneeX = -.85;
      q.rightLegX = -.20; q.rightKneeX = -.4;
      q.leftArmX = -.12; q.rightArmX = .25; q.leftArmZ = -.26; q.rightArmZ = .26;
      q.leftElbowX = q.rightElbowX = .55;
    }
    // Aim is an upper-body layer. Legs keep following the actual travel direction,
    // including sidestepping/backpedaling while the view and weapon stay on target.
    if (aimWeight > .001) {
      const twist = clamp(angleDelta(this.facing.value, p.yaw), -.8, .8);
      const aimPitch = Number.isFinite(p.pitch) ? p.pitch : 0;
      const chestPitch = (p.grounded && p.height < 1 ? -.70 : -.06) + aimPitch * .22;
      q.torsoX += (chestPitch - q.torsoX) * aimWeight;
      q.torsoY += (twist - q.torsoY) * aimWeight;
      q.headX += (clamp(aimPitch - q.torsoX, -.65, .8) - q.headX) * aimWeight;
      q.headY += (clamp(angleDelta(this.facing.value, p.yaw) - q.torsoY, -.55, .55) - q.headY) * aimWeight;
      q.leftArmX += (1.0 - q.leftArmX) * aimWeight; q.rightArmX += (.9 - q.rightArmX) * aimWeight;
      q.leftElbowX += (.7 - q.leftElbowX) * aimWeight; q.rightElbowX += (.8 - q.rightElbowX) * aimWeight;
      q.rigZ *= 1 - aimWeight * .8;
    }
    applyMeleePose(q, p.melee, meleeWeight, p.aiming, p);
    if(p.combat && p.combat.alive && !busy) {
      q.torsoX-=(p.combat.recoil||0)*.24;
      q.torsoZ+=Math.sin(this.time*4.5)*.004*aimWeight;
    }
    // Anatomical limits stop velocity extrapolation from inverting a knee.
    const pose = this.blender.update(q, dt);
    pose.leftKneeX = clamp(pose.leftKneeX, -2.8, -.015);
    pose.rightKneeX = clamp(pose.rightKneeX, -2.8, -.015);
    return pose;
  }
}
