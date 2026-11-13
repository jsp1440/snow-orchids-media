// Procedural, stylized-but-morphologically-faithful orchid models.
// Built in centimetres; callers scale the returned group.
//
// Morphology notes (from standard floras; stylized, not measured specimens):
//  Calypso bulbosa      – single nodding flower on a short scape, one basal ovate leaf;
//                         narrow pink-magenta sepals/petals fanned upward; slipper-shaped
//                         pouch lip with brown-orange spotting and a pale-haired apron.
//  Pleione humilis      – flask-shaped pseudobulbs on mossy rock, flower solitary and
//                         appearing while leafless; white, faintly blushed narrow tepals;
//                         tubular lip with crimson-brown spotting and a fringed margin.
//  Ponerorchis graminifolia – 2–3 grass-like leaves; raceme of rose-purple flowers; hood of
//                         dorsal sepal+petals, spreading lateral sepals, deeply 3-lobed lip
//                         (bifid mid-lobe) spotted at the base, curved spur.
//  Cephalanthera austiniae – leafless, entirely white "phantom orchid": white stem with
//                         sheathing bracts, raceme of half-open white flowers with a yellow
//                         lip centre.
//  Goodyera oblongifolia – rosette of dark blue-green leaves with a white midvein stripe and
//                         pale reticulation; downy spike of small greenish-white flowers in a
//                         loose spiral.
//  Myrosmodes (Andean)  – rosette of fleshy leaves flat on the ground; short, dense spike
//                         of brown scarious bracts with tiny whitish flowers.
import * as THREE from 'three';
import { mulberry32, hash1 } from './util.js';
import { goodyeraLeafTexture } from './textures.js';

const col = (h) => new THREE.Color(h);

// Parametric petal/leaf surface along +Y, width on X, cup/curl toward +Z.
export function petalGeometry({ len = 2, wid = 0.6, p = 0.7, q = 0.9, cup = 0.15, curl = 0.0, twist = 0, fringe = 0, segU = 18, segV = 8, colorFn }) {
  const pos = [], colors = [], uvs = [], idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= segU; i++) {
    const u = i / segU;
    const w = wid * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, p))), q) + 0.002;
    for (let j = 0; j <= segV; j++) {
      const v = j / segV * 2 - 1;
      let ww = w;
      if (fringe && Math.abs(v) > 0.8) ww *= 1 + fringe * (Math.sin(u * 90) * 0.5 + 0.5) * (Math.abs(v) - 0.8) * 5;
      let x = v * ww;
      let z = cup * wid * v * v + curl * len * u * u;
      let y = len * u;
      if (twist) { const a = twist * u; const cx = x * Math.cos(a) - z * Math.sin(a); z = x * Math.sin(a) + z * Math.cos(a); x = cx; }
      pos.push(x, y, z);
      uvs.push(j / segV, u);
      if (colorFn) colorFn(u, v, c); else c.set('#ffffff');
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = i * (segV + 1) + j, b = a + segV + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeMat(o = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: o.vc ?? true, color: o.color ?? '#ffffff', side: THREE.DoubleSide, roughness: o.r ?? 0.55, metalness: 0, emissive: o.emissive ?? '#ffffff', emissiveIntensity: 0, map: o.map ?? null });
}

class Builder {
  constructor() { this.group = new THREE.Group(); this.mats = []; }
  mat(o) { const m = makeMat(o); this.mats.push(m); return m; }
  add(geo, mat, { pos = [0, 0, 0], rot = [0, 0, 0], parent = this.group, scale } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos); m.rotation.set(...rot, 'ZXY');
    if (scale) m.scale.set(...scale);
    parent.add(m); return m;
  }
  // flower part placed with rotation around flower axis (Z) and tilt toward front (X)
  part(geo, mat, parent, angleZ, tiltX, offset = [0, 0, 0]) {
    const pivot = new THREE.Group();
    pivot.rotation.set(tiltX, 0, angleZ, 'ZXY');
    pivot.position.set(...offset);
    pivot.add(new THREE.Mesh(geo, mat));
    parent.add(pivot); return pivot;
  }
  stem(points, r0, r1, color, parent = this.group) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const g = new THREE.TubeGeometry(curve, 24, 1, 7, false);
    // taper
    const P = g.attributes.position, segs = 24, rad = 7;
    const centre = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs; curve.getPointAt(t, centre);
      const r = r0 + (r1 - r0) * t;
      for (let j = 0; j <= rad; j++) {
        const k = i * (rad + 1) + j; if (k >= P.count) continue;
        v.set(P.getX(k), P.getY(k), P.getZ(k)).sub(centre).multiplyScalar(r).add(centre);
        P.setXYZ(k, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    const m = this.mat({ vc: false, color });
    const mesh = new THREE.Mesh(g, m); parent.add(mesh);
    return curve;
  }
}

