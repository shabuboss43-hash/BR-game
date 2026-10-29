// config.js — configuration loading, validation and safe defaults.
// The game must start even if config.json is missing or malformed, so a
// complete fallback configuration lives here and is deep-merged with
// whatever valid values the JSON file provides.

export const FALLBACK_CONFIG = {
  game: { title: 'X Battle Royale', version: '1.0.0', backendEnabled: false, backendBaseUrl: 'backend/' },
  world: { size: 500, playableRadius: 235, seed: 20261029, terrainSegments: 72, treeCount: 140, rockCount: 46, grassCount: 260 },
  graphics: {
    defaultPreset: 'low',
    presets: {
      low:    { resolutionScale: 0.65, shadows: false, maxParticles: 20, vegetationFraction: 0.4, fogFar: 220, antialias: false },
      medium: { resolutionScale: 0.8,  shadows: false, maxParticles: 40, vegetationFraction: 0.7, fogFar: 300, antialias: false },
      high:   { resolutionScale: 1.0,  shadows: true,  maxParticles: 70, vegetationFraction: 1.0, fogFar: 420, antialias: true }
    }
  },
  player: {
    maxHealth: 100, walkSpeed: 6.2, sprintSpeed: 9.5, aimSpeedMultiplier: 0.55,
    acceleration: 34, gravity: -24, jumpVelocity: 8.2, radius: 0.45, height: 1.8,
    spawn: { x: 0, z: 150 }, modelPath: 'assets/models/soldier.glb', startWeapon: 'pistol'
  },
  enemy: {
    count: 5, maxHealth: 100, walkSpeed: 4.6, chaseSpeed: 6.4, detectionRadius: 62,
    attackRange: 46, preferredRange: 24, aimErrorDegrees: 3.4, decisionInterval: 0.25,
    radius: 0.45, height: 1.8, modelPath: 'assets/models/russian_soldier.glb',
    weaponPool: ['assault_rifle', 'assault_rifle', 'pistol', 'shotgun'],
    spawns: [
      { x: -60, z: -40 }, { x: 120, z: -110 }, { x: -115, z: 95 }, { x: 90, z: 70 },
      { x: -150, z: -130 }, { x: 160, z: 130 }, { x: 30, z: -170 }, { x: -40, z: 190 }
    ]
  },
  teams: { player: 'BLUE', enemy: 'RED', friendlyFire: false, playerColor: '#2e7cf6', enemyColor: '#e33b3b' },
  weapons: {
    assault_rifle: { id: 'assault_rifle', name: 'Assault Rifle', damage: 14, pellets: 1, magazineSize: 30, startReserve: 90, maxReserve: 240, reloadTime: 1.9, fireInterval: 0.105, automatic: true,  range: 220, recoil: 0.011, spreadDegrees: 0.9, mode: 'hitscan', sound: null },
    pistol:        { id: 'pistol',        name: 'Pistol',        damage: 11, pellets: 1, magazineSize: 12, startReserve: 48, maxReserve: 144, reloadTime: 1.3, fireInterval: 0.24,  automatic: false, range: 130, recoil: 0.006, spreadDegrees: 0.6, mode: 'hitscan', sound: null },
    shotgun:       { id: 'shotgun',       name: 'Shotgun',       damage: 9,  pellets: 8, magazineSize: 6,  startReserve: 24, maxReserve: 60,  reloadTime: 2.4, fireInterval: 0.85,  automatic: false, range: 70,  recoil: 0.035, spreadDegrees: 4.5, mode: 'hitscan', sound: null }
  },
  pickups: [
    { type: 'weapon', weaponId: 'assault_rifle', x: 8, z: 96 },
    { type: 'weapon', weaponId: 'shotgun', x: -112, z: 88 },
    { type: 'weapon', weaponId: 'assault_rifle', x: 122, z: -104 },
    { type: 'weapon', weaponId: 'shotgun', x: 14, z: -14 },
    { type: 'weapon', weaponId: 'pistol', x: -148, z: -124 },
    { type: 'ammo', weaponId: 'assault_rifle', amount: 60, x: -18, z: 22 },
    { type: 'ammo', weaponId: 'assault_rifle', amount: 60, x: 96, z: 64 },
    { type: 'ammo', weaponId: 'shotgun', amount: 12, x: 30, z: -60 },
    { type: 'ammo', weaponId: 'pistol', amount: 36, x: -70, z: -30 },
    { type: 'ammo', weaponId: 'assault_rifle', amount: 60, x: 150, z: -60 },
    { type: 'health', amount: 50, x: 0, z: 0 },
    { type: 'health', amount: 50, x: 118, z: -122 },
    { type: 'health', amount: 50, x: -120, z: 110 }
  ],
  safeZone: {
    center: { x: 0, z: 0 }, initialRadius: 240, damagePerSecond: 5,
    stages: [
      { delay: 25, warning: 10, shrinkTime: 45, targetRadius: 130 },
      { delay: 15, warning: 10, shrinkTime: 40, targetRadius: 65 },
      { delay: 12, warning: 8, shrinkTime: 35, targetRadius: 28 },
      { delay: 10, warning: 8, shrinkTime: 30, targetRadius: 10 }
    ]
  },
  audio: { enabled: true, volume: 0.7 },
  debug: { showFps: false, autoQuality: true, logModelInfo: true }
};

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

export function deepMerge(base, override) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlainObject(override) && !Array.isArray(override)) return out;
  for (const key of Object.keys(override)) {
    const b = base ? base[key] : undefined;
    const o = override[key];
    if (isPlainObject(b) && isPlainObject(o)) out[key] = deepMerge(b, o);
    else if (o !== undefined && o !== null) out[key] = o;
    else if (o === null && !(key in (base || {}))) out[key] = null;
  }
  return out;
}

