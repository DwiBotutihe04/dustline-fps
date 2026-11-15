// DUSTLINE — boot, loop, player, rounds, economy, bomb, shooting, particles.
// ?shot=mid|plant|buy|ads&seed=N renders one deterministic frame for a capture.
// ?demo=1 plays the match bot-vs-bot (the player is AI-driven) and reports it on
// window.__DUSTLINE__ for headless testing. No network requests anywhere.
import * as THREE from 'three';
import { createWorld, resolveCollision, pointInSite, SPAWNS, SITES } from './world.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createBot, updateBot, killBot, resetBot, hasLOS } from './bots.js';
import { WEAPONS, WEAPON_ORDER, ARMOR_PRICE, createViewmodel, currentSpread, damageAt } from './weapons.js';
import { clamp, lerp, mulberry32, angDiff } from './util.js';

const FIXED = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const demo = params.get('demo') === '1';
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const audio = createAudio();
const input = createInput(renderer.domElement, {
  onLock(locked) {
    if (shot || demo) return;
    if (locked) { started = true; hud.hideOverlay(); if (phase === 'menu') startMatch(); }
    else if (phase !== 'menu' && !matchOver) hud.showOverlay('paused');
  },
  onKey(code, down) {
    if (!down || shot) return;
    if (code === 'KeyB' && phase === 'buy' && player.alive) toggleBuy();
    if (code === 'KeyR' && player.alive && phase === 'live') startReload();
    if (phase === 'buy' && player.alive) {
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
      if (n >= 0) buyWeapon(WEAPON_ORDER[n]);
      if (code === 'Digit6') buyWeapon('ARMOR');
    } else if (player.alive && phase === 'live') {
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
      if (n >= 0 && owned.has(WEAPON_ORDER[n])) equip(WEAPON_ORDER[n]);
    }
  },
});

// ---------------- state ----------------
let phase = 'menu'; // menu | buy | live | roundEnd | matchEnd
let started = false, matchOver = false;
let round = 1, scoreCT = 0, scoreT = 0, lossStreak = 0;
let phaseT = 0; // seconds left in the current phase
let time = 0, frozen = false, elapsed = 0;
const timeScale = () => (demo ? { buy: 2, live: 30, bomb: 12, end: 1 } : { buy: 15, live: 100, bomb: 35, end: 4 });
const bomb = { planted: false, x: 0, z: 0, site: 'A', timer: 0, defused: false };
const player = {
  pos: new THREE.Vector3(-32, 0, 0), vel: new THREE.Vector3(), yaw: -Math.PI / 2, pitch: 0,
  hp: 100, armor: 0, money: 800, alive: true, isPlayer: true, team: 'CT', name: 'YOU',
  weapon: 'P9', mag: 12, reserve: 36, kills: 0, deaths: 0, damage: 0,
  crouch: false, onGround: true, ads: 0, spray: 0, reloadT: 0, fireT: 0, lastSeen: 0,
  lastSeenPos: new THREE.Vector3(), seed: 5,
};
const owned = new Set(['P9']);
const bots = [];
const CT_NAMES = ['HAVOC', 'BRICK', 'WREN', 'SABLE'];
const T_NAMES = ['DUNE', 'RUST', 'FANG', 'COBRA', 'VIPER'];
let planter = null;
let buyOpen = false;
let spectate = null;

// Player hitbox (invisible) so bots can shoot the player.
const playerHit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.4),
  new THREE.MeshBasicMaterial({ visible: false }));
playerHit.userData.player = true;
scene.add(playerHit);
const shootables = world.shootables.slice();
shootables.push(playerHit);

