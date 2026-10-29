// hud.js — all DOM HUD updates, screens and the 2D minimap.
// Values always come from live game state; nothing here is decorative.
import { formatTime } from './utils.js';

function el(id) { return document.getElementById(id); }

export class HUD {
  constructor() {
    this.hud = el('hud');
    this.healthFill = el('health-fill');
    this.healthText = el('health-text');
    this.weaponName = el('weapon-name');
    this.ammoText = el('ammo-text');
    this.reloadWrap = el('reload-wrap');
    this.reloadFill = el('reload-fill');
    this.aliveCount = el('alive-count');
    this.killCount = el('kill-count');
    this.timer = el('match-timer');
    this.zoneBanner = el('zone-banner');
    this.hitmarker = el('hitmarker');
    this.vignette = el('damage-vignette');
    this.pickupPrompt = el('pickup-prompt');
    this.interactBtn = el('btn-interact');
    this.toastEl = el('toast');
    this.countdownEl = el('countdown');
    this.debugPanel = el('debug-panel');
    this.slotBtns = [...document.querySelectorAll('.slot-btn')];
    this.minimap = el('minimap');
    this.mmCtx = this.minimap.getContext('2d');
    this._hitTimer = null;
    this._toastTimer = null;
    this._vigTimer = null;
    this.screens = {
      menu: el('screen-menu'), how: el('screen-how'), settings: el('screen-settings'),
      loading: el('screen-loading'), pause: el('screen-pause'), result: el('screen-result'),
      error: el('screen-error')
    };
  }

  showScreen(name) {
    for (const [key, node] of Object.entries(this.screens)) {
      node.classList.toggle('hidden', key !== name);
    }
    this.hud.classList.toggle('hidden', !(name === null || name === 'pause'));
    if (name === 'pause') this.hud.classList.remove('hidden');
  }

  setLoading(text, fraction) {
    el('loading-text').textContent = text;
    el('loading-fill').style.width = `${Math.round(fraction * 100)}%`;
  }

  setError(message) {
    el('error-text').textContent = message;
    this.showScreen('error');
  }

