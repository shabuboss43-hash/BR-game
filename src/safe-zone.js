// safe-zone.js — shrinking battle-royale zone with staged shrink phases.
// Timing logic is pure (testable); the translucent cylinder is visual only.
import * as THREE from 'three';

export class SafeZone {
  constructor(scene, zoneConfig) {
    this.cfg = zoneConfig;
    this.center = { x: zoneConfig.center.x, z: zoneConfig.center.z };
    this.reset();

    const geo = new THREE.CylinderGeometry(1, 1, 90, 48, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4d4d, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(this.center.x, 45, this.center.z);
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);

    const ringGeo = new THREE.RingGeometry(0.992, 1.0, 64);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xff6b6b, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(this.center.x, 2.2, this.center.z);
    scene.add(this.ring);
    this._syncMesh();
  }

  reset() {
    this.radius = this.cfg.initialRadius;
    this.stageIndex = 0;
    this.phase = 'delay';           // delay -> warning -> shrinking -> (next delay) -> final
    this.phaseTime = 0;
    this.fromRadius = this.radius;
    this.finished = this.cfg.stages.length === 0;
  }

  currentStage() { return this.cfg.stages[this.stageIndex] || null; }

  /** Seconds left in the current phase (for HUD countdowns). */
  timeRemaining() {
    const s = this.currentStage();
    if (!s || this.finished) return 0;
    if (this.phase === 'delay') return Math.max(0, s.delay - this.phaseTime);
    if (this.phase === 'warning') return Math.max(0, s.warning - this.phaseTime);
    if (this.phase === 'shrinking') return Math.max(0, s.shrinkTime - this.phaseTime);
    return 0;
  }

  nextRadius() {
    const s = this.currentStage();
    return s ? s.targetRadius : this.radius;
  }

  update(dt) {
    if (this.finished) return;
    const stage = this.currentStage();
    if (!stage) { this.finished = true; return; }
    this.phaseTime += dt;

    if (this.phase === 'delay' && this.phaseTime >= stage.delay) {
      this.phase = 'warning'; this.phaseTime = 0;
      if (this.onWarning) this.onWarning(stage);
    } else if (this.phase === 'warning' && this.phaseTime >= stage.warning) {
      this.phase = 'shrinking'; this.phaseTime = 0;
      this.fromRadius = this.radius;
      if (this.onShrinkStart) this.onShrinkStart(stage);
    } else if (this.phase === 'shrinking') {
      const t = Math.min(1, this.phaseTime / stage.shrinkTime);
      this.radius = this.fromRadius + (stage.targetRadius - this.fromRadius) * t;
      if (t >= 1) {
        this.radius = Math.max(stage.targetRadius, 1);
        this.stageIndex += 1;
        this.phase = 'delay'; this.phaseTime = 0;
        if (!this.currentStage()) this.finished = true;
      }
    }
    this._syncMesh();
  }

  isOutside(position) {
    const dx = position.x - this.center.x;
    const dz = position.z - this.center.z;
    return (dx * dx + dz * dz) > this.radius * this.radius;
  }

  distanceOutside(position) {
    const d = Math.hypot(position.x - this.center.x, position.z - this.center.z);
    return Math.max(0, d - this.radius);
  }

  _syncMesh() {
    if (!this.mesh) return;
    this.mesh.scale.set(this.radius, 1, this.radius);
    this.ring.scale.set(this.radius, this.radius, 1);
    // Pulse opacity slightly while shrinking so the wall reads as dangerous
    this.mesh.material.opacity = this.phase === 'shrinking' ? 0.22 : 0.14;
  }
}
