// combat.js — combatant health model, hitscan resolution and pooled effects.
import * as THREE from 'three';
import { damageAtRange } from './weapons.js';
import { degToRad } from './utils.js';

export class Combatant {
  constructor({ id, team, maxHealth, isPlayer = false }) {
    this.id = id;
    this.team = team;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.alive = true;
    this.isPlayer = isPlayer;
    this.lastDamageSource = null;
    this.stats = { shots: 0, hits: 0, kills: 0, damageDealt: 0 };
  }

  reset() {
    this.health = this.maxHealth;
    this.alive = true;
    this.lastDamageSource = null;
    this.stats = { shots: 0, hits: 0, kills: 0, damageDealt: 0 };
  }

  /**
   * Apply damage. Returns actually-applied damage (0 when dead / friendly /
   * self). onDeath callback is invoked exactly once.
   */
  takeDamage(amount, source, friendlyFire = false) {
    if (!this.alive || amount <= 0) return 0;
    if (source) {
      if (source === this) return 0;
      if (!friendlyFire && source.team === this.team) return 0;
    }
    const applied = Math.min(this.health, amount);
    this.health -= applied;
    this.lastDamageSource = source || this.lastDamageSource;
    if (source && source.stats) source.stats.damageDealt += applied;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (source && source.stats) source.stats.kills += 1;
      if (this.onDeath) this.onDeath(this, source);
    } else if (this.onDamaged) {
      this.onDamaged(this, applied, source);
    }
    return applied;
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    return this.health - before;
  }
}

/** Pooled tracers + impact particles. No per-shot allocations. */
export class EffectsPool {
  constructor(scene, maxParticles = 40) {
    this.maxParticles = maxParticles;
    // Tracers: reusable lines
    this.tracers = [];
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
      const line = new THREE.Line(geo, tracerMat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;

    // Particles: one THREE.Points with ring-buffer slots
    this.particlePos = new Float32Array(70 * 3);
    this.particleVel = new Float32Array(70 * 3);
    this.particleLife = new Float32Array(70);
    for (let i = 0; i < 70; i++) this.particlePos[i * 3 + 1] = -999;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePos, 3));
    this.points = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0xffb347, size: 0.55, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.particleIdx = 0;

