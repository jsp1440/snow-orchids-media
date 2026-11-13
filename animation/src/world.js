// Flight paths, terrain, forests and rocks.
import * as THREE from 'three';
import { mulberry32, clamp } from './util.js';

// ---------- Flight path with arc-length parameterisation and banking ----------
export class FlightPath {
  // points: array of [x,y,z]; local scene time s in [s0,s1] maps linearly onto the curve.
  constructor(points, { s0 = -1, s1 = 11, bank = 1 } = {}) {
    this.curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    this.len = this.curve.getLength();
    this.s0 = s0; this.s1 = s1; this.bank = bank;
    this._f = new THREE.Vector3(); this._f2 = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }
  uAt(s) { return clamp((s - this.s0) / (this.s1 - this.s0)); }
  speed() { return this.len / (this.s1 - this.s0); }
  pointAt(s, aheadMetres = 0, out = new THREE.Vector3()) {
    const u = this.uAt(s) + aheadMetres / this.len;
    return this.curve.getPointAt(clamp(u), out);
  }
  poseAt(s, aheadMetres, out) {
    const u = clamp(this.uAt(s) + aheadMetres / this.len, 0, 0.9999);
    this.curve.getPointAt(u, out.pos);
    const f = this.curve.getTangentAt(u, this._f).normalize();
    const f2 = this.curve.getTangentAt(clamp(u + 0.01, 0, 1), this._f2).normalize();
    // turn rate around world-up -> bank angle
    const turn = (f.x * f2.z - f.z * f2.x);
    const roll = clamp(-turn * 40 * this.bank, -0.55, 0.55);
    const up = this._u.set(0, 1, 0);
    const right = this._r.crossVectors(up, f).normalize();
    up.crossVectors(f, right).normalize();
    this._m.makeBasis(right, up, f);
    out.quat.setFromRotationMatrix(this._m);
    out.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    return out;
  }
}

// ---------- Terrain ----------
// heightFn(x,z) -> y ; colorFn(x,z,y,slope,out:Color)
export function makeTerrain({ size = 1200, seg = 220, heightFn, colorFn, center = [0, 0] }) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(center[0], 0, center[1]);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightFn(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorFn(p.getX(i), p.getZ(i), p.getY(i), 1 - n.getY(i), c);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = false;
  return m;
}

