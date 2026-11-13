// Santa Claus and the Quest for the Snow Orchids — 60 s Three.js cinematic.
// Deterministic timeline: render(t) is a pure function of t in [0, 60].
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSky } from './sky.js';
import { createSnow, createTrail } from './particles.js';
import { createTeam } from './characters.js';
import { buildScenes } from './scenes.js';
import { textTexture } from './textures.js';
import { clamp, envelope, smoothstep } from './util.js';

export const DURATION = 60;
export const FPS = 30;
const TRANSITIONS = [10, 20, 22.2, 30, 40, 50];

const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
let quality = params.get('quality') || (EXPORT ? 'high' : mobile ? 'low' : 'high');

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: EXPORT, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const fog = new THREE.FogExp2('#1b2a52', 0.004);
scene.fog = fog;
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 6000);

const hemi = new THREE.HemisphereLight('#7f95d8', '#1b2340', 1.0);
const moonLight = new THREE.DirectionalLight('#c6d4ff', 1.3);
const ambient = new THREE.AmbientLight('#26305a', 0.6);
const revealLight = new THREE.PointLight('#ffd9a0', 0, 5, 1.6);
scene.add(hemi, moonLight, moonLight.target, ambient, revealLight);

const sky = createSky();
scene.add(sky.rig);
const Q = { high: { trees: 1, snow: 9000, bloom: true, prCap: 1.5 }, low: { trees: 0.5, snow: 3500, bloom: false, prCap: 1 } };
const q = Q[quality] || Q.high;
const snow = createSnow(q.snow);
scene.add(snow.object);
const trail = createTrail(EXPORT || quality === 'high' ? 700 : 350);
scene.add(trail.object);
const team = createTeam();
scene.add(team.group);

// ---------- HUD (titles, captions, transitions, fades) ----------
const hudScene = new THREE.Scene();
const hudCam = new THREE.OrthographicCamera(-960, 960, 540, -540, -10, 10);
function hudPlane(tex, w, h, y, order) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, toneMapped: false }));
  m.position.y = y; m.renderOrder = order; hudScene.add(m); return m;
}
const mistMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, toneMapped: false,
  uniforms: { time: { value: 0 }, op: { value: 0 }, tint: { value: new THREE.Color('#dfe7ff') } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `uniform float time; uniform float op; uniform vec3 tint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
    float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.1; a*=0.5;} return s; }
    void main(){ vec2 p = vUv*vec2(3.2,1.8);
      float c = fbm(p + vec2(time*0.9, time*0.15)) * 0.6 + fbm(p*2.0 - vec2(time*1.6, 0.0)) * 0.4;
      float a = clamp(op*1.6 - (1.0-c)*1.1*(1.0-op), 0.0, 1.0);
      gl_FragColor = vec4(tint*(0.75+0.35*c), a); }`,
});
const mistQuad = new THREE.Mesh(new THREE.PlaneGeometry(1920, 1080), mistMat); mistQuad.renderOrder = 10; hudScene.add(mistQuad);
const black = new THREE.Mesh(new THREE.PlaneGeometry(1920, 1080), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false, toneMapped: false }));
black.renderOrder = 30; hudScene.add(black);

let scenes, hud = {};
const camState = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50, near: 0.3 };
let lastScene = -1;
let pxScale = 1;