function spawnBots() {
  for (const b of bots) scene.remove(b.group);
  bots.length = 0;
  shootables.length = world.shootables.length + 1; // keep world + playerHit
  CT_NAMES.forEach((n, i) => {
    const [x, z] = SPAWNS.CT[(i + 1) % 5];
    const b = createBot(scene, { name: n, team: 'CT', x, z, seed: seed + i * 31 + 3, skill: 0.35 + rng() * 0.45 });
    b.defendSite = i < 2 ? 'A' : i < 3 ? 'B' : 'A';
    if (i === 3) b.defendSite = 'B';
    bots.push(b);
  });
  T_NAMES.forEach((n, i) => {
    const [x, z] = SPAWNS.T[i];
    const b = createBot(scene, { name: n, team: 'T', x, z, seed: seed + i * 47 + 11, skill: 0.3 + rng() * 0.5 });
    b.site = i < 2 ? 'A' : i < 4 ? 'B' : 'A';
    if (i === 4) b.site = rng() < 0.5 ? 'A' : 'B';
    bots.push(b);
  });
  for (const b of bots) {
    for (const m of b.group.children) {
      if (m.name === 'body' || m.name === 'head') {
        m.userData.bot = b;
        m.userData.part = m.name;
        shootables.push(m);
      }
    }
  }
  planter = bots.find((b) => b.team === 'T');
  if (planter) planter.hasBomb = true;
}
spawnBots();

// Demo driver: an AI that plays the player's seat in ?demo=1.
let driver = null;
if (demo) {
  driver = createBot(scene, { name: 'YOU', team: 'CT', x: -32, z: 0, seed: seed + 999, skill: 0.7 });
  driver.isPlayer = true;
  driver.group.visible = false;
  driver.defendSite = 'A';
}

const viewmodel = createViewmodel(camera);
viewmodel.setWeapon('P9');

// ---------------- tracers & sparks (pooled, no per-frame allocation) ----------------
const TRACERS = 24;
const tracerGeo = new THREE.BufferGeometry();
const tracerPos = new Float32Array(TRACERS * 6);
tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.9 });
const tracers = new THREE.LineSegments(tracerGeo, tracerMat);
tracers.frustumCulled = false;
scene.add(tracers);
const tracerLife = new Float32Array(TRACERS);
let tracerI = 0;
function spawnTracer(a, b) {
  const i = tracerI; tracerI = (tracerI + 1) % TRACERS;
  tracerPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
  tracerLife[i] = 0.07;
  tracerGeo.attributes.position.needsUpdate = true;
}
const SPARKS = 240;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3);
const sparkVel = new Float32Array(SPARKS * 3);
const sparkLife = new Float32Array(SPARKS);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffc861, size: 0.09, transparent: true, opacity: 0.95 }));
sparks.frustumCulled = false;
scene.add(sparks);
let sparkI = 0;
function spawnSparks(p, n = 6) {
  for (let k = 0; k < n; k++) {
    const i = sparkI; sparkI = (sparkI + 1) % SPARKS;
    sparkPos[i * 3] = p.x; sparkPos[i * 3 + 1] = p.y; sparkPos[i * 3 + 2] = p.z;
    sparkVel[i * 3] = (rng() - 0.5) * 4; sparkVel[i * 3 + 1] = rng() * 3; sparkVel[i * 3 + 2] = (rng() - 0.5) * 4;
    sparkLife[i] = 0.35 + rng() * 0.25;
  }
  sparkGeo.attributes.position.needsUpdate = true;
}
function stepParticles(dt) {
  for (let i = 0; i < TRACERS; i++) {
    if (tracerLife[i] > 0) {
      tracerLife[i] -= dt;
      if (tracerLife[i] <= 0) {
        tracerPos[i * 6 + 1] = -100; tracerPos[i * 6 + 4] = -100;
        tracerGeo.attributes.position.needsUpdate = true;
      }
    }
  }
  let any = false;
  for (let i = 0; i < SPARKS; i++) {
    if (sparkLife[i] > 0) {
      sparkLife[i] -= dt; any = true;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      sparkVel[i * 3 + 1] -= 9 * dt;
      if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -100;
    }
  }
  if (any) sparkGeo.attributes.position.needsUpdate = true;
}

// ---------------- shooting ----------------
const raycaster = new THREE.Raycaster();
raycaster.far = 150;
const tmpDir = new THREE.Vector3();
const tmpV = new THREE.Vector3();

