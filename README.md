# X Battle Royale

A compact, **playable third-person 3D battle royale** built with HTML5, CSS3,
JavaScript and [Three.js](https://threejs.org) (pinned r160, bundled locally —
no CDN needed), designed for **low-end Android phones (~2 GB RAM)** in a mobile
browser.

Drop onto an original procedural island, loot an assault rifle or shotgun,
fight **5 AI enemy soldiers**, stay inside the shrinking safe zone, and be
the **last survivor**. Fully **offline** — no account, no database, no API
keys. An optional PHP backend can store match results.

![Stack](https://img.shields.io/badge/Three.js-r160-black) ![Platform](https://img.shields.io/badge/Android%20browser-2GB%20RAM-green) ![Mode](https://img.shields.io/badge/offline-vs%20AI-blue)

---

## ▶️ Play it

You only need a static file server (module scripts don't run from `file://`
in most browsers):

```bash
# Option A — Python
python3 -m http.server 8000

# Option B — Node
npx serve .
```

Then open **http://localhost:8000** (on your phone: `http://<your-pc-ip>:8000`
on the same Wi-Fi), or enable GitHub Pages on this repo and play online.

Tap **PLAY** → 3-2-1 countdown → survive.

### Controls

| Action | Mobile (touch) | Desktop |
| --- | --- | --- |
| Move | Left joystick | WASD / arrows |
| Look | Drag right side of screen | Mouse (click game to lock mouse) or drag |
| Fire | 🔥 FIRE button (hold for auto weapons) | Left mouse |
| Aim | ◎ AIM (hold) | Right mouse (hold) |
| Sprint | ⚡ RUN toggle | Shift |
| Jump | ⬆ JUMP | Space |
| Reload | ⟳ LOAD | R |
| Switch weapon | Weapon slot buttons 1/2/3 | 1 / 2 / 3 |
| Pick up loot | ✋ button (appears near loot) | E |
| Pause | ⏸ button | Esc / P |

---

## 🎮 What's in the game

- **Real Three.js 3D island** (500×500): seeded terrain with a hilltop,
  central village (8 houses), military outpost, warehouse, watchtower,
  river, 3 roads, forests, rocks, crates, sandbag walls, abandoned vehicles.
- **Third-person controller**: walk/sprint/jump, smooth follow camera with
  wall-collision shortening, aim mode, recoil & spread bloom.
- **3 weapons** (data-driven in `config.json`): Assault Rifle (auto, 30 rd),
  Pistol (semi, 12 rd), Shotgun (8 pellets, 6 shells) — damage falloff,
  magazines, reserves, reload timers, 3-slot inventory.
- **Weapon/ammo/medical pickups** scattered at the landmarks.
- **5 AI soldiers** with a real state machine — `IDLE / PATROL / INVESTIGATE /
  CHASE / ATTACK / SEEK_COVER / RELOAD / SEEK_ZONE / DEAD` — field-of-view +
  line-of-sight detection (they can't see or shoot through buildings),
  burst fire with aim error, cover-seeking at low health, gunshot-noise
  investigation, and safe-zone awareness.
- **Shrinking safe zone**: 4 staged shrinks (240 → 130 → 65 → 28 → 10),
  warnings, visible red wall, 5 DPS outside for everyone.
- **Full match flow**: menu → loading → countdown → playing → pause →
  victory/defeat with stats (kills, accuracy, damage, survival time) →
  clean restart. Lifetime stats persist in `localStorage`.
- **Mobile HUD**: joystick, fire/aim/jump/sprint/reload buttons, health,
  ammo, alive counter, kill counter, match timer, zone banner, hitmarker,
  damage vignette, dynamic **minimap** (roads, buildings, zone circles,
  weapon loot, recently-heard enemies), safe-area insets, portrait support
  with a rotate hint.
- **Performance engineering for 2 GB phones**: Low/Medium/High presets
  (resolution scale 0.65/0.8/1.0, shadows off by default, particle caps,
  vegetation density), capped pixel ratio, capped delta time, instanced
  trees/rocks/grass, pooled tracers/particles (no per-shot allocations),
  auto-quality that steps resolution down with hysteresis, FPS/debug
  overlay, pause when the tab is hidden, WebGL context-loss handling.
- **Soldier models**: drop `soldier.glb` / `russian_soldier.glb` into
  `assets/models/` and they're loaded, inspected (meshes/triangles/clips
  logged), auto-scaled and animated (`idle/walk/run/death` picked by name).
  Missing/corrupt models fall back to built-in low-poly soldiers — the game
  never breaks. Enemy model loads once and is cloned for the team.
