// DUSTLINE — five original weapons. Stats, prices, viewmodels, recoil and spread.
import * as THREE from 'three';
import { clamp } from './util.js';

export const WEAPONS = {
  P9: { name: 'P9 Sidearm', price: 0, damage: 34, headMul: 2, rpm: 400, mag: 12, reserve: 36, reload: 1.4, spread: 0.011, moveSpread: 0.02, adsSpread: 0.004, auto: false, pellets: 1, range: 45, falloff: 0.55, kick: 0.011, zoom: 1.15, color: 0x2a2d33 },
  'Vex-9': { name: 'Vex-9 SMG', price: 1200, damage: 26, headMul: 2, rpm: 750, mag: 32, reserve: 96, reload: 2.1, spread: 0.016, moveSpread: 0.03, adsSpread: 0.007, auto: true, pellets: 1, range: 40, falloff: 0.5, kick: 0.008, zoom: 1.25, color: 0x3a3f2a },
  'KR-7': { name: 'KR-7 Rifle', price: 2700, damage: 36, headMul: 2, rpm: 600, mag: 30, reserve: 90, reload: 2.4, spread: 0.009, moveSpread: 0.024, adsSpread: 0.003, auto: true, pellets: 1, range: 70, falloff: 0.7, kick: 0.014, zoom: 1.35, color: 0x33302a },
  'Longshot-50': { name: 'Longshot-50 Sniper', price: 4750, damage: 110, headMul: 2, rpm: 50, mag: 5, reserve: 15, reload: 3.2, spread: 0.002, moveSpread: 0.05, adsSpread: 0.0004, auto: false, pellets: 1, range: 120, falloff: 0.95, kick: 0.05, zoom: 3.2, color: 0x24303a },
  'Breacher-12': { name: 'Breacher-12 Shotgun', price: 1050, damage: 22, headMul: 1.6, rpm: 70, mag: 6, reserve: 24, reload: 2.8, spread: 0.05, moveSpread: 0.06, adsSpread: 0.035, auto: false, pellets: 8, range: 22, falloff: 0.35, kick: 0.045, zoom: 1.1, color: 0x4a2f22 },
};
export const WEAPON_ORDER = ['P9', 'Vex-9', 'KR-7', 'Longshot-50', 'Breacher-12'];
export const ARMOR_PRICE = 650;

// Damage at distance d (metres), before armour.
export function damageAt(w, d, head) {
  const f = d <= w.range * 0.4 ? 1 : 1 - (1 - w.falloff) * Math.min(1, (d - w.range * 0.4) / (w.range * 0.6));
  return w.damage * f * (head ? w.headMul : 1);
}