function muzzleWorld(out) {
  camera.getWorldPosition(out);
  tmpDir.set(0.22, -0.18, -0.8).applyQuaternion(camera.quaternion);
  return out.add(tmpDir);
}
function shootFrom(origin, dir, shooter, spread) {
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects(shootables, false);
  const hit = hits[0];
  if (!hit) return null;
  const p = hit.point;
  spawnTracer(origin, p);
  if (hit.object.userData.bot) {
    const b = hit.object.userData.bot;
    const head = hit.object.userData.part === 'head';
    const d = origin.distanceTo(p);
    let dmg = damageAt(WEAPONS[shooter.weapon || 'KR-7'], d, head);
    if (b.armor > 0) { const absorbed = Math.min(b.armor, dmg * 0.5); b.armor -= absorbed; dmg -= absorbed; }
    damageBot(b, dmg, head, shooter);
    return { bot: b, head, point: p };
  }
  if (hit.object.userData.player && shooter !== player) {
    const d = origin.distanceTo(p);
    let dmg = damageAt(WEAPONS[shooter.weapon || 'KR-7'], d, false);
    if (player.armor > 0) { const absorbed = Math.min(player.armor, dmg * 0.5); player.armor -= absorbed; dmg -= absorbed; }
    damagePlayer(dmg, shooter.pos || shooter);
    return { player: true, point: p };
  }
  spawnSparks(p, 5);
  return { world: true, point: p };
}
function damageBot(b, dmg, head, shooter) {
  if (!b.alive) return;
  b.hp -= dmg;
  if (shooter) { shooter.damage = (shooter.damage || 0) + dmg; }
  if (shooter === player) {
    hud.hitMarker(false, head);
    audio.hit(head);
  }
  if (b.hp <= 0) {
    killBot(b, shooter);
    if (shooter) shooter.kills = (shooter.kills || 0) + 1;
    const wname = WEAPONS[shooter?.weapon || 'KR-7'].name;
    hud.killfeed(`${shooter?.name || '?'}  [${wname}]  ${b.name}`, shooter?.team === 'CT');
    if (shooter === player) { player.money += 300; hud.setMoney(player.money); audio.kill(); }
    else if (shooter && shooter.team === 'CT') audio.kill();
    if (b.hasBomb) {
      b.hasBomb = false;
      const mate = bots.find((x) => x.alive && x.team === 'T' && x !== b);
      if (mate) { mate.hasBomb = true; planter = mate; hud.killfeed('Bomb picked up by ' + mate.name, false); }
    }
    checkRoundEnd();
  }
}
function damagePlayer(dmg, fromPos) {
  if (!player.alive) return;
  player.hp -= dmg;
  audio.hurt();
  const dx = (fromPos.x ?? fromPos.pos?.x ?? 0) - player.pos.x;
  const dz = (fromPos.z ?? fromPos.pos?.z ?? 0) - player.pos.z;
  const ang = Math.atan2(dx, dz) - player.yaw;
  hud.damageFrom((ang * 180) / Math.PI);
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    player.deaths++;
    hud.killfeed('You were eliminated', false);
    const alive = bots.filter((b) => b.alive && b.team === 'CT');
    spectate = alive[0] || null;
    input.releaseLock();
    checkRoundEnd();
  }
  hud.setHealth(player.hp, player.armor);
}
function playerShoot() {
  const w = WEAPONS[player.weapon];
  if (player.reloadT > 0 || player.fireT > 0) return;
  if (player.mag <= 0) { audio.dryFire(); startReload(); return; }
  player.fireT = 60 / w.rpm;
  player.mag--;
  player.spray = Math.min(1, player.spray + (w.auto ? 0.09 : 0.16));
  const spread = currentSpread(w, player.vel.length(), input.state.ads, player.spray);
  camera.getWorldPosition(tmpV);
  for (let p = 0; p < w.pellets; p++) {
    camera.getWorldDirection(tmpDir);
    tmpDir.x += (rng() * 2 - 1) * spread;
    tmpDir.y += (rng() * 2 - 1) * spread;
    tmpDir.z += (rng() * 2 - 1) * spread;
    tmpDir.normalize();
    shootFrom(tmpV, tmpDir, player, spread);
  }
  viewmodel.flash();
  viewmodel.addKick(w.kick);
  player.pitch += w.kick * 0.55;
  audio.shot(player.weapon, 0);
  hud.setAmmo(player.mag, player.reserve);
}
function startReload() {
  const w = WEAPONS[player.weapon];
  if (player.reloadT > 0 || player.mag === w.mag || player.reserve <= 0) return;
  player.reloadT = w.reload;
  viewmodel.startReload(w.reload);
  audio.reload();
}
function finishReload() {
  const w = WEAPONS[player.weapon];
  const need = w.mag - player.mag;
  const take = Math.min(need, player.reserve);
  player.mag += take;
  player.reserve -= take;
  hud.setAmmo(player.mag, player.reserve);
}
function equip(key) {
  if (!owned.has(key)) return;
  player.weapon = key;
  const w = WEAPONS[key];
  player.mag = w.mag; player.reserve = w.reserve;
  player.reloadT = 0; player.spray = 0;
  viewmodel.setWeapon(key);
  hud.setWeapon(w.name);
  hud.setAmmo(player.mag, player.reserve);
}
function buyWeapon(key) {
  if (phase !== 'buy' || !player.alive) return;
  if (key === 'ARMOR') {
    if (player.armor >= 100 || player.money < ARMOR_PRICE) { audio.denied(); return; }
    player.money -= ARMOR_PRICE; player.armor = 100;
    audio.buy(); hud.setMoney(player.money); hud.setHealth(player.hp, player.armor);
    return;
  }
  const w = WEAPONS[key];
  if (owned.has(key)) { equip(key); return; }
  if (player.money < w.price) { audio.denied(); return; }
  player.money -= w.price;
  owned.add(key);
  equip(key);
  audio.buy();
  hud.setMoney(player.money);
}
function toggleBuy() {
  buyOpen = !buyOpen;
  hud.showBuy(buyOpen);
  if (buyOpen) input.releaseLock();
  else input.requestLock();
}

