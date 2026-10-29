// Headless gameplay-logic tests (no browser/WebGL needed).
// Covers: weapons/ammo/reload (T8,T10,T11), damage/death (T9,T15),
// friend-or-foe rules, safe zone staging (T14), collision push-out (T7),
// segment-vs-wall blocking (T13) and deterministic terrain (map seed).
// Run: node tests/logic-tests.mjs
import assert from 'node:assert/strict';
import { FALLBACK_CONFIG as CFG } from '../src/config.js';
import { WeaponInventory, damageAtRange } from '../src/weapons.js';
import { Combatant } from '../src/combat.js';
import { CollisionWorld, segmentIntersectsBox } from '../src/collision.js';
import { SafeZone } from '../src/safe-zone.js';
import { createHeightFunction } from '../src/map.js';
import * as THREE from 'three';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`OK   ${name}`); }
  catch (err) { console.error(`FAIL ${name}: ${err.message}`); process.exitCode = 1; }
}

// ---- Weapons ----
test('firing consumes magazine ammo; fire rate is enforced', () => {
  const inv = new WeaponInventory(CFG.weapons, 'assault_rifle');
  const st = inv.current();
  assert.equal(st.magazine, 30);
  assert.equal(inv.tryFire(0).fired, true);
  assert.equal(st.magazine, 29);
  assert.equal(inv.tryFire(0.01).fired, false);           // still in fire interval
  assert.equal(inv.tryFire(0.11).fired, true);
  assert.equal(st.magazine, 28);
});

test('reload moves ammo from reserve to magazine after reloadTime', () => {
  const inv = new WeaponInventory(CFG.weapons, 'pistol');
  const st = inv.current();
  for (let t = 0; t < 5; t++) inv.tryFire(t * 0.3);
  assert.equal(st.magazine, 7);
  assert.equal(inv.startReload(2), true);
  assert.equal(inv.tryFire(2.1).fired, false);            // cannot fire while reloading
  inv.update(2 + CFG.weapons.pistol.reloadTime + 0.01);
  assert.equal(st.magazine, 12);
  assert.equal(st.reserve, 48 - 5);
});

test('each weapon slot keeps independent ammo; switching works', () => {
  const inv = new WeaponInventory(CFG.weapons, 'pistol');
  inv.tryFire(0);
  assert.equal(inv.giveWeapon('shotgun'), 'added');
  assert.equal(inv.currentId, 'shotgun');
  assert.equal(inv.current().magazine, 6);
  assert.equal(inv.selectSlot(0), true);
  assert.equal(inv.currentId, 'pistol');
  assert.equal(inv.current().magazine, 11);                // pistol kept its count
  assert.equal(inv.giveWeapon('pistol'), 'ammo');         // duplicate -> ammo
});

test('empty magazine cannot fire; damage falloff respects range', () => {
  const inv = new WeaponInventory(CFG.weapons, 'shotgun');
  const st = inv.current();
  st.magazine = 0;
  assert.equal(inv.tryFire(10).reason, 'empty');
  const def = CFG.weapons.assault_rifle;
  assert.equal(damageAtRange(def, 10), def.damage);
  assert.ok(damageAtRange(def, def.range) < def.damage);
  assert.equal(damageAtRange(def, def.range + 1), 0);
});

// ---- Combat ----
test('damage reduces health; death fires once; dead take no damage', () => {
  const a = new Combatant({ id: 'a', team: 'BLUE', maxHealth: 100 });
  const b = new Combatant({ id: 'b', team: 'RED', maxHealth: 100 });
  let deaths = 0;
  b.onDeath = () => deaths++;
  assert.equal(b.takeDamage(30, a), 30);
  assert.equal(b.health, 70);
  b.takeDamage(500, a);
  assert.equal(b.alive, false);
  assert.equal(deaths, 1);
  assert.equal(b.takeDamage(10, a), 0);                    // no post-death damage
  assert.equal(a.stats.kills, 1);
  assert.equal(deaths, 1);
});

