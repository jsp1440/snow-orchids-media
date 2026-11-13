// The six regions of the 60-second journey. Each scene owns its world group,
// flight path, environment settings, camera choreography and orchid reveal.
// Local scene time s runs 0..10 (seconds).
import * as THREE from 'three';
import { makeNoise2D, fbm, ridged, mulberry32, smoothstep, smoother, clamp, lerp, envelope, seg } from './util.js';
import { FlightPath, makeTerrain, treeGeometry, instancedTrees, scatter, rockGeometry, instancedRocks } from './world.js';
import { createMist, createMotes } from './particles.js';
import { ORCHIDS, setGlow } from './orchids.js';
import { glowTexture } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ORCHID_SCALE = 0.035; // models are built in cm; x3.5 storybook magnification
const CK = 1.0; // close-up camera distance multiplier

// ---------- shared helpers ----------
function nearestOnPath(path, samples = 240) {
  const pts = path.curve.getSpacedPoints(samples);
  return (x, z) => {
    let best = Infinity, by = 0;
    for (const p of pts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) { best = d; by = p.y; } }
    return { d: Math.sqrt(best), y: by };
  };
}
function flatten(h, cx, cz, r0 = 1.5, r1 = 5) {
  const h0 = h(cx, cz);
  return (x, z) => {
    const d = Math.hypot(x - cx, z - cz);
    const w = smoothstep(r0, r1, d);
    return lerp(h0, h(x, z), w);
  };
}
function mossPatch(radius, seed, colors = ['#3f6a33', '#5b8a3c', '#6f5a3a'], rimColor = '#dfe7f5') {
  const rng = mulberry32(seed);
  const g = new THREE.RingGeometry(0.001, radius, 64, 8);
  const rim = new THREE.Color(rimColor);
  const p = g.attributes.position;
  const cols = [];
  const c = new THREE.Color();
  const cs = colors.map((h) => new THREE.Color(h));
  const wob = Array.from({ length: 5 }, () => [rng() * 6, rng() * 0.25]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const a = Math.atan2(y, x), r = Math.hypot(x, y);
    let k = 1; for (const [f, w] of wob) k += Math.sin(a * Math.round(f + 2) + f) * w;
    if (r > radius * 0.99) p.setXY(i, x * k, y * k);
    c.copy(cs[0]).lerp(cs[1], 0.5 + 0.5 * Math.sin(x * 9 + y * 7)).lerp(cs[2], 0.3 * (0.5 + 0.5 * Math.sin(x * 23 - y * 17)));
    c.lerp(rim, smoothstep(0.45, 1.0, r / radius + 0.15 * Math.sin(a * 5 + x * 3)));
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// Reveal: orchid + thawed moss patch + halo + rising motes. Light is shared (ctx.revealLight).
function createReveal(kind, { pos, rotY = 0, scale = ORCHID_SCALE, glow = '#ffe2a8', moss = true, mossColors, rimColor, haloSize = 2.2 }) {
  const group = new THREE.Group();
  group.position.copy(pos);
  const b = ORCHIDS[kind]();
  b.group.scale.setScalar(scale);
  b.group.rotation.y = rotY;
  group.add(b.group);
  if (moss) { const m = mossPatch(0.75, 7, mossColors, rimColor); m.position.y = 0.03; group.add(m); }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  const hh = b.group.userData.height * scale;
  halo.position.y = hh * 0.6; halo.scale.set(haloSize, haloSize, 1);
  group.add(halo);
  // light shaft from above
  const shaftGeo = new THREE.CylinderGeometry(0.04, 0.5, 12, 24, 1, true); shaftGeo.translate(0, 6, 0);
  const shaft = new THREE.Mesh(shaftGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { op: { value: 0 }, col: { value: new THREE.Color(glow) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform float op; uniform vec3 col; varying vec2 vUv; void main(){ float a = (1.0-vUv.y*0.7)*smoothstep(1.0,0.5,vUv.y)*op*0.5*(0.7+0.3*sin(vUv.x*40.0)); gl_FragColor=vec4(col*a,a);} `,
  }));
  // (light shaft removed: it washed out close-ups)
  const motes = createMotes(140, glow);
  group.add(motes.object);
  const local0 = V(0, 0, 0);
  return {
    group, builder: b, height: hh, glow,
    focus: () => group.position.clone().add(V(0, hh * 0.55, 0)),
    update(t, strength, pxScale, beam = strength) {
      setGlow(b, strength * 0.1, glow);
      halo.material.opacity = strength * 0.4;
      halo.scale.setScalar(haloSize * (0.9 + 0.1 * Math.sin(t * 2)));
      shaft.material.uniforms.op.value = beam;
      motes.update(t, local0, 0.7, hh * 2.2 + 0.6, strength, pxScale);
    },
  };
}

// Camera keyframe blending. keys: [{t, pos:(s)=>V, target:(s)=>V, fov}]
function keyCam(keys) {
  return (s, out) => {
    let k = 0;
    while (k < keys.length - 1 && s >= keys[k + 1].t) k++;
    const a = keys[k], b = keys[Math.min(k + 1, keys.length - 1)];
    const w = a === b ? 0 : smoother((s - a.t) / (b.t - a.t));
    out.pos.copy(a.pos(s)).lerp(b.pos(s), w);
    out.target.copy(a.target(s)).lerp(b.target(s), w);
    out.fov = lerp(a.fov ?? 50, b.fov ?? 50, w);
    out.near = Math.min(a.near ?? 0.3, b.near ?? 0.3);
    return out;
  };
}

// Sleigh-relative position: dx right, dy up, dz forward (yaw-only frame, no roll).
function relFn(path) {
  const p = V(0, 0, 0), f = V(0, 0, 0);
  return (dx, dy, dz, ahead = 0) => (s) => {
    path.pointAt(s, ahead, p);
    const u = path.uAt(s);
    path.curve.getTangentAt(clamp(u, 0, 1), f); f.y = 0; f.normalize();
    const r = V(f.z, 0, -f.x); // right-hand side
    return p.clone().addScaledVector(r, dx).add(V(0, dy, 0)).addScaledVector(f, dz);
  };
}
const at = (v) => () => v.clone();

function snowColorFn(noise, { rock = '#7d8799', snow = '#e4ecf8', shade = '#b7c6e2', rockSlope = 0.38, snowLine = -1e9, low = null, lowLine = 0 } = {}) {
  const R = new THREE.Color(rock), S = new THREE.Color(snow), Sh = new THREE.Color(shade), L = low ? new THREE.Color(low) : null;
  return (x, z, y, slope, out) => {
    const n = fbm(noise, x / 40, z / 40, 3) * 0.5 + 0.5;
    out.copy(S).lerp(Sh, n * 0.6);
    if (L && y < lowLine) out.lerp(L, smoothstep(lowLine, lowLine - 6, y) * 0.8);
    const sl = smoothstep(rockSlope, rockSlope + 0.18, slope + (n - 0.5) * 0.15);
    out.lerp(R, sl * (y > snowLine ? 0.75 : 1));
  };
}

// ================================================================
export function buildScenes(ctx) {
  const scenes = [lapland(ctx), himalaya(ctx), japan(ctx), pacificNW(ctx), rockies(ctx), finale(ctx)];
  return scenes;
}

// ---------------- 1. Swedish Lapland ----------------
function lapland(ctx) {
  const group = new THREE.Group(); group.name = 'lapland';
  const noise = makeNoise2D(101);
  const path = new FlightPath([[-190, 62, 70], [-120, 52, 38], [-50, 40, 10], [5, 30, -2], [55, 21, 4], [95, 16, 22], [130, 15, 52], [160, 16, 85]], { s0: -1, s1: 11 });
  const sOrchid = 8.6;
  const op = path.pointAt(sOrchid);
  const orchidXZ = [op.x + 3.5, op.z - 6];
  const base = (x, z) => 9 * fbm(noise, x / 230, z / 230, 4) + 2.2 * fbm(noise, x / 35, z / 35, 3);
  const h = flatten(base, orchidXZ[0], orchidXZ[1], 1.5, 6);
  group.add(makeTerrain({ size: 1500, seg: 200, heightFn: h, colorFn: snowColorFn(noise, { rockSlope: 0.5 }) }));
  const near = nearestOnPath(path);
  const camStart = V(-150, 0, 140); camStart.y = h(camStart.x, camStart.z) + 24;
  const spruce = treeGeometry('spruce', 3, 0.75);
  const trees = scatter(ctx.q.trees * 1700, [-700, -650, 700, 400], 12, (x, z) => {
    const { d, y } = near(x, z);
    if (y - h(x, z) < 34 && d < 15) return false;
    if (Math.hypot(x - orchidXZ[0], z - orchidXZ[1]) < 7) return false;
    if (Math.hypot(x - camStart.x, z - camStart.z) < 25) return false;
    return true;
  }, (r) => 9 + r() * 9);
  // a few trees sheltering the orchid ("beneath the trees")
  for (const [dx, dz, hh] of [[7, -5, 15], [-8, -8, 17], [2, -12, 13], [-11, 1, 12], [12, 4, 14]]) trees.push({ x: orchidXZ[0] + dx, z: orchidXZ[1] + dz, h: hh, rot: dx, w: hh * 0.85 });
  group.add(instancedTrees(spruce, trees, h));
  const opos = V(orchidXZ[0], h(orchidXZ[0], orchidXZ[1]), orchidXZ[1]);
  const reveal = createReveal('calypso', { pos: opos, rotY: 0.2 });
  group.add(reveal.group);
  const mist = createMist(Array.from({ length: 30 }, (_, i) => { const r = mulberry32(i + 50); return { pos: V(-300 + r() * 600, 8 + r() * 16, -320 + r() * 280), size: 60 + r() * 80 }; }).filter((m) => Math.hypot(m.pos.x - orchidXZ[0], m.pos.z - orchidXZ[1]) > 70), { color: '#b9c7ef', opacity: 0.32 });
  group.add(mist.group);

  const rel = relFn(path);
  const of = reveal.focus();
  const camera = keyCam([
    { t: 0, pos: at(camStart), target: rel(0, 2, 0), fov: 46 },
    { t: 2.6, pos: rel(-10, 1.5, -6), target: rel(0, 1, 2), fov: 50 },
    { t: 5.6, pos: rel(-8, 2.5, 7), target: rel(0, 1, -1), fov: 50 },
    { t: 7.3, pos: () => of.clone().add(V(-1.3, 0.9, 3.4).multiplyScalar(CK)), target: () => of.clone().add(V(0, 1.5, -2)), fov: 45, near: 0.05 },
    { t: 8.6, pos: () => of.clone().add(V(-0.75, 0.25, 1.35).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.02, 0)), fov: 38, near: 0.05 },
    { t: 10, pos: () => of.clone().add(V(-0.5, 0.18, 0.95).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.03, 0)), fov: 36, near: 0.05 },
  ]);
  return {
    name: 'Swedish Lapland', group, path, reveal, camera,
    caption: { region: 'SWEDISH LAPLAND', species: 'Calypso bulbosa', common: 'Fairy slipper', at: [7.9, 8.6, 9.7, 10.2] },
    revealWindow: [7.0, 8.2, 11, 12],
    env: { fog: '#1b2a52', fogDensity: 0.0042, palette: { top: '#040a22', mid: '#0b1b48', horizon: '#26406f', glow: '#2fbf8f', glowAmt: 0.55 },
      aurora: 1.15, auroraYaw: 0, moonDir: V(0.6, 0.35, -0.7), snow: 0.55, hemi: 1.0, moon: 1.3 },
    update(s, t) { mist.update(t); },
  };
}

// ---------------- 2. Himalayas ----------------
function himalaya(ctx) {
  const group = new THREE.Group(); group.name = 'himalaya';
  const noise = makeNoise2D(202);
  const river = (x) => 7 * Math.sin(x / 45) + 3 * Math.sin(x / 17);
  const path = new FlightPath([[-330, 40, 10], [-250, 78, 5], [-170, 96, 0], [-100, 62, 2], [-40, 30, 0], [20, 17, river(20) + 6], [80, 12, river(80) + 7], [130, 11, river(130) + 6], [175, 12, river(175) + 8]], { s0: -1, s1: 11 });
  const near = nearestOnPath(path);
  const sOrchid = 8.7;
  const opp = path.pointAt(sOrchid);
  const rockXZ = [opp.x + 4, river(opp.x + 4) - 4.2];
  const raw = (x, z) => {
    const dz = Math.abs(z - river(x));
    const wall = smoothstep(14, 140, dz);
    const peaks = 300 * Math.pow(ridged(noise, x / 260 + 3, z / 260, 5), 1.6);
    return 0.6 * fbm(noise, x / 9, z / 9, 2) + wall * (25 + peaks) + 5 * fbm(noise, x / 60, z / 60, 3);
  };
  const carved = (x, z) => {
    const r = raw(x, z); const { d, y } = near(x, z);
    const allowed = y - 9 + d * 0.9;
    return Math.min(r, allowed);
  };
  const h = flatten(carved, rockXZ[0], rockXZ[1], 2, 6);
  const noise2 = makeNoise2D(9);
  group.add(makeTerrain({ size: 1500, seg: 230, heightFn: h, colorFn: snowColorFn(noise2, { rock: '#6a6f80', rockSlope: 0.32, low: '#6f6a64', lowLine: 3 }) }));
  // stream ribbon
  const sp = []; for (let x = -160; x <= 260; x += 2) sp.push(V(x, 0, river(x)));
  const curve = new THREE.CatmullRomCurve3(sp);
  const N = 210, W = 2.6;
  const rpos = [], ruv = [], ridx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N; const p = curve.getPointAt(t); const tg = curve.getTangentAt(t);
    const nx = -tg.z, nz = tg.x;
    for (const side of [-1, 1]) { const x = p.x + nx * W * side, z = p.z + nz * W * side; rpos.push(x, h(x, z) + 0.12, z); ruv.push(side * 0.5 + 0.5, t * 60); }
    if (i < N) { const a = i * 2; ridx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); rg.setIndex(ridx);
  const streamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]),
    vertexShader: `#include <fog_pars_vertex>
      varying vec2 vUv; void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      uniform float time; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        float edge = smoothstep(0.0,0.25,vUv.x)*smoothstep(1.0,0.75,vUv.x);
        vec2 q = vec2(vUv.x*8.0, vUv.y - time*2.2);
        float w = sin(q.y*3.0 + sin(q.x*2.0))*0.5+0.5;
        vec3 c = mix(vec3(0.06,0.14,0.25), vec3(0.25,0.45,0.65), w*0.6);
        vec2 cell = floor(vec2(vUv.x*14.0, vUv.y*3.0 - time*4.0));
        float g = step(0.93, h(cell)) * (0.5+0.5*sin(time*12.0 + h(cell+3.1)*40.0));
        c += vec3(1.0,0.95,0.8)*g*1.6;
        gl_FragColor = vec4(c, edge*0.92);
        #include <fog_fragment>
      }`,
  });
  streamMat.fog = true;
  group.add(new THREE.Mesh(rg, streamMat));
  // boulders
  const rockG = rockGeometry(4, 0.8, 0);
  const rocks = scatter(ctx.q.trees * 420, [-200, -60, 260, 60], 33, (x, z) => Math.abs(z - river(x)) > 4.5 && Math.hypot(x - rockXZ[0], z - rockXZ[1]) > 7 && near(x, z).d > 3, (r) => 0.4 + Math.pow(r(), 3) * 3.5);
  group.add(instancedRocks(rockG, rocks.map((p) => ({ ...p, dy: -p.h * 0.15 })), h));
  // the mossy boulder carrying the Pleione
  const mossRock = new THREE.Mesh(rockGeometry(8, 0.0, 0.95), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const rh = h(rockXZ[0], rockXZ[1]);
  mossRock.scale.set(2.2, 1.6, 2.0); mossRock.position.set(rockXZ[0], rh - 0.3, rockXZ[1]);
  group.add(mossRock);
  const opos = V(rockXZ[0] + 0.1, rh - 0.3 + 1.6 * 0.62, rockXZ[1] + 0.2);
  const reveal = createReveal('pleione', { pos: opos, rotY: 0.5, moss: false });
  group.add(reveal.group);
  // scrub junipers on the lower slopes
  const jun = treeGeometry('juniper', 8, 0.5);
  group.add(instancedTrees(jun, scatter(ctx.q.trees * 260, [-200, -150, 260, 150], 44, (x, z) => { const dz = Math.abs(z - river(x)); return dz > 16 && dz < 70 && near(x, z).d > 10; }, (r) => 2 + r() * 3), h));
  // sea of clouds the sleigh rises out of + valley mist
  const cl = [];
  const r = mulberry32(5);
  for (let i = 0; i < 70; i++) cl.push({ pos: V(-420 + r() * 330, 52 + r() * 22, -140 + r() * 280), size: 90 + r() * 110, aspect: 0.35 });
  for (let i = 0; i < 18; i++) cl.push({ pos: V(-60 + r() * 300, 14 + r() * 20, river(0) - 60 + r() * 120), size: 50 + r() * 50, aspect: 0.3 });
  const clouds = createMist(cl, { color: '#c9d4f2', opacity: 0.55, seed: 21 });
  group.add(clouds.group);

  const rel = relFn(path);
  const of = reveal.focus();
  const camera = keyCam([
    { t: 0, pos: rel(4, -4, -15), target: rel(0, 2, 12), fov: 52 },
    { t: 2.8, pos: rel(-14, 5, -12), target: rel(0, 1, 6), fov: 50 },
    { t: 5.6, pos: rel(7, 3, -10), target: rel(0, 0.5, 6), fov: 50 },
    { t: 7.4, pos: () => of.clone().add(V(2.2, 1.0, 3.2).multiplyScalar(CK)), target: () => of.clone().add(V(-0.5, 0.6, -1.5)), fov: 44, near: 0.05 },
    { t: 8.7, pos: () => of.clone().add(V(0.9, 0.3, 1.45).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.0, 0)), fov: 38, near: 0.05 },
    { t: 10, pos: () => of.clone().add(V(0.6, 0.2, 1.05).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.02, 0)), fov: 36, near: 0.05 },
  ]);
  return {
    name: 'Himalayas', group, path, reveal, camera,
    caption: { region: 'THE HIMALAYAS', species: 'Pleione humilis', common: '', at: [8.0, 8.7, 9.7, 10.2] },
    revealWindow: [7.2, 8.4, 11, 12],
    env: { fog: '#22305a', fogDensity: 0.0026, palette: { top: '#050c28', mid: '#14275a', horizon: '#3b5288', glow: '#6a7fd0', glowAmt: 0.4 },
      aurora: 0.35, auroraYaw: 0.6, moonDir: V(-0.5, 0.45, -0.6), snow: 0.35, hemi: 1.05, moon: 1.4 },
    update(s, t) { clouds.update(t, 1); streamMat.uniforms.time.value = t; },
  };
}

// ---------------- 3. Japan (globe interlude + alpine) ----------------
function japan(ctx) {
  const group = new THREE.Group(); group.name = 'japan';
  // --- globe interlude ---
  const globe = new THREE.Group();
  globe.position.set(0, 4000, 0);
  const R = 100;
  const earthMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, emissive: '#0a1430', emissiveIntensity: 0.6 });
  if (ctx.earthTexture) earthMat.map = ctx.earthTexture;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), earthMat);
  globe.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 64, 48), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(vec3(0.35,0.6,1.0)*f*1.6, f); }`,
  }));
  globe.add(atmo);
  const ll = (lat, lon, r = R) => { const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180; return V(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)); };
  const A = ll(28, 86), B = ll(36.5, 137.7);
  const arcPts = []; for (let i = 0; i <= 60; i++) { const t = i / 60; const p = A.clone().lerp(B, t).normalize().multiplyScalar(R * (1.02 + Math.sin(Math.PI * t) * 0.12)); arcPts.push(p); }
  const arcCurve = new THREE.CatmullRomCurve3(arcPts);
  const arcGeo = new THREE.TubeGeometry(arcCurve, 120, 0.45, 8, false);
  const arc = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: '#ffd47a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  earth.add(arc);
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffdd88', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  spark.scale.set(14, 14, 1); earth.add(spark);
  group.add(globe);

  // --- alpine Japan ---
  const alp = new THREE.Group(); group.add(alp);
  const noise = makeNoise2D(303);
  const path = new FlightPath([[-260, 128, 70], [-190, 118, 40], [-120, 100, 12], [-50, 82, -6], [10, 62, 0], [60, 44, 12], [100, 34, 20], [135, 32, 34], [170, 34, 52]], { s0: 1.2, s1: 11.2 });
  const near = nearestOnPath(path);
  const sOrchid = 8.8;
  const opp = path.pointAt(sOrchid);
  const ledge = [opp.x + 2, opp.z - 6.5];
  const raw = (x, z) => 190 * Math.pow(ridged(noise, x / 200, z / 200, 5), 1.5) + 15 * fbm(noise, x / 50, z / 50, 3) - 10;
  const carved = (x, z) => { const r = raw(x, z); const { d, y } = near(x, z); return Math.min(r, y - 14 + d * 0.75); };
  // raise a cliff ledge for the orchid just below the path
  const ledgeH = opp.y - 9.5;
  const withLedge = (x, z) => { const base = carved(x, z); const d = Math.hypot(x - ledge[0], z - ledge[1]); return lerp(ledgeH, base, smoothstep(2.5, 9, d)); };
  const h = withLedge;
  group.userData.h = h;
  alp.add(makeTerrain({ size: 1500, seg: 230, heightFn: h, colorFn: snowColorFn(makeNoise2D(31), { rock: '#5d6272', rockSlope: 0.42 }) }));
  const fir = treeGeometry('fir', 5, 0.9);
  alp.add(instancedTrees(fir, scatter(ctx.q.trees * 900, [-500, -400, 500, 300], 55, (x, z) => { const hh = h(x, z); const nd = near(x, z); return hh < 120 && nd.d > 8 && Math.hypot(x - ledge[0], z - ledge[1]) > 5; }, (r) => 3 + r() * 5), h));
  const wetRock = new THREE.Mesh(rockGeometry(12, 0.15, 0.85), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  wetRock.scale.set(2.4, 1.3, 1.8); wetRock.position.set(ledge[0], ledgeH - 0.4, ledge[1]);
  alp.add(wetRock);
  const opos = V(ledge[0] + 0.2, ledgeH - 0.4 + 1.3 * 0.6, ledge[1] + 0.35);
  const reveal = createReveal('ponerorchis', { pos: opos, rotY: 0.3, glow: '#ffd2ec', moss: false });
  alp.add(reveal.group);
  const mr = mulberry32(77);
  const mist = createMist(Array.from({ length: 50 }, () => ({ pos: V(-300 + mr() * 600, 20 + mr() * 70, -300 + mr() * 450), size: 70 + mr() * 90, aspect: 0.3 })), { color: '#c4cff0', opacity: 0.5, seed: 33 });
  alp.add(mist.group);

  const rel = relFn(path);
  const of = reveal.focus();
  const gc = (x, y, z) => () => globe.position.clone().add(V(x, y, z));
  const camera = keyCam([
    { t: 0, pos: gc(-60, 150, 260), target: gc(0, 20, 0), fov: 42 },
    { t: 2.2, pos: gc(-10, 110, 200), target: gc(0, 40, 20), fov: 40 },
    { t: 2.21, pos: rel(-28, 12, -24), target: rel(0, 0, 10), fov: 52 },
    { t: 4.6, pos: rel(9, -1.5, -13), target: rel(0, 1, 8), fov: 50 },
    { t: 6.6, pos: rel(2, 5, -13), target: rel(0, 0.5, 4), fov: 50 },
    { t: 7.6, pos: () => of.clone().add(V(-1.8, 1.4, 3.4).multiplyScalar(CK)), target: () => of.clone().add(V(0.5, 1.3, -2)), fov: 46, near: 0.05 },
    { t: 8.8, pos: () => of.clone().add(V(-0.7, 0.25, 1.4).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.05, 0)), fov: 38, near: 0.05 },
    { t: 10, pos: () => of.clone().add(V(-0.45, 0.2, 1.05).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.08, 0)), fov: 36, near: 0.05 },
  ]);
  return {
    name: 'Japan', group, path, reveal, camera,
    caption: { region: 'THE JAPANESE ALPS', species: 'Ponerorchis graminifolia', common: '', at: [8.1, 8.8, 9.7, 10.2], regionAt: 2.4 },
    revealWindow: [7.4, 8.6, 11, 12],
    hideTeamBefore: 2.2,
    env: { fog: '#24345e', fogDensity: 0.0028, palette: { top: '#060b26', mid: '#152858', horizon: '#3c5590', glow: '#c78fd8', glowAmt: 0.25 },
      aurora: 0.2, auroraYaw: -0.4, moonDir: V(0.3, 0.5, -0.8), snow: 0.45, hemi: 1.0, moon: 1.3 },
    envAt(s, env) { if (s < 2.2) { env.fogDensity = 0; env.snow = 0; env.aurora = 0; env.moonDir = V(0.8, 0.3, 0.5); env.palette = { top: '#01030c', mid: '#020617', horizon: '#06102c', glow: '#3060c0', glowAmt: 0.15 }; } return env; },
    update(s, t) {
      const g = s < 2.2;
      globe.visible = g; alp.visible = !g;
      if (g) {
        earth.rotation.y = 2.45 + s * 0.07;
        const p = seg(s, 0.1, 2.0);
        arc.geometry.setDrawRange(0, Math.floor(arcGeo.index.count * p / 6) * 6);
        arcCurve.getPointAt(Math.max(0.001, p), spark.position);
        spark.material.opacity = 0.6 + 0.4 * Math.sin(t * 10);
      }
      mist.update(t, 1);
    },
  };
}