// ---------------- rounds ----------------
function resetRoundPositions() {
  player.pos.set(SPAWNS.CT[0][0], 0, SPAWNS.CT[0][1]);
  player.yaw = -Math.PI / 2; player.pitch = 0;
  bots.forEach((b, i) => {
    const arr = b.team === 'CT' ? SPAWNS.CT : SPAWNS.T;
    const [x, z] = arr[b.team === 'CT' ? ((i % 4) + 1) % 5 : i % 5];
    resetBot(b, x, z, b.team === 'CT' ? -Math.PI / 2 : Math.PI / 2);
    b.weapon = 'KR-7'; b.mag = 30;
  });
  if (driver) resetBot(driver, SPAWNS.CT[0][0], SPAWNS.CT[0][1], -Math.PI / 2);
  planter = bots.find((b) => b.team === 'T');
  if (planter) planter.hasBomb = true;
  bomb.planted = false; bomb.defused = false; bomb.timer = 0;
  player.alive = true; player.hp = 100; player.armor = player.armor > 0 ? player.armor : 0;
  player.vel.set(0, 0, 0);
  spectate = null;
  hud.hideBombTimer(); hud.hidePlant();
  hud.setHealth(player.hp, player.armor);
}
function startBuyPhase() {
  phase = 'buy';
  phaseT = timeScale().buy;
  resetRoundPositions();
  buyOpen = false;
  hud.showBuy(false);
  hud.setRound(round);
  hud.setTimer(phaseT);
  hud.banner('ROUND ' + round, 'Buy phase — press B to shop', 2200);
}
function startLivePhase() {
  phase = 'live';
  phaseT = timeScale().live;
  hud.showBuy(false);
  buyOpen = false;
  hud.banner('ROUND ' + round, scoreCT + ' — ' + scoreT, 1500);
}
function endRound(winner, reason) {
  if (phase === 'roundEnd') return;
  phase = 'roundEnd';
  phaseT = timeScale().end;
  hud.hideBombTimer(); hud.hidePlant();
  if (winner === 'CT') {
    scoreCT++;
    lossStreak = 0;
    player.money += 3250;
    audio.roundWin();
    hud.banner('ROUND WON', reason, 3000);
    hud.killfeed('Vanguard take the round — ' + reason, true);
  } else {
    scoreT++;
    lossStreak = Math.min(2, lossStreak + 1);
    player.money += 1900 + lossStreak * 500;
    audio.roundLose();
    hud.banner('ROUND LOST', reason, 3000);
    hud.killfeed('Dusters take the round — ' + reason, false);
  }
  hud.setMoney(player.money);
  hud.setScore(scoreCT, scoreT);
  if (scoreCT >= 5 || scoreT >= 5 || round >= 9) endMatch();
}
function checkRoundEnd() {
  if (phase !== 'live') return;
  const ctAlive = bots.filter((b) => b.alive && b.team === 'CT').length + (player.alive ? 1 : 0);
  const tAlive = bots.filter((b) => b.alive && b.team === 'T').length;
  if (bomb.planted) return; // bomb decides now
  if (tAlive === 0) endRound('CT', 'Squad wiped');
  else if (ctAlive === 0) endRound('T', 'Squad wiped');
}
function endMatch() {
  matchOver = true;
  phase = 'matchEnd';
  const win = scoreCT > scoreT;
  const mvp = [...bots, player].sort((a, b) => b.kills - a.kills)[0];
  const rows = [
    ['Score', scoreCT + ' — ' + scoreT],
    ['Your K / D', player.kills + ' / ' + player.deaths],
    ['Your damage', Math.round(player.damage)],
    ['MVP', (mvp?.name || '—') + ' (' + (mvp?.kills || 0) + ' kills)'],
    ['Money', '$' + player.money],
  ];
  hud.showOverlay('end', { win, line: (win ? 'Vanguard take Foundry Sector K-7, ' : 'Dusters take Foundry Sector K-7, ') + scoreCT + ' — ' + scoreT + '. MVP: ' + (mvp?.name || '—') + '.', rows });
  if (document.pointerLockElement) input.releaseLock();
  window.__DUSTLINE__ = { ...(window.__DUSTLINE__ || {}), matchOver: true, winner: win ? 'CT' : 'T', scoreCT, scoreT };
}
function startMatch() {
  round = 1; scoreCT = 0; scoreT = 0; lossStreak = 0; matchOver = false;
  player.money = 800; player.kills = 0; player.deaths = 0; player.damage = 0;
  owned.clear(); owned.add('P9');
  equip('P9');
  bots.forEach((b) => { b.kills = 0; b.deaths = 0; b.damage = 0; });
  hud.setScore(0, 0); hud.setMoney(800);
  startBuyPhase();
}
hud.onPlay(() => {
  audio.unlock();
  if (phase === 'menu') { started = true; hud.hideOverlay(); input.requestLock(); startMatch(); }
  else if (matchOver) { hud.hideOverlay(); input.requestLock(); startMatch(); }
  else { hud.hideOverlay(); input.requestLock(); }
});
hud.onRematch(() => { hud.hideOverlay(); input.requestLock(); startMatch(); });
hud.buildBuyMenu((key) => buyWeapon(key));

