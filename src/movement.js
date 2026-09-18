import { Vector3 } from 'three';
import { solids, ramps, rampHeight, ziplines, spawns } from './world.js';
import { MeleeController } from './melee.js';

export const DEFAULTS = Object.freeze({
  runSpeed: 7.6, sprintSpeed: 12.5, crouchSpeed: 3.2, aimSpeed: 4.8, acceleration: 88,
  braking: 115, turnAcceleration: 140, inputBuffer: .14,
  airAcceleration: 15, airTurnRate: 2.6, gravity: 25, jumpSpeed: 10.3, doubleJumpSpeed: 9.8,
  bulletSpeed: 25, slideBoost: 4.8, slideFriction: 3.4,
  rollSpeed: 17.5, glideDuration: 3, latchDuration: 6, wallUpSpeed: 8.3,
});
export const LABELS = {
  idle: '待机', run: '奔跑', sprint: '冲刺', crouch: '蹲行', slide: '滑铲',
  jump: '跳跃', double: '二段跳', bullet: '子弹跳', fall: '下落',
  roll: '翻滚', airRoll: '空中翻滚', glide: '瞄准滑翔', kick: '空中滑踢',
  wallRun: '横向蹬墙', wallClimb: '纵向蹬墙', wallJump: '蹬墙跳离',
  latch: '壁面攀附', mantle: '攀越边缘', zipline: '绳索平衡',
  slam: '俯冲落地', hardLand: '重落地', land: '着陆', reset: '返回检查点',
  aim: '瞄准', aimWalk: '瞄准移动', aimCancel: '瞄准取消',
  meleeAttack: '近战挥击', heavyAttack: '近战重击', meleeSlam: '近战下砸', meleeImpact: '下砸着地', weaponSwap: '切换武器',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (a, b, d) => a < b ? Math.min(a + d, b) : Math.max(a - d, b);
const EPS = .0001;

export class MovementController {
  constructor(world = { solids, ramps, ziplines }, config = {}) {
    this.world = world; this.config = { ...DEFAULTS, ...config };
    this.position = new Vector3(); this.velocity = new Vector3();
    this.radius = .32; this.standingHeight = 1.85; this.lowHeight = .88;
    this.events = []; this.clock = 0; this.checkpoint = 0; this.melee = new MeleeController(); this.reset();
  }
  reset(spawn = spawns[this.checkpoint]) {
    this.resetSerial = (this.resetSerial || 0) + 1;
    this.position.set(spawn.x, spawn.y, spawn.z); this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw || 0; this.pitch = 0; this.facing = this.yaw; this.height = this.standingHeight;
    this.grounded = false; this.state = 'idle'; this.action = 'idle'; this.actionTime = 0;
    this.rollTimer = 0; this.rollCooldown = 0; this.bulletTimer = 0; this.doubleTimer = 0; this.aimSuppressTimer = 0;
    this.slideTimer = 0; this.slideCooldown = 0; this.airKickCooldown = 0;
    this.hardLandTimer = 0; this.wallCooldown = 0; this.wallHopTimer = 0;
    this.wall = null; this.mantle = null; this.rope = null; this.coyote = 0;
    this.jumpBuffer = 0; this.rollBuffer = 0; this.rollIntent = new Vector3();
    this.bufferedCrouch = false; this.slam = false; this.latchWallId = null;
    this.lastImpact = 0; this.aiming = false; this.carryTimer = 0; this.lastCancel = null;
    this.melee.reset();
    this.refreshAir(true); this.emit('reset');
  }
  refreshAir(full = false) {
    this.bulletUsed = false; this.doubleUsed = false; this.airRollUsed = false;
    this.glideLeft = this.config.glideDuration;
    if (full) { this.latchLeft = this.config.latchDuration; this.latchWallId = null; }
  }
  emit(name) {
    this.action = name; this.actionTime = 0;
    this.events.push({ name, time: this.clock });
    if (this.events.length > 40) this.events.shift();
  }
  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }
  canOccupy(p, height = this.height) {
    return !this.world.solids.some(b => p.x + this.radius > b.minX + EPS && p.x - this.radius < b.maxX - EPS &&
      p.z + this.radius > b.minZ + EPS && p.z - this.radius < b.maxZ - EPS &&
      p.y + height > b.minY + EPS && p.y < b.maxY - EPS);
  }
  canStand() {
    // Test only the newly expanded head/torso volume, not the feet on a slope.
    const upper = this.position.clone(); upper.y += this.lowHeight;
    return this.canOccupy(upper, this.standingHeight - this.lowHeight);
  }
  findWall() {
    const p = this.position, reach = this.radius + .20;
    let nearest = null;
    for (const b of this.world.solids) {
      if (p.y + this.height < b.minY + .2 || p.y > b.maxY - .25) continue;
      const faces = [];
      if (p.z > b.minZ - .1 && p.z < b.maxZ + .1) {
        faces.push([Math.abs(p.x - b.minX), new Vector3(-1, 0, 0), p.x <= b.minX]);
        faces.push([Math.abs(p.x - b.maxX), new Vector3(1, 0, 0), p.x >= b.maxX]);
      }
      if (p.x > b.minX - .1 && p.x < b.maxX + .1) {
        faces.push([Math.abs(p.z - b.minZ), new Vector3(0, 0, -1), p.z <= b.minZ]);
        faces.push([Math.abs(p.z - b.maxZ), new Vector3(0, 0, 1), p.z >= b.maxZ]);
      }
      for (const [distance, normal, outside] of faces) {
        if (outside && distance < reach && (!nearest || distance < nearest.distance)) nearest = { b, normal, distance };
      }
    }
    return nearest;
  }
  nearestRope() {
    let best = null;
    for (const line of this.world.ziplines) {
      const a = new Vector3(line.a.x, line.a.y, line.a.z), b = new Vector3(line.b.x, line.b.y, line.b.z);
      const delta = b.clone().sub(a), length = delta.length();
      const t = clamp(this.position.clone().sub(a).dot(delta) / (length * length), 0, 1);
      const point = a.clone().addScaledVector(delta, t);
      const distance = point.distanceTo(this.position.clone().add(new Vector3(0, .6, 0)));
      if (distance < 2 && (!best || distance < best.distance)) best = { a, delta, length, t, distance };
    }
    return best;
  }
  startMantle(wall) {
    const top = wall.b.maxY, p = this.position;
    if (top - p.y < .35 || top - p.y > this.height + .3 || this.velocity.y < -13) return false;
    const target = p.clone().addScaledVector(wall.normal, -(.85)); target.y = top + .015;
    if (!this.canOccupy(target, this.standingHeight)) return false;
    this.mantle = { from: p.clone(), to: target, elapsed: 0, duration: clamp(.28 - this.speed * .004, .20, .28),
      exitVelocity: this.velocity.clone().setY(0) };
    this.velocity.set(0, 0, 0); this.emit('mantle'); return true;
  }
  step(dt, input = {}) {
    if (!(dt > 0) || dt > .05) throw new Error('Movement requires fixed steps <= 50 ms');
    const cfg = this.config, p = this.position, v = this.velocity;
    this.clock += dt; this.actionTime += dt;
    for (const key of ['rollTimer', 'rollCooldown', 'bulletTimer', 'doubleTimer', 'aimSuppressTimer', 'slideTimer', 'slideCooldown', 'airKickCooldown', 'hardLandTimer', 'wallCooldown', 'wallHopTimer', 'jumpBuffer', 'rollBuffer', 'carryTimer']) this[key] = Math.max(0, this[key] - dt);
    this.yaw = input.yaw ?? this.yaw;
    this.pitch = input.pitch ?? this.pitch;
    input = this.melee.step(dt, input, this);
    const aimPressed = input.aimPressed || (input.aim && !this.aiming);
    const wantsAim = !!(input.aim || input.aimPressed);
    this.aiming = wantsAim;
    if (aimPressed) this.aimSuppressTimer = 0;
    let startedParkour = false, startedRoll = false;
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = forward.clone().multiplyScalar(input.z || 0).addScaledVector(right, input.x || 0);
    if (wish.lengthSq() > 1) wish.normalize();
    const moving = wish.lengthSq() > .001, direction = moving ? wish.clone().normalize() : forward;
    const crouching = !!input.crouch;
    if (input.jumpPressed) { this.jumpBuffer = cfg.inputBuffer; this.bufferedCrouch = input.jumpCrouch ?? crouching; }
    if (input.rollPressed) {
      this.rollBuffer = cfg.inputBuffer;
      if (Number.isFinite(input.rollX) && Number.isFinite(input.rollZ)) {
        this.rollIntent.copy(forward).multiplyScalar(input.rollZ).addScaledVector(right, input.rollX);
        if (this.rollIntent.lengthSq() < .001) this.rollIntent.copy(forward); else this.rollIntent.normalize();
      } else this.rollIntent.copy(direction);
    }
    // A fresh conflicting action replaces a waiting roll; simultaneous jump/roll
    // remains legal. A short buffer never grants another aerial action.
    if (!input.rollPressed && (input.jumpPressed || input.slamPressed || input.meleePressed || input.heavyPressed)) this.rollBuffer = 0;
    const low = crouching || (this.rollTimer > 0 && this.grounded);
    this.height = low ? this.lowHeight : this.canStand() ? this.standingHeight : this.lowHeight;
    if (moving) this.facing = Math.atan2(-direction.x, -direction.z);
    if (this.grounded) this.coyote = .09; else this.coyote = Math.max(0, this.coyote - dt);
    let onGround = this.grounded || this.coyote > 0;

    if (this.mantle) {
      const m = this.mantle; m.elapsed += dt;
      if (input.crouchPressed || input.rollPressed || input.jumpPressed) {
        this.mantle = null; this.grounded = false; this.coyote = 0; onGround = false;
        this.wallCooldown = .18;
        v.copy(m.exitVelocity); v.y = input.jumpPressed ? cfg.doubleJumpSpeed : 2;
        if (input.jumpPressed) { this.doubleUsed = true; this.doubleTimer = .42; }
        startedParkour = true; this.aimSuppressTimer = .12;
        this.jumpBuffer = 0; this.emit(input.jumpPressed ? 'double' : 'kick');
      } else {
        const t = clamp(m.elapsed / m.duration, 0, 1);
        // Lift first, then cross the lip. Prevents the body cutting through a ledge.
        const across = clamp((t - .6) / .4, 0, 1);
        p.copy(m.from).lerp(m.to, across * across * (3 - 2 * across));
        p.y = m.from.y + (m.to.y - m.from.y) * Math.sin(Math.min(1, t / .6) * Math.PI / 2);
        this.state = 'mantle';
        if (t === 1) {
          this.mantle = null; this.grounded = true; this.refreshAir(true);
          v.copy(m.exitVelocity); this.carryTimer = .30;
        }
        return;
      }
    }
    if (this.rope) {
      const r = this.rope, tangent = r.delta.clone().normalize();
      if (input.jumpPressed || input.interactPressed || crouching) {
        this.rope = null; this.grounded = false; this.coyote = 0;
        v.copy(tangent).multiplyScalar(wish.dot(tangent) * cfg.runSpeed);
        v.y = input.jumpPressed ? cfg.jumpSpeed : -2; this.jumpBuffer = 0;
        startedParkour = true; this.aimSuppressTimer = .12; this.emit(input.jumpPressed ? 'jump' : 'fall');
      } else {
        const speed = input.sprint ? cfg.sprintSpeed : cfg.runSpeed;
        r.t = clamp(r.t + wish.dot(tangent) * speed * dt / r.length, 0, 1);
        p.copy(r.a).addScaledVector(r.delta, r.t);
        v.copy(tangent).multiplyScalar(wish.dot(tangent) * speed);
        this.state = 'zipline'; return;
      }
    } else if (input.interactPressed) {
      const rope = this.nearestRope();
      if (rope) { this.rope = rope; this.refreshAir(true); this.emit('zipline'); this.state = 'zipline'; return; }
    }

    this.wall = this.wallCooldown === 0 ? this.findWall() : null;
    const wall = this.wall;
    const intoWall = wall ? direction.dot(wall.normal) : 0;
    let specialWall = false;
    if (!this.grounded && wall && !crouching && !this.slam) {
      if (input.jumpPressed && this.state === 'latch') {
        const tangent = wish.clone().addScaledVector(wall.normal, -Math.min(0, wish.dot(wall.normal)));
        this.refreshAir(); v.copy(wall.normal).multiplyScalar(10).addScaledVector(tangent, 5); v.y = 11.5;
        this.wallCooldown = .3; this.jumpBuffer = 0; this.emit('wallJump');
        startedParkour = true; this.aimSuppressTimer = .12;
      } else if (moving && intoWall < -.12 && p.y + this.height > wall.b.maxY - .2 && input.jumpHeld && this.startMantle(wall)) {
        this.jumpBuffer = 0; this.state = 'mantle'; return;
      } else if (wantsAim && this.latchLeft > 0 && this.rollTimer === 0) {
        if (this.state !== 'latch') {
          if (this.latchWallId !== wall.b.id) { this.refreshAir(); this.latchWallId = wall.b.id; }
          this.emit('latch');
        }
        this.latchLeft = Math.max(0, this.latchLeft - dt); v.set(0, 0, 0);
        this.state = 'latch'; specialWall = true;
      } else if (input.jumpHeld && moving && intoWall < .45) {
        const tangent = wish.clone().addScaledVector(wall.normal, -wish.dot(wall.normal));
        const vertical = tangent.length() < .45;
        this.state = vertical ? 'wallClimb' : 'wallRun';
        if (this.wallHopTimer === 0) {
          this.refreshAir(); this.wallHopTimer = .24; this.emit(this.state);
        }
        v.copy(tangent.normalize().multiplyScalar(cfg.sprintSpeed));
        v.addScaledVector(wall.normal, -2.5);
        v.y = vertical ? cfg.wallUpSpeed : 1.5 + Math.sin(this.wallHopTimer * 24) * 2;
        this.jumpBuffer = 0; specialWall = true;
      } else if (input.jumpPressed) {
        const tangent = wish.clone().addScaledVector(wall.normal, -Math.min(0, wish.dot(wall.normal)));
        this.refreshAir(); v.copy(wall.normal).multiplyScalar(10).addScaledVector(tangent, 6); v.y = 11;
        this.wallCooldown = .3; this.jumpBuffer = 0; this.emit('wallJump');
        startedParkour = true; this.aimSuppressTimer = .12;
      }
    }

    if (this.rollBuffer > 0 && this.rollCooldown === 0 && (onGround || !this.airRollUsed)) {
      const speed = Math.max(this.speed + 2.5, cfg.rollSpeed);
      v.x = this.rollIntent.x * speed; v.z = this.rollIntent.z * speed;
      this.rollBuffer = 0;
      if (!onGround) { this.airRollUsed = true; v.y = Math.max(v.y, 1.8); }
      this.rollTimer = .42; this.rollCooldown = .55; this.hardLandTimer = 0;
      this.bulletTimer = 0; this.doubleTimer = 0; startedParkour = startedRoll = true;
      this.slam = false; specialWall = false; this.wallCooldown = .28;
      this.emit(onGround ? 'roll' : 'airRoll');
    }

    if (input.crouchPressed && onGround && this.speed > 3.5 && this.slideCooldown === 0) {
      const speed = Math.min(34, this.speed + cfg.slideBoost);
      v.x = direction.x * speed; v.z = direction.z * speed;
      this.slideTimer = .3; this.slideCooldown = .65; this.emit('slide');
    } else if (input.crouchPressed && !onGround && this.airKickCooldown === 0) {
      v.addScaledVector(direction, 2.3); this.airKickCooldown = 1; this.emit('kick');
      this.bulletTimer = 0; this.doubleTimer = 0; this.aimSuppressTimer = .12; startedParkour = true;
    }

    if (this.jumpBuffer > 0 && !specialWall) {
      if (this.bufferedCrouch && !this.bulletUsed && (onGround || !this.doubleUsed)) {
        const pitch = input.pitch ?? .1;
        const angle = onGround ? (pitch < -1 ? Math.PI / 2 : Math.max(.36, pitch)) : pitch;
        const speed = Math.max(cfg.bulletSpeed, this.speed * .9);
        v.copy(forward).multiplyScalar(Math.cos(angle) * speed);
        v.y = Math.sin(angle) * speed;
        if (onGround) v.y = Math.max(v.y, 10.8);
        else this.doubleUsed = true; // A midair bullet jump occupies the second-jump slot.
        this.bulletUsed = true; this.bulletTimer = .5; this.rollTimer = 0;
        this.doubleTimer = 0; this.aimSuppressTimer = .10; startedParkour = true;
        this.grounded = false; this.coyote = 0; this.jumpBuffer = 0; onGround = false;
        this.slam = false; this.hardLandTimer = 0; this.wallCooldown = .15; this.emit('bullet');
      } else if (onGround && this.hardLandTimer === 0) {
        v.y = cfg.jumpSpeed; this.grounded = false; this.coyote = 0; onGround = false;
        this.jumpBuffer = 0; this.emit('jump');
        this.aimSuppressTimer = .12; startedParkour = true;
      } else if (!onGround && !this.doubleUsed) {
        v.y = cfg.doubleJumpSpeed;
        // The second jump changes vertical velocity; steering stays continuous.
        // An instantaneous horizontal rewrite made aerial combos snap sideways.
        if (moving && this.speed < cfg.runSpeed) v.addScaledVector(direction, (cfg.runSpeed - this.speed) * .25);
        this.doubleUsed = true; this.bulletTimer = 0; this.doubleTimer = .42;
        if (!startedRoll) this.rollTimer = 0;
        this.aimSuppressTimer = .12; startedParkour = true;
        this.jumpBuffer = 0; this.slam = false; this.emit('double');
      }
    }
    if (input.slamPressed && !onGround && !specialWall) {
      this.slam = true; this.rollTimer = 0; this.bulletTimer = 0;
      this.doubleTimer = 0; startedParkour = true;
      const aimed = Number.isFinite(input.aimedSlamPitch);
      const angle = aimed ? clamp(input.aimedSlamPitch, -1.5, -.70) : 0;
      const speed = aimed ? Math.cos(angle) * 35 : 7;
      v.x = forward.x * speed; v.z = forward.z * speed;
      v.y = aimed ? Math.sin(angle) * 35 : -34; this.emit('slam');
    }

    if (!specialWall) {
      if (this.grounded) {
        if (this.rollTimer > 0) this.state = 'roll';
        else if (crouching && this.speed > 3.5) {
          this.state = 'slide'; const oldSpeed = this.speed;
          const speed = Math.max(0, oldSpeed - cfg.slideFriction * dt);
          if (oldSpeed) { v.x *= speed / oldSpeed; v.z *= speed / oldSpeed; }
          if (moving) { v.x += direction.x * 1.8 * dt; v.z += direction.z * 1.8 * dt; }
          for (const ramp of this.world.ramps) {
            if (p.x > ramp.minX && p.x < ramp.maxX && p.z > ramp.minZ && p.z < ramp.maxZ) {
              const slope = (ramp.top - ramp.bottom) / (ramp.maxZ - ramp.minZ);
              v.z += cfg.gravity * slope / (1 + slope * slope) * dt;
            }
          }
        } else {
          const crouched = this.height < this.standingHeight;
          const speed = this.hardLandTimer > 0 ? 0 : crouched ? cfg.crouchSpeed : wantsAim ? cfg.aimSpeed : input.sprint ? cfg.sprintSpeed : cfg.runSpeed;
          const oldSpeed = this.speed;
          const alignment = oldSpeed > .1 ? (v.x * direction.x + v.z * direction.z) / oldSpeed : 1;
          const carry = moving && !crouched && !wantsAim && this.hardLandTimer === 0 && oldSpeed > speed && alignment > .55;
          const targetSpeed = carry ? Math.max(speed, oldSpeed - (this.carryTimer > 0 ? 6 : 12) * dt) : speed;
          const dx = wish.x * targetSpeed - v.x, dz = wish.z * targetSpeed - v.z;
          // Stop and redirect more promptly than we build speed. The vector
          // budget keeps diagonal input identical to axial input.
          const response = !moving || wantsAim && oldSpeed > speed ? cfg.braking :
            cfg.acceleration + (cfg.turnAcceleration - cfg.acceleration) * clamp(1 - alignment, 0, 1);
          const difference = Math.hypot(dx, dz), limit = response * dt;
          const fraction = difference > limit ? limit / difference : 1;
          v.x += dx * fraction; v.z += dz * fraction;
          this.state = this.hardLandTimer > 0 ? 'hardLand' : crouched ? 'crouch' : wantsAim ? moving ? 'aimWalk' : 'aim' : moving ? input.sprint ? 'sprint' : 'run' : 'idle';
        }
      } else {
        const gliding = wantsAim && !startedParkour && this.aimSuppressTimer === 0 && this.glideLeft > 0 && this.rollTimer === 0 && !this.slam;
        if (gliding) {
          if (this.bulletTimer > 0 || this.doubleTimer > 0 || this.state === 'kick') {
            this.lastCancel = this.bulletTimer > 0 ? 'bullet' : this.doubleTimer > 0 ? 'double' : 'kick';
            this.emit('aimCancel');
          }
          // End the old action, rather than hiding it until the aim button is released.
          // A cancellation never replenishes jumps, rolls, or the glide budget.
          this.bulletTimer = 0; this.doubleTimer = 0;
          this.glideLeft = Math.max(0, this.glideLeft - dt);
          if (this.state !== 'glide') this.emit('glide');
          // Retain forward momentum, brake vertical ascent/descent for precise landings.
          v.y *= Math.exp(-dt * 5); v.y -= cfg.gravity * .10 * dt;
          this.state = 'glide';
        } else {
          v.y -= cfg.gravity * dt * (this.rollTimer > 0 ? .42 : 1);
          this.state = this.slam ? 'slam' : this.rollTimer > 0 ? 'airRoll' : this.bulletTimer > 0 ? 'bullet' :
            crouching ? 'kick' : this.action === 'wallJump' && this.actionTime < .4 ? 'wallJump' :
            this.doubleTimer > 0 ? 'double' : v.y > 0 ? 'jump' : 'fall';
        }
        if (!this.slam && this.rollTimer === 0 && moving) {
          // Steer on the horizontal velocity arc, rather than braking each axis
          // independently. Looking alone does not steer; vertical launch speed
          // and parkour resources remain untouched.
          const oldSpeed = this.speed, current = oldSpeed > .05 ? Math.atan2(v.x, v.z) : Math.atan2(direction.x, direction.z);
          const target = Math.atan2(direction.x, direction.z);
          const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
          const turn = Math.min(cfg.airTurnRate, cfg.airAcceleration / Math.max(oldSpeed, 1)) * dt;
          const angle = current + clamp(delta, -turn, turn);
          const speed = approach(oldSpeed, Math.max(oldSpeed, cfg.runSpeed), cfg.airAcceleration * dt);
          v.x = Math.sin(angle) * speed; v.z = Math.cos(angle) * speed;
        }
      }
      if (this.grounded) v.y = Math.min(v.y, -.5);
    }
    this.melee.applyMotion(this);
    const horizontal = this.speed;
    if (horizontal > 38) { v.x *= 38 / horizontal; v.z *= 38 / horizontal; }
    v.y = Math.max(v.y, -45);
    const wasGrounded = this.grounded, impact = v.y;
    this.moveAndCollide(dt);
    if (this.grounded) {
      if (!wasGrounded) {
        this.lastImpact = Math.max(0, -impact); this.carryTimer = .28;
        this.refreshAir(true); this.bulletTimer = 0; this.doubleTimer = 0;
        if (crouching || this.rollTimer > 0 || this.rollBuffer > 0 && this.rollCooldown <= this.rollBuffer || this.state === 'glide') {
          this.hardLandTimer = 0; if (crouching) this.emit('slide');
        } else if (impact < -20) { this.hardLandTimer = .38; this.emit('hardLand'); }
        else this.emit('land');
        this.slam = false;
      }
    }
    this.melee.afterMove(this);
    if (p.y < -20 || Math.abs(p.x) > 100 || Math.abs(p.z) > 140) this.reset();
  }

  moveAndCollide(dt) {
    const p = this.position, v = this.velocity, r = this.radius;
    const count = Math.max(1, Math.ceil(v.length() * dt / .13)), sub = dt / count;
    this.grounded = false;
    for (let i = 0; i < count; i++) {
      for (const axis of ['x', 'z', 'y']) {
        const previous = p[axis], delta = v[axis] * sub; p[axis] += delta;
        for (const b of this.world.solids) {
          if (p.x + r <= b.minX + EPS || p.x - r >= b.maxX - EPS ||
              p.z + r <= b.minZ + EPS || p.z - r >= b.maxZ - EPS ||
              p.y + this.height <= b.minY + EPS || p.y >= b.maxY - EPS) continue;
          if (axis === 'y') {
            if (delta <= 0 && previous >= b.maxY - .03) { p.y = b.maxY; this.grounded = true; v.y = 0; }
            else if (delta > 0 && previous + this.height <= b.minY + .03) { p.y = b.minY - this.height; v.y = 0; }
          } else {
            // Real step-up for stairs and shallow lips, only with standing clearance.
            if (b.maxY - p.y > 0 && b.maxY - p.y <= .36 && v.y <= 0) {
              const step = p.clone(); step.y = b.maxY;
              if (this.canOccupy(step)) { p.y = b.maxY; this.grounded = true; continue; }
            }
            const min = axis === 'x' ? b.minX : b.minZ, max = axis === 'x' ? b.maxX : b.maxZ;
            if (delta > 0) p[axis] = min - r;
            else if (delta < 0) p[axis] = max + r;
            v[axis] = 0;
          }
        }
      }
      for (const ramp of this.world.ramps) {
        if (p.x > ramp.minX && p.x < ramp.maxX && p.z > ramp.minZ && p.z < ramp.maxZ) {
          const ground = rampHeight(ramp, p.z);
          if (p.y <= ground + .2 && p.y > ground - .55 && v.y <= 0) { p.y = ground; v.y = 0; this.grounded = true; }
        }
      }
    }
    // Stable resting support: a zero vertical velocity must not lose ground every other tick.
    if (!this.grounded && v.y <= 0) {
      for (const b of this.world.solids) {
        if (Math.abs(p.y - b.maxY) < .025 && p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ) {
          p.y = b.maxY; this.grounded = true; v.y = 0; break;
        }
      }
    }
  }
}
