# Third-party licenses & asset provenance

## Libraries

### Three.js r160 — MIT License
- Source: <https://github.com/mrdoob/three.js> (npm package `three@0.160.0`, pinned)
- Files bundled locally for offline play (no CDN at runtime):
  - `vendor/three/three.module.min.js`
  - `vendor/three/addons/loaders/GLTFLoader.js`
  - `vendor/three/addons/utils/BufferGeometryUtils.js`
  - `vendor/three/addons/utils/SkeletonUtils.js`
- Full license text: `vendor/three/LICENSE`
- Copyright © 2010–2023 three.js authors. MIT permits bundling and
  redistribution with attribution, which this file provides.

## Assets created for this project (original)

- The island map (terrain, village, outpost, warehouse, watchtower,
  roads, river) is **procedurally generated** in `src/map.js` from a
  seeded height function. No external map asset is used.
- Fallback soldiers, weapons, crates, vehicles and vegetation are
  primitives built in code.
- All sound effects are synthesized at runtime with WebAudio
  (`src/audio.js`). No audio files are included.
- UI, names and branding ("X Battle Royale") are original. This project
  does not use PUBG, Free Fire, Fortnite or Call of Duty assets, maps,
  logos, sounds or UI.

## User-supplied assets (NOT included in this repository)

The following files exist in the project owner's Google Drive `assets`
folder and are loaded opportunistically if the owner places them in
`assets/models/` (see `assets/models/README.md`):

| File | Known provenance |
| --- | --- |
| `soldier.glb` | Unknown — supplied by the project owner. License not verified. |
| `russian_soldier.glb` | Unknown — supplied by the project owner. License not verified. |
| `hand_gun.glb` | Unknown — not used by the game yet. |
| `gun_incineratorthermoelectricity_rifle.glb` | Unknown — not used by the game yet. |
| `mobile_anti_aircraft_gun_40mm.glb` | Unknown — not used by the game. |
| `battlefield_1_-_desert_map.glb` | Appears to originate from a commercial game. **Not used and must not be shipped with this project.** |

⚠️ Before publishing this game (Play Store, itch.io, a public website…),
verify you have the legal right to use and redistribute each model, or
replace them with models you made or that carry a clear license
(e.g. CC0 / CC-BY with attribution recorded here).
