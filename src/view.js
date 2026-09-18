import { Vector3, Raycaster } from 'three';

// Both rendering and shots sample the same camera geometry. Sampling never
// advances animation/springs: a shot can use this tick's input immediately.
export class ViewSample {
  constructor() {
    this.direction = new Vector3(); this.right = new Vector3();
    this.target = new Vector3(); this.boom = new Vector3(); this.origin = new Vector3();
    this.ray = new Raycaster(); this.safeLength = 0;
  }
  sample(position, { yaw, pitch, height, distance, shoulder }, obstacles = []) {
    this.direction.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.target.copy(position); this.target.y += height;
    this.boom.copy(this.direction).multiplyScalar(-distance).addScaledVector(this.right, shoulder);
    const length = this.boom.length(); this.boom.normalize();
    this.ray.set(this.target, this.boom); this.ray.far = length;
    const hit = this.ray.intersectObjects(obstacles, false)[0];
    this.safeLength = hit ? Math.max(.20, hit.distance - .25) : length;
    return this.limit(this.safeLength);
  }
  limit(clearance) {
    this.origin.copy(this.target).addScaledVector(this.boom, Math.min(this.safeLength, clearance));
    return this;
  }
}
