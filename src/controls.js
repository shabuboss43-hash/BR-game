// controls.js — unified touch + mouse + keyboard input (Pointer Events).
// Every control feeds the SAME input state, so mobile and desktop can never
// disagree about gameplay. Separate pointer IDs are tracked per control.

function bindHoldButton(node, onDown, onUp) {
  if (!node) return;
  const down = (e) => {
    e.preventDefault();
    node.classList.add('active');
    try { node.setPointerCapture(e.pointerId); } catch { /* mouse already fine */ }
    onDown();
  };
  const up = (e) => {
    e.preventDefault();
    node.classList.remove('active');
    if (onUp) onUp();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('contextmenu', (e) => e.preventDefault());
}

export class InputManager {
  /**
   * callbacks: { onReload, onWeaponSlot(i), onInteract, onPause, onAnyGesture,
   *              onPointerLockLost, isPlaying() }
   */
  constructor(callbacks) {
    this.cb = callbacks;
    this.joy = { x: 0, y: 0, pointerId: null };
    this.keys = new Set();
    this.look = { dx: 0, dy: 0, pointerId: null, lastX: 0, lastY: 0 };
    this.fireHeld = false;
    this.firePressedQueued = false;
    this.aimHeld = false;
    this.jumpQueued = false;
    this.sprintToggle = false;
    this.mouseFiring = false;
    this.enabled = false;
    this._wasPointerLocked = false;

    this._setupJoystick();
    this._setupLookArea();
    this._setupButtons();
    this._setupKeyboard();
    this._setupMouseLook();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.resetTransient();
    const look = document.getElementById('look-area');
    if (look) look.style.display = on ? 'block' : 'none';
  }

  resetTransient() {
    this.joy.x = 0; this.joy.y = 0; this.joy.pointerId = null;
    this.look.dx = 0; this.look.dy = 0; this.look.pointerId = null;
    this.fireHeld = false; this.firePressedQueued = false;
    this.aimHeld = false; this.jumpQueued = false; this.mouseFiring = false;
    this._updateKnob(0, 0);
    for (const b of document.querySelectorAll('.hud-btn.active')) b.classList.remove('active');
    // Sprint is a toggle: its lamp must reflect the (preserved) toggle state.
    if (this.sprintToggle) document.getElementById('btn-sprint')?.classList.add('active');
  }

  // ---------- queries used by the game loop ----------
  getMove() {
    let x = this.joy.x, y = this.joy.y;
    if (Math.abs(x) < 0.04 && Math.abs(y) < 0.04) {
      x = 0; y = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    }
    return { x, y };
  }

  consumeLook() {
    const out = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0; this.look.dy = 0;
    return out;
  }

  consumeFirePressed() { const v = this.firePressedQueued; this.firePressedQueued = false; return v; }
  consumeJump() { const v = this.jumpQueued; this.jumpQueued = false; return v; }
  isFiring() { return this.fireHeld || this.mouseFiring; }
  isAiming() { return this.aimHeld; }
  isSprinting() {
    return this.sprintToggle || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  // ---------- joystick ----------
  _updateKnob(dx, dy) {
    const knob = document.getElementById('joy-knob');
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _setupJoystick() {
    const zone = document.getElementById('joy-zone');
    const base = document.getElementById('joy-base');
    if (!zone || !base) return;
    const radius = 42;

    const handle = (e) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > radius) { dx = dx / len * radius; dy = dy / len * radius; }
      this.joy.x = dx / radius;
      this.joy.y = -dy / radius;
      this._updateKnob(dx, dy);
    };
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.joy.pointerId !== null) return;
      e.preventDefault();
      this.joy.pointerId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      handle(e);
      this.cb.onAnyGesture?.();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joy.pointerId) return;
      e.preventDefault();
      handle(e);
    });
    const end = (e) => {
      if (e.pointerId !== this.joy.pointerId) return;
      this.joy.pointerId = null;
      this.joy.x = 0; this.joy.y = 0;
      this._updateKnob(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // ---------- camera look (touch drag on right side) ----------
  _setupLookArea() {
    const area = document.getElementById('look-area');
    if (!area) return;
    area.style.display = 'none';
    area.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.look.pointerId !== null) return;
      if (e.pointerType === 'mouse' && document.pointerLockElement) return;
      e.preventDefault();
      this.look.pointerId = e.pointerId;
      this.look.lastX = e.clientX; this.look.lastY = e.clientY;
      try { area.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.cb.onAnyGesture?.();
      // Desktop convenience: a plain mouse click-drag on the look area also
      // offers pointer lock via the canvas handler below; touch just drags.
    });
    area.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.look.pointerId) return;
      e.preventDefault();
      this.look.dx += e.clientX - this.look.lastX;
      this.look.dy += e.clientY - this.look.lastY;
      this.look.lastX = e.clientX; this.look.lastY = e.clientY;
    });
    const end = (e) => { if (e.pointerId === this.look.pointerId) this.look.pointerId = null; };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
    area.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- action buttons ----------
  _setupButtons() {
    bindHoldButton(document.getElementById('btn-fire'),
      () => { this.fireHeld = true; this.firePressedQueued = true; this.cb.onAnyGesture?.(); },
      () => { this.fireHeld = false; });
    bindHoldButton(document.getElementById('btn-aim'),
      () => { this.aimHeld = true; }, () => { this.aimHeld = false; });
    bindHoldButton(document.getElementById('btn-jump'),
      () => { this.jumpQueued = true; });
    bindHoldButton(document.getElementById('btn-reload'),
      () => { this.cb.onReload?.(); });
    const sprintBtn = document.getElementById('btn-sprint');
    if (sprintBtn) {
      sprintBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.sprintToggle = !this.sprintToggle;
        sprintBtn.classList.toggle('active', this.sprintToggle);
      });
      sprintBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.cb.onPause?.());
    const interactBtn = document.getElementById('btn-interact');
    bindHoldButton(interactBtn, () => this.cb.onInteract?.());
    document.querySelectorAll('.slot-btn').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.cb.onWeaponSlot?.(Number(btn.dataset.slot));
      });
    });
  }

  // ---------- keyboard ----------
  _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
      this.keys.add(e.code);
      if (!this.enabled) return;
      switch (e.code) {
        case 'Space': this.jumpQueued = true; e.preventDefault(); break;
        case 'KeyR': this.cb.onReload?.(); break;
        case 'Digit1': this.cb.onWeaponSlot?.(0); break;
        case 'Digit2': this.cb.onWeaponSlot?.(1); break;
        case 'Digit3': this.cb.onWeaponSlot?.(2); break;
        case 'KeyE': case 'KeyF': this.cb.onInteract?.(); break;
        case 'Escape': case 'KeyP': this.cb.onPause?.(); break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseFiring = false; });
  }

  // ---------- mouse: pointer lock look + click fire ----------
  _setupMouseLook() {
    const container = document.getElementById('game-container');
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || !document.pointerLockElement) return;
      this.look.dx += e.movementX || 0;
      this.look.dy += e.movementY || 0;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      const locked = !!document.pointerLockElement;
      const onGame = e.target === container?.querySelector('canvas') || e.target.id === 'look-area';
      if (e.button === 0 && (locked || onGame)) {
        if (!locked && onGame && this.cb.isPlaying?.()) {
          // First click locks the mouse; it also fires so testing feels instant.
          container?.querySelector('canvas')?.requestPointerLock?.();
        }
        this.mouseFiring = true;
        this.firePressedQueued = true;
        this.cb.onAnyGesture?.();
      }
      if (e.button === 2) this.aimHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFiring = false;
      if (e.button === 2) this.aimHeld = false;
    });
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (this._wasPointerLocked && !locked && this.enabled) this.cb.onPointerLockLost?.();
      this._wasPointerLocked = locked;
    });
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
}
