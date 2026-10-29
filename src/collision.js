// collision.js — lightweight static-obstacle collision for characters.
// Boxes are axis-aligned (x/z footprint + height range). Circles are for
// rocks/trees. Characters are treated as vertical cylinders (x,z + radius).
// This is far cheaper than a physics engine and is enough for the prototype.

export class CollisionWorld {
  constructor() {
    this.boxes = [];        // {minX,maxX,minZ,maxZ,minY,maxY}
    this.circles = [];      // {x,z,r} always active (rocks)
    this.vegCircles = [];   // {x,z,r} trees; only first `vegActiveCount` collide
    this.vegActiveCount = 0;
  }

  addBox(cx, cz, halfX, halfZ, baseY, height) {
    const b = { minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ, minY: baseY, maxY: baseY + height };
    this.boxes.push(b);
    return b;
  }

  addCircle(x, z, r) { const c = { x, z, r }; this.circles.push(c); return c; }
  addVegCircle(x, z, r) { const c = { x, z, r }; this.vegCircles.push(c); return c; }

  /**
   * Push a character (position {x,z} mutated in place) out of all obstacles.
   * `feetY`/`height` let low obstacles be stepped over when jumping on them
   * is impossible anyway — we only collide when vertical ranges overlap.
   */
  resolve(position, radius, feetY = 0, height = 1.8) {
    const topY = feetY + height;
    // Boxes (AABB push-out along smallest penetration axis)
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (topY <= b.minY || feetY >= b.maxY) continue;
      const nearestX = Math.max(b.minX, Math.min(position.x, b.maxX));
      const nearestZ = Math.max(b.minZ, Math.min(position.z, b.maxZ));
      const dx = position.x - nearestX;
      const dz = position.z - nearestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > radius * radius) continue;
      if (distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        position.x += (dx / dist) * push;
        position.z += (dz / dist) * push;
      } else {
        // Center inside the box: push out along the shallowest side.
        const left = position.x - b.minX, right = b.maxX - position.x;
        const near = position.z - b.minZ, far = b.maxZ - position.z;
        const m = Math.min(left, right, near, far);
        if (m === left) position.x = b.minX - radius;
        else if (m === right) position.x = b.maxX + radius;
        else if (m === near) position.z = b.minZ - radius;
        else position.z = b.maxZ + radius;
      }
    }
    // Circles
    this._resolveCircles(position, radius, this.circles, this.circles.length);
    this._resolveCircles(position, radius, this.vegCircles, Math.min(this.vegActiveCount, this.vegCircles.length));
    return position;
  }

  _resolveCircles(position, radius, list, count) {
    for (let i = 0; i < count; i++) {
      const c = list[i];
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const minDist = radius + c.r;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist || distSq === 0) continue;
      const dist = Math.sqrt(distSq);
      position.x = c.x + (dx / dist) * minDist;
      position.z = c.z + (dz / dist) * minDist;
    }
  }

  /** True if segment a->b (THREE.Vector3-like {x,y,z}) is blocked by a box. */
  segmentBlocked(a, b) {
    for (let i = 0; i < this.boxes.length; i++) {
      if (segmentIntersectsBox(a, b, this.boxes[i])) return true;
    }
    return false;
  }
}

/** Slab-method segment vs AABB test. Exported for unit tests. */
export function segmentIntersectsBox(a, b, box) {
  let tMin = 0, tMax = 1;
  const axes = [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.y, b.y - a.y, box.minY, box.maxY],
    [a.z, b.z - a.z, box.minZ, box.maxZ]
  ];
  for (const [start, dir, lo, hi] of axes) {
    if (Math.abs(dir) < 1e-9) {
      if (start < lo || start > hi) return false;
    } else {
      let t1 = (lo - start) / dir;
      let t2 = (hi - start) / dir;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
  }
  return true;
}
