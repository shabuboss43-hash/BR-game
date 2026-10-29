// enemy.js — AI soldier: finite state machine + waypoint patrol +
// obstacle avoidance + line-of-sight combat. Decisions run at a low
// frequency (config.enemy.decisionInterval); movement runs every frame.
import * as THREE from 'three';
import { hasLineOfSight, resolveShot } from './combat.js';
import { clamp, angleDelta, degToRad } from './utils.js';

export const AIStates = {
  IDLE: 'IDLE', PATROL: 'PATROL', INVESTIGATE: 'INVESTIGATE', CHASE: 'CHASE',
  ATTACK: 'ATTACK', SEEK_COVER: 'SEEK_COVER', RELOAD: 'RELOAD', DEAD: 'DEAD',
  SEEK_ZONE: 'SEEK_ZONE'
};

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export class Enemy {
  constructor(scene, config, visual, map, colliders, spawn, weaponInventory, rng) {
    this.cfg = config.enemy;
    this.map = map;
    this.colliders = colliders;
    this.visual = visual;
    this.inventory = weaponInventory;
    this.rng = rng;
    scene.add(visual.group);
    this.spawn = { x: spawn.x, z: spawn.z };
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.position.y = map.groundY(spawn.x, spawn.z);
    this.facingYaw = rng() * Math.PI * 2;
    this.speed2D = 0;
    this.state = AIStates.PATROL;
    this.decisionTimer = Math.random() * this.cfg.decisionInterval;
    this.targetPoint = null;
    this.lastKnownPlayerPos = null;
    this.lastSeenAt = -999;
    this.burstLeft = 0;
    this.burstCooldown = 0;
    this.idleTimer = 0;
    this.stuckTimer = 0;
    this.lastPos = this.position.clone();
    this.combatant = null; // wired by game.js
    this.syncVisual(0);
    this._pickPatrolPoint();
  }

  reset() {
    this.position.set(this.spawn.x, 0, this.spawn.z);
    this.position.y = this.map.groundY(this.spawn.x, this.spawn.z);
    this.state = AIStates.PATROL;
    this.lastKnownPlayerPos = null;
    this.lastSeenAt = -999;
    this.burstLeft = 0; this.burstCooldown = 0;
    this.visual.resetPose();
    this._pickPatrolPoint();
    this.syncVisual(0);
  }

  setDead() {
    this.state = AIStates.DEAD;
    this.visual.setDeadPose();
    this.syncVisual(0);
  }

  /** Noise event: shots fired near the enemy draw investigation. */
  hearNoise(pos, now) {
    if (!this.combatant?.alive) return;
    const d = Math.hypot(pos.x - this.position.x, pos.z - this.position.z);
    if (d < this.cfg.detectionRadius * 1.4 && this.state !== AIStates.CHASE && this.state !== AIStates.ATTACK) {
      this.lastKnownPlayerPos = { x: pos.x, z: pos.z };
      this.state = AIStates.INVESTIGATE;
    }
    void now;
  }

  _pickPatrolPoint() {
    const pts = this.map.patrolPoints;
    if (!pts.length) return;
    // Prefer points within ~90 units so patrols stay local
    const nearby = pts.filter(p => Math.hypot(p.x - this.position.x, p.z - this.position.z) < 110);
    const pool = nearby.length ? nearby : pts;
    const p = pool[Math.floor(this.rng() * pool.length)];
    this.targetPoint = { x: p.x + (this.rng() * 16 - 8), z: p.z + (this.rng() * 16 - 8) };
  }

  _pickCoverPoint(threatPos) {
    let best = null, bestScore = -Infinity;
    for (const c of this.map.coverPoints) {
      const distSelf = Math.hypot(c.x - this.position.x, c.z - this.position.z);
      if (distSelf > 60 || distSelf < 2) continue;
      const distThreat = Math.hypot(c.x - threatPos.x, c.z - threatPos.z);
      const score = distThreat - distSelf * 0.7;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) this.targetPoint = { x: best.x, z: best.z };
    return !!best;
  }

  _canSeePlayer(ctx) {
    const p = ctx.player.position;
    const dx = p.x - this.position.x, dz = p.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.cfg.detectionRadius) return false;
    // Field of view ~130° unless very close (hearing/awareness radius)
    if (dist > 9) {
      const toPlayer = Math.atan2(dx, dz);
      if (Math.abs(angleDelta(toPlayer, this.facingYaw)) > degToRad(68)) return false;
    }
    _from.set(this.position.x, this.position.y + 1.5, this.position.z);
    _to.set(p.x, p.y + 1.3, p.z);
    return hasLineOfSight(_from, _to, ctx.obstacleMeshes);
  }

  /** Low-frequency strategic decisions. */
  _decide(ctx, now) {
    const combatant = this.combatant;
    if (!combatant || !combatant.alive) { this.state = AIStates.DEAD; return; }
    this.inventory.update(now);

    // Safe zone has priority over everything except being mid-fight nearby
    if (ctx.safeZone.isOutside(this.position)) {
      this.state = AIStates.SEEK_ZONE;
      this.targetPoint = { x: ctx.safeZone.center.x, z: ctx.safeZone.center.z };
      return;
    }

    const sees = ctx.playerCombatant.alive && this._canSeePlayer(ctx);
    if (sees) {
      this.lastSeenAt = now;
      this.lastKnownPlayerPos = { x: ctx.player.position.x, z: ctx.player.position.z };
    }
    const distToPlayer = Math.hypot(
      ctx.player.position.x - this.position.x, ctx.player.position.z - this.position.z);
    const weapon = this.inventory.current();

    // Reload when empty (or low and not actively trading fire)
    if (weapon && (weapon.magazine === 0 || (weapon.magazine <= 2 && !sees)) && weapon.reserve > 0) {
      if (this.inventory.startReload(now)) { this.state = AIStates.RELOAD; return; }
    }
    if (this.state === AIStates.RELOAD && weapon?.reloading) return;

    // Low health: break off to cover
    if (combatant.health < combatant.maxHealth * 0.35 && sees) {
      if (this._pickCoverPoint(ctx.player.position)) { this.state = AIStates.SEEK_COVER; return; }
    }

    if (sees) {
      this.state = distToPlayer <= this.cfg.attackRange ? AIStates.ATTACK : AIStates.CHASE;
      return;
    }
    if (now - this.lastSeenAt < 4 && this.lastKnownPlayerPos) {
      this.state = AIStates.INVESTIGATE;
      return;
    }
    if (this.state === AIStates.INVESTIGATE && this.lastKnownPlayerPos) return; // keep going
    if (this.state === AIStates.SEEK_COVER) return;
    if (this.state !== AIStates.PATROL && this.state !== AIStates.IDLE) {
      this.state = AIStates.PATROL;
      this._pickPatrolPoint();
    }
  }

  /** Per-frame update. ctx: { player, playerCombatant, playerEntity, entities, obstacleMeshes, safeZone, effects, friendlyFire, onShoot } */
  update(dt, now, ctx) {
    if (!this.combatant?.alive || this.state === AIStates.DEAD) return;
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.cfg.decisionInterval;
      this._decide(ctx, now);
    }
    this.inventory.update(now);
    if (this.burstCooldown > 0) this.burstCooldown -= dt;

    let moveX = 0, moveZ = 0, speed = this.cfg.walkSpeed;
    let faceTarget = null;

    const toPoint = (tx, tz) => {
      const dx = tx - this.position.x, dz = tz - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.4) { moveX = dx / d; moveZ = dz / d; }
      return d;
    };

    switch (this.state) {
      case AIStates.IDLE:
        this.idleTimer -= dt;
        faceTarget = this.facingYaw + Math.sin(now * 0.4 + this.spawn.x) * 0.002;
        if (this.idleTimer <= 0) { this.state = AIStates.PATROL; this._pickPatrolPoint(); }
        break;
      case AIStates.PATROL: {
        if (!this.targetPoint) this._pickPatrolPoint();
        const d = toPoint(this.targetPoint.x, this.targetPoint.z);
        if (d < 2.2) {
          if (this.rng() < 0.3) { this.state = AIStates.IDLE; this.idleTimer = 1.5 + this.rng() * 2.5; }
          else this._pickPatrolPoint();
        }
        break;
      }
      case AIStates.INVESTIGATE: {
        speed = this.cfg.chaseSpeed * 0.85;
        if (this.lastKnownPlayerPos) {
          const d = toPoint(this.lastKnownPlayerPos.x, this.lastKnownPlayerPos.z);
          if (d < 2.5) { this.lastKnownPlayerPos = null; this.state = AIStates.PATROL; this._pickPatrolPoint(); }
        } else { this.state = AIStates.PATROL; this._pickPatrolPoint(); }
        break;
      }
      case AIStates.CHASE: {
        speed = this.cfg.chaseSpeed;
        const tp = this.lastKnownPlayerPos || ctx.player.position;
        toPoint(tp.x, tp.z);
        faceTarget = Math.atan2(ctx.player.position.x - this.position.x, ctx.player.position.z - this.position.z);
        break;
      }
      case AIStates.ATTACK: {
        faceTarget = Math.atan2(ctx.player.position.x - this.position.x, ctx.player.position.z - this.position.z);
        const dist = Math.hypot(ctx.player.position.x - this.position.x, ctx.player.position.z - this.position.z);
        // Keep preferred range: back off if too close, close in if too far
        if (dist > this.cfg.preferredRange + 8) { toPoint(ctx.player.position.x, ctx.player.position.z); speed = this.cfg.chaseSpeed * 0.7; }
        else if (dist < this.cfg.preferredRange - 8) {
          moveX = -(ctx.player.position.x - this.position.x) / (dist || 1);
          moveZ = -(ctx.player.position.z - this.position.z) / (dist || 1);
          speed = this.cfg.walkSpeed * 0.8;
        } else {
          // Small strafe so the enemy is not a static target
          const strafe = Math.sin(now * 0.7 + this.spawn.x * 3.1);
          const px = -(ctx.player.position.z - this.position.z) / (dist || 1);
          const pz = (ctx.player.position.x - this.position.x) / (dist || 1);
          moveX = px * strafe; moveZ = pz * strafe;
          speed = this.cfg.walkSpeed * 0.55;
        }
        this._tryAttack(now, ctx);
        break;
      }
      case AIStates.SEEK_COVER: {
        speed = this.cfg.chaseSpeed;
        if (this.targetPoint) {
          const d = toPoint(this.targetPoint.x, this.targetPoint.z);
          if (d < 2.0) { this.state = AIStates.IDLE; this.idleTimer = 2.5; }
        } else this.state = AIStates.PATROL;
        break;
      }
      case AIStates.SEEK_ZONE: {
        speed = this.cfg.chaseSpeed;
        toPoint(ctx.safeZone.center.x + (this.rng() - 0.5) * 4, ctx.safeZone.center.z + (this.rng() - 0.5) * 4);
        if (!ctx.safeZone.isOutside(this.position)) { this.state = AIStates.PATROL; this._pickPatrolPoint(); }
        break;
      }
      case AIStates.RELOAD: {
        // Drift toward cover-ish: step away from player slowly
        const dist = Math.hypot(ctx.player.position.x - this.position.x, ctx.player.position.z - this.position.z) || 1;
        moveX = -(ctx.player.position.x - this.position.x) / dist;
        moveZ = -(ctx.player.position.z - this.position.z) / dist;
        speed = this.cfg.walkSpeed * 0.6;
        if (!this.inventory.current()?.reloading) this.state = AIStates.PATROL;
        break;
      }
    }

    // Simple obstacle avoidance: if blocked ahead, deflect movement 45°.
    if ((moveX !== 0 || moveZ !== 0)) {
      _from.set(this.position.x, this.position.y + 1.0, this.position.z);
      _to.set(this.position.x + moveX * 3.2, this.position.y + 1.0, this.position.z + moveZ * 3.2);
      if (!hasLineOfSight(_from, _to, ctx.obstacleMeshes)) {
        const cos = Math.cos(0.8), sin = Math.sin(0.8);
        const nx = moveX * cos - moveZ * sin;
        const nz = moveX * sin + moveZ * cos;
        moveX = nx; moveZ = nz;
      }
    }

    this.position.x += moveX * speed * dt;
    this.position.z += moveZ * speed * dt;
    const maxR = 238;
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > maxR) { this.position.x *= maxR / r; this.position.z *= maxR / r; }
    this.colliders.resolve(this.position, this.cfg.radius, this.position.y, this.cfg.height);
    this.position.y = this.map.groundY(this.position.x, this.position.z);

    // Stuck detection: repick destination
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.2) {
      const moved = Math.hypot(this.position.x - this.lastPos.x, this.position.z - this.lastPos.z);
      if ((moveX !== 0 || moveZ !== 0) && moved < 0.25 && this.state === AIStates.PATROL) this._pickPatrolPoint();
      this.lastPos.copy(this.position);
      this.stuckTimer = 0;
    }

    // Facing
    const moving = (moveX !== 0 || moveZ !== 0);
    const targetYaw = faceTarget !== null ? faceTarget : (moving ? Math.atan2(moveX, moveZ) : this.facingYaw);
    const dYaw = angleDelta(targetYaw, this.facingYaw);
    this.facingYaw += clamp(dYaw, -3.2 * dt, 3.2 * dt);
    this.speed2D = moving ? speed : 0;
    this.syncVisual(dt);
  }

  _tryAttack(now, ctx) {
    const weapon = this.inventory.current();
    if (!weapon || weapon.reloading) return;
    if (weapon.magazine <= 0) { this.inventory.startReload(now); return; }

    // Burst discipline: fire bursts, pause between them
    if (this.burstLeft <= 0) {
      if (this.burstCooldown > 0) return;
      const def = weapon.def;
      this.burstLeft = def.automatic ? 3 + Math.floor(this.rng() * 4) : 1;
    }
    const attempt = this.inventory.tryFire(now);
    if (!attempt.fired) return;

    // Aim at player chest with configurable inaccuracy
    _from.set(this.position.x, this.position.y + 1.45, this.position.z);
    _to.set(ctx.player.position.x, ctx.player.position.y + 1.3, ctx.player.position.z);
    _dir.copy(_to).sub(_from).normalize();
    const err = Math.tan(degToRad(this.cfg.aimErrorDegrees));
    _dir.x += (this.rng() * 2 - 1) * err;
    _dir.y += (this.rng() * 2 - 1) * err * 0.6;
    _dir.z += (this.rng() * 2 - 1) * err;
    _dir.normalize();

    const sin = Math.sin(this.facingYaw), cos = Math.cos(this.facingYaw);
    _muzzle.set(this.position.x + sin * 0.7, this.position.y + 1.4, this.position.z + cos * 0.7);

    resolveShot({
      shooter: this.combatant,
      shooterEntity: ctx.selfEntity,
      origin: _from.clone(),
      direction: _dir.clone(),
      def: weapon.def,
      entities: ctx.entities,
      obstacleMeshes: ctx.obstacleMeshes,
      friendlyFire: ctx.friendlyFire,
      effects: ctx.effects,
      muzzlePos: _muzzle.clone(),
      camera: ctx.camera
    });
    if (ctx.onShoot) ctx.onShoot(this, weapon.def, false);
    this.burstLeft -= 1;
    if (this.burstLeft <= 0) this.burstCooldown = 0.55 + this.rng() * 0.7;
  }

  syncVisual(dt) {
    this.visual.group.position.copy(this.position);
    this.visual.group.rotation.y = this.facingYaw;
    if (dt > 0) this.visual.update(dt, this.speed2D, this.state === AIStates.DEAD);
  }

  chestPosition(out) {
    out.set(this.position.x, this.position.y + 1.35, this.position.z);
    return out;
  }
}
