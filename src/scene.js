// scene.js — renderer / scene / camera setup tuned for low-end Android.
import * as THREE from 'three';

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch { return false; }
}

export class SceneSetup {
  constructor(container, config) {
    this.config = config;
    this.presetName = config.graphics.defaultPreset || 'low';
    const preset = this.getPreset();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !!preset.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x87b5d9);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d9);
    this.scene.fog = new THREE.Fog(0x9db8cc, 60, preset.fogFar);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.camera.position.set(0, 30, 60);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6b7a4f, 1.05);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    this.sun.position.set(120, 180, 60);
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -160; this.sun.shadow.camera.right = 160;
    this.sun.shadow.camera.top = 160; this.sun.shadow.camera.bottom = -160;
    this.sun.shadow.camera.far = 500;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.contextLost = false;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.error('[XBR] WebGL context lost');
      if (this.onContextLost) this.onContextLost();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.info('[XBR] WebGL context restored');
      if (this.onContextRestored) this.onContextRestored();
    });

    this.applyQuality(this.presetName);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 60));
  }

  getPreset(name = this.presetName) {
    return this.config.graphics.presets[name] || this.config.graphics.presets.low;
  }

  applyQuality(name) {
    this.presetName = name;
    const p = this.getPreset(name);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.effectivePixelRatio = Math.max(0.5, dpr * p.resolutionScale);
    this.renderer.setPixelRatio(this.effectivePixelRatio);
    this.renderer.shadowMap.enabled = !!p.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = !!p.shadows;
    if (this.scene.fog) this.scene.fog.far = p.fogFar;
    this.resize();
  }

  /** Temporary resolution drop used by automatic quality (hysteresis handled by caller). */
  setResolutionScale(scale) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.effectivePixelRatio = Math.max(0.45, dpr * scale);
    this.renderer.setPixelRatio(this.effectivePixelRatio);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render() {
    if (this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
  }
}