test('friendly fire and self damage are blocked by default', () => {
  const a = new Combatant({ id: 'a', team: 'BLUE', maxHealth: 100 });
  const mate = new Combatant({ id: 'm', team: 'BLUE', maxHealth: 100 });
  assert.equal(mate.takeDamage(50, a), 0);
  assert.equal(a.takeDamage(50, a), 0);
  assert.equal(mate.takeDamage(50, a, true), 50);          // explicit FF on
  const env = new Combatant({ id: 'e', team: 'RED', maxHealth: 100 });
  assert.ok(env.takeDamage(5, null) === 5);                // zone/environment damage
});

// ---- Collision ----
test('character is pushed out of building AABBs and rock circles', () => {
  const world = new CollisionWorld();
  world.addBox(0, 0, 5, 5, 0, 4);                          // 10x10 building
  const pos = { x: 1, y: 0, z: 0 };
  world.resolve(pos, 0.45, 0, 1.8);
  assert.ok(pos.x <= -5.45 + 0.001 || pos.x >= 5.45 - 0.001 || Math.abs(pos.x) > 5, `x=${pos.x}`);
  const pos2 = { x: 5.2, y: 0, z: 0 };
  world.resolve(pos2, 0.45, 0, 1.8);
  assert.ok(pos2.x >= 5.45 - 0.001, `x=${pos2.x}`);
  world.addCircle(20, 20, 1);
  const pos3 = { x: 20.5, y: 0, z: 20 };
  world.resolve(pos3, 0.45, 0, 1.8);
  assert.ok(Math.hypot(pos3.x - 20, pos3.z - 20) >= 1.45 - 0.001);
});

test('segment-vs-box blocks shots/LOS through walls', () => {
  const box = { minX: -1, maxX: 1, minY: 0, maxY: 4, minZ: -1, maxZ: 1 };
  assert.equal(segmentIntersectsBox({ x: -10, y: 1.5, z: 0 }, { x: 10, y: 1.5, z: 0 }, box), true);
  assert.equal(segmentIntersectsBox({ x: -10, y: 1.5, z: 5 }, { x: 10, y: 1.5, z: 5 }, box), false);
  assert.equal(segmentIntersectsBox({ x: -10, y: 9, z: 0 }, { x: 10, y: 9, z: 0 }, box), false); // over the roof
});

// ---- Safe zone ----
test('safe zone stages shrink radius monotonically to the final stage', () => {
  const scene = new THREE.Scene();
  const zone = new SafeZone(scene, CFG.safeZone);
  assert.equal(zone.radius, CFG.safeZone.initialRadius);
  let prev = zone.radius;
  for (let t = 0; t < 400; t += 0.5) {
    zone.update(0.5);
    assert.ok(zone.radius <= prev + 1e-9, 'radius must never grow');
    prev = zone.radius;
    if (zone.finished) break;
  }
  assert.equal(zone.finished, true);
  assert.equal(zone.radius, CFG.safeZone.stages[CFG.safeZone.stages.length - 1].targetRadius);
  assert.equal(zone.isOutside({ x: 500, z: 0 }), true);
  assert.equal(zone.isOutside({ x: 0, z: 0 }), false);
});

// ---- Terrain determinism ----
test('terrain height is deterministic for a seed and varies across map', () => {
  const h1 = createHeightFunction(20261029);
  const h2 = createHeightFunction(20261029);
  const h3 = createHeightFunction(7);
  for (const [x, z] of [[0, 0], [50, -80], [-150, -130], [200, 200], [-33, 71]]) {
    assert.equal(h1(x, z), h2(x, z));
  }
  assert.notEqual(h1(50, -80), h3(50, -80));
  assert.ok(h1(-150, -130) > h1(0, 0) + 4, 'hilltop should be much higher than village');
  assert.ok(Math.abs(h1(0, 0)) < 1.5, 'village should be flat-ish');
});

console.log(`\n${passed} logic test(s) passed${process.exitCode ? ' (with failures above)' : ''}.`);