// ---------------- 4. Pacific Northwest ----------------
function pacificNW(ctx) {
  const group = new THREE.Group(); group.name = 'pnw';
  const noise = makeNoise2D(404);
  const path = new FlightPath([[-170, 52, 40], [-110, 44, 10], [-60, 34, -14], [-10, 26, 4], [35, 18, 18], [75, 11, 8], [110, 8, -10], [140, 8, -32]], { s0: -1, s1: 11 });
  const near = nearestOnPath(path);
  const sOrchid = 8.5;
  const opp = path.pointAt(sOrchid);
  const oxz = [opp.x + 2.5, opp.z + 5.5];
  const h = flatten((x, z) => 3.5 * fbm(noise, x / 60, z / 60, 4) + 6 * fbm(noise, x / 300, z / 300, 2), oxz[0], oxz[1], 1.5, 5);
  const floorCol = (x, z, y, slope, out) => {
    const n = fbm(noise, x / 12, z / 12, 3) * 0.5 + 0.5;
    out.set('#2b3a26').lerp(new THREE.Color('#4a4030'), n * 0.6);
    const snow = smoothstep(0.55, 0.7, fbm(noise, x / 25 + 9, z / 25, 3) * 0.5 + 0.5);
    out.lerp(new THREE.Color('#cfd9ec'), snow * 0.8);
  };
  group.add(makeTerrain({ size: 1200, seg: 160, heightFn: h, colorFn: floorCol }));
  const giant = treeGeometry('giant', 9, 0.25);
  const trees = scatter(ctx.q.trees * 900, [-450, -350, 450, 350], 66, (x, z) => near(x, z).d > 8.5 && Math.hypot(x - oxz[0], z - oxz[1]) > 6, (r) => 50 + r() * 35);
  for (const [dx, dz, hh] of [[-6, -4, 70], [5, -7, 64], [-2, -11, 75]]) trees.push({ x: oxz[0] + dx, z: oxz[1] + dz, h: hh, rot: dx, w: hh * 0.95 });
  group.add(instancedTrees(giant, trees.map((t) => ({ ...t, w: t.h * (0.85 + (t.rot % 0.3)) })), h));
  // mossy fallen logs
  const logs = new THREE.Group();
  const lr = mulberry32(3);
  const logMat = new THREE.MeshLambertMaterial({ color: '#3f4a2f' });
  for (let i = 0; i < 40; i++) {
    const x = -200 + lr() * 400, z = -150 + lr() * 300;
    if (near(x, z).d < 4 || Math.hypot(x - oxz[0], z - oxz[1]) < 5) continue;
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 8 + lr() * 10, 8), logMat);
    l.rotation.set(Math.PI / 2, 0, lr() * Math.PI); l.position.set(x, h(x, z) + 0.4, z); logs.add(l);
  }
  group.add(logs);
  const opos = V(oxz[0], h(oxz[0], oxz[1]), oxz[1]);
  const reveal = createReveal('cephalanthera', { pos: opos, rotY: -0.4, glow: '#f4f6ff', mossColors: ['#3d4a2b', '#5a5338', '#6b7d48'], rimColor: '#34402b', haloSize: 2.8 });
  group.add(reveal.group);
  const mr = mulberry32(88);
  const mist = createMist(Array.from({ length: 90 }, () => ({ pos: V(-250 + mr() * 500, 3 + mr() * 55, -200 + mr() * 400), size: 30 + mr() * 50, aspect: 0.5 })), { color: '#b8c8e8', opacity: 0.42, seed: 44 });
  group.add(mist.group);

  const rel = relFn(path);
  const of = reveal.focus();
  const camera = keyCam([
    { t: 0, pos: rel(3, 0, 16), target: rel(0, 1, 0), fov: 50 },
    { t: 2.8, pos: rel(-8, 1.5, -2), target: rel(0, 1, 3), fov: 52 },
    { t: 5.2, pos: rel(0, 5, -15), target: rel(0, 0, 8), fov: 55 },
    { t: 7.0, pos: () => of.clone().add(V(1.6, 1.8, -3.8).multiplyScalar(CK)), target: () => of.clone().add(V(-0.5, 0.6, 1.5)), fov: 46, near: 0.05 },
    { t: 8.4, pos: () => of.clone().add(V(0.8, 0.25, -1.7).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.05, 0)), fov: 40, near: 0.05 },
    { t: 10, pos: () => of.clone().add(V(0.55, 0.15, -1.25).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.1, 0)), fov: 38, near: 0.05 },
  ]);
  return {
    name: 'Pacific Northwest', group, path, reveal, camera,
    caption: { region: 'THE PACIFIC NORTHWEST', species: 'Cephalanthera austiniae', common: 'Phantom orchid', at: [7.9, 8.6, 9.7, 10.2] },
    revealWindow: [6.8, 8.0, 11, 12],
    env: { fog: '#2a3a5e', fogDensity: 0.0105, palette: { top: '#0a1230', mid: '#1b2b58', horizon: '#3d5084', glow: '#8fa6e0', glowAmt: 0.3 },
      aurora: 0.25, auroraYaw: 0.3, moonDir: V(-0.4, 0.6, -0.6), snow: 0.3, hemi: 1.15, moon: 1.1 },
    update(s, t) { mist.update(t, 1); },
  };
}

