// Independent practice choreography. The input families follow Warframe's
// published melee rules; these timings are authored here, not extracted data.
export const WEAPONS = {
  staff: { label: '双手棍杖', short: '棍杖', detail: '双手横扫、回扫与转棍下劈', color: 0xe9bd76 },
  sword: { label: '单手剑', short: '单手剑', detail: '单手斜斩、反手斩与过顶劈砍', color: 0x8dfff0 },
};
export const BRANCHES = { neutral: '原地连击', forward: '前进连击', tactical: '格挡连击', forwardTactical: '突进连击', slide: '滑铲旋击', aerial: '空中连击', heavy: '重击', slam: '下砸' };
const move = (name, motion, duration, extra = {}) => ({ name, motion, duration, strike: [.26, .67], ...extra });
export const MELEE_SETS = {
  staff: {
    neutral: [move('横扫', 'sweep', .52), move('回扫', 'reverse', .50), move('转棍下劈', 'overhead', .66)],
    forward: [move('迈步横扫', 'sweep', .48), move('回身扫击', 'reverse', .48), move('进步劈棍', 'overhead', .60)],
    tactical: [move('直刺', 'thrust', .58), move('挑棍', 'lift', .61)],
    forwardTactical: [move('突进刺棍', 'thrust', .66, { drive: 12 }), move('追身横扫', 'sweep', .54, { drive: 5 })],
    slide: [move('低身旋棍', 'spin', .64)],
    aerial: [move('空中横扫', 'sweep', .48), move('空中回扫', 'reverse', .48), move('空中劈棍', 'overhead', .60)],
    heavy: [move('蓄力转棍', 'heavy', .97, { strike: [.55, .83] })],
    slam: [move('棍杖下砸', 'slam', .34)],
  },
  sword: {
    neutral: [move('斜斩', 'sweep', .43), move('反手斩', 'reverse', .45), move('过顶劈斩', 'overhead', .58)],
    forward: [move('迈步斜斩', 'sweep', .42), move('反手追斩', 'reverse', .43), move('进步劈斩', 'overhead', .56)],
    tactical: [move('直刺', 'thrust', .53), move('上挑', 'lift', .54)],
    forwardTactical: [move('突进刺剑', 'thrust', .61, { drive: 13 }), move('追身斜斩', 'sweep', .46, { drive: 5 })],
    slide: [move('低身旋斩', 'spin', .59)],
    aerial: [move('空中斜斩', 'sweep', .44), move('空中反斩', 'reverse', .44), move('空中劈斩', 'overhead', .54)],
    heavy: [move('蓄力横斩', 'heavy', .90, { strike: [.55, .83] })],
    slam: [move('剑锋下砸', 'slam', .32)],
  },
};

