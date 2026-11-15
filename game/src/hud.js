// DUSTLINE — HUD: crosshair, health, ammo, money, timer, score, killfeed,
// minimap (canvas 2D), round banners, buy menu, damage direction, overlays.
import { WEAPONS, WEAPON_ORDER, ARMOR_PRICE } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    cross: $('crosshair'), hit: $('hitmarker'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-reserve'),
    hp: $('hp-value'), hpBar: $('hp-bar'), armorBar: $('armor-bar'), money: $('money-value'),
    timer: $('timer-value'), score: $('score-value'), round: $('round-value'),
    feed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    minimap: $('minimap'), dmg: $('dmg-indicator'), buy: $('buy-menu'), buyMoney: $('buy-money'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), stats: $('stats'), bomb: $('bomb-timer'), bombBar: $('bomb-bar'),
    weaponName: $('weapon-name'), plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    endStats: $('end-stats'), rematch: $('rematch'),
  };
  const mm = els.minimap.getContext('2d');
  let feedCount = 0;

  function setAmmo(mag, reserve) {
    els.ammoMag.textContent = mag;
    els.ammoRes.textContent = '/ ' + reserve;
    els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
  }
  function setHealth(hp, armor) {
    els.hp.textContent = Math.max(0, Math.ceil(hp));
    els.hpBar.style.width = Math.max(0, hp) + '%';
    els.armorBar.style.width = Math.max(0, armor) + '%';
    els.hpBar.classList.toggle('low', hp <= 30);
  }
  function setMoney(m) { els.money.textContent = '$' + m; if (els.buyMoney) els.buyMoney.textContent = '$' + m; }
  function setTimer(s) {
    const t = Math.max(0, Math.ceil(s));
    els.timer.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    els.timer.classList.toggle('urgent', t <= 10);
  }
  function setScore(a, b) { els.score.textContent = a + ' — ' + b; }
  function setRound(r) { els.round.textContent = 'ROUND ' + r; }
  function setWeapon(name) { els.weaponName.textContent = name; }
  function setCrosshair(spreadPx) {
    els.cross.style.setProperty('--gap', spreadPx + 'px');
  }
  function hitMarker(kill, head) {
    els.hit.classList.remove('on', 'kill', 'head');
    void els.hit.offsetWidth;
    els.hit.classList.add('on');
    if (kill) els.hit.classList.add('kill');
    if (head) els.hit.classList.add('head');
    setTimeout(() => els.hit.classList.remove('on'), 120);
  }
  function damageFrom(angleDeg) {
    els.dmg.style.transform = `translate(-50%,-50%) rotate(${angleDeg}deg)`;
    els.dmg.classList.remove('on');
    void els.dmg.offsetWidth;
    els.dmg.classList.add('on');
    setTimeout(() => els.dmg.classList.remove('on'), 450);
  }
  function killfeed(text, good) {
    const div = document.createElement('div');
    div.className = 'feed-item' + (good ? ' good' : ' bad');
    div.textContent = text;
    els.feed.prepend(div);
    feedCount++;
    while (els.feed.children.length > 5) els.feed.lastChild.remove();
    setTimeout(() => { div.classList.add('fade'); setTimeout(() => div.remove(), 600); }, 4500);
  }
  function banner(title, sub, ms = 2600) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub || '';
    els.banner.classList.remove('show');
    void els.banner.offsetWidth;
    els.banner.classList.add('show');
    clearTimeout(banner._t);
    banner._t = setTimeout(() => els.banner.classList.remove('show'), ms);
  }
  function showBombTimer(s) {
    els.bomb.hidden = false;
    els.bombBar.style.width = Math.max(0, (s / 35) * 100) + '%';
    els.bomb.querySelector('span').textContent = 'BOMB ' + Math.ceil(Math.max(0, s)) + 's';
  }
  function hideBombTimer() { els.bomb.hidden = true; }
  function showPlant(p) {
    els.plantBar.hidden = false;
    els.plantFill.style.width = Math.min(100, p * 100) + '%';
  }
  function hidePlant() { els.plantBar.hidden = true; }
  // Minimap: walls, sites, player arrow, allies always, enemies only when seen recently.
  function drawMinimap(world, player, bots, bomb, now) {
    const W = els.minimap.width, H = els.minimap.height;
    const sx = (x) => ((x + 37) / 74) * W;
    const sz = (z) => ((z + 27) / 54) * H;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(12,10,8,0.72)';
    mm.fillRect(0, 0, W, H);
    mm.fillStyle = 'rgba(255,179,71,0.35)';
    mm.fillRect(sx(-14), sz(-24), sx(6) - sx(-14), sz(-12) - sz(-24));
    mm.fillStyle = 'rgba(79,195,247,0.3)';
    mm.fillRect(sx(-2), sz(12), sx(16) - sx(-2), sz(24) - sz(12));
    mm.fillStyle = '#ffb347'; mm.font = 'bold 11px system-ui';
    mm.fillText('A', sx(-6), sz(-18));
    mm.fillStyle = '#4fc3f7'; mm.fillText('B', sx(6), sz(19));
    mm.strokeStyle = 'rgba(233,230,223,0.5)'; mm.lineWidth = 1;
    mm.strokeRect(sx(-36), sz(-26), sx(36) - sx(-36), sz(26) - sz(-26));
    mm.strokeStyle = 'rgba(233,230,223,0.35)';
    mm.beginPath(); mm.moveTo(sx(0), sz(-10)); mm.lineTo(sx(0), sz(10)); mm.stroke();
    mm.beginPath(); mm.moveTo(sx(-36), sz(-10)); mm.lineTo(sx(36), sz(-10)); mm.stroke();
    mm.beginPath(); mm.moveTo(sx(-36), sz(10)); mm.lineTo(sx(36), sz(10)); mm.stroke();
    if (bomb && bomb.planted) {
      mm.fillStyle = '#ff5252';
      mm.beginPath(); mm.arc(sx(bomb.x), sz(bomb.z), 4, 0, Math.PI * 2); mm.fill();
    }
    for (const b of bots) {
      if (!b.alive) continue;
      const seen = b.team === 'CT' || (b.lastSeen && now - b.lastSeen < 4);
      if (!seen) continue;
      mm.fillStyle = b.team === 'CT' ? '#7db8e8' : '#f08a3c';
      mm.beginPath(); mm.arc(sx(b.pos.x), sz(b.pos.z), 3, 0, Math.PI * 2); mm.fill();
    }
    // Player arrow.
    mm.save();
    mm.translate(sx(player.pos.x), sz(player.pos.z));
    mm.rotate(-player.yaw);
    mm.fillStyle = '#fff';
    mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(-4.5, 5); mm.closePath(); mm.fill();
    mm.restore();
  }
  function buildBuyMenu(onBuy) {
    const list = $('buy-list');
    list.innerHTML = '';
    WEAPON_ORDER.forEach((key, i) => {
      const w = WEAPONS[key];
      const row = document.createElement('button');
      row.className = 'buy-row';
      row.type = 'button';
      row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${w.name}</span>` +
        `<span class="buy-stat">${w.damage} dmg · ${w.rpm} rpm · ${w.mag} rnd</span><span class="buy-price">$${w.price}</span>`;
      row.addEventListener('click', () => onBuy(key));
      list.appendChild(row);
    });
    const armor = document.createElement('button');
    armor.className = 'buy-row';
    armor.type = 'button';
    armor.innerHTML = `<span class="buy-key">6</span><span class="buy-name">Kevlar Armor</span>` +
      `<span class="buy-stat">halves damage taken</span><span class="buy-price">$${ARMOR_PRICE}</span>`;
    armor.addEventListener('click', () => onBuy('ARMOR'));
    list.appendChild(armor);
  }
  function showBuy(show) { els.buy.hidden = !show; }
  function showOverlay(kind, data) {
    els.overlay.hidden = false;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'DUSTLINE';
      els.overlayCopy.textContent = 'Tactical strike in Foundry Sector K-7. First to 5 rounds wins. Plant or defuse the bomb — or wipe the other team.';
      els.play.textContent = 'Click to play';
      els.stats.hidden = true;
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'Click to jump back in.';
      els.play.textContent = 'Resume';
      els.stats.hidden = true;
    } else if (kind === 'end') {
      els.overlayTitle.textContent = data.win ? 'VICTORY' : 'DEFEAT';
      els.overlayCopy.textContent = data.line;
      els.play.textContent = 'Rematch';
      els.stats.hidden = false;
      els.endStats.innerHTML = data.rows.map((r) => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
    }
  }
  function hideOverlay() { els.overlay.hidden = true; }
  return {
    setAmmo, setHealth, setMoney, setTimer, setScore, setRound, setWeapon, setCrosshair,
    hitMarker, damageFrom, killfeed, banner, showBombTimer, hideBombTimer, showPlant, hidePlant,
    drawMinimap, buildBuyMenu, showBuy, showOverlay, hideOverlay,
    onPlay(cb) { els.play.addEventListener('click', cb); },
    onRematch(cb) { els.rematch.addEventListener('click', cb); },
  };
}
