// player.js — soldier visuals (GLB + low-poly fallback) and player controller.
// The game never depends on the GLB files existing: the fallback soldier is
// created first and only replaced after a model loads AND inspects cleanly.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, angleDelta } from './utils.js';

const _box3 = new THREE.Box3();
const _size = new THREE.Vector3();

/** Pick an animation clip by fuzzy name; returns null when nothing matches. */
function findClip(clips, keywords) {
  if (!clips) return null;
  const lower = clips.map(c => (c.name || '').toLowerCase());
  for (const kw of keywords) {
    const i = lower.findIndex(n => n.includes(kw));
    if (i >= 0) return clips[i];
  }
  return null;
}

/**
 * A soldier visual: THREE.Group at feet origin, faces +Z at rotation 0.
 * Contains either the fallback rig or the loaded GLB, a team ring, and an
 * invisible hit-proxy cylinder used by combat raycasts.
 */
export class SoldierVisual {
  constructor(teamColorHex, height = 1.8) {
    this.height = height;
    this.group = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.usingModel = false;
    this.walkPhase = 0;
    this.modelInfo = null;

    // Team ring at feet (readable team ID without seeing through walls)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 24),
      new THREE.MeshBasicMaterial({ color: teamColorHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    this.group.add(ring);
    this.ring = ring;

    // Hit proxy: raycastable but renders nothing (material invisible).
    this.proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, height, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.proxy.position.y = height / 2;
    this.group.add(this.proxy);

    this.fallback = this._buildFallback(teamColorHex);
    this.group.add(this.fallback.group);
    this.inner = this.fallback.group; // rotated for death fall, group stays upright for ring/proxy
  }

  _buildFallback(teamColorHex) {
    const g = new THREE.Group();
    const uniform = new THREE.MeshLambertMaterial({ color: 0x5a6b4a });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc9995f });
    const teamMat = new THREE.MeshLambertMaterial({ color: teamColorHex });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2c2f2a });

    const mk = (geo, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    // Torso + team chest band + head/helmet
    mk(new THREE.BoxGeometry(0.62, 0.72, 0.34), uniform, 0, 1.22, 0);
    mk(new THREE.BoxGeometry(0.64, 0.2, 0.36), teamMat, 0, 1.36, 0);
    mk(new THREE.BoxGeometry(0.34, 0.36, 0.34), skin, 0, 1.76, 0);
    mk(new THREE.BoxGeometry(0.44, 0.16, 0.44), dark, 0, 1.96, 0); // helmet
    // Backpack
    mk(new THREE.BoxGeometry(0.44, 0.5, 0.2), dark, 0, 1.24, -0.27);

    // Limb pivots (hip/shoulder) so we can swing them procedurally
    const limb = (x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      g.add(pivot);
      return pivot;
    };
    const legL = limb(-0.17, 0.88), legR = limb(0.17, 0.88);
    const armL = limb(-0.42, 1.52), armR = limb(0.42, 1.52);
    mk(new THREE.BoxGeometry(0.22, 0.86, 0.24), uniform, 0, -0.43, 0, legL);
    mk(new THREE.BoxGeometry(0.22, 0.86, 0.24), uniform, 0, -0.43, 0, legR);
    mk(new THREE.BoxGeometry(0.18, 0.7, 0.2), uniform, 0, -0.33, 0, armL);
    mk(new THREE.BoxGeometry(0.18, 0.7, 0.2), uniform, 0, -0.33, 0, armR);

    // Rifle held forward (+Z is facing direction)
    const gun = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), dark);
    barrel.position.set(0, 0.03, 0.55);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.12), dark);
    mag.position.set(0, -0.16, 0.05);
    gun.add(body, barrel, mag);
    gun.position.set(0.22, 1.34, 0.42);
    g.add(gun);

    return { group: g, legL, legR, armL, armR, gun };
  }

  /**
   * Try to load a GLB. Resolves (never rejects) with an info object:
   * { ok, path, meshes, triangles(approx), clips[], hasSkin, error }
   * On success the fallback is replaced; on failure it stays visible.
   */
  async loadModel(path, timeoutMs = 9000) {
    if (!path) return { ok: false, path, error: 'no path configured' };
    const loader = new GLTFLoader();
    try {
      const gltf = await Promise.race([
        loader.loadAsync(path),
        new Promise((_, reject) => setTimeout(() => reject(new Error('load timeout')), timeoutMs))
      ]);
      return this.adoptModel(gltf.scene, gltf.animations || [], path);
    } catch (err) {
      // Missing/corrupt model is an expected, handled case on fresh clones.
      console.info(`[XBR] Model "${path}" not loaded (${err.message}); using fallback soldier.`);
      this.modelInfo = { ok: false, path, error: err.message };
      return this.modelInfo;
    }
  }

  /**
   * Inspect + normalize + install an already-loaded model scene.
   * Used directly by game.js for shared enemy models (load once, clone many).
   */
  adoptModel(model, clips, path) {
    try {
      // --- Inspect ---
      let meshes = 0, triangles = 0, hasSkin = false, materials = new Set();
      model.traverse(obj => {
        if (obj.isMesh) {
          meshes++;
          const geo = obj.geometry;
          if (geo) {
            const index = geo.getIndex();
            const posCount = geo.getAttribute('position')?.count || 0;
            triangles += Math.floor((index ? index.count : posCount) / 3);
          }
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => m && materials.add(m.uuid));
          obj.castShadow = true;
          obj.frustumCulled = true;
        }
        if (obj.isSkinnedMesh) hasSkin = true;
      });
      // --- Normalize: scale to target height, feet on ground ---
      _box3.setFromObject(model);
      _box3.getSize(_size);
      if (_size.y > 0.01) {
        const s = this.height / _size.y;
        model.scale.setScalar(s);
        _box3.setFromObject(model);
        model.position.y -= _box3.min.y;
      }
      // --- Swap in ---
      this.group.remove(this.fallback.group);
      this.inner = model;
      this.group.add(model);
      this.usingModel = true;
      // --- Animations (only clips that actually exist) ---
      clips = Array.isArray(clips) ? clips : [];
      if (clips.length > 0) {
        this.mixer = new THREE.AnimationMixer(model);
        const defs = {
          idle: ['idle', 'stand', 'tpose', 't-pose'],
          walk: ['walk', 'walking'],
          run: ['run', 'running', 'sprint', 'jog'],
          death: ['death', 'die', 'dead', 'fall']
        };
        for (const [key, kws] of Object.entries(defs)) {
          const clip = findClip(clips, kws);
          if (clip) {
            const action = this.mixer.clipAction(clip);
            if (key === 'death') { action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; }
            this.actions[key] = action;
          }
        }
        if (this.actions.idle) this._play('idle');
        else if (clips[0]) { this.actions.idle = this.mixer.clipAction(clips[0]); this._play('idle'); }
      }
      this.modelInfo = {
        ok: true, path, meshes, triangles, materials: materials.size,
        clips: clips.map(c => c.name), hasSkin
      };
      console.info('[XBR] Model loaded:', this.modelInfo);
      return this.modelInfo;
    } catch (err) {
      // Missing/corrupt model is an expected, handled case on fresh clones.
      console.info(`[XBR] Model "${path}" not loaded (${err.message}); using fallback soldier.`);
      this.modelInfo = { ok: false, path, error: err.message };
      return this.modelInfo;
    }
  }

  _play(name) {
    const next = this.actions[name];
    if (!next || this.currentAction === next) return;
    if (this.currentAction) this.currentAction.fadeOut(0.15);
    next.reset().fadeIn(0.15).play();
    this.currentAction = next;
  }

  /** speed: current horizontal speed; dt seconds; dead flag freezes/falls. */
  update(dt, speed, dead = false) {
    if (this.mixer) {
      this.mixer.update(dt);
      if (dead) { if (this.actions.death) this._play('death'); }
      else if (speed > 6.8) this._play(this.actions.run ? 'run' : 'walk');
      else if (speed > 0.4) this._play(this.actions.walk ? 'walk' : 'run');
      else this._play('idle');
    }
    if (!this.usingModel || !this.mixer) {
      // Procedural fallback animation (also used for unanimated GLBs)
      if (dead) {
        this.inner.rotation.x = Math.max(-Math.PI / 2, this.inner.rotation.x - dt * 4);
        return;
      }
      this.inner.rotation.x = 0;
      if (!this.usingModel) {
        this.walkPhase += dt * (2 + speed * 1.6);
        const swing = Math.min(1, speed / 5) * 0.65;
        const s = Math.sin(this.walkPhase) * swing;
        this.fallback.legL.rotation.x = s;
        this.fallback.legR.rotation.x = -s;
        this.fallback.armL.rotation.x = -s * 0.7;
        this.fallback.armR.rotation.x = s * 0.7;
        this.fallback.group.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.05 * Math.min(1, speed / 4);
      } else {
        // Unanimated model: gentle bob so movement still reads
        this.walkPhase += dt * (2 + speed * 1.4);
        this.inner.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.04 * Math.min(1, speed / 4);
      }
    } else if (dead && !this.actions.death) {
      this.inner.rotation.x = Math.max(-Math.PI / 2, this.inner.rotation.x - dt * 4);
    }
  }

  setDeadPose() {
    if (this.mixer && this.actions.death) this._play('death');
    else this.inner.rotation.x = -Math.PI / 2;
    this.proxy.visible = false; // dead bodies are not valid targets
    this.ring.visible = false;
  }

  resetPose() {
    this.inner.rotation.x = 0;
    this.inner.position.y = this.usingModel ? (this.modelBaseY || 0) : 0;
    if (!this.usingModel) this.fallback.group.position.y = 0;
    this.proxy.visible = true;
    this.ring.visible = true;
    if (this.mixer) this._play('idle');
  }
}

