# X Battle Royale — Test Checklist

Status legend: ✅ PASS (executed) · 🟡 PARTIAL (core logic executed headlessly,
needs browser/device confirmation) · ⬜ NOT TESTED (needs a browser/device/PHP
runtime that this build environment does not have)

**How automated tests were run** (Node 22, in the build sandbox):
`npm test` → `tests/syntax-check.mjs` (16 modules parse),
`tests/config-validation.js` (4 checks), `tests/logic-tests.mjs` (10 tests),
`tests/integration-tests.mjs` (6 tests, real Three.js scene graph + raycasts,
no GPU). PHP files were parsed with `php-parser` (syntax only).
The sandbox has **no browser, no GPU and no PHP runtime**, so anything that
requires actual rendering, touch hardware or PHP execution is honestly
marked 🟡/⬜ below — run those from the live preview / your phone.

| # | Test | Status | Evidence / how to verify |
| --- | --- | --- | --- |
| 1 | Application startup, menu loads | 🟡 | All modules parse + import cleanly; all 46 JS-referenced DOM ids exist in `index.html`; served over HTTP with 200s. Final check: open the preview URL and watch the console. |
| 2 | 3D rendering (terrain/buildings/lighting) | 🟡 | Integration test builds the real scene graph (terrain geometry, 20+ obstacle meshes, instanced vegetation) headlessly. Pixels need a browser: open preview. |
| 3 | Player spawn | ✅ | Integration test: player spawns exactly on terrain height. Fallback soldier always exists. |
| 4 | Enemy spawn | ✅ | Integration test constructs enemies at configured spawns; game creates 5 at separate points. |
| 5 | Movement (touch + desktop) | 🟡 | ✅ headless: forward walk moves player, jump rises & lands. Touch joystick / WASD wiring is shared-code; needs a device pass. |
| 6 | Camera rotation + follow | 🟡 | Code shares one look pipeline (drag, pointer-lock, touch). Needs visual confirmation in browser. |
| 7 | Collision (buildings/obstacles) | ✅ | Integration test: sprinting into a village house for 3 s never enters its AABB. Unit tests cover circle push-out. |
| 8 | Firing consumes ammo + real hit test | ✅ | Unit: magazine decrements, fire-rate enforced. Integration: raycast hits enemy proxy. |
| 9 | Shot reduces enemy health | ✅ | Integration: enemy HP drops after `resolveShot`. |
| 10 | Reload correctness | ✅ | Unit: reserve→magazine math, can't fire mid-reload, empty handling. |
| 11 | Weapon switching (independent state) | ✅ | Unit: slots keep separate mag/reserve; duplicate pickup gives ammo. |
| 12 | AI detect → chase → attack | ✅ | Integration: 12 s simulated fight — AI moves >2 units, enters CHASE/ATTACK, fires, magazine consumed. |
| 13 | Line of sight blocked by walls | ✅ | Integration: same shot with a wall in between = 0 damage; `hasLineOfSight` false. Unit: segment-vs-AABB. |
| 14 | Safe zone shrink + outside damage | 🟡 | ✅ unit: radius shrinks monotonically through all stages to final 10; outside detection. DPS ticking is in the game loop — verify in browser (stand still ~40 s). |
| 15 | Death (player & enemy) | ✅ | Unit: death callback once, no post-death damage, kill credited. |
| 16 | Victory / defeat screens | 🟡 | Logic wired through death callbacks → result screens with real stats. Visual check in browser. |
| 17 | Pause actually pauses | 🟡 | State machine stops `matchTime` (all timers/reloads derive from it); verify in browser. |
| 18 | Restart is clean | 🟡 | `resetMatch()` reuses entities/effects, single rAF loop started once at boot; verify two matches in a row in browser. |
| 19 | Multi-touch independence | ⬜ | Implemented with per-pointer-ID tracking + pointer capture; needs a real touchscreen. |
| 20 | Low-end mode cheaper + playable | 🟡 | Presets measurably change pixel ratio, vegetation instanced counts, particle caps, shadows. Real FPS must be measured on a target phone (Settings → Show FPS). No FPS number is claimed without hardware. |
| 21 | PHP endpoints return valid JSON | 🟡 | All 3 PHP files parse cleanly (`php-parser` AST). No PHP runtime in sandbox — run `php -S localhost:8000` and curl `backend/get-config.php` to execute. |
| 22 | Malformed configuration handled | ✅ | Validator reports 15 problems on a deliberately broken config; loader falls back to defaults. |
| 23 | Missing GLB/audio assets | ✅ | Verified pattern: models absent from repo → loader resolves with `{ok:false}` and fallback soldiers spawn. Audio is synthesized (no files exist to go missing). GLB 404 confirmed over HTTP. |
| 24 | Offline match needs no PHP | ✅ | `backendEnabled:false` in `config.json`; the only fetch during play is `config.json`. Three.js is vendored locally — no CDN calls. |
| 25 | No console exceptions in a full match | ⬜ | Needs a browser playthrough. Please check DevTools console during a full match on the preview and report anything red. |

## Manual browser script (≈5 minutes)

1. Open the game URL → title menu over a rotating island view. Console clean.
2. PLAY → countdown 3-2-1-GO. Move with joystick/WASD, look around, jump,
   sprint. Try to walk through a house (you shouldn't).
3. Pick up the Assault Rifle near spawn (south road). Fire at an enemy:
   ammo drops, hitmarker shows, enemy health depletes → kill toast.
4. Press R / LOAD with a half magazine → reload bar fills, reserve drops.
   Switch 1/2/3 — each weapon keeps its own ammo.
5. Let an enemy spot you → it chases and shoots; hide behind a building →
   its fire stops being effective. Stay outside the zone after ~35 s →
   warning banner + health ticking down.
6. Pause (Esc/⏸) → world frozen → Resume, then Restart → fresh match,
   no duplicated enemies. Die (or win) → correct result screen + Play Again.
7. Settings: switch Low/Medium/High, move sensitivity/volume sliders,
   toggle FPS overlay (debug panel shows FPS, draw calls, AI states).
8. On a phone: two thumbs at once (joystick + look + FIRE), rotate device.

## Known limitations found during testing

- Terrain ridges don't block bullets/LOS (buildings, walls, crates, tents
  and vehicles do). Shooting over the hilltop can clip the ridge.
- PHP endpoints were syntax-validated but not executed (no PHP runtime here).
- GLB soldier files could not be transferred from Drive into the build
  sandbox (no binary channel; network restricted), so model-specific
  behaviour (their actual clips/orientation) is verified by the runtime
  inspector the first time you add the files — check the console log
  `Model loaded: { meshes, triangles, clips }`.
