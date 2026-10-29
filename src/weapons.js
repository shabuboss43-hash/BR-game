// weapons.js — weapon inventory, ammunition, reload and fire-rate logic.
// Pure logic (no DOM), so it can be unit-tested in Node. Actual raycasts
// live in combat.js; this module decides *whether* a shot may happen.

export class WeaponState {
  constructor(def) {
    this.def = def;
    this.magazine = def.magazineSize;
    this.reserve = def.startReserve;
    this.reloading = false;
    this.reloadEndsAt = 0;
    this.nextFireAt = 0;
  }
  reset() {
    this.magazine = this.def.magazineSize;
    this.reserve = this.def.startReserve;
    this.reloading = false;
    this.reloadEndsAt = 0;
    this.nextFireAt = 0;
  }
}

export class WeaponInventory {
  /** defs: config.weapons object. Slots are ordered by acquisition (max 3). */
  constructor(defs, startWeaponId) {
    this.defs = defs;
    this.slots = [];               // weapon ids, max 3
    this.states = new Map();       // id -> WeaponState
    this.currentId = null;
    if (startWeaponId && defs[startWeaponId]) this.giveWeapon(startWeaponId);
  }

  reset(startWeaponId) {
    this.slots = [];
    this.states.clear();
    this.currentId = null;
    if (startWeaponId && this.defs[startWeaponId]) this.giveWeapon(startWeaponId);
  }

  has(id) { return this.states.has(id); }
  current() { return this.currentId ? this.states.get(this.currentId) : null; }
  currentDef() { return this.currentId ? this.defs[this.currentId] : null; }

  /** Returns 'added' | 'ammo' | 'full'. Picking up an owned weapon gives ammo. */
  giveWeapon(id) {
    const def = this.defs[id];
    if (!def) return 'full';
    if (this.states.has(id)) {
      this.addAmmo(id, def.magazineSize * 2);
      return 'ammo';
    }
    if (this.slots.length >= 3) {
      // Replace the non-current, non-first slot to keep things simple and fair.
      const replaceIdx = this.slots.findIndex(s => s !== this.currentId);
      const old = this.slots[replaceIdx];
      this.states.delete(old);
      this.slots[replaceIdx] = id;
    } else {
      this.slots.push(id);
    }
    this.states.set(id, new WeaponState(def));
    this.currentId = id;
    return 'added';
  }

  addAmmo(id, amount) {
    const st = this.states.get(id);
    if (!st) return 0;
    const before = st.reserve;
    st.reserve = Math.min(st.def.maxReserve, st.reserve + Math.max(0, Math.floor(amount)));
    return st.reserve - before;
  }

  selectSlot(index) {
    const id = this.slots[index];
    if (!id || id === this.currentId) return false;
    const cur = this.current();
    if (cur && cur.reloading) { cur.reloading = false; } // switching cancels reload
    this.currentId = id;
    return true;
  }

  selectWeapon(id) {
    const idx = this.slots.indexOf(id);
    return idx >= 0 ? this.selectSlot(idx) : false;
  }

  /**
   * Attempt to fire at time `now` (seconds, match clock).
   * Returns { fired, reason, def } — ammo is consumed here, damage in combat.js.
   */
  tryFire(now) {
    const st = this.current();
    if (!st) return { fired: false, reason: 'no-weapon' };
    if (st.reloading) return { fired: false, reason: 'reloading' };
    if (now < st.nextFireAt) return { fired: false, reason: 'cooldown' };
    if (st.magazine <= 0) return { fired: false, reason: 'empty' };
    st.magazine -= 1;
    st.nextFireAt = now + st.def.fireInterval;
    return { fired: true, def: st.def, state: st };
  }

  startReload(now) {
    const st = this.current();
    if (!st || st.reloading) return false;
    if (st.magazine >= st.def.magazineSize) return false;
    if (st.reserve <= 0) return false;
    st.reloading = true;
    st.reloadEndsAt = now + st.def.reloadTime;
    return true;
  }

  /** Call every frame; completes reloads. Returns true on the frame a reload finishes. */
  update(now) {
    let finished = false;
    for (const st of this.states.values()) {
      if (st.reloading && now >= st.reloadEndsAt) {
        const needed = st.def.magazineSize - st.magazine;
        const taken = Math.min(needed, st.reserve);
        st.magazine += taken;
        st.reserve -= taken;
        st.reloading = false;
        if (st === this.current()) finished = true;
      }
    }
    return finished;
  }

  reloadProgress(now) {
    const st = this.current();
    if (!st || !st.reloading) return 0;
    const total = st.def.reloadTime;
    return Math.min(1, Math.max(0, 1 - (st.reloadEndsAt - now) / total));
  }
}

/** Damage after range falloff: full until 50% range, then down to 40%. */
export function damageAtRange(def, distance) {
  if (distance > def.range) return 0;
  const start = def.range * 0.5;
  if (distance <= start) return def.damage;
  const t = (distance - start) / (def.range - start);
  return def.damage * (1 - 0.6 * t);
}