const spotted = (base, spotCol, density, thresh, region = () => 1) => (u, v, c) => {
  c.copy(base);
  const s = Math.sin(u * density * 1.7 + Math.sin(v * 5) * 2) * Math.sin(v * density * 0.9 + u * 3);
  if (s > thresh && region(u, v) > 0.5) c.lerp(spotCol, 0.85);
};

// ---------------- Calypso bulbosa ----------------
export function calypso() {
  const b = new Builder();
  const pink = col('#d9549b'), pinkLight = col('#f19cc8');
  const tepal = b.mat();
  const tepalGeo = (l, w) => petalGeometry({ len: l, wid: w, p: 0.55, q: 1.1, cup: 0.25, curl: -0.12, colorFn: (u, v, c) => c.copy(pink).lerp(pinkLight, 0.4 * (1 - Math.abs(v)) + 0.2 * u) });
  // leaf: single basal ovate, pleated
  const leafMat = b.mat();
  const leaf = petalGeometry({ len: 5, wid: 1.9, p: 0.75, q: 0.8, cup: 0.12, curl: 0.05, segV: 12, colorFn: (u, v, c) => c.set('#2f5d34').lerp(col('#4f7f45'), 0.5 + 0.5 * Math.cos(v * 9)) });
  b.add(leaf, leafMat, { pos: [0, 0.2, 0], rot: [-1.35, 0, 0.4] });
  // scape
  b.stem([[0, 0, 0], [0.1, 4, 0.1], [0.2, 8, 0.4], [0.3, 10.5, 1.3]], 0.16, 0.11, '#7a3b4d');
  const flower = new THREE.Group(); flower.position.set(0.3, 10.6, 1.5); flower.rotation.x = 0.35; b.group.add(flower);
  // sepals + petals: five narrow segments fanned upward
  const fan = [[0, -0.15, 2.3], [0.55, -0.1, 2.2], [-0.55, -0.1, 2.2], [1.05, 0.05, 2.0], [-1.05, 0.05, 2.0]];
  for (const [a, tilt, l] of fan) b.part(tepalGeo(l, 0.28), tepal, flower, a, tilt);
  // column: broad pinkish hood over the lip
  const colGeo = petalGeometry({ len: 1.1, wid: 0.55, p: 0.6, q: 0.8, cup: 0.5, curl: 0.35, colorFn: (u, v, c) => c.set('#f3b6d4').lerp(col('#ffffff'), u * 0.3) });
  b.part(colGeo, b.mat(), flower, Math.PI, -1.25, [0, 0.0, 0.0]).rotation.y = Math.PI;
  // lip pouch (slipper)
  const pouchGeo = new THREE.SphereGeometry(1, 28, 18);
  const pp = pouchGeo.attributes.position; const pc = []; const cc = new THREE.Color();
  const pouchBase = col('#f6d9cf'), pouchSpot = col('#b4532c');
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    // taper the back into a slipper toe that splits into two small horns
    const toe = Math.max(0, z);
    pp.setXYZ(i, x * (0.55 - toe * 0.18), y * 0.48 - toe * toe * 0.25, z * 1.15);
    cc.copy(pouchBase);
    const s = Math.sin(x * 11 + z * 3) * Math.sin(z * 9 - y * 5);
    if (y < 0.35 && s > 0.15) cc.lerp(pouchSpot, 0.75);
    if (y < -0.2) cc.lerp(col('#e79a5a'), 0.35);
    pc.push(cc.r, cc.g, cc.b);
  }
  pouchGeo.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
  pouchGeo.computeVertexNormals();
  const pouch = new THREE.Mesh(pouchGeo, b.mat({ r: 0.4 })); pouch.position.set(0, -0.9, 1.15); pouch.rotation.x = -0.15; flower.add(pouch);
  // apron (lip lamina) with magenta spots and the pale hairy beard
  const apronGeo = petalGeometry({ len: 1.2, wid: 0.7, p: 0.5, q: 0.7, cup: -0.15, curl: 0.0, colorFn: spotted(col('#fbf3f6'), col('#c7307a'), 14, 0.55) });
  const apron = new THREE.Mesh(apronGeo, b.mat()); apron.rotation.x = Math.PI / 2 - 0.25; apron.position.set(0, -0.48, 0.5); flower.add(apron);
  const hairMat = b.mat({ vc: false, color: '#fff8e2' });
  const rng = mulberry32(4);
  for (let i = 0; i < 26; i++) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.28, 4), hairMat);
    h.position.set((rng() - 0.5) * 0.55, -0.38 + rng() * 0.08, 0.75 + rng() * 0.55);
    h.rotation.set(-0.3 + rng() * 0.6, 0, (rng() - 0.5) * 0.8);
    flower.add(h);
  }
  const yellow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), b.mat({ vc: false, color: '#f2c94c' })); yellow.position.set(0, -0.36, 0.95); yellow.scale.set(1.6, 0.6, 2.2); flower.add(yellow);
  b.group.userData = { height: 13, name: 'Calypso bulbosa' };
  return b;
}