/** Third-person player entity: physics-lite movement + collision + ground. */
export class Player {
  constructor(scene, config, visual, map, colliders) {
    this.cfg = config.player;
    this.map = map;
    this.colliders = colliders;
    this.visual = visual;
    scene.add(visual.group);
    this.position = new THREE.Vector3(this.cfg.spawn.x, 0, this.cfg.spawn.z);
    this.position.y = map.groundY(this.position.x, this.position.z);
    this.velocity = new THREE.Vector3();
    this.facingYaw = Math.PI; // face village (north, -Z) at spawn
    this.grounded = true;
    this.speed2D = 0;
    this.syncVisual(0);
  }

  reset() {
    this.position.set(this.cfg.spawn.x, 0, this.cfg.spawn.z);
    this.position.y = this.map.groundY(this.position.x, this.position.z);
    this.velocity.set(0, 0, 0);
    this.facingYaw = Math.PI;
    this.grounded = true;
    this.visual.resetPose();
    this.syncVisual(0);
  }

  /**
   * move: {x: strafe(-1..1 right+), y: forward(-1..1 fwd+)} in camera space.
   * camYaw: camera heading; aimYaw when aiming overrides facing.
   */
  update(dt, move, camYaw, sprint, aimMode, jumpRequested) {
    const cfg = this.cfg;
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    // Camera forward (horizontal) and right vectors
    const fwdX = sin, fwdZ = cos;
    const rightX = -cos, rightZ = sin;
    let wx = fwdX * move.y + rightX * move.x;
    let wz = fwdZ * move.y + rightZ * move.x;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }

    const maxSpeed = (sprint && !aimMode ? cfg.sprintSpeed : cfg.walkSpeed) *
      (aimMode ? cfg.aimSpeedMultiplier : 1);
    const accel = cfg.acceleration;
    // Accelerate XZ toward target velocity
    const tvx = wx * maxSpeed, tvz = wz * maxSpeed;
    const dvx = tvx - this.velocity.x, dvz = tvz - this.velocity.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvLen > 0.0001) {
      const s = Math.min(1, maxDv / dvLen);
      this.velocity.x += dvx * s;
      this.velocity.z += dvz * s;
    }

    // Jump + gravity
    const ground = this.map.groundY(this.position.x, this.position.z);
    if (jumpRequested && this.grounded) {
      this.velocity.y = cfg.jumpVelocity;
      this.grounded = false;
    }
    if (!this.grounded) this.velocity.y += cfg.gravity * dt;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Keep inside the playable island
    const maxR = this.cfg.maxRadius || 238;
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > maxR) {
      this.position.x *= maxR / r;
      this.position.z *= maxR / r;
    }
    // Obstacle collision (mutates x/z)
    this.colliders.resolve(this.position, cfg.radius, this.position.y, cfg.height);

    const newGround = this.map.groundY(this.position.x, this.position.z);
    if (this.position.y <= newGround) {
      this.position.y = newGround;
      this.velocity.y = 0;
      this.grounded = true;
    } else if (this.grounded && this.position.y - newGround < 0.6) {
      // Walking downhill: stick to terrain
      this.position.y = newGround;
    } else {
      this.grounded = false;
    }

    // Facing: aim direction while aiming/firing, else movement direction
    if (aimMode) this._turnToward(camYaw, dt, 14);
    else if (len > 0.15) this._turnToward(Math.atan2(wx, wz), dt, 10);

    this.speed2D = Math.hypot(this.velocity.x, this.velocity.z);
    this.syncVisual(dt);
  }

  _turnToward(targetYaw, dt, rate) {
    const d = angleDelta(targetYaw, this.facingYaw);
    this.facingYaw += clamp(d, -rate * dt, rate * dt);
  }

  syncVisual(dt) {
    this.visual.group.position.copy(this.position);
    this.visual.group.rotation.y = this.facingYaw;
    if (dt > 0) this.visual.update(dt, this.speed2D, false);
  }

  /** Muzzle world position (right of chest, forward). */
  muzzlePosition(out) {
    const sin = Math.sin(this.facingYaw), cos = Math.cos(this.facingYaw);
    out.set(
      this.position.x + sin * 0.7 + (-cos) * 0.22,
      this.position.y + 1.38,
      this.position.z + cos * 0.7 + sin * 0.22
    );
    return out;
  }

  chestPosition(out) {
    out.set(this.position.x, this.position.y + 1.35, this.position.z);
    return out;
  }
}
