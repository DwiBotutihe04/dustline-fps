// DUSTLINE — Foundry Sector K-7: a desert-industrial 3-lane map, built from boxes
// with procedural canvas textures. West = Vanguard (CT) spawn, east = Duster (T) spawn.
// Site A north (open warehouse), Site B south (container yard), mid in the middle.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export const SITES = {
  A: { minX: -14, maxX: 6, minZ: -24, maxZ: -12 },
  B: { minX: -2, maxX: 16, minZ: 12, maxZ: 24 },
};
export const SPAWNS = {
  CT: [[-32, -2], [-32, 2], [-30, -4], [-30, 4], [-34, 0]],
  T: [[32, -2], [32, 2], [30, -4], [30, 4], [34, 0]],
};
// Waypoint graph bots walk on. Edges are straight, collision-free lines by construction.
export const WAYPOINTS = [
  [-32, 0], [-24, 0], [-16, 0], [-8, 0], [-4, 4], [4, 4], [8, 0], [16, 0], [24, 0], [32, 0],
  [24, -16], [12, -16], [0, -16], [-10, -14], [-6, -18], [2, -20], [-12, -19.5],
  [24, 16], [12, 16], [0, 16], [6, 19], [12, 21], [-8, -6], [-4, 6],
];
export const EDGES = [
  [0, 1], [1, 2], [2, 3], [2, 22], [3, 4], [3, 22], [3, 23], [22, 13], [13, 14], [13, 12],
  [14, 15], [14, 16], [15, 12], [12, 11], [11, 10], [10, 9], [10, 8], [8, 9], [8, 17], [9, 17],
  [17, 18], [18, 19], [19, 20], [20, 21], [19, 23], [4, 5], [5, 6], [6, 7], [7, 8],
];
export const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }

// Breadth-first shortest path of waypoint indices.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const q = [from];
  prev[from] = from;
  while (q.length) {
    const n = q.shift();
    for (const m of ADJ[n]) {
      if (prev[m] !== -1) continue;
      prev[m] = n;
      if (m === to) {
        const path = [to];
        let c = to;
        while (c !== from) { c = prev[c]; path.unshift(c); }
        return path;
      }
      q.push(m);
    }
  }
  return [from, to];
}
export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x, dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(ctx, w, h, rng, colors, n, size) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.globalAlpha = 0.08 + rng() * 0.2;
    const s = 1 + rng() * size;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