async function init() {
  const fontsReady = Promise.all([
    document.fonts.load('400 64px Cinzel'), document.fonts.load('700 64px Cinzel'),
    document.fonts.load('italic 500 64px "Cormorant Garamond"'), document.fonts.load('500 64px "Cormorant Garamond"'),
  ]).catch(() => {});
  const earthTexture = await new Promise((res) => new THREE.TextureLoader().load('../earth-december.jpg.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, () => res(null)));
  await fontsReady;
  scenes = buildScenes({ q, earthTexture });
  scenes.forEach((s) => scene.add(s.group));

  const regionTex = (txt) => textTexture([{ text: txt, font: '400 66px Cinzel', y: 0.5, spacing: '14px', color: '#eef2ff', shadow: 'rgba(120,170,255,0.9)', blur: 22 }], { width: 2048, height: 256 });
  const speciesTex = (sp, common) => textTexture([
    { text: sp, font: 'italic 500 92px "Cormorant Garamond"', y: 0.38, color: '#fff3d6', shadow: 'rgba(255,190,90,0.9)', blur: 26 },
    ...(common ? [{ text: common, font: '500 46px "Cormorant Garamond"', y: 0.75, color: '#e8ecff', shadow: 'rgba(160,190,255,0.8)', blur: 16, spacing: '3px' }] : []),
  ], { width: 2048, height: 320 });
  hud.region = scenes.map((s) => s.caption.region ? hudPlane(regionTex(s.caption.region), 1500, 187, 380, 20) : null);
  hud.species = scenes.map((s) => s.caption.species ? hudPlane(speciesTex(s.caption.species, s.caption.common), 1300, 203, -360, 20) : null);
  const titleTex = textTexture([
    { text: 'SANTA CLAUS', font: '700 168px Cinzel', y: 0.27, color: '#fff6e2', spacing: '10px', shadow: 'rgba(255,200,110,0.95)', blur: 40 },
    { text: 'AND THE QUEST FOR THE', font: '400 60px Cinzel', y: 0.55, color: '#e9eeff', spacing: '16px', shadow: 'rgba(140,190,255,0.9)', blur: 22 },
    { text: 'SNOW ORCHIDS', font: '700 136px Cinzel', y: 0.8, color: '#ffe3a6', spacing: '12px', shadow: 'rgba(255,190,90,0.95)', blur: 40 },
  ], { width: 2048, height: 768 });
  hud.title = hudPlane(titleTex, 1600, 600, -30, 25);

  window.__ready = true;
}

function teamHidden(sc, s) { return sc.hideTeamBefore && s < sc.hideTeamBefore; }
const _e = new THREE.Vector3();

export function render(tIn) {
  const t = clamp(tIn, 0, DURATION - 1e-4);
  const i = Math.min(5, Math.floor(t / 10));
  const s = t - i * 10;
  const sc = scenes[i];
  if (i !== lastScene) {
    scenes.forEach((x, k) => (x.group.visible = k === i));
    lastScene = i;
  }
  const env = sc.envAt ? sc.envAt(s, { ...sc.env }) : sc.env;
  sky.setPalette(env.palette);
  fog.color.set(env.fog); fog.density = env.fogDensity;
  hemi.intensity = env.hemi; moonLight.intensity = env.moon;
  if (env.moonDir) moonLight.position.copy(env.moonDir).multiplyScalar(100);

  sc.update(s, t, pxScale);

  const hidden = teamHidden(sc, s);
  team.group.visible = !hidden;
  if (!hidden) team.update(t, (ahead, out) => sc.path.poseAt(s, ahead, out));
  trail.update(t, (te, out) => {
    if (te < 0 || Math.min(5, Math.floor(te / 10)) !== i) return false;
    const se = te - i * 10;
    if (teamHidden(sc, se)) return false;
    sc.path.pointAt(se, -2.4, out); out.y += 0.4; return true;
  }, hidden ? 0 : 1, pxScale);

  // orchid reveal
  if (sc.reveal) {
    const k = envelope(s, ...sc.revealWindow);
    const w = sc.revealWindow;
    sc.reveal.update(t, k, pxScale, envelope(s, w[0], w[0] + 0.6, w[1] + 0.2, w[1] + 1.2));
    revealLight.position.copy(sc.reveal.focus()).add(_e.set(0.2, 0.9, 0.7));
    revealLight.color.set(sc.reveal.glow);
    revealLight.intensity = 1.6 * k;
  } else revealLight.intensity = 0;

  sc.camera(s, camState);
  camera.position.copy(camState.pos);
  camera.lookAt(camState.target);
  camera.fov = camState.fov;
  camera.near = camState.near;
  camera.updateProjectionMatrix();

  sky.update(t, camera, { aurora: env.aurora, auroraYaw: env.auroraYaw, moonDir: env.moonDir, moon: 1, stars: 1, pxScale });
  snow.update(t, camera, env.snow, pxScale);

  // HUD
  let mist = 0;
  for (const b of TRANSITIONS) mist = Math.max(mist, envelope(t, b - 0.6, b - 0.05, b + 0.05, b + 0.65));
  mistMat.uniforms.op.value = mist;
  mistMat.uniforms.time.value = t;
  mistMat.uniforms.tint.value.set(i === 5 || (t > 49 && t < 50.7) ? '#ffe6b8' : '#dbe4ff');
  hud.region.forEach((m, k) => { if (!m) return; const ra = scenes[k].caption.regionAt ?? 0.5; m.material.opacity = k === i ? envelope(s, ra, ra + 0.8, ra + 2.4, ra + 3.2) : 0; });
  hud.species.forEach((m, k) => { if (!m) return; const a = scenes[k].caption.at; m.material.opacity = k === i ? envelope(s, ...a) : 0; });
  hud.title.material.opacity = i === 5 ? smoothstep(5.6, 7.0, s) : 0;
  hud.title.scale.setScalar(i === 5 ? 1 + (s - 5.6) * 0.012 : 1);
  black.material.opacity = Math.max(1 - smoothstep(0.0, 1.4, t), smoothstep(DURATION - 1.5, DURATION - 0.05, t));

  if (composer) composer.render(); else renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(hudScene, hudCam);
  renderer.autoClear = true;
  return { scene: i, s };
}

// ---------- sizing / post ----------
let composer = null, bloom = null;
function setupComposer(w, h) {
  if (!q.bloom) { composer = null; return; }
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.55, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
function resize() {
  let w, h;
  if (EXPORT) { w = 1920; h = 1080; renderer.setPixelRatio(1); }
  else {
    const wrap = canvas.parentElement.getBoundingClientRect();
    w = wrap.width; h = w * 9 / 16;
    if (h > wrap.height) { h = wrap.height; w = h * 16 / 9; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.prCap));
  }
  renderer.setSize(Math.round(w), Math.round(h), !EXPORT);
  if (!composer && q.bloom) setupComposer(w, h);
  if (composer) composer.setSize(Math.round(w), Math.round(h));
  pxScale = (h * renderer.getPixelRatio()) / 1080;
  camera.aspect = 16 / 9; camera.updateProjectionMatrix();
}

// ---------- playback controls ----------
let t = clamp(parseFloat(params.get('t') || '0') || 0, 0, DURATION);
let playing = false, last = 0, dirty = true;
const audio = document.getElementById('song');
const ui = {
  play: document.getElementById('play'), restart: document.getElementById('restart'), scrub: document.getElementById('scrub'),
  time: document.getElementById('time'), song: document.getElementById('songSel'), quality: document.getElementById('qualitySel'), chips: document.querySelectorAll('[data-jump]'),
};
const fmt = (x) => { const m = Math.floor(x / 60), s = x - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
function setSong() {
  const v = ui.song?.value || '1';
  if (v === '0') { audio.removeAttribute('src'); audio.load(); }
  else audio.src = `../song-${v}.mp3`;
}
function syncAudio(force) {
  if (!audio.src || !playing) { audio.pause(); return; }
  if (force || Math.abs(audio.currentTime - t) > 0.25) audio.currentTime = t;
  audio.volume = clamp(Math.min(t / 1.0, (DURATION - t) / 3), 0, 1);
  if (audio.paused) audio.play().catch(() => {});
}
function setPlaying(p) {
  if (p && t >= DURATION - 0.01) t = 0;
  playing = p; last = performance.now();
  if (ui.play) ui.play.textContent = p ? '❚❚ Pause' : '▶ Play';
  syncAudio(true);
}
function seek(x) { t = clamp(x, 0, DURATION); dirty = true; syncAudio(true); }

if (!EXPORT) {
  ui.play.onclick = () => setPlaying(!playing);
  ui.restart.onclick = () => { seek(0); setPlaying(true); };
  ui.scrub.oninput = () => seek(parseFloat(ui.scrub.value));
  ui.chips.forEach((c) => (c.onclick = () => seek(parseFloat(c.dataset.jump))));
  ui.song.onchange = () => { setSong(); syncAudio(true); };
  ui.quality.value = quality;
  ui.quality.onchange = () => { const u = new URL(location.href); u.searchParams.set('quality', ui.quality.value); u.searchParams.set('t', t.toFixed(2)); location.href = u.toString(); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    if (e.code === 'ArrowRight') seek(t + 1);
    if (e.code === 'ArrowLeft') seek(t - 1);
    if (e.code === 'Home') seek(0);
  });
  setSong();
  addEventListener('resize', () => { resize(); dirty = true; });
}

function frame(now) {
  if (playing) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    // the soundtrack is the master clock when it is playing, so picture and music stay in sync
    if (audio.src && !audio.paused && !audio.seeking && audio.readyState >= 2) t = audio.currentTime;
    else t += dt;
    if (t >= DURATION) { t = DURATION; setPlaying(false); }
    dirty = true;
    syncAudio(false);
  }
  if (dirty) {
    const info = render(t);
    dirty = false;
    if (ui.scrub && document.activeElement !== ui.scrub) ui.scrub.value = t;
    if (ui.time) ui.time.textContent = `${fmt(t)} / ${fmt(DURATION)}`;
    ui.chips.forEach((c, k) => c.classList.toggle('on', k === info.scene));
  }
  requestAnimationFrame(frame);
}

resize();
init().then(() => {
  document.body.classList.add('ready');
  if (EXPORT) {
    window.__renderFrame = (time, type = 'image/jpeg', quality = 0.93) => { render(time); return canvas.toDataURL(type, quality); };
    render(0);
  } else {
    requestAnimationFrame(frame);
  }
}).catch((e) => { console.error(e); document.getElementById('loading').textContent = 'Failed to start: ' + e.message; });
