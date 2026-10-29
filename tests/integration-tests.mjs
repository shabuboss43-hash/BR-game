// Headless 3D integration tests: real Three.js scene graph, raycasts,
// map construction, player movement/collision and a simulated AI fight —
// everything except actual GPU rendering (needs a browser; see checklist).
// Run: node tests/integration-tests.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FALLBACK_CONFIG as CFG } from '../src/config.js';
import { GameMap } from '../src/map.js';
import { CollisionWorld } from '../src/collision.js';
import { SoldierVisual, Player } from '../src/player.js';
import { Enemy } from '../src/enemy.js';
import { WeaponInventory } from '../src/weapons.js';
import { Combatant, EffectsPool, resolveShot, hasLineOfSight } from '../src/combat.js';
import { makeRng } from '../src/utils.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK   ${name}`); }
  catch (err) { console.error(`FAIL ${name}: ${err.stack || err.message}`); process.exitCode = 1; }
}

const scene = new THREE.Scene();
const colliders = new CollisionWorld();
const map = new GameMap(scene, CFG, colliders);
scene.updateMatrixWorld(true);

test('map builds a real 3D world (terrain, buildings, obstacles, patrols)', () => {
  assert.ok(map.terrain.geometry.getAttribute('position').count > 1000);
  assert.ok(map.obstacleMeshes.length >= 20, `obstacles=${map.obstacleMeshes.length}`);
  assert.ok(map.minimapFeatures.buildings.length >= 10);
  assert.ok(map.patrolPoints.length >= 10);
  assert.ok(map.coverPoints.length >= 10);
  assert.ok(Number.isFinite(map.groundY(10, 20)));
  assert.ok(colliders.boxes.length >= 20);
});

const playerVisual = new SoldierVisual(0x2e7cf6, 1.8);
const player = new Player(scene, CFG, playerVisual, map, colliders);
const playerCombatant = new Combatant({ id: 'p', team: 'BLUE', maxHealth: 100, isPlayer: true });

test('player spawns on terrain and walks forward under input', () => {
  const start = player.position.clone();
  assert.ok(Math.abs(start.y - map.groundY(start.x, start.z)) < 0.01);
  for (let i = 0; i < 60; i++) player.update(1 / 60, { x: 0, y: 1 }, Math.PI, false, false, false);
  const moved = Math.hypot(player.position.x - start.x, player.position.z - start.z);
  assert.ok(moved > 3, `moved=${moved}`);
  assert.ok(player.position.z < start.z, 'facing village (-Z)');
});

test('player cannot walk through a village building', () => {
  // Building at (-26,-18) size 9x8. Start south of it, walk north into it.
  player.position.set(-26, map.groundY(-26, -6), -6);
  player.velocity.set(0, 0, 0);
  for (let i = 0; i < 180; i++) player.update(1 / 60, { x: 0, y: 1 }, Math.PI, true, false, false);
  assert.ok(player.position.z > -14.6, `player entered building: z=${player.position.z}`);
});

test('player jumps and lands back on the terrain', () => {
  player.position.set(0, map.groundY(0, 150), 150);
  player.velocity.set(0, 0, 0);
  const ground = map.groundY(0, 150);
  player.update(1 / 60, { x: 0, y: 0 }, Math.PI, false, false, true);
  let maxY = player.position.y;
  for (let i = 0; i < 120; i++) { player.update(1 / 60, { x: 0, y: 0 }, Math.PI, false, false, false); maxY = Math.max(maxY, player.position.y); }
  assert.ok(maxY > ground + 0.8, `jump apex too low: ${maxY - ground}`);
  assert.ok(Math.abs(player.position.y - ground) < 0.05);
  assert.equal(player.grounded, true);
});

// --- Shooting: real raycast against hit proxy, wall blocks damage ---
const enemyVisual = new SoldierVisual(0xe33b3b, 1.8);
scene.add(enemyVisual.group);
enemyVisual.group.position.set(0, map.groundY(0, 130), 130);
const enemyCombatant = new Combatant({ id: 'e', team: 'RED', maxHealth: 100 });
const effects = new EffectsPool(scene, 20);
scene.updateMatrixWorld(true);

const playerEntity = { combatant: playerCombatant, proxy: playerVisual.proxy, position: player.position, height: 1.8 };
const enemyEntity = { combatant: enemyCombatant, proxy: enemyVisual.proxy, position: enemyVisual.group.position, height: 1.8 };