// ---------------- Pleione humilis ----------------
export function pleione() {
  const b = new Builder();
  // flask-shaped pseudobulbs (lathe)
  const bulbPts = [[0, 0], [1.1, 0.3], [1.5, 1.2], [1.3, 2.2], [0.7, 3.0], [0.35, 3.9], [0.3, 4.4], [0, 4.5]].map(([x, y]) => new THREE.Vector2(x, y));
  const bulbGeo = new THREE.LatheGeometry(bulbPts, 18);
  const bulbMat = b.mat({ vc: false, color: '#5d7d3a', r: 0.35 });
  b.add(bulbGeo, bulbMat, { pos: [0, 0, 0] });
  b.add(bulbGeo, bulbMat, { pos: [-2.6, -0.2, -1.2], scale: [0.85, 0.85, 0.85], rot: [0, 0, 0.12] });
  // single flower on a short scape emerging from the base (leafless at flowering)
  b.stem([[0.9, 0.2, 0.8], [1.3, 2.5, 1.6], [1.4, 4.5, 2.2], [1.5, 6.0, 2.9]], 0.18, 0.14, '#7c5a5e');
  const flower = new THREE.Group(); flower.position.set(1.5, 6.1, 3.0); flower.rotation.x = 0.25; b.group.add(flower);
  const white = col('#fbf8fa'), blush = col('#f3d6e6');
  const tepalMat = b.mat();
  const tg = (l, w) => petalGeometry({ len: l, wid: w, p: 0.6, q: 0.85, cup: 0.18, curl: -0.08, colorFn: (u, v, c) => c.copy(white).lerp(blush, 0.5 * u * (0.5 + 0.5 * Math.abs(v))) });
  for (const [a, l] of [[0, 4.2], [1.15, 4.0], [-1.15, 4.0], [2.25, 3.9], [-2.25, 3.9]]) b.part(tg(l, 0.55), tepalMat, flower, a, -0.15);
  // tubular lip: lathe funnel, fringed and spotted at the open end
  const lipPts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; lipPts.push(new THREE.Vector2(0.35 + Math.pow(t, 1.6) * 1.35, t * 3.6)); }
  const lipGeo = new THREE.LatheGeometry(lipPts, 40, -Math.PI * 0.85, Math.PI * 1.7);
  const lp = lipGeo.attributes.position, lc = []; const cc = new THREE.Color();
  const spot = col('#a3203e');
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i);
    const a = Math.atan2(z, x); const t = y / 3.6;
    // fringe: ragged margin at the mouth
    const fr = t > 0.88 ? 1 + 0.18 * Math.max(0, Math.sin(a * 46)) : 1;
    lp.setXYZ(i, x * fr, y + (t > 0.9 ? Math.sin(a * 46) * 0.12 : 0), z * fr);
    cc.copy(white);
    const s = Math.sin(a * 14 + y * 4) * Math.sin(y * 7.5);
    if (t > 0.35 && s > 0.3) cc.lerp(spot, 0.85);
    if (t > 0.3 && t < 0.8 && Math.abs(Math.sin(a * 3)) < 0.12) cc.lerp(col('#f4e3a0'), 0.7); // keels
    lc.push(cc.r, cc.g, cc.b);
  }
  lipGeo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  lipGeo.computeVertexNormals();
  const lip = new THREE.Mesh(lipGeo, b.mat()); lip.rotation.x = Math.PI / 2 + 0.35; lip.rotation.z = Math.PI; lip.position.set(0, -0.2, -0.3);
  flower.add(lip);
  b.group.userData = { height: 11, name: 'Pleione humilis' };
  return b;
}

