// audio.js — optional lightweight synthesized SFX (WebAudio, no assets).
// No external files are needed, so audio can never 404 or crash the game.
// The context is created lazily inside a user gesture (mobile policy).

export class SoundFX {
  constructor(enabled = true, volume = 0.7) {
    this.enabled = enabled;
    this.volume = volume;
    this.ctx = null;
    this.master = null;
  }

  /** Call from a click/tap handler before first play. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (err) {
      console.warn('[XBR] Audio unavailable:', err.message);
      this.ctx = null;
    }
  }

  setEnabled(on) { this.enabled = on; }
  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  _ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  _noise(duration = 0.12, freq = 1200, gainPeak = 0.5, type = 'lowpass') {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }

  _tone(freq, duration = 0.08, gainPeak = 0.25, type = 'square', slideTo = null) {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  click()  { this._tone(700, 0.05, 0.15, 'square'); }
  shoot(kind = 'rifle') {
    if (kind === 'shotgun') { this._noise(0.22, 700, 0.75); this._tone(110, 0.15, 0.4, 'triangle', 45); }
    else if (kind === 'pistol') { this._noise(0.09, 1800, 0.5); this._tone(220, 0.06, 0.3, 'triangle', 80); }
    else { this._noise(0.11, 1300, 0.55); this._tone(160, 0.07, 0.32, 'triangle', 60); }
  }
  enemyShoot() { this._noise(0.1, 900, 0.22); }
  reload() { this._tone(300, 0.07, 0.22, 'square', 180); setTimeout(() => this._tone(420, 0.06, 0.22, 'square', 240), 140); }
  empty() { this._tone(900, 0.045, 0.12, 'square'); }
  hit() { this._tone(1250, 0.06, 0.3, 'square', 900); }
  hurt() { this._tone(140, 0.16, 0.4, 'sawtooth', 70); }
  kill() { this._tone(520, 0.1, 0.3, 'square'); setTimeout(() => this._tone(780, 0.14, 0.3, 'square'), 90); }
  pickup() { this._tone(660, 0.08, 0.25, 'sine', 990); }
  jump() { this._noise(0.07, 500, 0.12); }
  zoneWarning() { this._tone(440, 0.16, 0.28, 'square'); setTimeout(() => this._tone(440, 0.16, 0.28, 'square'), 220); }
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.18, 0.28, 'triangle'), i * 130)); }
  lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this._tone(f, 0.2, 0.28, 'triangle'), i * 150)); }
}
