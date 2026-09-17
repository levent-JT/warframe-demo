// One shared source of truth for rendering, collision, minimap and test fixtures.
export const solids = [];
function box(id, x, y, z, w, h, d, kind = 'platform') {
  const b = { id, x, y, z, w, h, d, kind,
    minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2,
    maxY: y + h / 2, minZ: z - d / 2, maxZ: z + d / 2 };
  solids.push(b); return b;
}

box('atrium', 0, -1.5, 12, 64, 3, 56, 'floor');
box('north-deck', 0, -1.5, -49, 64, 3, 30, 'floor');
box('left-bridge', -27, -1.5, -25, 10, 3, 18, 'floor');
box('right-bridge', 27, -1.5, -25, 10, 3, 18, 'floor');
box('island-a', -7, 0.8, -23, 7, 3.6, 6);
box('island-b', 5, 2.3, -29, 7, 6.6, 6);
// A tunnel with 1.02 m clearance: standing really collides, sliding really fits.
box('tunnel-roof', -14, 1.75, 9, 10, 1.46, 7, 'tunnel');
box('tunnel-left', -19.5, 1.5, 9, 1, 3, 7);
box('tunnel-right', -8.5, 1.5, 9, 1, 3, 7);
box('vault-low', -14, 0.6, -1, 9, 1.2, 1.6);
box('vault-high', -14, 1.5, -9, 8, 3, 4);
// Parallel surfaces leave room to wall-hop and change direction.
box('wall-east', 19, 6, -2, 1.4, 12, 27, 'wall');
box('wall-west', 11.8, 4.5, -7, 1.4, 9, 17, 'wall');
box('wall-end', 15.4, 6, -20, 8.6, 12, 1.4, 'wall');
box('wall-perch', 22, 5.8, -16, 5, 0.4, 6);
box('tower', -18, 4, -45, 8, 8, 8, 'tower');
box('tower-step-a', -25, 1, -39, 5, 2, 5);
box('tower-step-b', -26, 2.5, -45, 4, 5, 5);
box('landing-pad', 19, 2.5, -48, 10, 5, 10, 'tower');
box('north-monolith', 0, 8, -60, 13, 16, 2, 'wall');
for (let i = 0; i < 4; i++) box(`stairs-${i}`, -2, (i + 1) * .16, -41 - i * 1.5, 9, (i + 1) * .32, 1.5);
box('stairs-top', -2, .64, -49, 9, 1.28, 8);
// Broad ramp rising toward the north; collision follows its plane.
export const ramps = [{ id: 'ramp', minX: 23, maxX: 30, minZ: -8, maxZ: 8, bottom: 0, top: 5 }];
export function rampHeight(r, z) { return r.bottom + (r.maxZ - z) / (r.maxZ - r.minZ) * (r.top - r.bottom); }
// Thin conservative volumes close the sides/underside of the ramp; the analytic
// surface above supplies continuous support instead of a visually stepped climb.
for (let i = 0; i < 64; i++) {
  const z = 8 - (i + .5) * .25, h = (i + .5) * 5 / 64;
  box(`ramp-solid-${i}`, 26.5, h / 2, z, 7, h, .25, 'ramp-collider');
}
box('ramp-deck', 26.5, 4.8, -11, 7, .4, 6);

export const ziplines = [{ a: { x: -18, y: 9.25, z: -45 }, b: { x: 19, y: 6.25, z: -48 } }];
export const spawns = [
  { name: '起点广场', x: 0, y: .03, z: 27, yaw: 0 },
  { name: '滑铲通道', x: -14, y: .03, z: 18, yaw: 0 },
  { name: '蹬墙回廊', x: 15.4, y: .03, z: 9, yaw: -Math.PI / 2 },
  { name: '断桥飞跃', x: 0, y: .03, z: -10, yaw: 0 },
  { name: '高空绳索', x: -18, y: 8.03, z: -45, yaw: -Math.PI / 2 },
  { name: '斜坡平台', x: 26.5, y: .03, z: 10, yaw: 0 },
];
export const gates = [
  { x: 0, y: 2.4, z: 17, r: 2.4 },
  { x: -14, y: 1, z: 8, r: 1.8 },
  { x: -14, y: 4.7, z: -9, r: 2.2 },
  { x: -7, y: 5.6, z: -23, r: 2.4 },
  { x: -18, y: 10, z: -45, r: 2.6 },
  { x: 18, y: 8, z: -48, r: 2.6 },
  { x: 15.4, y: 8, z: -19, r: 2.6 },
  { x: 0, y: 2.5, z: 27, r: 3.2 },
];