// ---------------- Ponerorchis graminifolia ----------------
export function ponerorchis() {
  const b = new Builder();
  const leafMat = b.mat();
  const leafGeo = (l, curl) => petalGeometry({ len: l, wid: 0.32, p: 0.35, q: 0.7, cup: 0.4, curl, segU: 24, segV: 4, colorFn: (u, v, c) => c.set('#3d6b3a').lerp(col('#5f8f4c'), u * 0.5) });
  b.add(leafGeo(12, 0.25), leafMat, { rot: [0.25, 0.4, 0.2] });
  b.add(leafGeo(10, 0.32), leafMat, { rot: [0.35, -2.2, -0.25] });
  b.add(leafGeo(8, 0.3), leafMat, { rot: [0.3, 2.4, 0.15] });
  const stemCurve = b.stem([[0, 0, 0], [0.2, 6, 0.2], [0.3, 12, 0.5], [0.4, 18, 0.7]], 0.12, 0.08, '#5b7d43');
  const rose = col('#c34ca0'), roseLight = col('#e7a0d4'), dark = col('#6e1557');
  const pm = b.mat();
  const hoodGeo = petalGeometry({ len: 0.75, wid: 0.32, p: 0.6, q: 0.8, cup: 0.4, curl: 0.35, colorFn: (u, v, c) => c.copy(rose).lerp(roseLight, 0.3) });
  const latGeo = petalGeometry({ len: 0.8, wid: 0.28, p: 0.55, q: 0.9, cup: 0.2, curl: -0.1, colorFn: (u, v, c) => c.copy(rose).lerp(roseLight, 0.4 * u) });
  // deeply 3-lobed lip, mid-lobe notched (bifid); spots at the base
  const lipGeo = petalGeometry({ len: 1.1, wid: 0.75, p: 0.45, q: 0.5, cup: -0.05, curl: 0.05, segV: 16, colorFn: (u, v, c) => {
    c.copy(rose).lerp(roseLight, 0.2);
    const s = Math.sin(u * 30 + v * 6) * Math.sin(v * 18);
    if (u < 0.45 && s > 0.35) c.lerp(dark, 0.85);
  } });
  { // carve lobes: pull sinuses inward between lateral and mid lobes, and notch the mid-lobe tip
    const P = lipGeo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i);
      const u = y / 1.1, side = Math.abs(x);
      let k = 1;
      if (u > 0.45 && u < 0.62) k = 0.55;           // sinus between lobes
      if (u > 0.85 && side < 0.12) P.setY(i, y - 0.15); // bifid apex
      P.setX(i, x * k);
    }
    lipGeo.computeVertexNormals();
  }
  const spurGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0, 0, 0], [0, -0.2, -0.5], [0, -0.7, -0.8], [0, -1.2, -0.75]].map((p) => new THREE.Vector3(...p))), 12, 0.07, 6, false);
  const spurMat = b.mat({ vc: false, color: '#d27bb8' });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = 0.62 + i / n * 0.36;
    const p = stemCurve.getPointAt(t);
    const f = new THREE.Group();
    const az = i * 2.2 + 0.4;
    f.position.copy(p).add(new THREE.Vector3(Math.cos(az) * 0.55, 0, Math.sin(az) * 0.55));
    f.rotation.y = az + Math.PI / 2; f.rotation.x = 0.15;
    const s = 0.95 - i * 0.04; f.scale.setScalar(s);
    b.part(hoodGeo, pm, f, 0, -0.35);                 // dorsal sepal + petals (hood)
    b.part(hoodGeo, pm, f, 0.35, -0.3);
    b.part(hoodGeo, pm, f, -0.35, -0.3);
    b.part(latGeo, pm, f, 1.7, 0.1);                 // spreading lateral sepals
    b.part(latGeo, pm, f, -1.7, 0.1);
    b.part(lipGeo, pm, f, Math.PI, 0.45, [0, -0.1, 0.05]); // lip hanging forward-down
    f.add(new THREE.Mesh(spurGeo, spurMat));
    b.group.add(f);
  }
  b.group.userData = { height: 20, name: 'Ponerorchis graminifolia' };
  return b;
}