// ---------- Trees ----------
// Merge simple primitives into one BufferGeometry with vertex colours.
function mergeColored(parts) {
  let count = 0; for (const { g } of parts) count += g.index ? g.index.count : g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const { g, color } of parts) {
    const gg = g.index ? g.toNonIndexed() : g;
    gg.computeVertexNormals();
    const P = gg.attributes.position, N = gg.attributes.normal;
    for (let i = 0; i < P.count; i++, o++) {
      pos.set([P.getX(i), P.getY(i), P.getZ(i)], o * 3);
      nor.set([N.getX(i), N.getY(i), N.getZ(i)], o * 3);
      const c = typeof color === 'function' ? color(P.getX(i), P.getY(i), P.getZ(i), N.getY(i)) : color;
      col.set([c.r, c.g, c.b], o * 3);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const C = (h) => new THREE.Color(h);
// tree types: spruce (Lapland), fir (Japan, small), giant (PNW Douglas-fir/hemlock), cedar (Rockies, drooping), juniper (Himalaya scrub)
export function treeGeometry(type, seed = 1, snowAmt = 0.6) {
  const rng = mulberry32(seed);
  const parts = [];
  const trunkCol = C(type === 'giant' ? '#4a3426' : '#3b2a20');
  const needle = { spruce: C('#1d3b2e'), fir: C('#1f4232'), giant: C('#1e3a2c'), cedar: C('#24412e'), juniper: C('#2d4434') }[type];
  const needleLight = needle.clone().offsetHSL(0.02, 0.05, 0.08);
  const snow = C('#e9f0ff');
  const cfg = {
    spruce: { h: 1, tiers: 7, base: 0.36, trunkH: 0.12, droop: 0.0 },
    fir: { h: 1, tiers: 6, base: 0.3, trunkH: 0.1, droop: 0.0 },
    giant: { h: 1, tiers: 9, base: 0.13, trunkH: 0.42, droop: 0.05 },
    cedar: { h: 1, tiers: 8, base: 0.3, trunkH: 0.08, droop: 0.12 },
    juniper: { h: 1, tiers: 4, base: 0.42, trunkH: 0.15, droop: 0 },
  }[type];
  const tr = { spruce: [0.012, 0.022], fir: [0.016, 0.028], giant: [0.02, 0.036], cedar: [0.016, 0.03], juniper: [0.03, 0.05] }[type];
  const trunk = new THREE.CylinderGeometry(tr[0], tr[1], 1, 7);
  trunk.translate(0, 0.5, 0);
  parts.push({ g: trunk, color: trunkCol });
  const crownStart = cfg.trunkH, crownH = 1 - cfg.trunkH;
  for (let i = 0; i < cfg.tiers; i++) {
    const f = i / cfg.tiers;
    const r = cfg.base * (1 - f * 0.85) * (0.9 + rng() * 0.2);
    const h = crownH / cfg.tiers * 2.1;
    const y = crownStart + f * crownH * 0.92;
    const cone = new THREE.ConeGeometry(r, h, 9, 1, true);
    const p = cone.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const yy = p.getY(k);
      if (yy < -h / 2 + 0.001) { // rim: jitter & droop
        const j = 0.85 + rng() * 0.35;
        p.setX(k, p.getX(k) * j); p.setZ(k, p.getZ(k) * j);
        p.setY(k, yy - cfg.droop * r * (0.5 + rng()));
      }
    }
    cone.rotateY(rng() * Math.PI);
    cone.translate(0, y + h / 2, 0);
    const y0 = y, y1 = y + h;
    parts.push({ g: cone, color: (x, yy, z, ny) => {
      const local = (yy - y0) / (y1 - y0);
      const sn = snowAmt * (local > 0.25 && local < 0.75 ? 1 : 0.35) * (0.6 + 0.4 * Math.sin(x * 40 + z * 33));
      return needle.clone().lerp(needleLight, local * 0.5).lerp(snow, Math.max(0, Math.min(1, sn)));
    } });
  }
  if (snowAmt > 0) {
    const cap = new THREE.ConeGeometry(cfg.base * 0.2, crownH / cfg.tiers * 1.4, 7);
    cap.translate(0, 1 - crownH / cfg.tiers * 0.6, 0);
    parts.push({ g: cap, color: snow });
  }
  return mergeColored(parts);
}

// Place instanced trees. placements: [{x,z,h,w,rot}] with ground height from heightFn.
export function instancedTrees(geometry, placements, heightFn, { variants = 1 } = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, mat, placements.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  placements.forEach((pl, i) => {
    p.set(pl.x, heightFn(pl.x, pl.z) - 0.3, pl.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot || 0);
    s.set(pl.w ?? pl.h * 0.9, pl.h, pl.w ?? pl.h * 0.9);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// Scatter helper: Poisson-ish random within bounds, rejecting by keep(x,z).
export function scatter(n, bounds, seed, keep, sizeFn) {
  const rng = mulberry32(seed);
  const out = [];
  let tries = 0;
  while (out.length < n && tries < n * 30) {
    tries++;
    const x = bounds[0] + rng() * (bounds[2] - bounds[0]);
    const z = bounds[1] + rng() * (bounds[3] - bounds[1]);
    if (keep && !keep(x, z, rng)) continue;
    const h = sizeFn ? sizeFn(rng, x, z) : 10 + rng() * 8;
    out.push({ x, z, h, rot: rng() * Math.PI * 2, w: h * (0.8 + rng() * 0.3) });
  }
  return out;
}

// Distance from (x,z) to a flight path's ground projection (sampled).
export function pathDistanceFn(path, samples = 200) {
  const pts = path.curve.getSpacedPoints(samples);
  return (x, z) => {
    let best = Infinity;
    for (const p of pts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; }
    return Math.sqrt(best);
  };
}

// ---------- Rocks ----------
export function rockGeometry(seed = 1, snowAmt = 0.5, mossAmt = 0) {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const offs = Array.from({ length: 6 }, () => [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, rng() * 0.35]);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    let k = 1;
    for (const [a, b, c, w] of offs) k += w * Math.max(0, v.x * a + v.y * b + v.z * c) * -0.5;
    v.multiplyScalar(k);
    v.y *= 0.65;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const rock = C('#59606e'), rockD = C('#3b404c'), snow = C('#edf3ff'), moss = C('#4d6b35');
  return mergeColored([{ g, color: (x, y, z, ny) => {
    let c = rockD.clone().lerp(rock, (Math.sin(x * 7 + z * 5) * 0.5 + 0.5));
    if (mossAmt > 0 && ny > -0.2 && y < 0.3) c.lerp(moss, mossAmt * (0.5 + 0.5 * Math.sin(x * 13 + z * 9)));
    if (ny > 0.55) c.lerp(snow, snowAmt);
    return c;
  } }]);
}

export function instancedRocks(geometry, placements, heightFn) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, mat, placements.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  placements.forEach((pl, i) => {
    p.set(pl.x, heightFn(pl.x, pl.z) + (pl.dy ?? 0), pl.z);
    e.set(0, pl.rot || 0, 0); q.setFromEuler(e);
    s.set(pl.h, pl.h * (pl.sy ?? 1), pl.h * (pl.sz ?? 1));
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.frustumCulled = false;
  return mesh;
}
