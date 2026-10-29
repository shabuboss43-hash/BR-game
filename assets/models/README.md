# Soldier models — where to put your Drive assets

The game is already fully playable with built-in low-poly fallback soldiers.
To use **your own models from Google Drive**, download them from your Drive
**`assets`** folder and place them in this directory (`assets/models/`)
with exactly these names:

| File in this folder | Your Drive file | Size | Drive file ID |
| --- | --- | --- | --- |
| `soldier.glb` (player, BLUE) | `soldier.glb` | 13.3 MB | `14wR5KIbtZvKXUSo7mC4uNTJA6ZLiZxqq` |
| `russian_soldier.glb` (enemy, RED) | `russian_soldier.glb` | 8.7 MB | `1Bd886IfvqQo-EdTyFS24TQ2XZvO22vYd` |

Drive folder: <https://drive.google.com/drive/folders/1LPX0n1TnplLVMSEFqqkdlbvLoorxt8B1>

## Easiest way to add them on GitHub (no coding tools needed)

1. On your phone/PC, download `soldier.glb` and `russian_soldier.glb`
   from the Drive folder above.
2. Open the GitHub repo → `assets` → `models` → **Add file → Upload files**.
3. Upload both files and commit. (Each is under GitHub's 25 MB web-upload
   limit.)
4. Reload the game — models are detected automatically. The main menu
   shows "Soldier models: loaded ✔" and the browser console logs mesh /
   triangle / animation-clip details for each file.

That is all — no code changes needed. If a file is missing or corrupt, the
game logs a clear message and keeps the visible fallback soldier, so the
player is never invisible.

## Why the .glb files are not already committed here

- The build environment could list and verify your Drive files, but it has
  no binary file-transfer channel for 8–22 MB GLB files from Drive into
  this workspace, and outbound network access here is restricted to
  GitHub/npm/PyPI.
- The origin/license of these models is unknown (see `LICENSES.md`), so
  they should only be redistributed in your repo if you have the right
  to do so. It is your Drive and your repo — uploading them yourself via
  step 2 above keeps that decision with you.

## Other files found in your Drive `assets` folder

| Drive file | Size | Status in this build |
| --- | --- | --- |
| `hand_gun.glb` | 6.3 MB | Not used yet — very heavy for a 2 GB RAM target; weapons use lightweight built-in 3D shapes. Can be wired later as an optional view model. |
| `gun_incineratorthermoelectricity_rifle.glb` | 12.7 MB | Not used yet — same reason as above. |
| `mobile_anti_aircraft_gun_40mm.glb` | 22.0 MB | Not used — too large for the low-end target. |
| `battlefield_1_-_desert_map.glb` | 4.8 MB | **Deliberately not used.** The name indicates a map from a commercial game; this project uses an original procedural island instead (see `src/map.js`). Do not ship ripped commercial maps. |

## Model requirements (if you swap in different models later)

- Format: binary glTF (`.glb`), ideally < 5 MB and < 30k triangles for
  low-end phones. Your current soldiers (13 MB / 9 MB) will work but load
  slower and use more RAM — consider compressing textures if the game
  feels heavy on your phone.
- The loader auto-scales the model to 1.8 units tall and puts its feet on
  the ground. Characters are assumed to face **+Z**; if your model faces
  the other way it will walk backwards — rotate it 180° in Blender
  (or tell the developer to flip it in `SoldierVisual.adoptModel`).
- Animation clips named like *idle / walk / run / death* are picked up
  automatically. Models without animations get a simple procedural bob.
- The enemy model is loaded **once** and cloned for all enemy soldiers
  (skinned-mesh safe), so one 9 MB file serves the whole enemy team.