export function createWorld(scene) {
  const rng = mulberry32(1337);
  const colliders = []; // {minX,maxX,minZ,maxZ,minY,maxY}
  const shootables = [];

  const concreteTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a7a68'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rng, ['#6e6252', '#9a8874', '#7d6f5c', '#5d5347'], 900, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(rng() * w, 0); ctx.lineTo(rng() * w, h); ctx.stroke(); }
  }, 8, 8);
  const floorTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6b5a48'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rng, ['#57493a', '#7d6c58', '#4a3e32'], 1200, 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  }, 18, 13);
  const rustTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6e4a30'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rng, ['#8a5a34', '#4a2f1e', '#a56a3a', '#3a2418'], 1100, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, rng() * h); ctx.lineTo(w, rng() * h); ctx.stroke(); }
  }, 2, 2);
  const woodTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a5a38'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      ctx.fillStyle = y % 64 ? '#71532f' : '#84643d';
      ctx.fillRect(0, y, w, 30);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, y + 30, w, 2);
    }
    speckle(ctx, w, h, rng, ['#5d4526', '#8f6f45'], 300, 3);
  }, 1, 1);
  const hazardTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d8a028'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    for (let i = -h; i < w + h; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 16 - h, h); ctx.lineTo(i - h, h); ctx.fill();
    }
  }, 4, 1);
  const tealTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2f6b6b'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rng, ['#265858', '#3a7d7d', '#1e4a4a'], 500, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 4;
    for (let x = 0; x <= w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  }, 1, 1);

  const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95, metalness: 0.02 });
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.02 });
  const rustMat = new THREE.MeshStandardMaterial({ map: rustTex, roughness: 0.8, metalness: 0.45 });
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.9, metalness: 0.05 });
  const tealMat = new THREE.MeshStandardMaterial({ map: tealTex, roughness: 0.7, metalness: 0.35 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.85, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9, metalness: 0.2 });

  function addBox(cx, cz, w, h, d, mat, collide = true, y0 = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, y0 + h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.world = true;
    scene.add(m);
    shootables.push(m);
    if (collide) colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: y0, maxY: y0 + h });
    return m;
  }
  function addCyl(cx, cz, r, h, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat);
    m.position.set(cx, h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.world = true;
    scene.add(m);
    shootables.push(m);
    colliders.push({ minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r, minY: 0, maxY: h });
    return m;
  }

  // Ground + perimeter.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(76, 56), floorMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  ground.userData.world = true;
  scene.add(ground);
  shootables.push(ground);
  addBox(0, -27, 76, 5, 2, wallMat);
  addBox(0, 27, 76, 5, 2, wallMat);
  addBox(-37, 0, 2, 5, 56, wallMat);
  addBox(37, 0, 2, 5, 56, wallMat);
  // Interior walls with gaps: A wall (z=-10), B wall (z=10), mid wall (x=0, door + window).
  addBox(-24, -10, 24, 4, 1, wallMat);
  addBox(7, -10, 30, 4, 1, wallMat);
  addBox(31, -10, 10, 4, 1, wallMat);
  addBox(-21, 10, 30, 4, 1, wallMat);
  addBox(11, 10, 26, 4, 1, wallMat);
  addBox(32, 10, 8, 4, 1, wallMat);
  addBox(0, -5.75, 1, 4, 8.5, wallMat);
  addBox(0, 2.25, 1, 4, 1.5, wallMat);
  addBox(0, 7.5, 1, 4, 5, wallMat);
  addBox(0, 0, 1, 1.1, 3, rustMat); // mid window sill
  addBox(0, 0, 1, 1.8, 3, wallMat, true, 2.2); // mid window lintel
  // Hazard stripes on the wall faces by the gaps.
  addBox(-12, -10, 0.2, 0.5, 4, hazardMat, false).position.y = 0.25;
  addBox(24, 10, 0.2, 0.5, 4, hazardMat, false).position.y = 0.25;

  // Cover: crates, containers, barrels.
  const crates = [
    [-4, -21, 2.4, 1.8, 2.4, woodMat], [2, -14, 2, 1.4, 2, rustMat], [-12, -14, 1.2, 1, 1.2, woodMat],
    [-12, -22, 3, 1.2, 2, rustMat], [4, 22, 2.4, 1.8, 2.4, tealMat], [13, 18, 1.8, 1.2, 1.8, rustMat],
    [2, 21, 1.2, 1, 1.2, woodMat], [12, 13.5, 2, 1.8, 2, tealMat],
    [-6, -2, 1.4, 1.1, 1.4, woodMat], [6, 4.5, 1.4, 1.1, 1.4, rustMat], [-14, 3, 1, 1, 1, woodMat],
    [14, -2, 1, 1, 1, rustMat], [-24, -6, 1.6, 1.2, 1.6, woodMat], [-24, 6, 1.6, 1.2, 1.6, rustMat],
    [28, -4, 2, 1.4, 1.2, tealMat], [20, -6, 1.6, 1.2, 1.6, woodMat], [20, 6, 1.6, 1.2, 1.6, rustMat],
    [18, -13, 1.4, 1.1, 1.4, woodMat], [4, -13, 1.4, 1.1, 1.4, rustMat],
    [18, 19, 1.4, 1.1, 1.4, tealMat], [8, 19, 1, 1, 1, woodMat],
  ];
  for (const [x, z, w, h, d, m] of crates) addBox(x, z, w, h, d, m);
  // Stacked container pair at B, tall cover at A.
  addBox(6, 18, 2.4, 2.4, 2.4, tealMat);
  const top = addBox(6, 18, 2.4, 1.2, 2.4, rustMat, false);
  top.position.y = 3.0;
  addBox(-8, -18, 2, 2.4, 2, rustMat);
  addCyl(-20, -3, 0.55, 1.1, rustMat);
  addCyl(20, 3, 0.55, 1.1, tealMat);
  addCyl(-2, -22, 0.55, 1.1, darkMat);
  addCyl(8, 13, 0.55, 1.1, rustMat);
  // Pipes along the north wall (visual).
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 10), rustMat);
  pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 4.2, -25.2);
  scene.add(pipe);
  // Site markers: glowing A / B plates on the ground.
  function sitePlate(site, x, z, color) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide }));
    p.rotation.x = -Math.PI / 2; p.position.set(x, 0.02, z);
    scene.add(p);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.1, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.03, z);
    scene.add(ring);
  }
  sitePlate('A', -4, -18, 0xffb347);
  sitePlate('B', 7, 19, 0x4fc3f7);

  // Sunset sky dome + sun.
  const skyTex = canvasTex(4, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b1e4d'); g.addColorStop(0.45, '#7a3b6e');
    g.addColorStop(0.72, '#e2703a'); g.addColorStop(0.85, '#f7a54a'); g.addColorStop(1, '#5c3a28');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 16, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  scene.add(sky);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(14, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
  sun.position.set(180, 26, -60); sun.lookAt(0, 0, 0);
  scene.add(sun);

  // Lights: low warm sun + dusty ambient.
  const dir = new THREE.DirectionalLight(0xffb36b, 3.2);
  dir.position.set(60, 26, -30);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -45; dir.shadow.camera.right = 45;
  dir.shadow.camera.top = 35; dir.shadow.camera.bottom = -35;
  dir.shadow.camera.far = 160;
  scene.add(dir);
  scene.add(new THREE.HemisphereLight(0xd8a276, 0x5a4632, 1.5));
  scene.fog = new THREE.FogExp2(0xb0714a, 0.011);

  return { colliders, shootables };
}

// Circle (radius r) vs AABB colliders: push (x,z) out. Returns corrected [x,z].
export function resolveCollision(x, z, r, colliders) {
  for (const b of colliders) {
    if (b.maxY < 0.9) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      z = cz + (dz / d) * r;
    } else {
      // Inside the box: push out along the smallest penetration axis.
      const pl = x - b.minX, pr = b.maxX - x, pt = z - b.minZ, pb = b.maxZ - z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = b.minX - r;
      else if (m === pr) x = b.maxX + r;
      else if (m === pt) z = b.minZ - r;
      else z = b.maxZ + r;
    }
  }
  x = Math.max(-35.4, Math.min(35.4, x));
  z = Math.max(-25.4, Math.min(25.4, z));
  return [x, z];
}
export function pointInSite(x, z, site) {
  const s = SITES[site];
  return x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ;
}
