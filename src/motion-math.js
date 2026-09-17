// Independently implemented closed-form damping and animation helpers.
// Background and design references are documented in RESEARCH.md.
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const smoothstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export class Spring {
  constructor(value = 0) { this.value = value; this.velocity = 0; }
  reset(value) { this.value = value; this.velocity = 0; return value; }
  step(target, omega, dt) {
    if (dt <= 0) return this.value;
    const displacement = this.value - target;
    const transient = this.velocity + omega * displacement;
    const decay = Math.exp(-omega * dt);
    this.value = target + (displacement + transient * dt) * decay;
    this.velocity = (this.velocity - omega * transient * dt) * decay;
    return this.value;
  }
}

// A short source-velocity extrapolation cross-fades into the authored target.
// Unlike continuously low-pass filtering every joint, this converges exactly
// to the target after the transition and does not soften a running gait forever.
export class PoseBlender {
  constructor(keys, angularKeys = keys) {
    this.keys = keys; this.angular = new Set(angularKeys); this.initialized = false;
    this.pose = {}; this.velocity = {}; this.source = {}; this.sourceVelocity = {};
    this.elapsed = 1; this.duration = .14;
  }
  reset(target) {
    for (const key of this.keys) { this.pose[key] = target[key]; this.velocity[key] = 0; }
    this.initialized = true; this.elapsed = 1; return this.pose;
  }
  transition(duration) {
    this.duration = duration; this.elapsed = 0;
    for (const key of this.keys) {
      this.source[key] = this.pose[key];
      // Extrapolate only a small amount, including when a somersault is canceled.
      this.sourceVelocity[key] = clamp(this.velocity[key], this.angular.has(key) ? -18 : -3, this.angular.has(key) ? 18 : 3);
    }
  }
  update(target, dt) {
    if (!this.initialized) return this.reset(target);
    if (dt <= 0) return this.pose;
    const t = this.elapsed, weight = smoothstep(t / this.duration);
    const extrapolation = (1 - Math.exp(-14 * t)) / 14;
    for (const key of this.keys) {
      const old = this.pose[key];
      let goal = target[key];
      if (this.angular.has(key)) goal = old + angleDelta(old, goal);
      const source = this.source[key] + this.sourceVelocity[key] * extrapolation;
      const next = weight >= 1 ? goal : source + (goal - source) * weight;
      this.velocity[key] = (next - old) / dt; this.pose[key] = next;
    }
    this.elapsed += dt;
    return this.pose;
  }
}

// Forward is -Z. Positive hip flexion lifts the knee forward, negative knee
// flexion folds the shin BACK. The v1 rig had these anatomical axes reversed.
export function solveLeg(down, forward, thigh = .46, shin = .44) {
  const length = clamp(Math.hypot(down, forward), .025, thigh + shin - .001);
  const hip = Math.atan2(-forward, down) + Math.acos(clamp((thigh * thigh + length * length - shin * shin) / (2 * thigh * length), -1, 1));
  const knee = -Math.acos(clamp((length * length - thigh * thigh - shin * shin) / (2 * thigh * shin), -1, 1));
  return { hip, knee, ankle: -hip - knee };
}

export class RenderInterpolator {
  constructor(position) { this.before = position.clone(); this.position = position.clone(); }
  capture(position) { this.before.copy(position); }
  reset(position) { this.before.copy(position); this.position.copy(position); }
  sample(current, alpha) { return this.position.copy(this.before).lerp(current, clamp(alpha, 0, 1)); }
}