// ---------------- 5. Northern Rockies ----------------
function rockies(ctx) {
  const group = new THREE.Group(); group.name = 'rockies';
  const noise = makeNoise2D(505);
  const path = new FlightPath([[-260, 105, -20], [-180, 92, -6], [-110, 70, 4], [-50, 46, 0], [5, 28, -6], [55, 17, 0], [95, 13, 12], [130, 14, 28]], { s0: -1, s1: 11 });
  const near = nearestOnPath(path);
  const sOrchid = 8.3;
  const opp = path.pointAt(sOrchid);
  const oxz = [opp.x - 2, opp.z - 7];
  const raw = (x, z) => {
    const dz = Math.abs(z);
    const wall = smoothstep(30, 200, dz);
    return wall * (40 + 260 * Math.pow(ridged(noise, x / 240, z / 240, 5), 1.5)) + 5 * fbm(noise, x / 50, z / 50, 3);
  };
  const carved = (x, z) => { const r = raw(x, z); const { d, y } = near(x, z); return Math.min(r, y - 11 + d * 0.8); };
  const h = flatten(carved, oxz[0], oxz[1], 1.5, 5);
  group.add(makeTerrain({ size: 1500, seg: 230, heightFn: h, colorFn: snowColorFn(makeNoise2D(51), { rock: '#5f6676', rockSlope: 0.45 }) }));
  const cedar = treeGeometry('cedar', 13, 0.95);
  const trees = scatter(ctx.q.trees * 1700, [-500, -350, 500, 350], 77, (x, z) => { const nd = near(x, z); return h(x, z) < 150 && (nd.d > 12 || nd.y - h(x, z) > 30) && Math.hypot(x - oxz[0], z - oxz[1]) > 13; }, (r) => 12 + r() * 14);
  for (const [dx, dz, hh] of [[-6, -8, 22], [6, -9, 25], [0, -13, 20], [-11, -3, 18]]) trees.push({ x: oxz[0] + dx, z: oxz[1] + dz, h: hh, rot: dz, w: hh * 0.8 });
  group.add(instancedTrees(cedar, trees, h));
  const opos = V(oxz[0], h(oxz[0], oxz[1]), oxz[1]);
  const reveal = createReveal('goodyera', { pos: opos, rotY: 0.1, glow: '#e8ffd8', mossColors: ['#36532d', '#4f6e36', '#5d4a33'] });
  group.add(reveal.group);
  const mr = mulberry32(99);
  const mist = createMist(Array.from({ length: 40 }, () => ({ pos: V(-300 + mr() * 600, 10 + mr() * 50, -160 + mr() * 320), size: 60 + mr() * 80, aspect: 0.3 })), { color: '#c0ccec', opacity: 0.4, seed: 55 });
  group.add(mist.group);

  const rel = relFn(path);
  const of = reveal.focus();
  const ob = opos.clone();
  const camera = keyCam([
    { t: 0, pos: rel(-34, 20, -30), target: rel(0, 0, 10), fov: 50 },
    { t: 3.4, pos: rel(8, 2, -9), target: rel(0, 1, 5), fov: 50 },
    { t: 5.4, pos: rel(-3, 3, -10), target: rel(0, -1, 6), fov: 50 },
    { t: 6.7, pos: () => ob.clone().add(V(1.6, 3.2, 3.2)), target: () => ob.clone().add(V(0, 0.2, 0)), fov: 46, near: 0.05 },
    { t: 7.8, pos: () => ob.clone().add(V(0.4, 0.8, 0.55).multiplyScalar(CK)), target: () => ob.clone().add(V(0, 0.03, 0)), fov: 42, near: 0.05 },
    { t: 9.2, pos: () => ob.clone().add(V(0.55, 0.45, 1.25).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.05, 0)), fov: 40, near: 0.05 },
    { t: 10, pos: () => ob.clone().add(V(0.5, 0.4, 1.15).multiplyScalar(CK)), target: () => of.clone().add(V(0, 0.08, 0)), fov: 40, near: 0.05 },
  ]);
  return {
    name: 'Northern Rockies', group, path, reveal, camera,
    caption: { region: 'THE NORTHERN ROCKIES', species: 'Goodyera oblongifolia', common: 'Western rattlesnake plantain', at: [7.9, 8.5, 9.7, 10.2] },
    revealWindow: [6.6, 7.8, 11, 12],
    env: { fog: '#24325a', fogDensity: 0.0045, palette: { top: '#060c28', mid: '#142656', horizon: '#3a5088', glow: '#45c9a0', glowAmt: 0.35 },
      aurora: 0.6, auroraYaw: -0.2, moonDir: V(0.5, 0.5, -0.7), snow: 1.0, hemi: 1.05, moon: 1.3 },
    update(s, t) { mist.update(t, 1); },
  };
}