// ---------------- Cephalanthera austiniae ----------------
export function cephalanthera() {
  const b = new Builder();
  const curve = b.stem([[0, 0, 0], [0.3, 10, 0.1], [0.2, 20, 0.4], [0.1, 30, 0.2]], 0.32, 0.18, '#f4f1ea');
  const white = col('#fbfbf7'), ivory = col('#efeadb');
  const sheathMat = b.mat();
  const sheath = petalGeometry({ len: 4, wid: 0.9, p: 0.5, q: 0.7, cup: 0.9, curl: 0.15, colorFn: (u, v, c) => c.copy(ivory).lerp(white, u) });
  for (let i = 0; i < 4; i++) {
    const p = curve.getPointAt(0.05 + i * 0.13);
    b.add(sheath, sheathMat, { pos: [p.x, p.y, p.z], rot: [0.15, i * 2.4, 0] });
  }
  const tm = b.mat({ r: 0.45 });
  const tep = petalGeometry({ len: 1.3, wid: 0.42, p: 0.55, q: 0.85, cup: 0.45, curl: 0.25, colorFn: (u, v, c) => c.copy(white).lerp(ivory, 0.3 * (1 - u)) });
  const lip = petalGeometry({ len: 0.9, wid: 0.45, p: 0.5, q: 0.7, cup: 0.3, curl: 0.3, colorFn: (u, v, c) => { c.copy(white); if (u > 0.3 && u < 0.8 && Math.abs(v) < 0.45) c.lerp(col('#f2cf3c'), 0.85); } });
  const brM = b.mat();
  const bract = petalGeometry({ len: 1.2, wid: 0.3, p: 0.5, q: 0.8, cup: 0.3, colorFn: (u, v, c) => c.copy(ivory) });
  const n = 11;
  for (let i = 0; i < n; i++) {
    const t = 0.52 + i / n * 0.46;
    const p = curve.getPointAt(t);
    const az = i * 2.4;
    const f = new THREE.Group();
    f.position.copy(p).add(new THREE.Vector3(Math.cos(az) * 0.6, 0, Math.sin(az) * 0.6));
    f.rotation.y = az + Math.PI / 2; f.rotation.x = -0.35;
    f.scale.setScalar(1 - i * 0.03);
    // half-open: tepals converge forward
    for (const [a, tilt] of [[0, 0.55], [1.2, 0.5], [-1.2, 0.5], [2.4, 0.45], [-2.4, 0.45]]) b.part(tep, tm, f, a, tilt);
    b.part(lip, tm, f, Math.PI, 0.7, [0, -0.05, 0.1]);
    b.part(bract, brM, f, Math.PI * 0.95, -0.4, [0, -0.1, -0.2]);
    b.group.add(f);
  }
  b.group.userData = { height: 32, name: 'Cephalanthera austiniae' };
  return b;
}

