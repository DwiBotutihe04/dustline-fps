# DUSTLINE — Tactical Strike in Foundry Sector K-7

A 5v5 tactical FPS for the make.fun threejs-fps bounty. You are Vanguard (CT):
hold the sites, defuse the bomb, or wipe the Dusters. First to 5 rounds wins.

## Play

```sh
node serve.ts        # then open http://localhost:8080
```

WASD move · Mouse aim · Click fire · Right-click aim down sights · R reload ·
B buy menu (buy phase) · E hold to defuse · Shift walk · Ctrl crouch · Space jump ·
Esc pause. Click PLAY, then click the game to lock the mouse.

## What is in the game

- **Map** — Foundry Sector K-7: a desert foundry at dusk. Three lanes (A-long,
  mid with a window + door, B-tunnel), Site A warehouse, Site B container yard,
  crates, barrels and pipes for cover. Procedural canvas textures, low warm sun,
  dust fog, ACES tone mapping.
- **Weapons** — five originals: P9 Sidearm, Vex-9 SMG, KR-7 Rifle, Longshot-50
  sniper (one-shot body kill, scope zoom), Breacher-12 shotgun (8 pellets).
  Damage falloff, headshots x2, armour halves damage, recoil + spread that
  punish firing on the move, ADS zoom.
- **Economy** — start $800, kill +$300, round win +$3,250, loss +$1,900
  (+$500 loss-streak bonus), plant +$300. Buy menu with keys 1–6.
- **Bots** — 4 allies + 5 enemies with a state machine (patrol / engage /
  plant / defend / defuse / rotate) over a waypoint graph. Reaction time
  0.2–0.8 s and aim error vary per bot; they strafe in duels, fall back when
  hurt, pick up the bomb when the planter dies, and rotate to a plant.
- **Bomb** — plant takes 3 s, explodes after 35 s, defuse takes 5 s (hold E).
  Win by elimination, detonation, defuse, or holding the sites when time runs out.
- **Feel** — low-poly viewmodel guns with bob, kick and reload animation,
  tracers, muzzle flash, impact sparks, hitmarkers (white / red headshot /
  red kill), damage direction indicator, killfeed, 2D minimap, round banners,
  end-of-match stats with MVP and rematch. All audio is synthesized WebAudio
  (gunshots, reload clicks, footsteps, beeps, round jingles, desert wind).
  No audio files, no network requests, no gore.

## Test modes (query params)

- `?shot=mid|plant|buy|ads&seed=7` — renders one deterministic frame for a
  screenshot and sets `window.__shotReady` when done.
- `?demo=1` — the player's seat is AI-driven; a full bot-vs-bot match plays
  out at high speed. State is on `window.__DUSTLINE__`.

## Files

- `main.ts` — entrypoint: copies `game/` + `screenshots/` to `/output` and
  writes `dossier.json` with the vendored make.fun library.
- `game/index.html` — page + HUD. `game/src/` — `main.js` (loop, player,
  rounds, economy, bomb), `world.js` (map + waypoints), `bots.js` (bot AI),
  `weapons.js` (stats + viewmodels), `hud.js` (HUD + minimap + buy menu),
  `input.js`, `audio.js`, `util.js`.
- `game/vendor/three/` — three.js 0.187.0 from the kit, unchanged.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.
- `screenshots/` — 4 renders of this build (see `shots.json`).
- `LICENSE` — MIT.

## Local checks

```sh
node test-local.mjs   # serves the game, captures the 4 screenshots,
                      # plays a full bot-vs-bot match headless, reports errors
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # build the dossier
```