  setHealth(current, max) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    this.healthFill.style.width = `${pct}%`;
    this.healthFill.classList.toggle('low', pct <= 30);
    this.healthText.textContent = String(Math.ceil(current));
  }

  setWeapon(def, state, inventory) {
    if (!def || !state) {
      this.weaponName.textContent = 'No weapon';
      this.ammoText.textContent = '—';
    } else {
      this.weaponName.textContent = def.name;
      this.ammoText.textContent = `${state.magazine} / ${state.reserve}`;
      this.ammoText.classList.toggle('empty', state.magazine === 0);
    }
    this.slotBtns.forEach((btn, i) => {
      const id = inventory.slots[i];
      btn.textContent = id ? `${i + 1} ${inventory.defs[id].name.split(' ')[0].slice(0, 4).toUpperCase()}` : `${i + 1} —`;
      btn.classList.toggle('active', !!id && id === inventory.currentId);
      btn.classList.toggle('locked', !id);
    });
  }

  setReload(progress) {
    if (progress > 0) {
      this.reloadWrap.classList.remove('hidden');
      this.reloadFill.style.width = `${Math.round(progress * 100)}%`;
    } else {
      this.reloadWrap.classList.add('hidden');
    }
  }

  setAlive(n) { this.aliveCount.textContent = String(n); }
  setKills(n) { this.killCount.textContent = String(n); }
  setTimer(seconds) { this.timer.textContent = formatTime(seconds); }

  setZone(text, mode = '') {
    this.zoneBanner.textContent = text;
    this.zoneBanner.className = 'hud-chip' + (mode ? ' ' + mode : '');
  }

  showHitmarker(isKill) {
    this.hitmarker.classList.add('show');
    this.hitmarker.classList.toggle('kill', !!isKill);
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.hitmarker.classList.remove('show'), isKill ? 420 : 160);
  }

  damageFlash() {
    this.vignette.classList.remove('fade');
    this.vignette.classList.add('show');
    clearTimeout(this._vigTimer);
    this._vigTimer = setTimeout(() => {
      this.vignette.classList.add('fade');
      this.vignette.classList.remove('show');
    }, 90);
  }

  setPickupPrompt(text) {
    if (text) {
      this.pickupPrompt.textContent = text;
      this.pickupPrompt.classList.remove('hidden');
      this.interactBtn.classList.remove('hidden');
    } else {
      this.pickupPrompt.classList.add('hidden');
      this.interactBtn.classList.add('hidden');
    }
  }

  toast(message, ms = 2200) {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  setCountdown(value) {
    if (value === null || value === undefined) { this.countdownEl.classList.add('hidden'); return; }
    this.countdownEl.textContent = String(value);
    this.countdownEl.classList.remove('hidden');
  }

  setDebug(text) {
    if (text === null) { this.debugPanel.classList.add('hidden'); return; }
    this.debugPanel.classList.remove('hidden');
    this.debugPanel.textContent = text;
  }

  showResult(won, stats, lifetime) {
    el('result-title').textContent = won ? '🏆 WINNER! LAST SURVIVOR' : '💀 YOU WERE ELIMINATED';
    el('result-subtitle').textContent = won
      ? 'You outlasted every soldier on the island.'
      : 'The island claims another soldier. Try again!';
    const acc = stats.shots > 0 ? Math.round((stats.hits / stats.shots) * 100) : 0;
    el('result-stats').innerHTML = `
      <div><b>${stats.kills}</b><span>ELIMINATIONS</span></div>
      <div><b>${formatTime(stats.duration)}</b><span>SURVIVED</span></div>
      <div><b>${Math.round(stats.damageDealt)}</b><span>DAMAGE DEALT</span></div>
      <div><b>${acc}%</b><span>ACCURACY (${stats.hits}/${stats.shots})</span></div>
      <div><b>${lifetime.wins}</b><span>TOTAL WINS</span></div>
      <div><b>${lifetime.matches}</b><span>MATCHES PLAYED</span></div>`;
    this.showScreen('result');
  }

  /**
   * Minimap: derived from the same map data as the 3D world.
   * enemiesVisible: positions the player may fairly know (recent shooters).
   */
  drawMinimap({ worldSize, features, playerPos, playerYaw, enemiesVisible, zone, pickups }) {
    const ctx = this.mmCtx;
    const S = this.minimap.width;
    const toMap = (v) => ((v + worldSize / 2) / worldSize) * S;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#42563a';
    ctx.fillRect(0, 0, S, S);
    // River
    ctx.strokeStyle = 'rgba(70,140,200,.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = -250; x <= 250; x += 25) {
      const z = 58 + Math.sin(x * 0.012) * 18;
      const mx = toMap(x), my = toMap(z);
      if (x === -250) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
    }
    ctx.stroke();
    // Roads
    ctx.strokeStyle = 'rgba(40,40,40,.8)';
    ctx.lineWidth = 2;
    for (const path of features.roads) {
      ctx.beginPath();
      path.forEach((p, i) => { const mx = toMap(p.x), my = toMap(p.z); i === 0 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my); });
      ctx.stroke();
    }
    // Buildings
    ctx.fillStyle = 'rgba(205,205,205,.9)';
    for (const b of features.buildings) {
      ctx.fillRect(toMap(b.x - b.w / 2), toMap(b.z - b.d / 2), (b.w / worldSize) * S, (b.d / worldSize) * S);
    }
    // Weapon pickups (yellow pips) — loot intel is standard on BR minimaps
    ctx.fillStyle = '#ffd27a';
    for (const p of pickups) {
      if (p.type !== 'weapon' || !p.available) continue;
      ctx.fillRect(toMap(p.x) - 1.5, toMap(p.z) - 1.5, 3, 3);
    }
    // Safe zone
    ctx.beginPath();
    ctx.arc(toMap(zone.center.x), toMap(zone.center.z), (zone.radius / worldSize) * S, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (zone.nextRadius && zone.nextRadius < zone.radius) {
      ctx.beginPath();
      ctx.arc(toMap(zone.center.x), toMap(zone.center.z), (zone.nextRadius / worldSize) * S, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,90,90,.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Recently-heard enemies
    ctx.fillStyle = '#ff4d4d';
    for (const e of enemiesVisible) {
      ctx.beginPath();
      ctx.arc(toMap(e.x), toMap(e.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow (yaw: 0 faces +Z which is "south"/down on the minimap)
    const px = toMap(playerPos.x), py = toMap(playerPos.z);
    ctx.save();
    ctx.translate(px, py);
    // Minimap: +x right, +z down. Facing -Z is "north" (up). Arrow is drawn
    // pointing up, so rotate by (PI - yaw): yaw=PI -> 0 (up), yaw=0 -> down.
    ctx.rotate(Math.PI - playerYaw);
    ctx.fillStyle = '#57a8ff';
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // Border
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}