    // Muzzle flash: single reusable sprite-ish plane
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({ color: 0xffcf6e, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashLife = 0;
  }

  setMaxParticles(n) { this.maxParticles = Math.min(70, Math.max(0, n)); }

  tracer(from, to) {
    const t = this.tracers[this.tracerIdx++ % this.tracers.length];
    const arr = t.line.geometry.attributes.position.array;
    arr[0] = from.x; arr[1] = from.y; arr[2] = from.z;
    arr[3] = to.x; arr[4] = to.y; arr[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.life = 0.06;
    t.line.visible = true;
  }

  muzzle(position, camera) {
    this.flash.position.copy(position);
    if (camera) this.flash.quaternion.copy(camera.quaternion);
    this.flashLife = 0.045;
    this.flash.visible = true;
  }

  impact(position, count = 4) {
    const n = Math.min(count, this.maxParticles);
    for (let k = 0; k < n; k++) {
      const i = this.particleIdx++ % 70;
      this.particlePos[i * 3] = position.x;
      this.particlePos[i * 3 + 1] = position.y;
      this.particlePos[i * 3 + 2] = position.z;
      this.particleVel[i * 3] = (Math.random() - 0.5) * 5;
      this.particleVel[i * 3 + 1] = Math.random() * 4 + 1;
      this.particleVel[i * 3 + 2] = (Math.random() - 0.5) * 5;
      this.particleLife[i] = 0.28 + Math.random() * 0.2;
    }
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
    }
    if (this.flashLife > 0) { this.flashLife -= dt; if (this.flashLife <= 0) this.flash.visible = false; }
    let any = false;
    for (let i = 0; i < 70; i++) {
      if (this.particleLife[i] <= 0) continue;
      any = true;
      this.particleLife[i] -= dt;
      if (this.particleLife[i] <= 0) { this.particlePos[i * 3 + 1] = -999; continue; }
      this.particleVel[i * 3 + 1] -= 12 * dt;
      this.particlePos[i * 3] += this.particleVel[i * 3] * dt;
      this.particlePos[i * 3 + 1] += this.particleVel[i * 3 + 1] * dt;
      this.particlePos[i * 3 + 2] += this.particleVel[i * 3 + 2] * dt;
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }

  clear() {
    for (const t of this.tracers) { t.life = 0; t.line.visible = false; }
    this.flashLife = 0; this.flash.visible = false;
    this.particleLife.fill(0);
    for (let i = 0; i < 70; i++) this.particlePos[i * 3 + 1] = -999;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

/**
 * Resolve one fired weapon (all pellets). Raycasts against obstacle meshes
 * and enemy hit-proxies; the nearest hit wins, so walls block damage.
 * entities: [{ combatant, proxy (Mesh), position (Vector3 feet), height }]
 * Returns { hitEntity, totalDamage, hitPoints[] } for HUD feedback.
 */
export function resolveShot({ shooter, shooterEntity, origin, direction, def, entities, obstacleMeshes, friendlyFire, spreadScale = 1, effects, muzzlePos, camera }) {
  const result = { hitEntity: null, totalDamage: 0, hitPoints: [] };
  const targets = [];
  for (const e of entities) {
    if (e === shooterEntity || !e.combatant.alive) continue;
    if (!friendlyFire && e.combatant.team === shooter.team) continue;
    targets.push(e);
  }
  const targetProxies = targets.map(t => t.proxy);
  const pellets = Math.max(1, def.pellets || 1);
  const spreadRad = degToRad(def.spreadDegrees || 0) * spreadScale;

  shooter.stats.shots += 1;
  let anyHit = false;

  for (let p = 0; p < pellets; p++) {
    _dir.copy(direction);
    if (spreadRad > 0) {
      // Random cone deviation
      _dir.x += (Math.random() * 2 - 1) * Math.tan(spreadRad);
      _dir.y += (Math.random() * 2 - 1) * Math.tan(spreadRad);
      _dir.z += (Math.random() * 2 - 1) * Math.tan(spreadRad);
      _dir.normalize();
    }
    _raycaster.set(origin, _dir);
    _raycaster.far = def.range;

    let nearest = null;
    let nearestEntity = null;
    const obsHits = _raycaster.intersectObjects(obstacleMeshes, false);
    if (obsHits.length > 0) nearest = obsHits[0];
    if (targetProxies.length > 0) {
      const entHits = _raycaster.intersectObjects(targetProxies, false);
      if (entHits.length > 0 && (!nearest || entHits[0].distance < nearest.distance)) {
        nearest = entHits[0];
        nearestEntity = targets.find(t => t.proxy === entHits[0].object) || null;
      }
    }

    if (nearest) {
      result.hitPoints.push(nearest.point.clone());
      if (effects) {
        effects.tracer(muzzlePos || origin, nearest.point);
        effects.impact(nearest.point, nearestEntity ? 5 : 3);
      }
      if (nearestEntity) {
        const dmg = damageAtRange(def, nearest.distance);
        const applied = nearestEntity.combatant.takeDamage(dmg, shooter, friendlyFire);
        if (applied > 0) {
          result.totalDamage += applied;
          result.hitEntity = nearestEntity;
          anyHit = true;
        }
      }
    } else if (effects) {
      _end.copy(_dir).multiplyScalar(Math.min(def.range, 120)).add(origin);
      effects.tracer(muzzlePos || origin, _end);
    }
  }
  if (anyHit) shooter.stats.hits += 1;
  if (effects && muzzlePos) effects.muzzle(muzzlePos, camera);
  return result;
}

/** Line-of-sight: true when no obstacle mesh blocks from->to. */
export function hasLineOfSight(from, to, obstacleMeshes) {
  _dir.copy(to).sub(from);
  const dist = _dir.length();
  if (dist < 0.01) return true;
  _dir.normalize();
  _raycaster.set(from, _dir);
  _raycaster.far = dist - 0.4;
  const hits = _raycaster.intersectObjects(obstacleMeshes, false);
  return hits.length === 0;
}