// ---------------- bot shooting / bomb events ----------------
const botCtx = {
  bots, player, colliders: world.colliders, shootables,
  raycaster, time: 0, dt: FIXED, bomb, roundPhase: 'live',
  onShoot(shooter, target, dist) {
    const w = WEAPONS[shooter.weapon];
    const eye = new THREE.Vector3(shooter.pos.x, 1.5, shooter.pos.z);
    const aim = new THREE.Vector3(target.pos.x, target.isPlayer ? 1.35 : 1.2, target.pos.z);
    const err = (1 - shooter.skill) * 0.55 + (dist > 25 ? 0.35 : 0);
    aim.x += (rng() - 0.5) * err * dist * 0.12;
    aim.y += (rng() - 0.5) * err * 1.2 + (rng() < 0.18 ? 0.35 : 0); // occasional head-level shot
    aim.z += (rng() - 0.5) * err * dist * 0.12;
    const dir = aim.sub(eye).normalize();
    const origin = eye.clone();
    origin.x += Math.sin(shooter.yaw) * 0.3; origin.z += Math.cos(shooter.yaw) * 0.3;
    shootFrom(origin, dir, shooter);
    audio.shot(shooter.weapon, clamp(dist / 60, 0, 1));
    // Bot muzzle flash: brief tracer from the gun.
    spawnTracer(origin, origin.clone().add(dir.clone().multiplyScalar(1.2)));
  },
  onPlant(bot) {
    bomb.planted = true;
    bomb.x = bot.pos.x; bomb.z = bot.pos.z;
    bomb.site = pointInSite(bot.pos.x, bot.pos.z, 'A') ? 'A' : 'B';
    bomb.timer = timeScale().bomb;
    bots.filter((b) => b.team === 'T').forEach((b) => { b.money = (b.money || 0) + 300; });
    hud.banner('BOMB PLANTED', 'Site ' + bomb.site + ' — defuse it!', 3000);
    hud.killfeed('Bomb planted at Site ' + bomb.site, false);
    audio.plantDone();
  },
  onDefuse(bot) {
    bomb.defused = true;
    bomb.planted = false;
    hud.hideBombTimer();
    endRound('CT', 'Bomb defused by ' + bot.name);
  },
};

