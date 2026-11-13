// Sky dome, twinkling stars, moon and animated aurora curtains.
// The whole rig follows the camera so it always reads as infinitely far away.
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { glowTexture } from './textures.js';

const NOISE_GLSL = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;

export function createSky() {
  const rig = new THREE.Group();
  rig.name = 'skyRig';

  // --- gradient dome ---
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color('#050b24') },
      mid: { value: new THREE.Color('#0d1f4a') },
      horizon: { value: new THREE.Color('#2a3f6e') },
      glowDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
      glowColor: { value: new THREE.Color('#3a8f7a') },
      glowAmt: { value: 0.35 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top, mid, horizon, glowColor, glowDir; uniform float glowAmt; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(horizon, mid, smoothstep(-0.05, 0.25, h));
        c = mix(c, top, smoothstep(0.25, 0.9, h));
        float g = pow(max(dot(normalize(vDir), glowDir), 0.0), 3.0);
        c += glowColor * g * glowAmt * smoothstep(-0.1, 0.4, h);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), domeMat);
  dome.renderOrder = -10;
  rig.add(dome);

  // --- stars ---
  const rng = mulberry32(11);
  const N = 2600;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2;
    const y = Math.abs(u) * 0.97 + 0.03; // upper hemisphere bias
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * r * 3500, y * 3500, Math.sin(th) * r * 3500], i * 3);
    seed[i] = rng() * 100;
    size[i] = Math.pow(rng(), 5) * 7 + 1.5;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { time: { value: 0 }, opacity: { value: 1 }, pxScale: { value: 1 } },
    vertexShader: `attribute float seed; attribute float size; uniform float time; uniform float pxScale; varying float vA;
      void main(){ vA = 0.55 + 0.45*sin(time*(1.5+fract(seed)*2.5) + seed*6.0);
        gl_PointSize = size * pxScale; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float opacity; varying float vA;
      void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); float a = smoothstep(0.5,0.0,r); a = a*a;
        gl_FragColor = vec4(vec3(0.85,0.9,1.0)*1.3, a*vA*opacity); }`,
  });
  const stars = new THREE.Points(sg, starMat);
  stars.renderOrder = -9;
  rig.add(stars);

  // --- moon ---
  const moon = new THREE.Group();
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { opacity: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: NOISE_GLSL + `uniform float opacity; varying vec2 vUv; void main(){ vec2 p=vUv-0.5; float r=length(p);
      float n = fbm(vUv*6.0); vec3 c = mix(vec3(1.0,0.97,0.88), vec3(0.78,0.8,0.86), smoothstep(0.45,0.75,n));
      float a = smoothstep(0.5,0.48,r); gl_FragColor = vec4(c*1.25, a*opacity); }`,
  }));
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#9fb6ff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  moonGlow.scale.set(520, 520, 1);
  moon.add(moonGlow, moonDisc);
  rig.add(moon);

  // --- aurora curtains ---
  const auroraMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { time: { value: 0 }, intensity: { value: 1 }, seed: { value: 0 },
      colA: { value: new THREE.Color('#38ffb0') }, colB: { value: new THREE.Color('#7a5cff') }, colC: { value: new THREE.Color('#ff5ca8') } },
    vertexShader: NOISE_GLSL + `uniform float time; uniform float seed; varying vec2 vUv; varying float vFold;
      void main(){ vUv = uv; vec3 p = position;
        float f = fbm(vec2(uv.x*3.0 + seed, time*0.05)) - 0.5;
        p.z += f * 900.0 + sin(uv.x*9.0 + time*0.35 + seed)*120.0;
        p.y += sin(uv.x*5.0 + time*0.2)*60.0;
        vFold = f;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
    fragmentShader: NOISE_GLSL + `uniform float time; uniform float intensity; uniform float seed; uniform vec3 colA, colB, colC;
      varying vec2 vUv; varying float vFold;
      void main(){
        float x = vUv.x, y = vUv.y;
        float rays = fbm(vec2(x*60.0 + seed, time*0.25)) ;
        rays = pow(rays, 1.6) * 1.8;
        float band = fbm(vec2(x*4.0 - time*0.04 + seed*3.0, 1.7));
        band = smoothstep(0.35, 0.75, band);
        float bottom = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.08, 0.95, y));
        float edge = smoothstep(0.0, 0.06, x) * smoothstep(1.0, 0.94, x);
        vec3 col = mix(colA, colB, smoothstep(0.25, 0.85, y));
        col = mix(col, colC, smoothstep(0.65, 1.0, y) * 0.6);
        col += colA * smoothstep(0.12, 0.0, y) * 0.8;
        float a = rays * band * bottom * edge * intensity * (0.75 + vFold);
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const aurora = new THREE.Group();
  const curtains = [];
  const specs = [
    { w: 5200, h: 900, x: 0, y: 380, z: -2300, ry: 0.0, seed: 1.3 },
    { w: 4200, h: 760, x: -900, y: 560, z: -2700, ry: 0.35, seed: 7.1 },
    { w: 3800, h: 640, x: 1400, y: 300, z: -1900, ry: -0.45, seed: 13.7 },
  ];
  for (const s of specs) {
    const m = auroraMat.clone();
    m.uniforms.seed.value = s.seed;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h, 160, 1), m);
    mesh.geometry.translate(0, s.h / 2, 0);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.ry;
    mesh.renderOrder = -8;
    aurora.add(mesh);
    curtains.push(mesh);
  }
  rig.add(aurora);

  const state = {
    rig, dome, stars, moon, aurora,
    setPalette(p) {
      domeMat.uniforms.top.value.set(p.top);
      domeMat.uniforms.mid.value.set(p.mid);
      domeMat.uniforms.horizon.value.set(p.horizon);
      domeMat.uniforms.glowColor.value.set(p.glow || '#3a8f7a');
      domeMat.uniforms.glowAmt.value = p.glowAmt ?? 0.35;
    },
    update(t, camera, opts) {
      rig.position.copy(camera.position);
      starMat.uniforms.time.value = t;
      starMat.uniforms.opacity.value = opts.stars ?? 1;
      starMat.uniforms.pxScale.value = opts.pxScale ?? 1;
      aurora.rotation.y = opts.auroraYaw ?? 0;
      aurora.position.y = opts.auroraY ?? 0;
      for (const c of curtains) {
        c.material.uniforms.time.value = t;
        c.material.uniforms.intensity.value = opts.aurora ?? 1;
      }
      aurora.visible = (opts.aurora ?? 1) > 0.001;
      const md = opts.moonDir;
      moon.visible = !!md;
      if (md) {
        moon.position.copy(md).normalize().multiplyScalar(3000);
        moon.lookAt(camera.position);
        moonDisc.material.uniforms.opacity.value = opts.moon ?? 1;
        moonGlow.material.opacity = 0.5 * (opts.moon ?? 1);
      }
      const g = domeMat.uniforms.glowDir.value;
      g.set(Math.sin(opts.auroraYaw ?? 0) * -1, 0.25, -Math.cos(opts.auroraYaw ?? 0)).normalize();
    },
  };
  return state;
}
