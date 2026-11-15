// DUSTLINE — bot AI: a state machine over the waypoint graph.
// patrol/rotate -> engage (reaction time + aim error) -> plant/defend/defuse.
// T bots push a site together; the planter carries the bomb; if he dies, another picks it up.
import * as THREE from 'three';
import { WAYPOINTS, findPath, nearestWaypoint, pointInSite, resolveCollision } from './world.js';
import { clamp, angDiff, mulberry32, segHitsBox } from './util.js';
import { WEAPONS, damageAt } from './weapons.js';

const EYE = 1.55;
const BODY_H = 1.7;

export function createBot(scene, opts) {
  const rng = mulberry32(opts.seed);
  const team = opts.team; // 'CT' (Vanguard) or 'T' (Duster)
  const color = team === 'CT' ? 0x2f6fb2 : 0xc96a2a;
  const dark = team === 'CT' ? 0x1d4a75 : 0x8a3d16;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.85, metalness: 0.1 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 });
  function part(w, h, d, mat, x, y, z, name) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.name = name;
    group.add(m);
    return m;
  }
  const legs = part(0.42, 0.75, 0.3, darkMat, 0, 0.375, 0, 'body');
  const torso = part(0.56, 0.62, 0.34, bodyMat, 0, 1.06, 0, 'body');
  const vest = part(0.58, 0.3, 0.38, darkMat, 0, 1.12, 0, 'body');
  const head = part(0.3, 0.3, 0.3, skinMat, 0, 1.58, 0, 'head');
  const helmet = part(0.34, 0.12, 0.34, darkMat, 0, 1.74, 0, 'head');
  const gun = part(0.07, 0.1, 0.6, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.7 }), 0.2, 1.15, -0.3, 'gun');
  // Team ring under the feet so the player reads friend from foe at a glance.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  group.add(ring);
  // Name tag sprite (canvas) — helps the killfeed and the HUD read.
  const tag = makeTag(opts.name, team === 'CT' ? '#7db8e8' : '#f0a35e');
  tag.position.y = 2.05;
  group.add(tag);
  scene.add(group);

  const bot = {
    name: opts.name, team, group, alive: true, hp: 100, armor: 0, seed: opts.seed,
    pos: new THREE.Vector3(opts.x, 0, opts.z),
    yaw: team === 'CT' ? -Math.PI / 2 : Math.PI / 2,
    speed: 3.6 + rng() * 0.9,
    skill: opts.skill ?? (0.35 + rng() * 0.5), // 0..1: aim + reaction
    state: 'patrol', target: null, targetPos: null,
    path: [], pathI: 0, waitT: 0, scanT: rng() * 0.3,
    reactT: 0, burstLeft: 0, burstT: 0, reloadT: 0, mag: 30,
    strafeDir: 1, strafeT: 0, lowHpHide: false,
    hasBomb: false, planting: 0, defusing: 0, site: null,
    lastSeen: 0, lastSeenPos: new THREE.Vector3(),
    kills: 0, deaths: 0, damage: 0,
    weapon: 'KR-7',
    isPlayer: false,
  };
  group.position.copy(bot.pos);
  group.rotation.y = bot.yaw;
  return bot;
}

function makeTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = ctx.measureText(text).width + 24;
  ctx.fillRect((256 - w) / 2, 8, w, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

// Line of sight between two eye positions, blocked by world colliders (2D + height).
export function hasLOS(ax, ay, az, bx, by, bz, colliders) {
  for (const b of colliders) {
    if (!segHitsBox(ax, az, bx, bz, b)) continue;
    // Blocked only if the box is tall enough to cut the sight line.
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return false;
    const cx = Math.max(b.minX, Math.min(ax, b.maxX));
    const cz = Math.max(b.minZ, Math.min(az, b.maxZ));
    const t = ((cx - ax) * dx + (cz - az) * dz) / len2;
    const y = ay + (by - ay) * clamp(t, 0, 1);
    if (y < b.maxY - 0.05) return false;
  }
  return true;
}

// --- per-frame bot update. ctx: {bots, player, colliders, shootables, raycaster, onShoot, onDamage, time, dt, bomb, roundPhase}
export function updateBot(bot, ctx) {
  if (!bot.alive) return;
  const dt = ctx.dt;
  const rng = bot._rng || (bot._rng = mulberry32((bot.seed || 7) * 7919 + 13));
  bot.scanT -= dt;
  // --- sensing: nearest visible living enemy.
  let enemy = null, enemyD = Infinity;
  if (bot.scanT <= 0) {
    bot.scanT = 0.12 + rng() * 0.08;
    const foes = ctx.bots.filter((b) => b.alive && b.team !== bot.team && !b.isPlayer);
    if (ctx.player.alive && bot.team !== 'CT') foes.push(ctx.player);
    for (const f of foes) {
      const dx = f.pos.x - bot.pos.x, dz = f.pos.z - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 55) continue;
      const ang = Math.atan2(-dx, -dz);
      const diff = Math.abs(angDiff(bot.yaw, ang));
      if (d > 6 && diff > 1.5) continue; // outside view cone (hearing covers close range)
      if (!hasLOS(bot.pos.x, EYE, bot.pos.z, f.pos.x, 1.35, f.pos.z, ctx.colliders)) continue;
      if (d < enemyD) { enemyD = d; enemy = f; }
    }
    if (enemy) {
      bot.lastSeen = ctx.time;
      bot.lastSeenPos.copy(enemy.pos);
      if (bot.target !== enemy) {
        bot.target = enemy;
        bot.reactT = 0.55 - bot.skill * 0.35 + rng() * 0.25; // 0.2–0.8 s
      }
    } else if (bot.target && ctx.time - bot.lastSeen > 1.6) {
      bot.target = null;
    }
  }
  // --- objective: plant / defuse / rotate.
  const bomb = ctx.bomb;
  if (bot.team === 'T' && bot.hasBomb && !bomb.planted && ctx.roundPhase === 'live') {
    if (pointInSite(bot.pos.x, bot.pos.z, bot.site || 'A')) {
      bot.planting += dt;
      bot.state = 'plant';
      if (bot.planting >= 3) {
        bot.planting = 0;
        ctx.onPlant(bot);
      }
      return; // stand still and plant
    }
    bot.planting = 0;
  }
  if (bot.team === 'CT' && bomb.planted && ctx.roundPhase === 'live') {
    const d = Math.hypot(bomb.x - bot.pos.x, bomb.z - bot.pos.z);
    if (d < 1.6) {
      bot.defusing += dt;
      bot.state = 'defuse';
      if (bot.defusing >= 5) { bot.defusing = 0; ctx.onDefuse(bot); }
      return;
    }
    bot.defusing = 0;
    if (bot.state !== 'engage') bot.state = 'rotate';
  }
  if (bot.hp < 35 && bot.state !== 'engage') bot.lowHpHide = true; else if (bot.hp > 60) bot.lowHpHide = false;

  // --- movement target.
  let dest = null, wantSpeed = bot.speed;
  if (bot.target) {
    bot.state = 'engage';
    // Strafe while duelling; close distance if too far, back off if too close.
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafeT = 0.7 + rng() * 0.9; bot.strafeDir = rng() < 0.5 ? -1 : 1; }
    const dx = bot.target.pos.x - bot.pos.x, dz = bot.target.pos.z - bot.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const fx = dx / d, fz = dz / d;
    const want = bot.weapon === 'Breacher-12' ? 6 : bot.weapon === 'Longshot-50' ? 26 : 14;
    const radial = d > want + 3 ? 1 : d < want - 4 ? -0.7 : 0;
    dest = { x: bot.pos.x + fx * radial + (-fz) * bot.strafeDir * 0.8, z: bot.pos.z + fz * radial + fx * bot.strafeDir * 0.8 };
    wantSpeed = bot.speed * 0.75;
  } else if (bot.team === 'T' && ctx.roundPhase === 'live') {
    bot.state = bot.hasBomb ? 'plant' : 'patrol';
    dest = waypointDest(bot, bot.site);
  } else if (bot.team === 'CT' && bomb.planted) {
    dest = { x: bomb.x + (rng() - 0.5), z: bomb.z + (rng() - 0.5) };
  } else if (bot.team === 'CT') {
    bot.state = 'defend';
    dest = waypointDest(bot, bot.defendSite);
  } else {
    dest = waypointDest(bot, bot.site);
  }
  if (bot.lowHpHide && !bot.target) { // fall back to the nearest waypoint behind cover: just wait.
    dest = null;
    wantSpeed = 0;
  }
  if (dest) {
    const dx = dest.x - bot.pos.x, dz = dest.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.25) {
      const nx = bot.pos.x + (dx / d) * wantSpeed * dt;
      const nz = bot.pos.z + (dz / d) * wantSpeed * dt;
      const [rx, rz] = resolveCollision(nx, nz, 0.4, ctx.colliders);
      bot.pos.x = rx; bot.pos.z = rz;
      bot.yaw = Math.atan2(-(dx / d), -(dz / d));
      bot.moving = true;
    } else {
      bot.moving = false;
      advancePath(bot);
    }
  } else bot.moving = false;

  // Face the enemy while engaging (turn speed limited by skill).
  if (bot.target) {
    const dx = bot.target.pos.x - bot.pos.x, dz = bot.target.pos.z - bot.pos.z;
    const want = Math.atan2(-dx, -dz);
    bot.yaw += clamp(angDiff(bot.yaw, want), -dt * (2.5 + bot.skill * 4), dt * (2.5 + bot.skill * 4));
  }
  bot.group.position.set(bot.pos.x, 0, bot.pos.z);
  bot.group.rotation.y = bot.yaw;
  bot.group.visible = bot.alive;

  // --- shooting.
  if (bot.reloadT > 0) { bot.reloadT -= dt; if (bot.reloadT <= 0) bot.mag = WEAPONS[bot.weapon].mag; }
  if (bot.target && bot.reloadT <= 0) {
    bot.reactT -= dt;
    if (bot.reactT <= 0) {
      bot.burstT -= dt;
      if (bot.burstLeft <= 0 && bot.burstT <= 0) {
        bot.burstLeft = 3 + Math.floor(rng() * 4);
        bot.burstT = 0.45 + rng() * 0.5;
      }
      if (bot.burstLeft > 0) {
        const w = WEAPONS[bot.weapon];
        const interval = 60 / w.rpm;
        bot._shotT = (bot._shotT || 0) - dt;
        if (bot._shotT <= 0) {
          bot._shotT = interval;
          bot.burstLeft--;
          bot.mag--;
          ctx.onShoot(bot, bot.target, enemyD);
          if (bot.mag <= 0) { bot.reloadT = w.reload; }
        }
      }
    }
  }
}

