// map.js — original compact island: deterministic terrain, village, outpost,
// warehouse, watchtower, roads, river, forest, hilltop and cover objects.
// All geometry is procedural (no external map asset needed or used).
import * as THREE from 'three';
import { makeRng, clamp, smoothstep } from './utils.js';

const FLAT_SPOTS = [
  { x: 0, z: 0, r: 78, h: 0.3 },       // central village
  { x: 125, z: -112, r: 52, h: 0.4 },  // military outpost
  { x: -112, z: 92, r: 40, h: 0.35 },  // warehouse
  { x: 0, z: 150, r: 30, h: 0.3 }      // player spawn beach camp
];

export function riverZ(x) { return 58 + Math.sin(x * 0.012) * 18; }

/**
 * Deterministic analytic terrain height. The same function is used for the
 * mesh, character ground contact and object placement, so they always agree.
 */
export function createHeightFunction(seed) {
  const rng = makeRng(seed);
  const bumps = [];
  for (let i = 0; i < 10; i++) {
    bumps.push({
      x: (rng() * 2 - 1) * 200,
      z: (rng() * 2 - 1) * 200,
      r: 34 + rng() * 46,
      h: 1.2 + rng() * 2.6
    });
  }
  const phaseA = rng() * Math.PI * 2;
  const phaseB = rng() * Math.PI * 2;

  return function heightAt(x, z) {
    let h = 1.5 * Math.sin(x * 0.018 + phaseA) * Math.cos(z * 0.021 + phaseB);
    h += 0.7 * Math.sin(x * 0.045 + phaseB) * Math.sin(z * 0.038 + phaseA);
    // Hilltop landmark (north-west)
    const hd = Math.hypot(x + 150, z + 130);
    h += 11 * Math.exp(-(hd * hd) / (2 * 55 * 55));
    for (const b of bumps) {
      const d = Math.hypot(x - b.x, z - b.z);
      h += b.h * Math.exp(-(d * d) / (2 * b.r * b.r));
    }
    // River channel
    const rd = z - riverZ(x);
    h -= 1.6 * Math.exp(-(rd * rd) / (2 * 7 * 7));
    // Flatten landmark areas so buildings sit sensibly
    for (const s of FLAT_SPOTS) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.r) {
        const t = smoothstep(d / s.r);
        h = h * t + s.h * (1 - t);
      }
    }
    // Island edge falls toward the sea
    const r = Math.hypot(x, z);
    if (r > 218) h -= smoothstep((r - 218) / 34) * 7;
    return h;
  };
}