// ---------------- player step ----------------
function stepPlayer(dt) {
  if (!player.alive) return;
  const look = input.takeLook();
  const sens = 0.0023;
  player.yaw -= look.x * sens * (1 - player.ads * 0.5);
  player.pitch = clamp(player.pitch - look.y * sens * (1 - player.ads * 0.5), -1.5, 1.5);
  player.crouch = input.state.keys.has('ControlLeft') || input.state.keys.has('ControlRight');
  const w = WEAPONS[player.weapon];
  const adsTarget = input.state.ads && player.reloadT <= 0 ? 1 : 0;
  player.ads = lerp(player.ads, adsTarget, dt * 10);
  const speed = player.crouch ? 2.6 : input.state.keys.has('ShiftLeft') ? 2.8 : player.ads > 0.5 ? 2.6 : 5.4;
  let fx = 0, fz = 0;
  if (input.state.keys.has('KeyW')) fz -= 1;
  if (input.state.keys.has('KeyS')) fz += 1;
  if (input.state.keys.has('KeyA')) fx -= 1;
  if (input.state.keys.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len; fz /= len;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wx = fx * cos - fz * sin;
  const wz = fx * sin + fz * cos;
  const accel = player.onGround ? 14 : 4;
  player.vel.x = lerp(player.vel.x, wx * speed, Math.min(1, accel * dt));
  player.vel.z = lerp(player.vel.z, wz * speed, Math.min(1, accel * dt));
  if (input.state.keys.has('Space') && player.onGround) { player.vel.y = 5.2; player.onGround = false; }
  player.vel.y -= 14 * dt;
  let nx = player.pos.x + player.vel.x * dt;
  let nz = player.pos.z + player.vel.z * dt;
  [nx, nz] = resolveCollision(nx, nz, 0.42, world.colliders);
  player.pos.x = nx; player.pos.z = nz;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.onGround = true; }
  // Firing (semi-auto needs a fresh click).
  player.fireT -= dt;
  if (player.reloadT > 0) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) finishReload();
  }
  if (input.state.firing && phase === 'live') {
    if (w.auto) playerShoot();
    else if (!player._clicked) { player._clicked = true; playerShoot(); }
  }
  if (!input.state.firing) player._clicked = false;
  player.spray = Math.max(0, player.spray - dt * 1.4);
  // Defuse: hold E near a planted bomb.
  if (bomb.planted && input.state.keys.has('KeyE')) {
    const d = Math.hypot(bomb.x - player.pos.x, bomb.z - player.pos.z);
    if (d < 1.8) {
      player._defuse = (player._defuse || 0) + dt;
      hud.showPlant(player._defuse / 5);
      if (player._defuse >= 5) {
        player._defuse = 0;
        bomb.planted = false; bomb.defused = true;
        hud.hidePlant(); hud.hideBombTimer();
        endRound('CT', 'Bomb defused');
      }
    } else { player._defuse = 0; hud.hidePlant(); }
  } else if (player._defuse) { player._defuse = 0; hud.hidePlant(); }
  // Footsteps.
  const spd = Math.hypot(player.vel.x, player.vel.z);
  player._stepT = (player._stepT || 0) - dt * spd;
  if (spd > 1 && player._stepT <= 0) { player._stepT = 2.4; audio.step(); }
  // Camera + viewmodel.
  const eye = player.crouch ? 1.12 : 1.62;
  camera.position.set(player.pos.x, player.pos.y + eye, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  const targetFov = 74 / (player.ads > 0.05 ? lerp(1, w.zoom, player.ads) : 1);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = lerp(camera.fov, targetFov, dt * 12);
    camera.updateProjectionMatrix();
  }
  document.getElementById('scope').classList.toggle('on', player.weapon === 'Longshot-50' && player.ads > 0.7);
  viewmodel.setVisible(!(player.weapon === 'Longshot-50' && player.ads > 0.7));
  viewmodel.step(dt, spd > 0.5 ? 1 : 0, player.ads, spd);
  hud.setCrosshair(4 + player.spray * 14 + spd * 1.2 - player.ads * 3);
  playerHit.position.set(player.pos.x, player.pos.y + 0.85, player.pos.z);
  playerHit.rotation.y = player.yaw;
}