// A low-poly gun built from boxes, parented to the camera. One per weapon, swapped on buy.
export function createViewmodel(camera) {
  const group = new THREE.Group();
  camera.add(group);
  let current = null;
  const mats = {};
  function mat(color) {
    if (!mats[color]) mats[color] = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.7 });
    return mats[color];
  }
  const dark = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.8 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.9, metalness: 0.1 });
  function box(w, h, d, m, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    return mesh;
  }
  function build(key) {
    const w = WEAPONS[key];
    const g = new THREE.Group();
    const m = mat(w.color);
    if (key === 'P9') {
      g.add(box(0.05, 0.09, 0.24, m, 0, 0, -0.1));
      g.add(box(0.045, 0.11, 0.05, gripMat, 0, -0.09, 0.0));
      g.add(box(0.02, 0.02, 0.02, dark, 0, 0.055, -0.2));
    } else if (key === 'Vex-9') {
      g.add(box(0.06, 0.08, 0.42, m, 0, 0, -0.18));
      g.add(box(0.05, 0.14, 0.06, gripMat, 0, -0.1, -0.02));
      g.add(box(0.05, 0.05, 0.16, dark, 0, -0.02, -0.34));
      g.add(box(0.04, 0.06, 0.1, m, 0, 0.06, -0.28));
    } else if (key === 'KR-7') {
      g.add(box(0.06, 0.09, 0.5, m, 0, 0, -0.22));
      g.add(box(0.05, 0.13, 0.07, gripMat, 0, -0.1, -0.05));
      g.add(box(0.05, 0.07, 0.12, dark, 0, -0.045, -0.4));
      g.add(box(0.04, 0.05, 0.2, m, 0, 0.07, -0.3));
      g.add(box(0.03, 0.03, 0.06, dark, 0, 0.02, -0.48));
    } else if (key === 'Longshot-50') {
      g.add(box(0.055, 0.08, 0.72, m, 0, 0, -0.3));
      g.add(box(0.05, 0.12, 0.07, gripMat, 0, -0.095, -0.08));
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), dark);
      scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.07, -0.3);
      g.add(scope);
      g.add(box(0.03, 0.03, 0.1, dark, 0, 0.02, -0.66));
      g.add(box(0.05, 0.06, 0.14, m, 0, -0.05, -0.5));
    } else { // Breacher-12
      g.add(box(0.07, 0.09, 0.46, m, 0, 0, -0.2));
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.4, 10), dark);
      tube.rotation.x = Math.PI / 2; tube.position.set(0, -0.045, -0.24);
      g.add(tube);
      g.add(box(0.05, 0.12, 0.07, gripMat, 0, -0.1, -0.04));
      g.add(box(0.06, 0.05, 0.2, gripMat, 0, -0.02, -0.34));
    }
    // Muzzle flash quad at the barrel tip.
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    flash.position.set(0, 0.01, key === 'Longshot-50' ? -0.72 : key === 'KR-7' ? -0.5 : -0.42);
    flash.name = 'flash';
    g.add(flash);
    return g;
  }
  function setWeapon(key) {
    if (current) group.remove(current);
    current = build(key);
    group.add(current);
    group.position.set(0.22, -0.2, -0.42);
    group.rotation.set(0, 0, 0);
  }
  let bobT = 0, kick = 0, reloadT = -1;
  return {
    setWeapon,
    setVisible(v) { group.visible = v; },
    flash() {
      if (!current) return;
      const f = current.getObjectByName('flash');
      if (f) { f.material.opacity = 0.95; f.rotation.z = Math.random() * Math.PI; f.scale.setScalar(0.8 + Math.random() * 0.5); }
    },
    startReload(dur) { reloadT = dur; },
    // dt seconds, moving 0..1, ads 0..1, speed for bob.
    step(dt, moving, ads, speed) {
      if (reloadT > 0) reloadT -= dt;
      bobT += dt * (4 + speed * 1.6);
      kick = Math.max(0, kick - dt * 0.35);
      const bobA = moving ? 0.012 : 0.004;
      const bx = Math.sin(bobT) * bobA;
      const by = Math.abs(Math.cos(bobT)) * bobA * 0.8 - 0.2;
      const adsX = 0.22 * (1 - ads), adsY = -0.2 + 0.055 * ads;
      group.position.set(adsX + bx * (1 - ads * 0.8), adsY + by * (1 - ads * 0.8), -0.42 + kick * 0.9);
      group.rotation.x = kick * 1.4 + (reloadT > 0 ? Math.sin((reloadT % 0.6) / 0.6 * Math.PI) * -0.7 : 0);
      group.rotation.z = ads ? 0 : Math.sin(bobT * 0.5) * 0.006;
      if (current) {
        const f = current.getObjectByName('flash');
        if (f && f.material.opacity > 0) f.material.opacity = Math.max(0, f.material.opacity - dt * 14);
      }
    },
    addKick(k) { kick = Math.min(0.12, kick + k); },
  };
}

// Spread for one shot: base + movement + air, reduced by ADS; grows while spraying.
export function currentSpread(w, speed, ads, spray) {
  const base = ads ? w.adsSpread : w.spread;
  const move = speed > 0.5 ? w.moveSpread * Math.min(1, speed / 6) : 0;
  return base + move + spray * 0.012;
}
export function clampSpread(s) { return clamp(s, 0, 0.09); }