// Pick the next waypoint on the way to the bot's objective site.
function waypointDest(bot, site) {
  const goalWp = site === 'B' ? 20 : 14;
  const cur = nearestWaypoint(bot.pos.x, bot.pos.z);
  if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== goalWp) {
    bot.path = findPath(cur, goalWp);
    bot.pathI = 0;
  }
  // Skip waypoints already reached.
  while (bot.pathI < bot.path.length) {
    const wp = WAYPOINTS[bot.path[bot.pathI]];
    const d = Math.hypot(wp[0] - bot.pos.x, wp[1] - bot.pos.z);
    if (d < 1.0) bot.pathI++;
    else return { x: wp[0], z: wp[1] };
  }
  return { x: WAYPOINTS[goalWp][0], z: WAYPOINTS[goalWp][1] };
}
function advancePath(bot) {
  if (bot.pathI < bot.path.length - 1) bot.pathI++;
}

export function killBot(bot, killer) {
  bot.alive = false;
  bot.deaths++;
  bot.group.rotation.x = -Math.PI / 2; // fall over
  bot.group.position.y = 0.15;
  if (killer) killer.kills++;
}
export function resetBot(bot, x, z, yaw) {
  bot.alive = true;
  bot.hp = 100; bot.armor = 0;
  bot.pos.set(x, 0, z);
  bot.yaw = yaw;
  bot.target = null; bot.path = []; bot.pathI = 0;
  bot.planting = 0; bot.defusing = 0; bot.reloadT = 0; bot.mag = 30;
  bot.group.rotation.set(0, yaw, 0);
  bot.group.position.set(x, 0, z);
  bot.group.visible = true;
}
