// save-system.js — local settings + lifetime stats (localStorage), plus an
// OPTIONAL, non-blocking POST of match results to the PHP backend.
// Offline play never depends on any of this succeeding.

const SETTINGS_KEY = 'xbr.settings.v1';
const STATS_KEY = 'xbr.stats.v1';

export const DEFAULT_SETTINGS = {
  quality: 'low',
  sensitivity: 1.0,
  invertY: false,
  sound: true,
  volume: 0.7,
  showFps: false,
  autoQuality: true
};

function safeParse(json, fallback) {
  try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}

export class SaveSystem {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.stats = { matches: 0, wins: 0, kills: 0, bestKills: 0, shots: 0, hits: 0 };
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) this.settings = { ...DEFAULT_SETTINGS, ...safeParse(s, {}) };
      const st = localStorage.getItem(STATS_KEY);
      if (st) this.stats = { ...this.stats, ...safeParse(st, {}) };
    } catch (err) {
      console.warn('[XBR] localStorage unavailable:', err.message);
    }
  }

  saveSettings(patch) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* private mode etc. */ }
    return this.settings;
  }

  recordMatch({ won, kills, shots, hits }) {
    this.stats.matches += 1;
    if (won) this.stats.wins += 1;
    this.stats.kills += kills || 0;
    this.stats.bestKills = Math.max(this.stats.bestKills, kills || 0);
    this.stats.shots += shots || 0;
    this.stats.hits += hits || 0;
    try { localStorage.setItem(STATS_KEY, JSON.stringify(this.stats)); } catch { /* ignore */ }
    return this.stats;
  }

  /**
   * Optional backend save. Fire-and-forget: failures are only logged.
   * Only called when config.game.backendEnabled === true.
   */
  sendResultToBackend(baseUrl, payload) {
    try {
      fetch(baseUrl + 'save-result.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).then(r => { if (!r.ok) console.info('[XBR] Backend save rejected:', r.status); })
        .catch(err => console.info('[XBR] Backend save skipped (offline):', err.message));
    } catch (err) {
      console.info('[XBR] Backend save skipped:', err.message);
    }
  }
}