function buildRibbon(points, width, yAt, material) {
  const verts = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[Math.min(i + 1, points.length - 1)];
    const prev = points[Math.max(i - 1, 0)];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const px = -dz * width / 2, pz = dx * width / 2;
    const lx = p.x + px, lz = p.z + pz, rx = p.x - px, rz = p.z - pz;
    verts.push(lx, yAt(lx, lz), lz, rx, yAt(rx, rz), rz);
    if (i > 0) {
      const a = (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

export class GameMap {
  constructor(scene, config, colliders) {
    this.config = config;
    this.colliders = colliders;
    this.heightAt = createHeightFunction(config.world.seed);
    this.obstacleMeshes = [];   // meshes used for shot/LOS raycasts
    this.patrolPoints = [];
    this.coverPoints = [];
    this.minimapFeatures = { buildings: [], roads: [] };
    this.group = new THREE.Group();
    scene.add(this.group);
    this._buildTerrain();
    this._buildWaterAndRiver();
    this._buildRoads();
    this._buildVillage();
    this._buildOutpost();
    this._buildWarehouseAndTower();
    this._buildCoverAndVehicles();
    this._buildVegetation();
    this._buildPatrolAndCoverPoints();
  }

  groundY(x, z) { return this.heightAt(x, z); }

  _mat(color, rough = 0.95) {
    return new THREE.MeshLambertMaterial({ color });
  }

  _buildTerrain() {
    const size = this.config.world.size;
    const seg = this.config.world.terrainSegments;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xc9b380);
    const cGrass = new THREE.Color(0x6f9e4e);
    const cDry = new THREE.Color(0x9aa354);
    const cRock = new THREE.Color(0x8d8577);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      if (h < 0.1) tmp.copy(cSand);
      else if (h > 6.5) tmp.copy(cRock);
      else if (h > 3.2) tmp.copy(cDry);
      else tmp.copy(cGrass);
      const rd = Math.abs(z - riverZ(x));
      if (rd < 6) tmp.lerp(cSand, 0.55);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.group.add(this.terrain);
  }

  _buildWaterAndRiver() {
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshLambertMaterial({ color: 0x2e6da8 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.1;
    this.group.add(sea);

    const pts = [];
    for (let x = -250; x <= 250; x += 14) pts.push({ x, z: riverZ(x) });
    const river = buildRibbon(pts, 10, (x, z) => this.heightAt(x, z) + 0.32,
      new THREE.MeshLambertMaterial({ color: 0x3f83b8, transparent: true, opacity: 0.85 }));
    this.group.add(river);
  }

  _buildRoads() {
    const roadMat = this._mat(0x4c4a44);
    const yAt = (x, z) => this.heightAt(x, z) + 0.07;
    const ew = []; for (let x = -235; x <= 235; x += 16) ew.push({ x, z: 8 });
    const ns = []; for (let z = -235; z <= 235; z += 16) ns.push({ x: -6, z });
    const diag = []; for (let t = 0; t <= 1.0001; t += 0.06) diag.push({ x: -6 + (125 + 6) * t, z: 8 + (-112 - 8) * t });
    for (const path of [ew, ns, diag]) {
      this.group.add(buildRibbon(path, 6.5, yAt, roadMat));
      this.minimapFeatures.roads.push(path);
    }
  }

  /** Box building with prism-coloured flat roof; registers collider + raycast mesh. */
  _building(x, z, w, d, h, wallColor, roofColor) {
    const baseY = this.heightAt(x, z);
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._mat(wallColor));
    walls.position.set(0, h / 2 - 0.4, 0);
    walls.castShadow = true; walls.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.5, d + 0.9), this._mat(roofColor));
    roof.position.set(0, h - 0.15, 0);
    roof.castShadow = true;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.15), this._mat(0x3a2c1e));
    door.position.set(0, 0.85, d / 2 + 0.03);
    g.add(walls, roof, door);
    g.position.set(x, baseY, z);
    this.group.add(g);
    this.colliders.addBox(x, z, w / 2, d / 2, baseY - 0.5, h + 0.4);
    walls.userData.isObstacle = true;
    this.obstacleMeshes.push(walls);
    this.minimapFeatures.buildings.push({ x, z, w, d });
    return g;
  }

  _crate(x, z, s = 1.4) {
    const y = this.heightAt(x, z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), this._mat(0x8a6f42));
    m.position.set(x, y + s / 2, z);
    m.castShadow = true;
    this.group.add(m);
    this.colliders.addBox(x, z, s / 2, s / 2, y, s);
    m.userData.isObstacle = true;
    this.obstacleMeshes.push(m);
    this.coverPoints.push({ x, z });
    return m;
  }

  _wall(x, z, w, d, h, color = 0xa79b7d) {
    const y = this.heightAt(x, z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._mat(color));
    m.position.set(x, y + h / 2 - 0.2, z);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    this.colliders.addBox(x, z, w / 2, d / 2, y - 0.3, h + 0.2);
    m.userData.isObstacle = true;
    this.obstacleMeshes.push(m);
    return m;
  }

  _buildVillage() {
    const roofColors = [0xb5482f, 0x39628f, 0xc78f2d, 0x5d7d3c, 0x8a4a72, 0xb5482f, 0x39628f, 0x777d84];
    const spots = [
      [-26, -18, 9, 8, 4.2], [18, -26, 10, 8, 4.6], [-32, 24, 8, 9, 4.0], [24, 30, 9, 8, 4.4],
      [-6, -44, 11, 9, 5.0], [38, -4, 8, 8, 4.0], [-44, -2, 9, 10, 4.4], [6, 48, 8, 8, 4.0]
    ];
    spots.forEach((s, i) => this._building(s[0], s[1], s[2], s[3], s[4], 0xd8cdb4, roofColors[i % roofColors.length]));
    // Village well / market cover
    this._crate(-10, 6); this._crate(12, 14); this._crate(14, 12, 1.1);
    this._wall(-16, -34, 8, 0.8, 1.3); this._wall(30, 18, 0.8, 8, 1.3);
  }

  _buildOutpost() {
    const cx = 125, cz = -112;
    this._building(cx - 14, cz - 10, 12, 8, 4.4, 0x9aa184, 0x4c5a3a); // barracks
    this._building(cx + 13, cz + 9, 10, 9, 4.0, 0xa39d84, 0x555f44);  // store
    // Sandbag perimeter (gap on south side as entrance)
    this._wall(cx, cz - 24, 44, 1.0, 1.5, 0xb3a277);
    this._wall(cx - 22, cz, 1.0, 48, 1.5, 0xb3a277);
    this._wall(cx + 22, cz, 1.0, 48, 1.5, 0xb3a277);
    this._wall(cx - 14, cz + 24, 16, 1.0, 1.5, 0xb3a277);
    this._wall(cx + 14, cz + 24, 16, 1.0, 1.5, 0xb3a277);
    // Tents (triangular prisms via rotated boxes is overkill: use cones squashed)
    for (const [tx, tz] of [[cx - 4, cz + 14], [cx + 8, cz - 16]]) {
      const y = this.heightAt(tx, tz);
      const tent = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.6, 4), this._mat(0x5d6b45));
      tent.position.set(tx, y + 1.3, tz);
      tent.rotation.y = Math.PI / 4;
      tent.castShadow = true;
      this.group.add(tent);
      this.colliders.addBox(tx, tz, 2.1, 2.1, y, 2.4);
      tent.userData.isObstacle = true;
      this.obstacleMeshes.push(tent);
    }
    this._crate(cx - 8, cz - 2); this._crate(cx - 6.4, cz - 2, 1.1); this._crate(cx + 16, cz - 8);
  }

  _buildWarehouseAndTower() {
    // Warehouse (west, near river bend)
    const wx = -112, wz = 92;
    const baseY = this.heightAt(wx, wz);
    const wh = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(20, 6.5, 12), this._mat(0x8f9aa3));
    walls.position.y = 2.85; walls.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(21, 0.7, 13), this._mat(0x5d6770));
    roof.position.y = 6.2;
    const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 0.2), this._mat(0x46505a));
    gate.position.set(0, 1.7, 6.05);
    wh.add(walls, roof, gate);
    wh.position.set(wx, baseY, wz);
    this.group.add(wh);
    this.colliders.addBox(wx, wz, 10, 6, baseY - 0.5, 6.6);
    walls.userData.isObstacle = true;
    this.obstacleMeshes.push(walls);
    this.minimapFeatures.buildings.push({ x: wx, z: wz, w: 20, d: 12 });
    this._crate(wx + 14, wz + 9); this._crate(wx - 14, wz + 8); this._crate(wx + 13, wz - 8, 1.1);

    // Watchtower on the hilltop approach
    const tx = -138, tz = -118;
    const ty = this.heightAt(tx, tz);
    const tower = new THREE.Group();
    const legMat = this._mat(0x6e5638);
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), legMat);
      leg.position.set(lx, 4.5, lz);
      tower.add(leg);
      this.colliders.addCircle(tx + lx, tz + lz, 0.5);
    }
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 5.6), this._mat(0x9a7c4f));
    cabin.position.y = 10.1; cabin.castShadow = true;
    const troof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), this._mat(0x74452a));
    troof.position.y = 12.2; troof.rotation.y = Math.PI / 4;
    tower.add(cabin, troof);
    tower.position.set(tx, ty, tz);
    this.group.add(tower);
    cabin.userData.isObstacle = true;
    this.obstacleMeshes.push(cabin);
    this.minimapFeatures.buildings.push({ x: tx, z: tz, w: 6, d: 6 });
  }

  _vehicle(x, z, rotY, color) {
    const y = this.heightAt(x, z);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 1.9), this._mat(color));
    body.position.y = 0.85; body.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 1.7), this._mat(0x39424c));
    cab.position.set(-0.2, 1.75, 0);
    g.add(body, cab);
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
    const wheelMat = this._mat(0x1d1d1f);
    for (const [wx, wz] of [[-1.5, 0.95], [1.5, 0.95], [-1.5, -0.95], [1.5, -0.95]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.42, wz);
      g.add(w);
    }
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    this.group.add(g);
    // Approximate rotated footprint with a square collider (safe for gameplay)
    this.colliders.addBox(x, z, 2.2, 2.2, y, 2.2);
    body.userData.isObstacle = true;
    this.obstacleMeshes.push(body);
    this.coverPoints.push({ x, z });
  }

  _buildCoverAndVehicles() {
    this._vehicle(20, 8, 0.4, 0x7a4a35);
    this._vehicle(-58, 90, -0.9, 0x4f6350);
    this._vehicle(96, -52, 1.2, 0x6b6f52);
    const crates = [[-70, -30], [52, 66], [70, -90], [-30, 130], [150, 40], [-90, -80], [40, -150], [-160, 30]];
    for (const [x, z] of crates) this._crate(x, z, 1.5);
    this._wall(58, -30, 7, 0.8, 1.4);
    this._wall(-52, 60, 0.8, 7, 1.4);
    this._wall(12, 118, 8, 0.8, 1.4);
  }

  _buildVegetation() {
    const cfg = this.config.world;
    const rng = makeRng(cfg.seed + 77);
    const half = cfg.size / 2 - 18;
    const isClear = (x, z) => {
      if (Math.abs(z - 8) < 7 || Math.abs(x + 6) < 7) return false;        // roads
      if (Math.abs(z - riverZ(x)) < 8) return false;                        // river
      for (const s of FLAT_SPOTS) if (Math.hypot(x - s.x, z - s.z) < s.r * 0.62) return false;
      return Math.hypot(x, z) < 232;
    };
    const dummy = new THREE.Object3D();

    // Trees: two InstancedMeshes (trunks + canopies)
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6);
    const canopyGeo = new THREE.ConeGeometry(1.9, 4.2, 7);
    this.trunks = new THREE.InstancedMesh(trunkGeo, this._mat(0x6b4e2f), cfg.treeCount);
    this.canopies = new THREE.InstancedMesh(canopyGeo, this._mat(0x3f7040), cfg.treeCount);
    let placed = 0, guard = 0;
    // Forest cluster bias: sample around forest centers half the time
    const forestCenters = [{ x: -80, z: -60 }, { x: 70, z: 130 }, { x: -170, z: 90 }, { x: 170, z: -40 }];
    while (placed < cfg.treeCount && guard++ < 4000) {
      let x, z;
      if (rng() < 0.55) {
        const c = forestCenters[Math.floor(rng() * forestCenters.length)];
        x = c.x + (rng() * 2 - 1) * 55; z = c.z + (rng() * 2 - 1) * 55;
      } else { x = (rng() * 2 - 1) * half; z = (rng() * 2 - 1) * half; }
      if (!isClear(x, z)) continue;
      const y = this.heightAt(x, z);
      const s = 0.85 + rng() * 0.6;
      dummy.position.set(x, y + 1.2 * s, z); dummy.scale.setScalar(s); dummy.rotation.set(0, rng() * 6.28, 0);
      dummy.updateMatrix(); this.trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = y + (2.4 + 2.0) * s - 0.4;
      dummy.updateMatrix(); this.canopies.setMatrixAt(placed, dummy.matrix);
      this.colliders.addVegCircle(x, z, 0.45);
      placed++;
    }
    this.treeTotal = placed;
    this.trunks.count = placed; this.canopies.count = placed;
    this.group.add(this.trunks, this.canopies);

    // Rocks (fixed count, always collide)
    const rockGeo = new THREE.DodecahedronGeometry(1.1, 0);
    this.rocks = new THREE.InstancedMesh(rockGeo, this._mat(0x8d8577), cfg.rockCount);
    placed = 0; guard = 0;
    while (placed < cfg.rockCount && guard++ < 2000) {
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      if (!isClear(x, z)) continue;
      const s = 0.6 + rng() * 1.1;
      dummy.position.set(x, this.heightAt(x, z) + 0.3 * s, z);
      dummy.scale.set(s, s * 0.75, s);
      dummy.rotation.set(rng(), rng() * 6.28, rng());
      dummy.updateMatrix(); this.rocks.setMatrixAt(placed, dummy.matrix);
      this.colliders.addCircle(x, z, 1.0 * s);
      this.coverPoints.push({ x, z });
      placed++;
    }
    this.rocks.count = placed;
    this.group.add(this.rocks);

    // Grass clumps (decorative, instanced cones, no collision)
    const grassGeo = new THREE.ConeGeometry(0.4, 0.9, 5);
    this.grass = new THREE.InstancedMesh(grassGeo, this._mat(0x5c8a44), cfg.grassCount);
    placed = 0; guard = 0;
    while (placed < cfg.grassCount && guard++ < 4000) {
      const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
      if (Math.abs(z - riverZ(x)) < 6) continue;
      dummy.position.set(x, this.heightAt(x, z) + 0.4, z);
      dummy.scale.setScalar(0.8 + rng() * 0.9);
      dummy.rotation.set(0, rng() * 6.28, 0);
      dummy.updateMatrix(); this.grass.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    this.grassTotal = placed;
    this.grass.count = placed;
    this.group.add(this.grass);
  }

  /** Apply vegetation density for a graphics preset. */
  setVegetationFraction(f) {
    const trees = Math.max(8, Math.floor(this.treeTotal * clamp(f, 0, 1)));
    this.trunks.count = trees;
    this.canopies.count = trees;
    this.colliders.vegActiveCount = trees;
    this.grass.count = Math.floor(this.grassTotal * clamp(f, 0, 1));
  }

  _buildPatrolAndCoverPoints() {
    this.patrolPoints = [
      { x: 0, z: 0 }, { x: -40, z: -30 }, { x: 40, z: 40 }, { x: 125, z: -112 },
      { x: -112, z: 92 }, { x: -130, z: -110 }, { x: 80, z: 110 }, { x: 90, z: -60 },
      { x: -80, z: 40 }, { x: 20, z: 140 }, { x: -20, z: -140 }, { x: 170, z: 60 },
      { x: -170, z: -40 }, { x: 60, z: -170 }, { x: -60, z: 180 }, { x: 150, z: 150 }
    ];
    // Building corners make reliable tall cover
    for (const b of this.minimapFeatures.buildings) {
      this.coverPoints.push({ x: b.x + b.w / 2 + 1.6, z: b.z });
      this.coverPoints.push({ x: b.x - b.w / 2 - 1.6, z: b.z });
      this.coverPoints.push({ x: b.x, z: b.z + b.d / 2 + 1.6 });
      this.coverPoints.push({ x: b.x, z: b.z - b.d / 2 - 1.6 });
    }
  }
}
