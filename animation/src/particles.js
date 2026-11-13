// Snow, golden magic trail, rising motes and drifting mist — all deterministic
// functions of the timeline time t.
import * as THREE from 'three';
import { mulberry32, hash1 } from './util.js';
import { sparkleTexture, mistTexture } from './textures.js';

let _sparkTex;
const sparkTex = () => (_sparkTex ||= sparkleTexture());

// ---------- Snow: a wrapped box of flakes around the camera (GPU-animated) ----------
export function createSnow(count = 9000) {
  const rng = mulberry32(5);
  const box = new THREE.Vector3(140, 70, 140);
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([rng() * box.x, rng() * box.y, rng() * box.z], i * 3);
    rnd[i] = rng();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() }, box: { value: box },
      wind: { value: new THREE.Vector2(2.0, 0.5) }, amount: { value: 1 }, pxScale: { value: 1 }, tint: { value: new THREE.Color('#dfe9ff') } },
    vertexShader: `attribute float rnd; uniform float time; uniform vec3 cam; uniform vec3 box; uniform vec2 wind; uniform float amount; uniform float pxScale;
      varying float vA;
      void main(){
        float fall = 1.6 + rnd*1.8;
        vec3 p = position + vec3(wind.x*time + sin(time*0.7 + rnd*40.0)*1.5, -fall*time, wind.y*time + cos(time*0.6+rnd*30.0)*1.5);
        p = mod(p - cam + box*0.5, box) - box*0.5 + cam;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        float d = -mv.z;
        vA = (step(rnd, amount)) * smoothstep(0.4, 2.0, d) * (1.0 - smoothstep(40.0, 68.0, d));
        gl_PointSize = pxScale * (0.6 + rnd*1.2) * 160.0 / max(d, 0.5);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 tint; varying float vA; void main(){ float r = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.1,r)*vA*0.9; if(a<0.01) discard; gl_FragColor = vec4(tint, a); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return {
    object: pts,
    update(t, camera, amount, pxScale) {
      mat.uniforms.time.value = t;
      mat.uniforms.cam.value.copy(camera.position);
      mat.uniforms.amount.value = amount;
      mat.uniforms.pxScale.value = pxScale;
      pts.visible = amount > 0.001;
    },
  };
}

// ---------- Sparkle points material (shared) ----------
function sparkMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { map: { value: sparkTex() }, pxScale: { value: 1 } },
    vertexShader: `attribute float size; attribute vec3 color; attribute float alpha; uniform float pxScale; varying vec3 vC; varying float vA;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.0);
        gl_PointSize = pxScale * size * 300.0 / max(-mv.z, 0.1); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC*t.rgb*1.6, t.a*vA); }`,
  });
}

function pointsBuffers(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}

// ---------- Golden trail behind the sleigh ----------
// Particles are tied to absolute emission slots k (not to their age), so each
// grain keeps its own drift as time advances and scrubbing is exact.
export function createTrail(n = 700) {
  const g = pointsBuffers(n);
  const mat = sparkMaterial();
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  const P = g.attributes.position.array, C = g.attributes.color.array, S = g.attributes.size.array, A = g.attributes.alpha.array;
  const dt = 1 / 60, life = n * dt;
  const gold = new THREE.Color('#ffcf6b'), white = new THREE.Color('#fff6e0'), rose = new THREE.Color('#ffb0d0');
  const tmp = new THREE.Vector3(), c = new THREE.Color();
  return {
    object: pts,
    // emitterAt(time) -> {pos: Vector3, valid: bool} : world position of the sleigh's tail at that global time
    update(t, emitterAt, strength, pxScale) {
      mat.uniforms.pxScale.value = pxScale;
      const k0 = Math.floor(t / dt);
      for (let i = 0; i < n; i++) {
        const k = k0 - i;
        const te = k * dt, age = t - te;
        const e = emitterAt(te, tmp);
        const h1 = hash1(k * 3 + 1), h2 = hash1(k * 3 + 2), h3 = hash1(k * 3 + 3);
        if (!e || te < 0) { A[i] = 0; continue; }
        const spread = 0.25 + age * 0.55;
        P[i * 3] = tmp.x + (h1 - 0.5) * spread * 2;
        P[i * 3 + 1] = tmp.y + (h2 - 0.5) * spread - age * 0.6;
        P[i * 3 + 2] = tmp.z + (h3 - 0.5) * spread * 2;
        const life01 = age / life;
        const tw = 0.6 + 0.4 * Math.sin(t * 9 + k);
        A[i] = strength * Math.pow(1 - life01, 1.5) * tw * Math.min(1, age * 8);
        S[i] = (0.06 + h2 * 0.16) * (1 - life01 * 0.5);
        c.copy(gold).lerp(h1 > 0.85 ? rose : white, h3 * 0.5);
        C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
      }
      g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = g.attributes.alpha.needsUpdate = true;
      pts.visible = strength > 0.001;
    },
  };
}

// ---------- Rising motes around a point (orchid reveals) ----------
export function createMotes(n = 160, color = '#ffd98a') {
  const g = pointsBuffers(n);
  const mat = sparkMaterial();
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  const P = g.attributes.position.array, C = g.attributes.color.array, S = g.attributes.size.array, A = g.attributes.alpha.array;
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) { C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; }
  return {
    object: pts,
    setColor(hex) { col.set(hex); for (let i = 0; i < n; i++) { C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; } g.attributes.color.needsUpdate = true; },
    update(t, center, radius, height, strength, pxScale) {
      mat.uniforms.pxScale.value = pxScale;
      for (let i = 0; i < n; i++) {
        const h = hash1(i * 7 + 11), h2 = hash1(i * 13 + 5), h3 = hash1(i * 17 + 3);
        const period = 2.5 + h * 2.5;
        const ph = ((t / period) + h2) % 1;
        const ang = h3 * Math.PI * 2 + t * (0.3 + h * 0.4);
        const r = radius * (0.2 + 0.8 * Math.sqrt(h2)) * (1 - ph * 0.4);
        P[i * 3] = center.x + Math.cos(ang) * r;
        P[i * 3 + 1] = center.y + ph * height;
        P[i * 3 + 2] = center.z + Math.sin(ang) * r;
        A[i] = strength * Math.sin(ph * Math.PI) * (0.6 + 0.4 * Math.sin(t * 7 + i));
        S[i] = radius * (0.012 + h * 0.03);
      }
      g.attributes.position.needsUpdate = g.attributes.size.needsUpdate = g.attributes.alpha.needsUpdate = true;
      pts.visible = strength > 0.001;
    },
  };
}

// ---------- Mist banks: soft billboards placed in a region ----------
export function createMist(placements, { color = '#c8d6ff', opacity = 0.5, seed = 9 } = {}) {
  const tex = mistTexture(seed);
  const group = new THREE.Group();
  const items = [];
  const rng = mulberry32(seed);
  for (const p of placements) {
    const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: opacity * (0.6 + rng() * 0.4), depthWrite: false, fog: true });
    const s = new THREE.Sprite(m);
    s.position.copy(p.pos);
    s.scale.set(p.size, p.size * (p.aspect ?? 0.45), 1);
    s.material.rotation = (rng() - 0.5) * 0.3;
    s.renderOrder = 4;
    group.add(s);
    items.push({ s, base: p.pos.clone(), speed: (rng() - 0.5) * 2, baseOp: m.opacity });
  }
  return {
    group,
    update(t, fade = 1) {
      for (const it of items) {
        it.s.position.x = it.base.x + it.speed * t;
        it.s.material.opacity = it.baseOp * fade;
      }
    },
  };
}