// ---------------- simulation step ----------------
function step(dt) {
  time += dt;
  elapsed += dt;
  botCtx.time = time;
  botCtx.dt = dt;
  botCtx.roundPhase = phase;
  // Phase timers.
  if (phase === 'buy') {
    phaseT -= dt;
    hud.setTimer(phaseT);
    if (phaseT <= 0) startLivePhase();
  } else if (phase === 'live') {
    phaseT -= dt;
    hud.setTimer(phaseT);
    if (bomb.planted) {
      bomb.timer -= dt;
      hud.showBombTimer(bomb.timer);
      if (bomb.timer <= 0) { bomb.planted = false; endRound('T', 'Bomb detonated'); }
    } else if (phaseT <= 0) {
      endRound('CT', 'Time expired — site held');
    }
  } else if (phase === 'roundEnd') {
    phaseT -= dt;
    if (phaseT <= 0 && !matchOver) { round++; startBuyPhase(); }
  }
  if (phase === 'live' || phase === 'buy') {
    if (demo && driver) {
      updateBot(driver, botCtx);
      // The driver IS the player: mirror its body. Damage flows the other way:
      // T bots hurt the player (damagePlayer), and the driver copies that after.
      player.pos.set(driver.pos.x, 0, driver.pos.z);
      player.yaw = driver.yaw;
      if (driver.target) {
        const dx = driver.target.pos.x - player.pos.x;
        const dy = 1.35 - 1.62;
        const dz = driver.target.pos.z - player.pos.z;
        player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      const eye = 1.62;
      camera.position.set(player.pos.x, eye, player.pos.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      playerHit.position.set(player.pos.x, 0.85, player.pos.z);
      hud.setHealth(player.hp, player.armor);
      hud.setAmmo(driver.mag, 30);
      if (!driver.alive && !spectate) {
        const alive = bots.filter((b) => b.alive && b.team === 'CT');
        spectate = alive[0] || null;
      }
    } else {
      stepPlayer(dt);
    }
    for (const b of bots) updateBot(b, botCtx);
    if (demo && driver) { driver.hp = player.hp; driver.alive = player.alive; }
    // Spectate a living ally when dead.
    if (!player.alive && spectate && spectate.alive) {
      camera.position.set(spectate.pos.x, 1.9, spectate.pos.z);
      camera.rotation.set(-0.08, spectate.yaw, 0);
    }
  }
  stepParticles(dt);
  // HUD minimap, throttled.
  if (elapsed - (step._mm || 0) > 0.15) {
    step._mm = elapsed;
    hud.drawMinimap(world, player, bots, bomb, time);
    window.__DUSTLINE__ = {
      phase, round, scoreCT, scoreT, playerHp: Math.round(player.hp), playerAlive: player.alive,
      ctAlive: bots.filter((b) => b.alive && b.team === 'CT').length + (player.alive ? 1 : 0),
      tAlive: bots.filter((b) => b.alive && b.team === 'T').length,
      bombPlanted: bomb.planted, matchOver, time: Math.round(time),
    };
  }
}

// ---------------- main loop ----------------
let lastTime = performance.now();
let accumulator = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    const maxSteps = demo ? 120 : 5;
    let steps = 0;
    while (accumulator >= FIXED && steps < maxSteps) {
      step(FIXED);
      accumulator -= FIXED;
      steps++;
    }
    if (accumulator > FIXED * maxSteps) accumulator = 0;
  }
  renderer.render(scene, camera);
}
function settle(n) { for (let i = 0; i < n; i++) step(FIXED); }
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted++;
    if (painted === 2) { window.__shotReady = true; frozen = true; }
  }
  requestAnimationFrame(paint);
}
function aimAt(x, y, z) {
  const dx = x - player.pos.x, dy = y - (player.pos.y + 1.62), dz = z - player.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(clamp(dy / len, -1, 1));
  camera.position.set(player.pos.x, player.pos.y + 1.62, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  hud.setMoney(3200);
  player.money = 3200;
  if (name === 'mid') {
    startLivePhase();
    round = 2; scoreCT = 1; scoreT = 1;
    hud.setRound(2); hud.setScore(1, 1); phaseT = 78;
    buyWeaponSilent('KR-7');
    player.pos.set(-6, 0, 0);
    const t1 = bots.find((b) => b.team === 'T');
    const t2 = bots.filter((b) => b.team === 'T')[1];
    const ally = bots.find((b) => b.team === 'CT');
    resetBot(t1, 8, -1, Math.PI / 2); resetBot(t2, 12, 3, Math.PI / 2);
    resetBot(ally, -2, 5, -Math.PI / 2);
    bots.filter((b) => b !== t1 && b !== t2 && b !== ally).forEach((b) => { b.alive = false; b.group.visible = false; });
    settle(30);
    aimAt(8, 1.3, -1);
    // The enemy fires across the player's view at the ally in mid: tracer in frame.
    botCtx.onShoot(t1, ally, 14);
    settle(2);
    player.mag = 24;
    hud.setAmmo(24, 90);
  } else if (name === 'plant') {
    startLivePhase();
    round = 3; scoreCT = 1; scoreT = 1;
    hud.setRound(3); hud.setScore(1, 1); phaseT = 41;
    buyWeaponSilent('KR-7');
    player.pos.set(-12, 0, -13);
    bomb.planted = true; bomb.x = -4; bomb.z = -18; bomb.site = 'A'; bomb.timer = 22;
    hud.showBombTimer(22);
    const planterBot = bots.find((b) => b.team === 'T');
    const guard = bots.filter((b) => b.team === 'T')[1];
    resetBot(planterBot, -2.5, -16.5, Math.PI / 2);
    planterBot.crouch = true;
    resetBot(guard, 2, -14, Math.PI / 2);
    bots.filter((b) => b !== planterBot && b !== guard).forEach((b) => { b.alive = false; b.group.visible = false; });
    settle(30);
    aimAt(-4, 1.2, -18);
    player.mag = 18;
    hud.setAmmo(18, 90);
  } else if (name === 'buy') {
    startBuyPhase();
    player.pos.set(-30, 0, 0);
    const allies = bots.filter((b) => b.team === 'CT');
    allies.forEach((b, i) => resetBot(b, -28 + i * 2, -3 + i * 2, -Math.PI / 2));
    bots.filter((b) => b.team === 'T').forEach((b) => { b.alive = false; b.group.visible = false; });
    hud.showBuy(true);
    buyOpen = true;
    settle(20);
    aimAt(-16, 1.4, 0);
    hud.setAmmo(12, 36);
  } else if (name === 'ads') {
    startLivePhase();
    round = 4; scoreCT = 2; scoreT = 1;
    hud.setRound(4); hud.setScore(2, 1); phaseT = 63;
    buyWeaponSilent('Longshot-50');
    player.pos.set(-2, 0, 16);
    const far = bots.find((b) => b.team === 'T');
    resetBot(far, 22, 16, Math.PI / 2);
    bots.filter((b) => b !== far).forEach((b) => { b.alive = false; b.group.visible = false; });
    settle(30);
    aimAt(22, 1.3, 16);
    player.ads = 1;
    viewmodel.step(0.1, 0, 1, 0);
    viewmodel.setVisible(false);
    camera.fov = 74 / 3.2;
    camera.updateProjectionMatrix();
    document.getElementById('scope').classList.add('on');
    document.getElementById('crosshair').style.display = 'none';
    hud.setAmmo(5, 15);
  }
  hud.setHealth(player.hp, player.armor);
  hud.setMoney(player.money);
  paintTwiceThenReady();
}
function buyWeaponSilent(key) {
  owned.add(key);
  equip(key);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Boot.
hud.setAmmo(player.mag, player.reserve);
hud.setHealth(player.hp, player.armor);
hud.setMoney(player.money);
hud.setScore(0, 0);
hud.setTimer(100);
hud.showOverlay('start');
camera.position.set(player.pos.x, 1.62, player.pos.z);
camera.rotation.set(0, player.yaw, 0);
if (shot) {
  runShot(shot);
} else if (demo) {
  startMatch();
  requestAnimationFrame(frame);
} else {
  requestAnimationFrame(frame);
}