/**
 * Validate a (merged) config. Returns an array of human-readable problems.
 * Empty array = valid. Used at startup and by tests/config-validation.js.
 */
export function validateConfig(cfg) {
  const errors = [];
  const num = (v, label, min, max) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${label} must be a number`);
    else if (min !== undefined && v < min) errors.push(`${label} must be >= ${min}`);
    else if (max !== undefined && v > max) errors.push(`${label} must be <= ${max}`);
  };
  if (!isPlainObject(cfg)) return ['config root must be an object'];

  num(cfg.world?.size, 'world.size', 100, 5000);
  num(cfg.world?.seed, 'world.seed');
  num(cfg.player?.maxHealth, 'player.maxHealth', 1, 100000);
  num(cfg.player?.walkSpeed, 'player.walkSpeed', 0.1, 100);
  num(cfg.enemy?.count, 'enemy.count', 1, 64);
  num(cfg.enemy?.detectionRadius, 'enemy.detectionRadius', 1, 2000);
  num(cfg.enemy?.attackRange, 'enemy.attackRange', 1, 2000);

  const weapons = cfg.weapons;
  if (!isPlainObject(weapons) || Object.keys(weapons).length < 3) {
    errors.push('weapons must define at least 3 weapon types');
  } else {
    for (const [id, w] of Object.entries(weapons)) {
      if (!isPlainObject(w)) { errors.push(`weapons.${id} must be an object`); continue; }
      if (w.id !== id) errors.push(`weapons.${id}.id must equal "${id}"`);
      if (typeof w.name !== 'string' || w.name.length === 0) errors.push(`weapons.${id}.name is required`);
      num(w.damage, `weapons.${id}.damage`, 0, 100000);
      num(w.magazineSize, `weapons.${id}.magazineSize`, 1, 10000);
      num(w.reloadTime, `weapons.${id}.reloadTime`, 0, 60);
      num(w.fireInterval, `weapons.${id}.fireInterval`, 0.01, 10);
      num(w.range, `weapons.${id}.range`, 1, 5000);
      num(w.spreadDegrees, `weapons.${id}.spreadDegrees`, 0, 45);
      if (w.mode !== 'hitscan' && w.mode !== 'projectile') errors.push(`weapons.${id}.mode must be "hitscan" or "projectile"`);
    }
    const start = cfg.player?.startWeapon;
    if (start && !weapons[start]) errors.push(`player.startWeapon "${start}" is not a defined weapon`);
  }

  const stages = cfg.safeZone?.stages;
  num(cfg.safeZone?.initialRadius, 'safeZone.initialRadius', 10, 5000);
  num(cfg.safeZone?.damagePerSecond, 'safeZone.damagePerSecond', 0, 1000);
  if (!Array.isArray(stages) || stages.length === 0) errors.push('safeZone.stages must be a non-empty array');
  else {
    let prev = cfg.safeZone.initialRadius;
    stages.forEach((s, i) => {
      num(s.targetRadius, `safeZone.stages[${i}].targetRadius`, 1, 5000);
      num(s.shrinkTime, `safeZone.stages[${i}].shrinkTime`, 0.1, 3600);
      if (typeof s.targetRadius === 'number' && typeof prev === 'number' && s.targetRadius >= prev) {
        errors.push(`safeZone.stages[${i}].targetRadius must be smaller than the previous radius`);
      }
      prev = s.targetRadius;
    });
  }

  for (const name of ['low', 'medium', 'high']) {
    const p = cfg.graphics?.presets?.[name];
    if (!p) { errors.push(`graphics.presets.${name} is missing`); continue; }
    num(p.resolutionScale, `graphics.presets.${name}.resolutionScale`, 0.3, 2);
    num(p.maxParticles, `graphics.presets.${name}.maxParticles`, 0, 10000);
  }

  if (!Array.isArray(cfg.pickups)) errors.push('pickups must be an array');
  else cfg.pickups.forEach((p, i) => {
    if (!['weapon', 'ammo', 'health'].includes(p?.type)) errors.push(`pickups[${i}].type must be weapon|ammo|health`);
    num(p?.x, `pickups[${i}].x`); num(p?.z, `pickups[${i}].z`);
    if ((p?.type === 'weapon' || p?.type === 'ammo') && weapons && !weapons[p.weaponId]) {
      errors.push(`pickups[${i}].weaponId "${p.weaponId}" is not a defined weapon`);
    }
  });

  return errors;
}

/** Fetch config.json, merge over fallbacks, validate. Never throws. */
export async function loadConfig(url = 'config.json') {
  let raw = null;
  let loadError = null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    loadError = err;
    console.warn('[XBR] config.json could not be loaded, using built-in defaults:', err.message);
  }
  const merged = raw ? deepMerge(FALLBACK_CONFIG, raw) : JSON.parse(JSON.stringify(FALLBACK_CONFIG));
  const problems = validateConfig(merged);
  if (problems.length > 0) {
    console.warn('[XBR] config.json validation problems (safe defaults kept where possible):', problems);
  }
  if (loadError || (raw && validateConfig(deepMerge(FALLBACK_CONFIG, raw)).length > 0 && !raw.weapons)) {
    return { config: JSON.parse(JSON.stringify(FALLBACK_CONFIG)), problems, usedFallback: true };
  }
  return { config: merged, problems, usedFallback: !raw };
}