// ---------------- Goodyera oblongifolia ----------------
export function goodyera() {
  const b = new Builder();
  const tex = goodyeraLeafTexture();
  const leafMat = b.mat({ vc: false, map: tex, r: 0.5 });
  const leafGeo = petalGeometry({ len: 6.5, wid: 1.6, p: 0.7, q: 0.75, cup: 0.12, curl: 0.06, segV: 10 });
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + 0.3;
    const pivot = new THREE.Group(); pivot.rotation.y = a; b.group.add(pivot);
    const m = new THREE.Mesh(leafGeo, leafMat); m.rotation.x = 1.25 - (i % 2) * 0.12; m.position.y = 0.3; m.scale.setScalar(0.85 + (i % 3) * 0.1);
    pivot.add(m);
  }
  const curve = b.stem([[0, 0, 0], [0.1, 9, 0.1], [0.3, 18, 0.2], [0.2, 26, 0.3]], 0.22, 0.12, '#7d8f6a');
  // downy scape: short hairs
  const hairM = b.mat({ vc: false, color: '#c8d1b2' });
  const flM = b.mat();
  const tep = petalGeometry({ len: 0.55, wid: 0.22, p: 0.55, q: 0.8, cup: 0.5, curl: 0.3, colorFn: (u, v, c) => c.set('#eef2df').lerp(col('#c9d6a8'), 0.4 * (1 - u)) });
  const pouch = new THREE.SphereGeometry(0.16, 10, 8);
  const rng = mulberry32(21);
  const nf = 26;
  for (let i = 0; i < nf; i++) {
    const t = 0.45 + i / nf * 0.53;
    const p = curve.getPointAt(t);
    const az = i * 0.55; // loose spiral
    const f = new THREE.Group();
    f.position.copy(p).add(new THREE.Vector3(Math.cos(az) * 0.32, 0, Math.sin(az) * 0.32));
    f.rotation.y = az + Math.PI / 2; f.rotation.x = 0.1;
    for (const [a, tilt] of [[0, 0.5], [1.4, 0.3], [-1.4, 0.3]]) b.part(tep, flM, f, a, tilt);
    const pm = new THREE.Mesh(pouch, hairM); pm.position.set(0, -0.15, 0.15); pm.scale.set(1, 0.8, 1.4); f.add(pm);
    b.group.add(f);
  }
  for (let i = 0; i < 60; i++) {
    const p = curve.getPointAt(0.2 + rng() * 0.75);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 3), hairM);
    const a = rng() * Math.PI * 2;
    h.position.set(p.x + Math.cos(a) * 0.15, p.y, p.z + Math.sin(a) * 0.15); h.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
    b.group.add(h);
  }
  b.group.userData = { height: 27, name: 'Goodyera oblongifolia' };
  return b;
}

// ---------------- Myrosmodes (high-Andean rosette orchid) ----------------
export function myrosmodes() {
  const b = new Builder();
  const lm = b.mat({ r: 0.35 });
  const leaf = petalGeometry({ len: 3.6, wid: 1.6, p: 1.25, q: 0.6, cup: 0.35, curl: 0.05, segV: 10, colorFn: (u, v, c) => c.set('#7fa64e').lerp(col('#b7cf7a'), 0.4 * u).lerp(col('#a26a3c'), u > 0.92 ? 0.4 : 0) });
  for (let ring = 0; ring < 2; ring++) {
    const n = ring ? 6 : 8;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + ring * 0.4;
      const pv = new THREE.Group(); pv.rotation.y = a; b.group.add(pv);
      const m = new THREE.Mesh(leaf, lm); m.rotation.x = ring ? 1.0 : 1.42; m.scale.setScalar(ring ? 0.7 : 1); pv.add(m);
    }
  }
  b.stem([[0, 0, 0], [0, 1.5, 0], [0, 3, 0]], 0.45, 0.4, '#d9d4bf');
  // dense spike: spiral of overlapping brown bracts with tiny white flowers between
  const bractM = b.mat({ r: 0.7 });
  const bract = petalGeometry({ len: 0.75, wid: 0.45, p: 0.6, q: 0.8, cup: 0.5, curl: 0.25, colorFn: (u, v, c) => c.set('#8a5a32').lerp(col('#d2b48a'), Math.abs(v) * 0.5 + u * 0.2) });
  const fm = b.mat({ vc: false, color: '#fbf8ef' });
  const tiny = new THREE.SphereGeometry(0.13, 8, 6);
  const N = 70;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const y = 2.6 + t * 3.2;
    const r = 0.95 * Math.sin(Math.PI * (0.15 + t * 0.85)) * (1 - t * 0.35) + 0.15;
    const a = i * 2.39996;
    const g = new THREE.Group(); g.position.set(Math.cos(a) * r, y, Math.sin(a) * r); g.rotation.y = -a + Math.PI / 2; b.group.add(g);
    const bm = new THREE.Mesh(bract, bractM); bm.rotation.x = -0.9; g.add(bm);
    if (hash1(i) > 0.3) { const f = new THREE.Mesh(tiny, fm); f.position.set(0, 0.3, 0.25); f.scale.set(1, 0.7, 1); g.add(f); }
  }
  b.group.userData = { height: 6, name: 'Myrosmodes' };
  return b;
}

export const ORCHIDS = { calypso, pleione, ponerorchis, cephalanthera, goodyera, myrosmodes };

// Emissive glow control for reveals/finale
export function setGlow(builder, amount, color = '#ffe6b0') {
  for (const m of builder.mats) { m.emissive.set(color); m.emissiveIntensity = amount; }
}