test('hitscan shot damages enemy proxy; wall blocks the same shot', () => {
  player.position.set(0, map.groundY(0, 150), 150);
  playerVisual.group.position.copy(player.position);
  scene.updateMatrixWorld(true);
  const origin = new THREE.Vector3(0, player.position.y + 1.4, 150);
  // Aim at the enemy chest (terrain height differs between the two spots,
  // exactly as a player would compensate with the camera).
  const chest = new THREE.Vector3(0, enemyVisual.group.position.y + 1.3, 130);
  const dir = chest.clone().sub(origin).normalize();
  const before = enemyCombatant.health;
  const open = resolveShot({
    shooter: playerCombatant, shooterEntity: playerEntity, origin: origin.clone(), direction: dir.clone(),
    def: CFG.weapons.assault_rifle, entities: [playerEntity, enemyEntity],
    obstacleMeshes: [], friendlyFire: false, spreadScale: 0, effects, muzzlePos: origin.clone(), camera: null
  });
  assert.ok(open.totalDamage > 0 && enemyCombatant.health < before, 'open shot should damage');

  // Put a solid wall between shooter and enemy
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 0.6), new THREE.MeshBasicMaterial({ color: 0x888888 }));
  wall.position.set(0, map.groundY(0, 140) + 2.5, 140);
  scene.add(wall);
  scene.updateMatrixWorld(true);
  const hpBeforeBlocked = enemyCombatant.health;
  const blocked = resolveShot({
    shooter: playerCombatant, shooterEntity: playerEntity, origin: origin.clone(), direction: dir.clone(),
    def: CFG.weapons.assault_rifle, entities: [playerEntity, enemyEntity],
    obstacleMeshes: [wall], friendlyFire: false, spreadScale: 0, effects, muzzlePos: origin.clone(), camera: null
  });
  assert.equal(blocked.totalDamage, 0);
  assert.equal(enemyCombatant.health, hpBeforeBlocked);
  assert.equal(hasLineOfSight(origin, new THREE.Vector3(0, enemyVisual.group.position.y + 1.3, 130), [wall]), false);
  scene.remove(wall);
});

// --- Full AI: simulated fight for 12 seconds of game time ---
test('enemy AI patrols, engages a visible player and fires its weapon', () => {
  const inv = new WeaponInventory(CFG.weapons, 'assault_rifle');
  const visual = new SoldierVisual(0xe33b3b, 1.8);
  const enemy = new Enemy(scene, CFG, visual, map, colliders, { x: 0, z: 120 }, inv, makeRng(99));
  const ec = new Combatant({ id: 'ai', team: 'RED', maxHealth: 100 });
  enemy.combatant = ec;
  const pc = new Combatant({ id: 'tp', team: 'BLUE', maxHealth: 100000, isPlayer: true });
  const fakePlayer = { position: new THREE.Vector3(0, map.groundY(0, 150), 150) };
  const pVisual = new SoldierVisual(0x2e7cf6, 1.8);
  scene.add(pVisual.group);
  pVisual.group.position.copy(fakePlayer.position);
  const pEnt = { combatant: pc, proxy: pVisual.proxy, position: fakePlayer.position, height: 1.8 };
  const eEnt = { combatant: ec, proxy: visual.proxy, position: enemy.position, height: 1.8 };
  enemy.entity = eEnt;
  scene.updateMatrixWorld(true);

  let shotsHeard = 0;
  const states = new Set();
  const startPos = enemy.position.clone();
  for (let t = 0; t < 12; t += 1 / 30) {
    scene.updateMatrixWorld(true);
    enemy.update(1 / 30, t, {
      player: fakePlayer, playerCombatant: pc, playerEntity: pEnt,
      entities: [pEnt, eEnt], obstacleMeshes: map.obstacleMeshes,
      safeZone: { isOutside: () => false, center: { x: 0, z: 0 } },
      effects, friendlyFire: false, camera: null, selfEntity: eEnt,
      onShoot: () => shotsHeard++
    });
    states.add(enemy.state);
  }
  const moved = Math.hypot(enemy.position.x - startPos.x, enemy.position.z - startPos.z);
  assert.ok(moved > 2, `AI barely moved: ${moved}`);
  assert.ok(states.has('CHASE') || states.has('ATTACK'), `never engaged: ${[...states].join(',')}`);
  assert.ok(shotsHeard > 0, 'AI never fired');
  assert.ok(inv.current().magazine < CFG.weapons.assault_rifle.magazineSize || inv.current().reloading,
    'AI magazine was never consumed');
});

console.log(`\n${passed} integration test(s) passed${process.exitCode ? ' (with failures above)' : ''}.`);
