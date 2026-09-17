import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export { createCharacter } from './character.js';
import { solids, ramps, rampHeight, ziplines, gates } from './world.js';

const white = 0xc6cbd0, dark = 0x253746, gold = 0xc4a677, cyan = 0x8dfff0;
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111e2b); scene.fog = new THREE.Fog(0x111e2b, 55, 150);
  const camera = new THREE.PerspectiveCamera(69, innerWidth / innerHeight, .08, 280);
  scene.add(new THREE.HemisphereLight(0xcbe7ff, 0x3c4548, 2.4));
  const sun = new THREE.DirectionalLight(0xffecd7, 3.1);
  sun.position.set(-28, 55, 25); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -58; sun.shadow.camera.right = 58;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70; sun.shadow.camera.far = 170;
  sun.shadow.normalBias = .035; sun.shadow.bias = -.00015;
  sun.target.position.set(0, 0, -15); scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x6fd5ff, 2); rim.position.set(18, 15, -50); scene.add(rim);
  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: white, metalness: .3, roughness: .64 }),
    platform: new THREE.MeshStandardMaterial({ color: 0x9faeb8, metalness: .4, roughness: .46 }),
    wall: new THREE.MeshStandardMaterial({ color: dark, metalness: .45, roughness: .46 }),
    tower: new THREE.MeshStandardMaterial({ color: 0x40576a, metalness: .5, roughness: .48 }),
    tunnel: new THREE.MeshStandardMaterial({ color: 0x667e8f, metalness: .5, roughness: .4 }),
    trim: new THREE.MeshStandardMaterial({ color: gold, metalness: .8, roughness: .36 }),
    glow: new THREE.MeshBasicMaterial({ color: cyan }),
    ink: new THREE.MeshBasicMaterial({ color: 0x4d6979 }),
  };
  const collisionMeshes = [], staticMeshes = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  function cube(x, y, z, w, h, d, mat, collidable = false) {
    const mesh = new THREE.Mesh(boxGeo, mat); mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
    mesh.castShadow = h > .2; mesh.receiveShadow = true; scene.add(mesh);
    staticMeshes.push(mesh);
    if (collidable) collisionMeshes.push(mesh); return mesh;
  }
  for (const b of solids) {
    if (b.kind === 'ramp-collider') continue;
    cube(b.x, b.y, b.z, b.w, b.h, b.d, materials[b.kind] || materials.platform, true);
    cube(b.x, b.maxY + .009, b.minZ + .08, b.w, .022, .07, materials.trim);
    cube(b.minX + .06, b.maxY + .009, b.z, .05, .022, b.d, materials.trim);
    if (b.kind === 'floor') {
      for (let x = b.minX + 4; x < b.maxX; x += 4) cube(x, b.maxY + .006, b.z, .022, .008, b.d, materials.ink);
      for (let z = b.minZ + 4; z < b.maxZ; z += 4) cube(b.x, b.maxY + .006, z, b.w, .008, .022, materials.ink);
      cube(b.x, b.maxY - .25, b.minZ - .016, b.w - 1, .055, .025, materials.glow);
    }
    if (b.kind === 'wall') {
      const alongZ = b.d > b.w;
      for (let n = 1; n < b.h; n += 2) {
        cube(b.x + (alongZ ? b.w / 2 + .01 : 0), b.minY + n, b.z + (alongZ ? 0 : b.d / 2 + .01),
          alongZ ? .024 : b.w - .4, .025, alongZ ? b.d - .4 : .024, materials.trim);
        if (alongZ) cube(b.minX - .015, b.minY + n, b.z, .024, .025, b.d - .4, materials.trim);
      }
      if (alongZ) for (const x of [b.minX - .03, b.maxX + .03]) cube(x, b.y, b.minZ + .3, .05, b.h - .6, .06, materials.glow);
    }
  }
  for (const r of ramps) {
    const positions = [r.minX, 0, r.maxZ, r.maxX, 0, r.maxZ, r.maxX, r.top, r.minZ,
      r.minX, 0, r.maxZ, r.maxX, r.top, r.minZ, r.minX, r.top, r.minZ];
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials.platform); mesh.receiveShadow = true; scene.add(mesh); collisionMeshes.push(mesh);
    for (let z = r.minZ + .5; z < r.maxZ; z += 1.3) cube((r.minX + r.maxX) / 2, rampHeight(r, z) + .03, z, r.maxX - r.minX - .2, .024, .055, materials.trim);
  }
  // Architectural silhouette outside the playable island.
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI * 2 / 16, distance = 76 + Math.sin(i * 4) * 15;
    cube(Math.cos(a) * distance, -5, -15 + Math.sin(a) * distance, 5, 25 + i % 5 * 9, 5, materials.wall);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(27, .18, 8, 96), materials.trim);
  halo.position.set(0, 14, -79); scene.add(halo);
  const halo2 = new THREE.Mesh(new THREE.TorusGeometry(25.5, .045, 6, 96), materials.glow);
  halo2.position.copy(halo.position); scene.add(halo2);
  for (const x of [-30.5, 30.5]) {
    for (const z of [31, 18, 2, -39, -57]) {
      cube(x, 1.2, z, .32, 2.4, .32, materials.wall);
      cube(x, 2.2, z, .34, .65, .34, materials.glow);
    }
  }
  // Floor runway markings and a launch pad, all generated locally.
  for (let z = 24; z > -13; z -= 4) {
    for (const x of [-2.8, 2.8]) cube(x, .025, z, .06, .025, 1.5, materials.trim);
  }
  const launch = new THREE.Mesh(new THREE.RingGeometry(2.7, 2.76, 80), materials.trim);
  launch.rotation.x = -Math.PI / 2; launch.position.set(0, .03, 27); scene.add(launch);

  function label(text, sub, x, y, z, scale = 1) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const ctx = c.getContext('2d'); ctx.fillStyle = 'rgba(10,24,35,.86)'; ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#bda57d'; ctx.fillRect(0, 0, 7, 256);
    ctx.font = '600 72px sans-serif'; ctx.fillStyle = '#e5eef2'; ctx.fillText(text, 45, 105);
    ctx.font = '30px sans-serif'; ctx.fillStyle = '#92acba'; ctx.fillText(sub, 48, 180);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.position.set(x, y, z); sprite.scale.set(7 * scale, 1.75 * scale, 1); scene.add(sprite); return sprite;
  }
  label('01 / UNDERFLOW', 'SLIDE  →  BULLET JUMP', -14, 4.1, 11, .95);
  label('02 / VERTICAL', 'HOLD SPACE  ·  RMB TO LATCH', 15.4, 13.8, -18);
  label('03 / AIRBORNE', 'JUMP  →  ROLL  →  GLIDE', 0, 6, -29, .85);
  label('04 / SKYLINE', 'X TO BALANCE ON THE LINE', -18, 12.8, -47, .9);
  label('KINETIC', 'MOVEMENT RESEARCH FACILITY', 0, 15, -58, 1.7);

  for (const line of ziplines) {
    const a = new THREE.Vector3(line.a.x, line.a.y, line.a.z), b = new THREE.Vector3(line.b.x, line.b.y, line.b.z);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, a.distanceTo(b), 8), materials.glow);
    rope.position.copy(a).add(b).multiplyScalar(.5);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); scene.add(rope);
    for (const point of [a, b]) {
      cube(point.x, point.y - .6, point.z, .12, 1.2, .12, materials.trim);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(.17, 12, 8), materials.glow); cap.position.copy(point); scene.add(cap);
    }
  }
  const gateMeshes = gates.map((g, i) => {
    const material = new THREE.MeshBasicMaterial({ color: i === 0 ? gold : cyan, transparent: true, opacity: i === 0 ? .95 : .18 });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(g.r, .042, 8, 64), material);
    mesh.position.set(g.x, g.y, g.z); scene.add(mesh);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(g.r + .14, .012, 6, 64, Math.PI * 1.3), material);
    mesh.add(inner); return mesh;
  });
  // Sparse points make the void read as volume without external textures.
  const dots = new Float32Array(450 * 3);
  for (let i = 0; i < dots.length; i += 3) {
    const n = i + 1; dots[i] = Math.sin(n * 78.23) * 100;
    dots[i + 1] = 15 + (Math.sin(n * 43.7) * .5 + .5) * 70;
    dots[i + 2] = -40 + Math.cos(n * 23.62) * 100;
  }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dots, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xbad1db, size: .075, transparent: true, opacity: .5 })));
  // Batch hundreds of floor seams, architecture pieces and trims into a few
  // draw calls. Keep the small original collider set for camera ray queries.
  const batches = new Map();
  for (const mesh of staticMeshes) {
    mesh.updateMatrixWorld(true);
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(geometry); scene.remove(mesh);
  }
  for (const [material, geometries] of batches) {
    const merged = new THREE.Mesh(mergeGeometries(geometries), material);
    merged.castShadow = material !== materials.glow && material !== materials.ink;
    merged.receiveShadow = true; scene.add(merged);
    for (const geometry of geometries) geometry.dispose();
  }
  return { scene, renderer, camera, collisionMeshes, gateMeshes };
}

export function createTrails(scene) {
  const count = 65, positions = new Float32Array(count * 3), life = new Float32Array(count);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: cyan, size: .08, transparent: true, opacity: .65, depthWrite: false });
  const mesh = new THREE.Points(geometry, material); mesh.frustumCulled = false; scene.add(mesh);
  let index = 0;
  return (p, dt) => {
    for (let i = 0; i < count; i++) {
      life[i] -= dt; if (life[i] <= 0) positions[i * 3 + 1] = -100;
    }
    if (['bullet', 'airRoll', 'slide', 'wallRun', 'wallClimb'].includes(p.state)) {
      for (let n = 0; n < 2; n++) {
        const i = index++ % count; life[i] = .32;
        positions[i * 3] = p.position.x + (Math.random() - .5) * .25;
        positions[i * 3 + 1] = p.position.y + .65 + (Math.random() - .5) * .5;
        positions[i * 3 + 2] = p.position.z + (Math.random() - .5) * .25;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  };
}
