// game.js — X Battle Royale entry point: match state machine, camera,
// pickups, safe-zone ticking and wiring between every subsystem.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadConfig } from './src/config.js';
import { SceneSetup, webglAvailable } from './src/scene.js';
import { GameMap } from './src/map.js';
import { CollisionWorld } from './src/collision.js';
import { SoldierVisual, Player } from './src/player.js';
import { Enemy } from './src/enemy.js';
import { WeaponInventory } from './src/weapons.js';
import { Combatant, EffectsPool, resolveShot } from './src/combat.js';
import { SafeZone } from './src/safe-zone.js';
import { InputManager } from './src/controls.js';
import { HUD } from './src/hud.js';
import { SoundFX } from './src/audio.js';
import { SaveSystem } from './src/save-system.js';
import { PerformanceMonitor } from './src/performance.js';
import { clamp, makeRng, formatTime } from './src/utils.js';

const State = {
  BOOT: 'BOOT', MAIN_MENU: 'MAIN_MENU', LOADING: 'LOADING', READY: 'READY',
  PLAYING: 'PLAYING', PAUSED: 'PAUSED', PLAYER_WON: 'PLAYER_WON',
  PLAYER_LOST: 'PLAYER_LOST', ERROR: 'ERROR'
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _camDir = new THREE.Vector3();

class Game {
  constructor() {
    this.state = State.BOOT;
    this.matchTime = 0;
    this.camYaw = Math.PI;
    this.camPitch = 0.34;
    this.recoilBloom = 0;
    this.readyTimer = 0;
    this.lastCountdown = -1;
    this.pendingEnd = null;      // { won, at }
    this.resultRecorded = false;
    this.zoneTick = 0;
    this.minimapTick = 0;
    this.hurtSoundAt = 0;
    this.currentPickup = null;
    this.modelPromise = null;
    this.modelStatus = 'Models: loading…';
    this.settingsReturn = 'menu';
    this.menuOrbit = 0;
    this.lastZoneText = '';
  }

  async boot() {
    this.hud = new HUD();
    this.hud.showScreen('loading');
    this.hud.setLoading('Loading configuration…', 0.08);

    if (!webglAvailable()) {
      this.state = State.ERROR;
      this.hud.setError('Your browser or device does not support WebGL, which X Battle Royale needs for 3D rendering. Try Chrome on Android with hardware acceleration enabled.');
      return;
    }

    const { config, usedFallback } = await loadConfig('config.json');
    this.config = config;
    if (usedFallback) console.info('[XBR] Running with built-in fallback configuration.');

    this.save = new SaveSystem();
    this.settings = { ...this.save.settings };
    if (!config.graphics.presets[this.settings.quality]) this.settings.quality = config.graphics.defaultPreset;

    this.hud.setLoading('Creating 3D renderer…', 0.2);
    this.sceneSetup = new SceneSetup(document.getElementById('game-container'), config);
    this.sceneSetup.onContextLost = () => {
      this.state = State.ERROR;
      this.hud.setError('The graphics context was lost (the device may be out of GPU memory). Tap reload to try again — Low graphics is recommended.');
    };

    this.hud.setLoading('Building island…', 0.38);
    this.colliders = new CollisionWorld();
    this.map = new GameMap(this.sceneSetup.scene, config, this.colliders);
    this.effects = new EffectsPool(this.sceneSetup.scene, 40);
    this.safeZone = new SafeZone(this.sceneSetup.scene, config.safeZone);
    this.safeZone.onWarning = () => { this.hud.toast('⚠️ Safe zone will shrink soon!'); this.audio?.zoneWarning(); };
    this.safeZone.onShrinkStart = () => this.hud.toast('🔴 Zone is shrinking — move to the white circle!');

    this.hud.setLoading('Deploying soldiers…', 0.55);
    this._createCombatants();
    this._createPickups();

    this.audio = new SoundFX(this.settings.sound, this.settings.volume);
    this.input = new InputManager({
      onReload: () => this.tryReload(),
      onWeaponSlot: (i) => this.selectWeaponSlot(i),
      onInteract: () => this.tryInteract(),
      onPause: () => { if (this.state === State.PLAYING) this.pause(); else if (this.state === State.PAUSED) this.resume(); },
      onAnyGesture: () => this.audio.unlock(),
      onPointerLockLost: () => { if (this.state === State.PLAYING) this.pause(); },
      isPlaying: () => this.state === State.PLAYING
    });

    this.perf = new PerformanceMonitor({
      onLowPerformance: (fps) => {
        if (this.state === State.PLAYING) {
          this.hud.toast(`⚠️ Low performance (${fps} FPS). ` + (this.settings.autoQuality ? 'Auto-quality is lowering resolution.' : 'Try Low graphics in Settings.'), 3500);
        }
      },
      onAutoQuality: (scale) => this.sceneSetup.setResolutionScale(scale)
    });

    this._wireMenus();
    this.applySettings(false);
    this._updateMenuStats();

    this.hud.setLoading('Loading soldier models (fallbacks ready)…', 0.75);
    this.modelPromise = this._loadModels();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === State.PLAYING) this.pause();
    });

    this.clock = new THREE.Clock();
    this.state = State.MAIN_MENU;
    this.hud.showScreen('menu');
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    console.info('[XBR] X Battle Royale ready. State: MAIN_MENU');
  }

  // ================= creation =================
  _createCombatants() {
    const cfg = this.config;
    const scene = this.sceneSetup.scene;
    this.rng = makeRng(cfg.world.seed + 4242);

    // Player
    this.playerVisual = new SoldierVisual(new THREE.Color(cfg.teams.playerColor).getHex(), cfg.player.height);
    this.player = new Player(scene, cfg, this.playerVisual, this.map, this.colliders);
    this.playerCombatant = new Combatant({
      id: 'player', team: cfg.teams.player, maxHealth: cfg.player.maxHealth, isPlayer: true
    });
    this.playerInventory = new WeaponInventory(cfg.weapons, cfg.player.startWeapon);
    this.playerCombatant.onDamaged = () => {
      this.hud.damageFlash();
      if (this.matchTime - this.hurtSoundAt > 0.25) { this.audio?.hurt(); this.hurtSoundAt = this.matchTime; }
      this.hud.setHealth(this.playerCombatant.health, this.playerCombatant.maxHealth);
    };
    this.playerCombatant.onDeath = () => this._onCombatantDeath(this.playerCombatant);

    this.playerEntity = {
      combatant: this.playerCombatant, proxy: this.playerVisual.proxy,
      position: this.player.position, height: cfg.player.height, kind: 'player'
    };

    // Enemies
    this.enemies = [];
    this.enemyEntities = [];
    const count = Math.min(cfg.enemy.count, cfg.enemy.spawns.length);
    for (let i = 0; i < count; i++) {
      const visual = new SoldierVisual(new THREE.Color(cfg.teams.enemyColor).getHex(), cfg.enemy.height);
      const weaponId = cfg.enemy.weaponPool[i % cfg.enemy.weaponPool.length];
      const inv = new WeaponInventory(cfg.weapons, weaponId);
      inv.addAmmo(weaponId, 180);
      const enemy = new Enemy(scene, cfg, visual, this.map, this.colliders, cfg.enemy.spawns[i], inv, makeRng(cfg.world.seed + 100 + i * 17));
      const combatant = new Combatant({ id: `enemy-${i}`, team: cfg.teams.enemy, maxHealth: cfg.enemy.maxHealth });
      enemy.combatant = combatant;
      combatant.onDeath = () => this._onCombatantDeath(combatant);
      enemy.lastShotAt = -999;
      this.enemies.push(enemy);
      const entity = { combatant, proxy: visual.proxy, position: enemy.position, height: cfg.enemy.height, kind: 'enemy', enemy };
      enemy.entity = entity;
      this.enemyEntities.push(entity);
    }
    this.entities = [this.playerEntity, ...this.enemyEntities];
  }

  _createPickups() {
    this.pickups = [];
    const scene = this.sceneSetup.scene;
    const defs = this.config.weapons;
    for (const p of this.config.pickups) {
      const y = this.map.groundY(p.x, p.z);
      const group = new THREE.Group();
      let label = '';
      if (p.type === 'weapon') {
        const color = p.weaponId === 'shotgun' ? 0xd98a3d : (p.weaponId === 'pistol' ? 0x9fb6c9 : 0x6fc96f);
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 1.15), new THREE.MeshLambertMaterial({ color: 0x2c2f2a }));
        const accent = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.5), new THREE.MeshLambertMaterial({ color }));
        accent.position.y = 0.14;
        group.add(body, accent);
        label = defs[p.weaponId]?.name || p.weaponId;
      } else if (p.type === 'ammo') {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.55), new THREE.MeshLambertMaterial({ color: 0xc9a93d }));
        group.add(box);
        label = `${defs[p.weaponId]?.name || ''} Ammo ×${p.amount || 30}`;
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
        const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.62), new THREE.MeshLambertMaterial({ color: 0xd92e2e }));
        const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.62), new THREE.MeshLambertMaterial({ color: 0xd92e2e }));
        crossA.position.y = 0.21; crossB.position.y = 0.21;
        group.add(box, crossA, crossB);
        label = `Medkit +${p.amount || 50}`;
      }
      // Soft glow disc so pickups read at a distance
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 20),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35, depthWrite: false })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = -0.55;
      group.add(disc);
      group.position.set(p.x, y + 0.85, p.z);
      scene.add(group);
      this.pickups.push({ ...p, label, group, baseY: y + 0.85, available: true });
    }
  }

  async _loadModels() {
    const cfg = this.config;
    const results = [];
    // Player model
    const playerP = this.playerVisual.loadModel(cfg.player.modelPath).then(r => results.push(r));
    // Enemy model: load ONCE, then clone for every enemy ( SkeletonUtils
    // handles skinned meshes). Failure keeps all fallback soldiers.
    const enemyP = (async () => {
      const path = cfg.enemy.modelPath;
      try {
        const loader = new GLTFLoader();
        const gltf = await Promise.race([
          loader.loadAsync(path),
          new Promise((_, reject) => setTimeout(() => reject(new Error('load timeout')), 9000))
        ]);
        this.enemies.forEach((enemy, i) => {
          const instance = i === 0 ? gltf.scene : cloneSkinned(gltf.scene);
          const info = enemy.visual.adoptModel(instance, gltf.animations || [], path);
          if (i === 0) results.push(info);
        });
      } catch (err) {
        console.info(`[XBR] Enemy model "${path}" not loaded (${err.message}); fallback soldiers in use.`);
        results.push({ ok: false, path, error: err.message });
      }
    })();
    await Promise.allSettled([playerP, enemyP]);
    const okCount = results.filter(r => r.ok).length;
    this.modelStatus = okCount === 2
      ? 'Soldier models: loaded from assets/models/ ✔'
      : okCount === 1
        ? 'Soldier models: 1 loaded, 1 using built-in fallback soldier'
        : 'Soldier models: using built-in soldiers (add soldier.glb / russian_soldier.glb to assets/models/ to use yours)';
    const node = document.getElementById('menu-model-status');
    if (node) node.textContent = this.modelStatus;
    return results;
  }

  // ================= menus / settings =================
  _wireMenus() {
    const $ = (id) => document.getElementById(id);
    const click = (id, fn) => { const n = $(id); if (n) n.addEventListener('click', () => { this.audio?.unlock(); this.audio?.click(); fn(); }); };

    click('btn-play', () => this.startMatch());
    click('btn-settings', () => { this.settingsReturn = 'menu'; this._fillSettingsForm(); this.hud.showScreen('settings'); });
    click('btn-how', () => this.hud.showScreen('how'));
    click('btn-resume', () => this.resume());
    click('btn-restart', () => this.startMatch());
    click('btn-pause-settings', () => { this.settingsReturn = 'pause'; this._fillSettingsForm(); this.hud.showScreen('settings'); });
    click('btn-quit-menu', () => this.toMainMenu());
    click('btn-play-again', () => this.startMatch());
    click('btn-result-menu', () => this.toMainMenu());
    click('btn-settings-save', () => { this._readSettingsForm(); this.applySettings(true); this.hud.showScreen(this.settingsReturn === 'pause' && (this.state === State.PAUSED) ? 'pause' : 'menu'); if (this.settingsReturn !== 'pause') this.state = State.MAIN_MENU; });
    document.querySelectorAll('[data-back]').forEach(btn => btn.addEventListener('click', () => {
      if (this.state === State.PAUSED) this.hud.showScreen('pause');
      else { this.state = State.MAIN_MENU; this.hud.showScreen('menu'); }
    }));
  }

  _fillSettingsForm() {
    const $ = (id) => document.getElementById(id);
    $('set-quality').value = this.settings.quality;
    $('set-autoquality').checked = !!this.settings.autoQuality;
    $('set-sensitivity').value = this.settings.sensitivity;
    $('set-inverty').checked = !!this.settings.invertY;
    $('set-sound').checked = !!this.settings.sound;
    $('set-volume').value = this.settings.volume;
    $('set-showfps').checked = !!this.settings.showFps;
  }

  _readSettingsForm() {
    const $ = (id) => document.getElementById(id);
    this.settings = {
      quality: $('set-quality').value,
      autoQuality: $('set-autoquality').checked,
      sensitivity: Number($('set-sensitivity').value) || 1,
      invertY: $('set-inverty').checked,
      sound: $('set-sound').checked,
      volume: Number($('set-volume').value),
      showFps: $('set-showfps').checked
    };
  }

  applySettings(persist) {
    const preset = this.config.graphics.presets[this.settings.quality] || this.config.graphics.presets.low;
    this.sceneSetup.applyQuality(this.settings.quality);
    this.perf?.reset();
    this.map.setVegetationFraction(preset.vegetationFraction);
    this.effects.setMaxParticles(preset.maxParticles);
    this.audio?.setEnabled(!!this.settings.sound);
    this.audio?.setVolume(this.settings.volume);
    if (!this.settings.showFps && !this.config.debug.showFps) this.hud.setDebug(null);
    if (persist) this.save.saveSettings(this.settings);
  }

  _updateMenuStats() {
    const node = document.getElementById('menu-stats');
    const s = this.save.stats;
    if (node) node.textContent = s.matches > 0
      ? `Matches: ${s.matches} · Wins: ${s.wins} · Eliminations: ${s.kills}`
      : 'No matches yet — good luck, soldier!';
    const ms = document.getElementById('menu-model-status');
    if (ms) ms.textContent = this.modelStatus;
  }

  // ================= match flow =================
  async startMatch() {
    if (this.state === State.LOADING) return;
    this.audio.unlock();
    this.state = State.LOADING;
    this.hud.showScreen('loading');
    this.hud.setLoading('Preparing match…', 0.35);
    if (this.modelPromise) {
      this.hud.setLoading('Waiting for soldier models (fallbacks ready)…', 0.6);
      await Promise.race([this.modelPromise, new Promise(r => setTimeout(r, 4000))]);
    }
    this.hud.setLoading('Spawning combatants…', 0.9);
    this.resetMatch();
    this.state = State.READY;
    this.readyTimer = 3.2;
    this.lastCountdown = -1;
    this.hud.showScreen(null);
    this.input.setEnabled(true);
    if (window.matchMedia?.('(orientation: portrait)').matches) {
      const rp = document.getElementById('rotate-prompt');
      rp.classList.remove('hidden');
      setTimeout(() => rp.classList.add('hidden'), 4500);
    }
  }

  resetMatch() {
    const cfg = this.config;
    this.matchTime = 0;
    this.pendingEnd = null;
    this.resultRecorded = false;
    this.camYaw = Math.PI;
    this.camPitch = 0.34;
    this.recoilBloom = 0;
    this.zoneTick = 0;
    this.perf.reset();

    this.player.reset();
    this.playerCombatant.reset();
    this.playerInventory.reset(cfg.player.startWeapon);

    this.enemies.forEach((enemy, i) => {
      const weaponId = cfg.enemy.weaponPool[i % cfg.enemy.weaponPool.length];
      enemy.inventory.reset(weaponId);
      enemy.inventory.addAmmo(weaponId, 180);
      enemy.combatant.reset();
      enemy.lastShotAt = -999;
      enemy.reset();
    });

    for (const p of this.pickups) { p.available = true; p.group.visible = true; }
    this.currentPickup = null;
    this.safeZone.reset();
    this.effects.clear();
    this.input.resetTransient();
    this.input.sprintToggle = false;
    document.getElementById('btn-sprint')?.classList.remove('active');

    this.hud.setHealth(this.playerCombatant.health, this.playerCombatant.maxHealth);
    this._refreshWeaponHud();
    this.hud.setAlive(this._aliveCount());
    this.hud.setKills(0);
    this.hud.setTimer(0);
    this.hud.setPickupPrompt(null);
    this.hud.setCountdown(null);
    this.lastZoneText = '';
    this._snapCameraBehind();
  }

  pause() {
    if (this.state !== State.PLAYING && this.state !== State.READY) return;
    this.state = State.PAUSED;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this.hud.showScreen('pause');
    this.hud.setCountdown(null);
  }

  resume() {
    if (this.state !== State.PAUSED) return;
    this.audio.unlock();
    this.state = State.PLAYING;
    this.hud.showScreen(null);
    this.input.setEnabled(true);
    this.clock.getDelta(); // discard pause duration
  }

  toMainMenu() {
    this.state = State.MAIN_MENU;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    this._updateMenuStats();
    this.hud.showScreen('menu');
    this.hud.setCountdown(null);
  }

  _aliveCount() { return this.entities.filter(e => e.combatant.alive).length; }

  _onCombatantDeath(combatant) {
    if (combatant.isPlayer) {
      this.playerVisual.setDeadPose();
      this.audio?.lose();
      this.pendingEnd = { won: false, at: this.matchTime + 1.1 };
    } else {
      const enemy = this.enemies.find(e => e.combatant === combatant);
      if (enemy) enemy.setDead();
      const byPlayer = combatant.lastDamageSource === this.playerCombatant;
      if (byPlayer) { this.hud.showHitmarker(true); this.audio?.kill(); }
      this.hud.toast(byPlayer ? '🎯 Enemy eliminated!' : 'An enemy was eliminated', 1400);
      if (this.enemies.every(e => !e.combatant.alive) && this.playerCombatant.alive) {
        this.pendingEnd = { won: true, at: this.matchTime + 1.1 };
      }
    }
    this.hud.setAlive(this._aliveCount());
  }

  _finishMatch(won) {
    if (this.resultRecorded) return;
    this.resultRecorded = true;
    this.state = won ? State.PLAYER_WON : State.PLAYER_LOST;
    this.input.setEnabled(false);
    this.input.exitPointerLock();
    if (won) this.audio?.win();
    const stats = {
      kills: this.playerCombatant.stats.kills,
      shots: this.playerCombatant.stats.shots,
      hits: this.playerCombatant.stats.hits,
      damageDealt: this.playerCombatant.stats.damageDealt,
      duration: this.matchTime
    };
    const lifetime = this.save.recordMatch({ won, ...stats });
    if (this.config.game.backendEnabled) {
      this.save.sendResultToBackend(this.config.game.backendBaseUrl, {
        result: won ? 'won' : 'lost',
        kills: stats.kills,
        shots: stats.shots,
        hits: stats.hits,
        durationSeconds: Math.round(stats.duration),
        damageDealt: Math.round(stats.damageDealt)
      });
    }
    this.hud.showResult(won, stats, lifetime);
  }

  // ================= player actions =================
  tryReload() {
    if (this.state !== State.PLAYING) return;
    if (this.playerInventory.startReload(this.matchTime)) this.audio.reload();
  }

  selectWeaponSlot(i) {
    if (this.state !== State.PLAYING) return;
    if (this.playerInventory.selectSlot(i)) { this.audio.click(); this._refreshWeaponHud(); }
  }

  tryInteract() {
    if (this.state !== State.PLAYING || !this.currentPickup) return;
    const p = this.currentPickup;
    if (p.type === 'weapon') {
      const res = this.playerInventory.giveWeapon(p.weaponId);
      this.hud.toast(res === 'added' ? `🔫 Picked up ${p.label}!` : `🔫 ${p.label} ammo collected`);
      this._consumePickup(p);
    } else if (p.type === 'ammo') {
      if (!this.playerInventory.has(p.weaponId)) {
        this.hud.toast(`Find the ${this.config.weapons[p.weaponId]?.name || 'weapon'} first!`, 1600);
        return;
      }
      const added = this.playerInventory.addAmmo(p.weaponId, p.amount || 30);
      this.hud.toast(`🧰 +${added} ammo`);
      this._consumePickup(p);
    } else if (p.type === 'health') {
      const healed = this.playerCombatant.heal(p.amount || 50);
      if (healed <= 0) { this.hud.toast('Health already full', 1200); return; }
      this.hud.toast(`❤️ +${Math.round(healed)} health`);
      this.hud.setHealth(this.playerCombatant.health, this.playerCombatant.maxHealth);
      this._consumePickup(p);
    }
    this.audio.pickup();
    this._refreshWeaponHud();
  }

  _consumePickup(p) {
    p.available = false;
    p.group.visible = false;
    if (this.currentPickup === p) { this.currentPickup = null; this.hud.setPickupPrompt(null); }
  }

  _refreshWeaponHud() {
    this.hud.setWeapon(this.playerInventory.currentDef(), this.playerInventory.current(), this.playerInventory);
  }

  _playerShoot() {
    const inv = this.playerInventory;
    const attempt = inv.tryFire(this.matchTime);
    if (!attempt.fired) {
      if (attempt.reason === 'empty') {
        this.audio.empty();
        if (!inv.startReload(this.matchTime)) {
          const st = inv.current();
          if (st && st.reserve <= 0) this.hud.toast('No ammo! Find an ammo box or another weapon.', 1800);
        } else this.audio.reload();
      }
      return;
    }
    const def = attempt.def;
    const camera = this.sceneSetup.camera;
    camera.getWorldDirection(_camDir);
    // Aim point far along the crosshair ray, then fire from the muzzle to it.
    _v1.copy(camera.position).addScaledVector(_camDir, 90);
    this.player.muzzlePosition(_v2);
    _v3.copy(_v1).sub(_v2).normalize();

    const spreadScale = (this.input.isAiming() ? 0.55 : 1) * (1 + this.recoilBloom * 2.2) *
      (this.player.speed2D > 7 ? 1.5 : 1);
    const result = resolveShot({
      shooter: this.playerCombatant,
      shooterEntity: this.playerEntity,
      origin: _v2.clone(),
      direction: _v3.clone(),
      def,
      entities: this.entities,
      obstacleMeshes: this.map.obstacleMeshes,
      friendlyFire: this.config.teams.friendlyFire,
      spreadScale,
      effects: this.effects,
      muzzlePos: _v2.clone(),
      camera
    });
    this.camPitch = clamp(this.camPitch - def.recoil, -0.35, 1.0);
    this.recoilBloom = Math.min(1, this.recoilBloom + 0.22);
    this.audio.shoot(def.id === 'shotgun' ? 'shotgun' : def.id === 'pistol' ? 'pistol' : 'rifle');
    for (const e of this.enemies) e.hearNoise(this.player.position, this.matchTime);
    if (result.totalDamage > 0) {
      this.audio.hit();
      if (result.hitEntity && result.hitEntity.combatant.alive) this.hud.showHitmarker(false);
    }
    this.hud.setKills(this.playerCombatant.stats.kills);
    this._refreshWeaponHud();
    // Auto reload prompt when mag empties
    const st = inv.current();
    if (st && st.magazine === 0 && st.reserve > 0) this.hud.toast('Press LOAD / R to reload', 1200);
  }

  // ================= camera =================
  _snapCameraBehind() {
    const cam = this.sceneSetup.camera;
    this._updateCamera(10, true);
    cam.lookAt(this.player.position.x, this.player.position.y + 1.7, this.player.position.z);
  }

  _updateCamera(dt, snap = false) {
    const cam = this.sceneSetup.camera;
    const aiming = this.input?.isAiming() && this.state === State.PLAYING;
    const dist = aiming ? 3.6 : 7.2;
    const targetY = this.player.position.y + 1.9;
    const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
    const cosP = Math.cos(this.camPitch), sinP = Math.sin(this.camPitch);

    // Desired camera position, shortened if a building is in the way
    let usedDist = dist;
    for (let step = dist; step >= 1.2; step -= 0.8) {
      const x = this.player.position.x - sin * cosP * step;
      const y = targetY + sinP * step;
      const z = this.player.position.z - cos * cosP * step;
      usedDist = step;
      const blocked = this.colliders.boxes.some(b =>
        x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y > b.minY && y < b.maxY);
      if (!blocked) break;
      usedDist = Math.max(1.2, step - 0.8);
    }
    _v1.set(
      this.player.position.x - sin * cosP * usedDist,
      Math.max(targetY + sinP * usedDist, this.map.groundY(this.player.position.x, this.player.position.z) + 0.7),
      this.player.position.z - cos * cosP * usedDist
    );
    if (snap) cam.position.copy(_v1);
    else {
      const t = 1 - Math.exp(-dt * 11);
      cam.position.lerp(_v1, t);
    }
    // Look slightly ahead of the player so the crosshair sits above the head
    _v2.set(
      this.player.position.x + sin * cosP * 5,
      targetY - sinP * 5 + 0.25,
      this.player.position.z + cos * cosP * 5
    );
    cam.lookAt(_v2);
  }

  _menuCamera(dt) {
    const cam = this.sceneSetup.camera;
    this.menuOrbit += dt * 0.07;
    const r = 85;
    cam.position.set(Math.sin(this.menuOrbit) * r, 34, Math.cos(this.menuOrbit) * r);
    cam.lookAt(0, 2, 0);
  }

  // ================= main loop =================
  _loop() {
    requestAnimationFrame(this._loop);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05); // capped delta: no physics explosions after stalls
    if (dt <= 0) return;

    switch (this.state) {
      case State.MAIN_MENU:
      case State.LOADING:
        this._menuCamera(dt);
        this._idleVisuals(dt);
        break;
      case State.READY: {
        this._applyLook(dt);
        this._updateCamera(dt);
        this._idleVisuals(dt);
        this.readyTimer -= dt;
        const n = Math.ceil(this.readyTimer);
        if (n !== this.lastCountdown && n > 0) { this.lastCountdown = n; this.hud.setCountdown(n); this.audio?.click(); }
        if (this.readyTimer <= 0) {
          this.hud.setCountdown('GO!');
          setTimeout(() => this.hud.setCountdown(null), 550);
          this.state = State.PLAYING;
          this.hud.toast('🏝️ Be the last survivor!', 2000);
        }
        break;
      }
      case State.PLAYING:
        this._updatePlaying(dt);
        break;
      case State.PLAYER_WON:
      case State.PLAYER_LOST:
        this._menuCamera(dt * 0.4);
        this._idleVisuals(dt);
        break;
      case State.PAUSED:
      case State.ERROR:
        break; // frozen frame behind the panel
      default:
        break;
    }
    this.effects.update(dt);
    this.sceneSetup.render();
    if (this.state === State.PLAYING || this.state === State.READY) {
      const preset = this.sceneSetup.getPreset();
      this.perf.tick(dt, this.settings.autoQuality, this.perf.autoScale ?? preset.resolutionScale);
      if (this.settings.showFps || this.config.debug.showFps) this._updateDebug();
    }
  }

  _idleVisuals(dt) {
    this.playerVisual.update(dt, 0, !this.playerCombatant.alive);
    for (const e of this.enemies) e.visual.update(dt, 0, !e.combatant.alive);
    this._animatePickups(dt);
  }

  _animatePickups(dt) {
    const t = performance.now() * 0.001;
    for (const p of this.pickups) {
      if (!p.available) continue;
      p.group.rotation.y += dt * 1.6;
      p.group.position.y = p.baseY + Math.sin(t * 2 + p.x) * 0.12;
    }
  }

  _applyLook(dt) {
    const look = this.input.consumeLook();
    const sens = 0.0031 * this.settings.sensitivity;
    this.camYaw -= look.dx * sens;
    const dy = this.settings.invertY ? -look.dy : look.dy;
    this.camPitch = clamp(this.camPitch + dy * sens, -0.32, 1.0);
    void dt;
  }

  _updatePlaying(dt) {
    this.matchTime += dt;
    const now = this.matchTime;
    this._applyLook(dt);
    this.recoilBloom = Math.max(0, this.recoilBloom - dt * 3.2);

    // --- Player ---
    const move = this.input.getMove();
    const firing = this.input.isFiring();
    if (this.playerCombatant.alive) {
      this.player.update(dt, move, this.camYaw, this.input.isSprinting(),
        this.input.isAiming() || firing, this.input.consumeJump());
      if (this.input.jumpQueued) this.input.consumeJump();
    }
    this._updateCamera(dt);

    // Weapons (fire + reload)
    const pressed = this.input.consumeFirePressed();
    if (this.playerCombatant.alive) {
      const def = this.playerInventory.currentDef();
      if (def && (def.automatic ? firing : pressed)) this._playerShoot();
      else if (def && !def.automatic && firing && pressed) this._playerShoot();
      if (this.playerInventory.update(now)) this._refreshWeaponHud();
      if (this.playerInventory.current()?.magazine !== this._lastMag) {
        this._lastMag = this.playerInventory.current()?.magazine;
        this._refreshWeaponHud();
      }
    }
    this.hud.setReload(this.playerInventory.reloadProgress(now));

    // --- Enemies ---
    const ctx = {
      player: this.player,
      playerCombatant: this.playerCombatant,
      playerEntity: this.playerEntity,
      entities: this.entities,
      obstacleMeshes: this.map.obstacleMeshes,
      safeZone: this.safeZone,
      effects: this.effects,
      friendlyFire: this.config.teams.friendlyFire,
      camera: this.sceneSetup.camera
    };
    if (!this.playerCombatant.alive) this.playerVisual.update(dt, 0, true);
    for (const enemy of this.enemies) {
      if (!enemy.combatant.alive) { enemy.visual.update(dt, 0, true); continue; }
      enemy.update(dt, now, {
        ...ctx,
        selfEntity: enemy.entity,
        onShoot: (e) => { e.lastShotAt = now; this.audio.enemyShoot(); }
      });
    }

    // --- Safe zone ---
    this.safeZone.update(dt);
    this.zoneTick += dt;
    if (this.zoneTick >= 0.5) {
      const dps = this.config.safeZone.damagePerSecond * this.zoneTick;
      for (const ent of this.entities) {
        if (ent.combatant.alive && this.safeZone.isOutside(ent.position)) {
          ent.combatant.takeDamage(dps, null);
          if (ent.combatant.isPlayer) this.hud.setHealth(ent.combatant.health, ent.combatant.maxHealth);
        }
      }
      this.zoneTick = 0;
    }
    this._updateZoneHud();

    // --- Pickups ---
    this._animatePickups(dt);
    this._updatePickupPrompt();

    // --- HUD + minimap ---
    this.hud.setTimer(now);
    this.minimapTick += dt;
    if (this.minimapTick > 0.15) {
      this.minimapTick = 0;
      const visible = this.enemies
        .filter(e => e.combatant.alive && (now - e.lastShotAt < 3 ||
          Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z) < 38))
        .map(e => ({ x: e.position.x, z: e.position.z }));
      this.hud.drawMinimap({
        worldSize: this.config.world.size,
        features: this.map.minimapFeatures,
        playerPos: this.player.position,
        playerYaw: this.camYaw,
        enemiesVisible: visible,
        zone: { center: this.safeZone.center, radius: this.safeZone.radius, nextRadius: this.safeZone.nextRadius() },
        pickups: this.pickups
      });
    }

    // --- Match end (delayed slightly so the death reads visually) ---
    if (this.pendingEnd && now >= this.pendingEnd.at) {
      const won = this.pendingEnd.won;
      this.pendingEnd = null;
      this._finishMatch(won);
    }
  }

  _updatePickupPrompt() {
    if (!this.playerCombatant.alive) { this.hud.setPickupPrompt(null); this.currentPickup = null; return; }
    let best = null, bestDist = 3.4;
    for (const p of this.pickups) {
      if (!p.available) continue;
      const d = Math.hypot(p.x - this.player.position.x, p.z - this.player.position.z);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    this.currentPickup = best;
    this.hud.setPickupPrompt(best ? `✋ ${best.label}` : null);
  }

  _updateZoneHud() {
    const z = this.safeZone;
    const outside = this.playerCombatant.alive && z.isOutside(this.player.position);
    let text, mode = '';
    if (outside) { text = '⚠️ OUTSIDE ZONE — TAKING DAMAGE!'; mode = 'warn'; }
    else if (z.finished) { text = 'FINAL ZONE'; mode = 'shrink'; }
    else if (z.phase === 'warning') { text = `ZONE SHRINKS IN ${Math.ceil(z.timeRemaining())}s`; mode = 'warn'; }
    else if (z.phase === 'shrinking') { text = '🔴 ZONE SHRINKING'; mode = 'shrink'; }
    else { text = `ZONE SHRINKS IN ${formatTime(z.timeRemaining() + (z.currentStage()?.warning || 0))}`; }
    if (text !== this.lastZoneText) { this.lastZoneText = text; this.hud.setZone(text, mode); }
  }

  _updateDebug() {
    const r = this.sceneSetup.renderer.info.render;
    const aliveEnemies = this.enemies.filter(e => e.combatant.alive).length;
    this.hud.setDebug(
      `FPS ${this.perf.fps} · ${this.perf.frameMs}ms\n` +
      `calls ${r.calls} · tris ${Math.round(r.triangles / 1000)}k\n` +
      `quality ${this.sceneSetup.presetName} · scale ${this.perf.autoScale ?? this.sceneSetup.getPreset().resolutionScale}\n` +
      `enemies ${aliveEnemies} · state ${this.state}\n` +
      `AI ${this.enemies.map(e => e.state.slice(0, 4)).join(' ')}`
    );
  }
}

// Boot with a top-level safety net: never a silent blank page.
const game = new Game();
game.boot().catch(err => {
  console.error('[XBR] Fatal boot error:', err);
  try {
    const hud = game.hud || new HUD();
    hud.setError('The game failed to start. Please reload. (Details are in the browser console for developers.)');
  } catch { document.body.innerHTML = '<p style="color:#fff;padding:2rem;font-family:sans-serif">X Battle Royale failed to start. Please reload the page.</p>'; }
});