- **Synthesized sound effects** (WebAudio, zero audio files): shots, reload,
  hit, hurt, kill, pickup, zone warning, win/lose jingles + volume/mute.

## 🗂 Project structure

```
index.html  style.css  game.js        # shell, HUD styling, entry + match flow
config.json                           # ALL balance/world/weapon/zone tuning
src/  config scene map player enemy weapons combat collision
      safe-zone controls hud audio save-system performance utils
assets/models/                        # ← put soldier.glb files here (see its README)
vendor/three/                         # pinned Three.js r160 (offline, no CDN)
backend/                              # OPTIONAL PHP: get-config / save-result
tests/                                # automated tests + manual checklist
```

## ⚙️ Configuration

Everything tunable lives in **`config.json`**: world size & map seed,
graphics presets, player/enemy stats, all weapon numbers, safe-zone stages,
pickup positions, team colors. The config is validated at startup; a broken
or missing file falls back to built-in defaults instead of crashing.
Make matches shorter for testing by editing `safeZone.stages`, or harder by
raising `enemy.count` (spawns included up to 8) and lowering
`enemy.aimErrorDegrees`.

## 🧪 Tests

```bash
npm install   # dev-only: pinned three for the headless tests
npm test      # syntax + config + logic + 3D integration tests
```

The suite parses every module, validates `config.json`, unit-tests
weapons/reload/damage/death/collision/safe-zone/terrain determinism, and
runs **headless Three.js integration tests** (real map build, player
movement, building collision, hitscan vs. wall-blocked shots, and a
12-second simulated AI fight). See **`tests/test-checklist.md`** for the
honest status of all 25 spec tests, including what still needs a real
device/browser session (GPU rendering, touch, FPS on hardware).

## 🖥 Optional PHP backend

`backend/` provides `get-config.php` (health + public config) and
`save-result.php` (validated, size-capped match-result storage). It is
**off by default**; see `backend/README.md`. Offline play never calls it.

## 🔮 Multiplayer — honest status

This release is **offline vs AI only**. There is no fake "online" mode.
The code is structured for a future online version (team system, shared
combat model, JSON results), but real multiplayer needs persistent
WebSocket connections and a **server-authoritative** simulation — PHP
request/response endpoints alone cannot do that, and clients must never
decide their own kills/damage/results.

## 📱 Performance notes

Targets (not guarantees): ~30 FPS on a 2 GB RAM Android phone at the
**Low** preset. Measure on your device with *Settings → Show FPS*.
The biggest costs are the optional user GLB models — the built-in fallback
soldiers and Low preset are the lightest configuration.

## 📄 Licenses

Original code in this repo. Three.js is MIT-licensed. Model files are
user-supplied and **not** redistributed here — see `LICENSES.md` before
publishing anywhere.

## Known limitations (v1.0)

- Terrain height doesn't block bullets/LOS (buildings/rocks/walls do);
  extreme hill-to-valley shots can pass through a ridge.
- No crouch/prone, no vehicles to drive, no grenades — cover and movement
  are the survival tools.
- Watchtower is a landmark, not climbable.
- Enemy count defaults to 5 for low-end performance (configurable).
- Browser rendering/touch/FPS still need a pass on real hardware —
  see the test checklist.