export class MeleeController {
  constructor() { this.weapon = 'staff'; this.serial = 0; this.impactSerial = 0; this.reset(); }
  reset() {
    this.active = null; this.drawn = false; this.queued = null; this.queueLeft = 0;
    this.lastBranch = null; this.nextIndex = 0; this.chainAge = 9;
    this.blockUntilRelease = false; this.wasAim = false; this.cancelReason = null;
    this.serial++; this.impact = null;
  }
  cancel(reason) {
    if (this.active) { this.serial++; this.cancelReason = reason; }
    this.active = null; this.queued = null; this.queueLeft = 0;
    this.lastBranch = null; this.nextIndex = 0; this.chainAge = 9;
    if (reason === 'aim') this.drawn = false;
  }
  selectWeapon(kind) {
    if (!WEAPONS[kind]) return false;
    if (this.active?.branch === 'slam' && this.active.stage === 'fall') {
      // Changing the practice weapon must not detach the pose from an ongoing
      // physical slam, or produce an impact before ground contact.
      const progress = this.progress, move = MELEE_SETS[kind].slam[0];
      this.active = { ...this.active, weapon: kind, move, elapsed: progress * move.duration };
    } else this.cancel('weapon');
    this.weapon = kind; this.drawn = true; this.serial++;
    return true;
  }
  get progress() {
    const a = this.active;
    return a ? Math.min(1, a.elapsed / a.move.duration) : 0;
  }
  get striking() {
    const a = this.active, t = this.progress;
    return !!a && a.branch !== 'slam' && t >= a.move.strike[0] && t <= a.move.strike[1];
  }
  chooseBranch(input, p, heavy = false) {
    if (!p.grounded) return heavy || ((input.pitch ?? p.pitch) < -.70 && (input.z || 0) >= 0) ? 'slam' : 'aerial';
    if (heavy) return 'heavy';
    if (input.crouch && p.speed > 3.5) return 'slide';
    return input.aim ? (input.z > .1 ? 'forwardTactical' : 'tactical') : input.z > .1 ? 'forward' : 'neutral';
  }
  start(branch, input, p, heavy = false) {
    const moves = MELEE_SETS[this.weapon][branch];
    const index = this.lastBranch === branch && this.chainAge < .65 ? this.nextIndex % moves.length : 0;
    this.active = { weapon: this.weapon, branch, index, move: moves[index], elapsed: 0,
      yaw: input.yaw ?? p.yaw, heavy, stage: branch === 'slam' ? 'fall' : 'swing' };
    this.lastBranch = branch; this.nextIndex = (index + 1) % moves.length; this.chainAge = 0;
    this.queued = null; this.queueLeft = 0; this.drawn = true; this.cancelReason = null; this.serial++;
    p.bulletTimer = 0; p.doubleTimer = 0;
    p.emit(branch === 'slam' ? 'meleeSlam' : branch === 'heavy' ? 'heavyAttack' : 'meleeAttack');
  }
  step(dt, input, p) {
    const aimEdge = input.aimPressed || (input.aim && !this.wasAim);
    this.wasAim = !!input.aim; this.chainAge += dt;
    this.queueLeft = Math.max(0, this.queueLeft - dt);
    if (!this.queueLeft) this.queued = null;
    if (!input.meleeHeld) this.blockUntilRelease = false;
    if (input.switchWeaponPressed) {
      this.selectWeapon(this.weapon === 'staff' ? 'sword' : 'staff');
      this.blockUntilRelease = !!input.meleeHeld; p.emit('weaponSwap'); return input;
    }
    // Dodge/jump inputs keep precedence. Holding attack cannot silently restart
    // a cancelled combo on the next physics tick; release it to re-arm.
    const fallingSlam = this.active?.branch === 'slam' && this.active.stage === 'fall';
    const onGround = p.grounded || p.coyote > dt;
    const canDodge = p.rollCooldown === 0 && (onGround || !p.airRollUsed);
    const canJump = onGround || !p.doubleUsed;
    if ((input.rollPressed && (!fallingSlam || canDodge)) || (input.jumpPressed && (!fallingSlam || canJump))) {
      this.cancel(input.rollPressed ? 'roll' : 'jump'); this.blockUntilRelease = !!input.meleeHeld; return input;
    }
    if (!fallingSlam && aimEdge && !input.meleeHeld && !input.meleePressed && !input.heavyPressed && !input.slamPressed) {
      this.cancel('aim'); return input;
    }
    if (p.mantle || p.rope || (p.rollTimer > 0 && !input.slamPressed) || (p.slam && this.active?.branch !== 'slam')) {
      this.cancel('parkour'); return input;
    }
    let startSlam = false;
    if (input.slamPressed && !p.grounded) {
      this.start('slam', input, p); startSlam = true;
    } else if (input.heavyPressed && this.active?.branch !== 'slam') {
      if (this.active?.branch !== 'heavy') {
        const branch = this.chooseBranch(input, p, true);
        this.start(branch, input, p, true); startSlam = branch === 'slam';
      }
    } else {
      if (this.active) {
        const a = this.active; a.elapsed += dt;
        const delta = Math.atan2(Math.sin((input.yaw ?? p.yaw) - a.yaw), Math.cos((input.yaw ?? p.yaw) - a.yaw));
        a.yaw += Math.max(-6 * dt, Math.min(6 * dt, delta));
        if (a.stage === 'fall') a.elapsed = Math.min(a.elapsed, a.move.duration * .6);
        if (input.meleePressed && a.branch !== 'slam') { this.queued = 'light'; this.queueLeft = .32; }
        const repeat = !this.blockUntilRelease && input.meleeHeld && !['heavy', 'slam'].includes(a.branch);
        const chain = a.stage !== 'fall' && a.branch !== 'slam' && this.progress >= .88 && (repeat || this.queued);
        if (chain) {
          const branch = this.chooseBranch(input, p);
          this.start(branch, input, p); startSlam = branch === 'slam';
        } else if (a.stage !== 'fall' && this.progress >= 1) {
          this.active = null; this.chainAge = 0;
        }
      } else if ((input.meleePressed || input.meleeHeld) && !this.blockUntilRelease && !p.slam) {
        const branch = this.chooseBranch(input, p);
        this.start(branch, input, p); startSlam = branch === 'slam';
      }
    }
    // A melee swing is its own action layer. Held aim is a combo modifier; a
    // fresh aim press without attack cancels it and returns to gun aim/glide.
    const aimedSlamPitch = startSlam && !input.slamPressed && (input.pitch ?? p.pitch) < -.70 ? (input.pitch ?? p.pitch) : null;
    return this.active ? { ...input, aim: false, aimPressed: false, sprint: false, slamPressed: startSlam, aimedSlamPitch } : input;
  }
  applyMotion(p) {
    const a = this.active, t = this.progress;
    if (!a || !p.grounded || !a.move.drive || t < .2 || t > .57) return;
    const x = -Math.sin(a.yaw), z = -Math.cos(a.yaw);
    const speed = p.velocity.x * x + p.velocity.z * z;
    if (speed < a.move.drive) { p.velocity.x += x * (a.move.drive - speed); p.velocity.z += z * (a.move.drive - speed); }
  }
  afterMove(p) {
    const a = this.active;
    if (!a || !p.grounded) return;
    if (a.branch === 'slam' && a.stage === 'fall') {
      a.stage = 'recover'; a.elapsed = 0;
      this.impactSerial++; this.impact = { x: p.position.x, y: p.position.y, z: p.position.z, heavy: a.heavy };
      p.emit('meleeImpact');
    } else if (a.branch === 'aerial') this.cancel('landing');
  }
}