// ---------------- 6. Finale: the Snow Orchids constellation ----------------
function finale(ctx) {
  const group = new THREE.Group(); group.name = 'finale';
  const noise = makeNoise2D(606);
  const path = new FlightPath([[0, 70, 160], [0, 92, 80], [0, 118, 0], [0, 150, -90], [0, 190, -190], [0, 240, -300]], { s0: -1, s1: 11, bank: 0 });
  const h = (x, z) => -160 + 230 * Math.pow(ridged(noise, x / 300, z / 300, 5), 1.6) + 10 * fbm(noise, x / 60, z / 60, 3);
  group.add(makeTerrain({ size: 3000, seg: 160, heightFn: h, colorFn: snowColorFn(makeNoise2D(61), { rock: '#4f5568', rockSlope: 0.45 }) }));
  const r = mulberry32(6);
  const clouds = createMist(Array.from({ length: 60 }, () => ({ pos: V(-700 + r() * 1400, -30 + r() * 30, -600 + r() * 900), size: 160 + r() * 160, aspect: 0.3 })), { color: '#aebde6', opacity: 0.5, seed: 66 });
  group.add(clouds.group);

  // ring of six luminous orchids around the sleigh
  const kinds = ['calypso', 'pleione', 'ponerorchis', 'cephalanthera', 'goodyera', 'myrosmodes'];
  const tints = ['#ffb3d9', '#ffe6f0', '#f0a6ff', '#f2f6ff', '#d8ffd0', '#ffe2b0'];
  const ring = new THREE.Group(); group.add(ring);
  const items = kinds.map((k, i) => {
    const b = ORCHIDS[k]();
    const target = 2.2; // metres tall in the sky
    const sc = target / b.group.userData.height;
    b.group.scale.setScalar(sc);
    const holder = new THREE.Group(); holder.add(b.group);
    b.group.position.y = -target * 0.5;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: tints[i], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(5, 5, 1); holder.add(halo);
    ring.add(holder);
    return { b, holder, halo, tint: tints[i], appear: 0.9 + i * 0.45 };
  });
  // constellation lines (closed hexagon + star to centre) drawn progressively
  const lineCount = 6;
  const linePos = new Float32Array(lineCount * 2 * 3);
  const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: '#ffd77a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeo, lineMat); lines.frustumCulled = false; group.add(lines);
  // thicker glowing beads travelling along the lines
  const beadGeo = new THREE.BufferGeometry(); const beadN = 240; beadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(beadN * 3), 3));
  const beads = new THREE.Points(beadGeo, new THREE.PointsMaterial({ color: '#ffe3a0', size: 0.35, map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  beads.frustumCulled = false; group.add(beads);

  const rel = relFn(path);
  const pose = { pos: V(0, 0, 0), quat: new THREE.Quaternion() };
  const camera = keyCam([
    { t: 0, pos: rel(3, -5, -13), target: rel(0, 2, 8), fov: 50 },
    { t: 2.6, pos: rel(-15, 3, -9), target: rel(0, 0.5, 1), fov: 54 },
    { t: 5.4, pos: rel(0, 3.5, -19), target: rel(0, 2, 6), fov: 52 },
    { t: 10, pos: rel(0, 2, -34, 6), target: rel(0, 6, 40), fov: 50 },
  ]);
  const tmp = V(0, 0, 0), tmp2 = V(0, 0, 0);
  return {
    name: 'The Snow Orchids', group, path, camera, reveal: null,
    caption: { region: '', species: '', at: null },
    env: { fog: '#1b2650', fogDensity: 0.0012, palette: { top: '#030820', mid: '#0b1a48', horizon: '#2c4478', glow: '#3de0a8', glowAmt: 0.7 },
      aurora: 1.5, auroraYaw: 0, moonDir: V(0.7, 0.3, -0.6), snow: 0.25, hemi: 0.9, moon: 1.0 },
    update(s, t, pxScale) {
      clouds.update(t, 1);
      path.pointAt(s, 0, pose.pos);
      // ring centre trails the sleigh, then the constellation lifts away into the sky
      const lift = smoother(seg(s, 5.0, 8.5));
      ring.position.copy(pose.pos).add(V(0, 1 + lift * 60, -lift * 30));
      ring.rotation.y = s * 0.25;
      const radius = 7 + lift * 18;
      const pts = [];
      items.forEach((it, i) => {
        const a = i / items.length * Math.PI * 2;
        const k = smoother(seg(s, it.appear, it.appear + 1.0));
        it.holder.position.set(Math.cos(a) * radius, Math.sin(s * 1.3 + i) * 0.4 + Math.sin(a * 2) * 1.2, Math.sin(a) * radius);
        it.holder.scale.setScalar(Math.max(0.0001, k * (1 + lift * 1.5)));
        it.holder.rotation.y = -s * 0.25 + Math.PI / 2 - a;
        setGlow(it.b, 0.5 * k + 0.15 * Math.sin(t * 3 + i) * k, it.tint);
        it.halo.material.opacity = 0.65 * k;
        it.holder.updateMatrixWorld(true);
        pts.push(it.holder.getWorldPosition(V(0, 0, 0)));
      });
      // constellation
      const lp = smoother(seg(s, 3.6, 5.6));
      for (let i = 0; i < lineCount; i++) {
        const a = pts[i], b = pts[(i + 1) % lineCount];
        const local = clamp(lp * lineCount - i);
        tmp.copy(a); tmp2.copy(a).lerp(b, local);
        linePos.set([tmp.x, tmp.y, tmp.z, tmp2.x, tmp2.y, tmp2.z], i * 6);
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineMat.opacity = 0.9 * smoothstep(3.5, 4.0, s) * (1 - 0.5 * smoothstep(5.6, 7.0, s));
      const bp = beadGeo.attributes.position.array;
      for (let j = 0; j < beadN; j++) {
        const li = j % lineCount; const f = ((j / beadN) * 7 + t * 0.35) % 1;
        const local = clamp(lp * lineCount - li);
        tmp.copy(pts[li]).lerp(pts[(li + 1) % lineCount], f * local);
        bp.set([tmp.x, tmp.y, tmp.z], j * 3);
      }
      beadGeo.attributes.position.needsUpdate = true;
      beads.material.opacity = 0.9 * smoothstep(3.6, 4.2, s);
      beads.material.size = 0.35 * (1 + lift * 2);
    },
  };
}
