// performance.js — FPS sampling + automatic quality with hysteresis.

export class PerformanceMonitor {
  constructor({ onSample = null, onLowPerformance = null, onAutoQuality = null } = {}) {
    this.frames = 0;
    this.accum = 0;
    this.fps = 0;
    this.frameMs = 0;
    this.sampleInterval = 0.5;
    this.lowWindows = 0;
    this.lowWarned = false;
    this.autoCooldown = 0;
    this.autoScale = null; // null = use preset scale
    this.onSample = onSample;
    this.onLowPerformance = onLowPerformance;
    this.onAutoQuality = onAutoQuality;
  }

  reset() {
    this.frames = 0; this.accum = 0; this.lowWindows = 0;
    this.lowWarned = false; this.autoCooldown = 0; this.autoScale = null;
  }

  /** Call once per rendered frame with the (already capped) delta time. */
  tick(dt, autoQualityEnabled, currentScale) {
    this.frames++;
    this.accum += dt;
    if (this.autoCooldown > 0) this.autoCooldown -= dt;
    if (this.accum < this.sampleInterval) return;

    this.fps = Math.round(this.frames / this.accum);
    this.frameMs = Math.round((this.accum / Math.max(1, this.frames)) * 1000 * 10) / 10;
    this.frames = 0;
    this.accum = 0;
    if (this.onSample) this.onSample(this.fps, this.frameMs);

    // Sustained low FPS -> warn once, and (optionally) step resolution down.
    if (this.fps > 0 && this.fps < 24) {
      this.lowWindows++;
      if (this.lowWindows >= 4 && !this.lowWarned) {
        this.lowWarned = true;
        if (this.onLowPerformance) this.onLowPerformance(this.fps);
      }
      if (autoQualityEnabled && this.autoCooldown <= 0) {
        const base = this.autoScale ?? currentScale;
        const next = Math.max(0.5, Math.round((base - 0.1) * 100) / 100);
        if (next < base) {
          this.autoScale = next;
          this.autoCooldown = 6; // hysteresis: wait before stepping again
          if (this.onAutoQuality) this.onAutoQuality(next);
        }
      }
    } else {
      this.lowWindows = Math.max(0, this.lowWindows - 1);
    }
  }
}
