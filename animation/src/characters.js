// Stylized storybook Santa, sleigh and reindeer built entirely from procedural geometry.
// Models face +Z. Units: roughly metres.
import * as THREE from 'three';
import { hash1 } from './util.js';
import { glowTexture } from './textures.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.6, metalness: o.m ?? 0.0, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, flatShading: o.flat ?? false });

const M = {
  red: std('#b3122a', { r: 0.35, m: 0.15 }),
  deepRed: std('#7d0c1d', { r: 0.5 }),
  gold: std('#e0b04a', { r: 0.25, m: 0.85, e: '#5a3a08', ei: 0.35 }),
  fur: std('#f4f1ea', { r: 0.9 }),
  skin: std('#f0c3a2', { r: 0.7 }),
  cheek: std('#e8907e', { r: 0.7 }),
  dark: std('#1c1414', { r: 0.6 }),
  mitten: std('#1f4d33', { r: 0.8 }),
  belt: std('#1a1210', { r: 0.4 }),
  sack: std('#7a5a3c', { r: 0.95 }),
  deer: std('#7b5233', { r: 0.85 }),
  deerLight: std('#cfae84', { r: 0.9 }),
  deerLeg: std('#56391f', { r: 0.85 }),
  hoof: std('#231a14', { r: 0.5 }),
  antler: std('#dcc9a3', { r: 0.7 }),
  harness: std('#9a1022', { r: 0.4 }),
  giftA: std('#2f6fb3', { r: 0.5 }),
  giftB: std('#c9a227', { r: 0.4, m: 0.4 }),
  giftC: std('#2e8a57', { r: 0.5 }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }
function ellipsoid(r, sx, sy, sz, mat) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat); m.scale.set(sx, sy, sz); return m; }

// Cylinder spanning points a->b (used for straps, limbs, reins)
const _up = new THREE.Vector3(0, 1, 0);
export function makeStrap(radius, mat) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 6, 1, true);
  g.translate(0, 0.5, 0);
  return new THREE.Mesh(g, mat);
}
const _d = new THREE.Vector3();
export function setStrap(m, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / Math.max(len, 1e-5)));
  m.scale.set(1, len, 1);
}

// Map 2D profile (x = along length, y = height) into 3D (z, y) at lateral offset xo.
const to3 = (p, xo) => new THREE.Vector3(xo, p.y, p.x);

// ---------------- Sleigh + Santa ----------------
export function createSleigh() {
  const g = new THREE.Group();
  g.name = 'sleigh';

  // body profile
  const top = (path) => {
    path.quadraticCurveTo(1.62, 0.25, 1.68, 0.75);
    path.bezierCurveTo(1.74, 1.28, 1.32, 1.42, 1.18, 1.08);
    path.quadraticCurveTo(1.02, 0.74, 0.55, 0.82);
    path.lineTo(-0.55, 0.86);
    path.bezierCurveTo(-1.0, 0.92, -1.12, 1.72, -1.52, 1.66);
    path.quadraticCurveTo(-1.82, 1.6, -1.66, 1.05);
  };
  const shape = new THREE.Shape();
  shape.moveTo(-1.5, 0.22);
  shape.lineTo(1.05, 0.22);
  top(shape);
  shape.lineTo(-1.5, 0.22);
  const W = 1.34;
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 24 });
  bodyGeo.rotateY(-Math.PI / 2);
  bodyGeo.translate(W / 2, 0, 0);
  g.add(mesh(bodyGeo, M.red));
  // dark seat cushion
  const seat = mesh(new THREE.BoxGeometry(W - 0.12, 0.12, 1.3), M.deepRed, 0, 0.9, -0.35);
  g.add(seat);

  // gold trim along both top edges + scroll ornaments
  const trimPath = new THREE.Path();
  trimPath.moveTo(1.05, 0.22);
  top(trimPath);
  const pts2 = trimPath.getSpacedPoints(90);
  for (const xo of [-W / 2 - 0.05, W / 2 + 0.05]) {
    const curve = new THREE.CatmullRomCurve3(pts2.map((p) => to3(p, xo)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.045, 8, false), M.gold));
    // decorative scroll on the side panel
    const sc = [];
    for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 3.2; const r = 0.05 + i / 40 * 0.32; sc.push(new THREE.Vector3(xo * 1.01, 0.55 + Math.sin(a) * r * 0.8, 0.1 + Math.cos(a) * r)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sc), 80, 0.022, 6, false), M.gold));
  }

  // runners
  const runnerPts = [[-1.75, -0.12], [-1.6, -0.3], [-0.5, -0.32], [0.8, -0.32], [1.7, -0.3], [2.15, -0.1], [2.3, 0.25], [2.12, 0.5], [1.92, 0.42], [1.96, 0.26]];
  for (const xo of [-0.6, 0.6]) {
    const c = new THREE.CatmullRomCurve3(runnerPts.map(([z, y]) => new THREE.Vector3(xo, y, z)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 120, 0.055, 8, false), M.gold));
    for (const z of [-1.1, 0.0, 1.0]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), M.gold, xo, -0.05, z));
  }

  // ---- Santa ----
  const santa = new THREE.Group();
  santa.position.set(0, 0.9, -0.55);
  const torso = mesh(new THREE.CylinderGeometry(0.34, 0.48, 0.8, 24), M.red, 0, 0.4, 0);
  const belly = ellipsoid(0.44, 1, 0.95, 0.9, M.red); belly.position.set(0, 0.32, 0.12);
  const beltM = mesh(new THREE.TorusGeometry(0.455, 0.05, 8, 32), M.belt, 0, 0.3, 0.05); beltM.rotation.x = Math.PI / 2; beltM.scale.set(1, 0.92, 1);
  const buckle = mesh(new THREE.BoxGeometry(0.16, 0.12, 0.04), M.gold, 0, 0.3, 0.46);
  const furHem = mesh(new THREE.TorusGeometry(0.47, 0.07, 8, 32), M.fur, 0, 0.02, 0.04); furHem.rotation.x = Math.PI / 2;
  const furFront = mesh(new THREE.BoxGeometry(0.12, 0.7, 0.06), M.fur, 0, 0.42, 0.44);
  santa.add(torso, belly, beltM, buckle, furHem, furFront);
  const head = new THREE.Group(); head.position.set(0, 1.05, 0.02);
  const face = ellipsoid(0.23, 1, 1.05, 1, M.skin);
  const nose = mesh(new THREE.SphereGeometry(0.055, 12, 8), M.cheek, 0, 0.0, 0.22);
  const cheekL = mesh(new THREE.SphereGeometry(0.06, 12, 8), M.cheek, 0.12, -0.03, 0.17), cheekR = cheekL.clone(); cheekR.position.x = -0.12;
  const eyeL = mesh(new THREE.SphereGeometry(0.025, 8, 6), M.dark, 0.075, 0.07, 0.2), eyeR = eyeL.clone(); eyeR.position.x = -0.075;
  const browL = ellipsoid(0.05, 1.4, 0.5, 0.6, M.fur); browL.position.set(0.08, 0.12, 0.19); const browR = browL.clone(); browR.position.x = -0.08;
  const beard = ellipsoid(0.27, 1.05, 1.25, 0.75, M.fur); beard.position.set(0, -0.2, 0.1);
  const beardTip = mesh(new THREE.ConeGeometry(0.2, 0.35, 16), M.fur, 0, -0.45, 0.12); beardTip.rotation.x = Math.PI + 0.25;
  const mustL = ellipsoid(0.08, 1.6, 0.6, 0.7, M.fur); mustL.position.set(0.08, -0.06, 0.21); mustL.rotation.z = -0.35; const mustR = mustL.clone(); mustR.position.x = -0.08; mustR.rotation.z = 0.35;
  const hairBack = ellipsoid(0.24, 1.05, 0.8, 0.9, M.fur); hairBack.position.set(0, -0.05, -0.06);
  const hat = new THREE.Group(); hat.position.set(0, 0.17, -0.02); hat.rotation.x = -0.35;
  const hatCone = mesh(new THREE.ConeGeometry(0.235, 0.55, 20), M.red, 0, 0.27, 0); hatCone.rotation.z = 0.0;
  const hatRim = mesh(new THREE.TorusGeometry(0.225, 0.07, 10, 28), M.fur, 0, 0.0, 0); hatRim.rotation.x = Math.PI / 2;
  const pom = mesh(new THREE.SphereGeometry(0.08, 14, 10), M.fur, 0, 0.56, 0);
  hat.add(hatCone, hatRim, pom);
  head.add(hairBack, face, nose, cheekL, cheekR, eyeL, eyeR, browL, browR, beard, beardTip, mustL, mustR, hat);
  santa.add(head);
  // arms (shoulder -> hand), animated via update
  const armL = makeStrap(0.1, M.red), armR = makeStrap(0.1, M.red);
  const mitL = mesh(new THREE.SphereGeometry(0.1, 12, 8), M.mitten), mitR = mitL.clone();
  const cuffL = mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 16), M.fur), cuffR = cuffL.clone();
  santa.add(armL, armR, mitL, mitR, cuffL, cuffR);
  g.add(santa);

  // sack of gifts behind Santa
  const sackGeo = new THREE.SphereGeometry(0.6, 32, 20);
  const sp = sackGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const w = 1 + 0.08 * Math.sin(x * 9 + y * 5) + 0.06 * Math.sin(z * 11 - y * 7);
    sp.setXYZ(i, x * w, y * w * (y > 0 ? 1.15 : 0.9), z * w);
  }
  sackGeo.computeVertexNormals();
  const sack = mesh(sackGeo, M.sack, 0, 1.35, -1.25);
  g.add(sack);
  const gifts = [[0.18, 2.0, -1.2, 0.3, M.giftA, 0.3], [-0.22, 1.95, -1.35, 0.26, M.giftB, -0.4], [0.02, 2.1, -1.0, 0.22, M.giftC, 0.9]];
  for (const [x, y, z, s, m, r] of gifts) {
    const b = mesh(new THREE.BoxGeometry(s, s, s), m, x, y, z); b.rotation.set(0.2, r, 0.15);
    const rib = mesh(new THREE.BoxGeometry(s * 1.02, s * 1.02, s * 0.18), M.gold); b.add(rib);
    const rib2 = mesh(new THREE.BoxGeometry(s * 0.18, s * 1.02, s * 1.02), M.gold); b.add(rib2);
    g.add(b);
  }

  // lantern on a curled pole at the front
  const poleC = new THREE.CatmullRomCurve3([new THREE.Vector3(0.62, 0.95, 1.2), new THREE.Vector3(0.66, 1.6, 1.25), new THREE.Vector3(0.66, 1.95, 1.45), new THREE.Vector3(0.66, 1.88, 1.7)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(poleC, 30, 0.03, 6, false), M.gold));
  const lanternMat = new THREE.MeshBasicMaterial({ color: '#ffd27a' });
  const lantern = mesh(new THREE.SphereGeometry(0.11, 16, 10), lanternMat, 0.66, 1.7, 1.7);
  const cage = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#e0b04a', metalness: 0.8, roughness: 0.3, wireframe: true }), 0.66, 1.7, 1.7);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffc36b', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(1.8, 1.8, 1); halo.position.copy(lantern.position);
  const light = new THREE.PointLight('#ffbf6a', 6, 14, 1.6);
  light.position.copy(lantern.position);
  g.add(lantern, cage, halo, light);

  const shL = new THREE.Vector3(0.36, 0.8, 0.0), shR = new THREE.Vector3(-0.36, 0.8, 0.0);
  const hL = new THREE.Vector3(), hR = new THREE.Vector3();
  return {
    group: g,
    santa,
    handWorld: [mitL, mitR],
    update(t) {
      // gentle Santa sway + rein hands bob
      santa.rotation.z = Math.sin(t * 1.3) * 0.04;
      head.rotation.y = Math.sin(t * 0.5) * 0.18;
      head.rotation.x = Math.sin(t * 1.1) * 0.04;
      const bob = Math.sin(t * 5.2) * 0.04;
      hL.set(0.24, 0.55 + bob, 0.62); hR.set(-0.24, 0.55 - bob, 0.62);
      setStrap(armL, shL, hL); setStrap(armR, shR, hR);
      mitL.position.copy(hL); mitR.position.copy(hR);
      cuffL.position.copy(hL).lerp(shL, 0.12); cuffR.position.copy(hR).lerp(shR, 0.12);
      cuffL.lookAt(santa.localToWorld(shL.clone())); cuffR.lookAt(santa.localToWorld(shR.clone()));
      const fl = 0.85 + 0.15 * Math.sin(t * 13.0) * Math.sin(t * 7.3);
      light.intensity = 6 * fl;
      halo.material.opacity = 0.75 + 0.2 * fl;
    },
  };
}

// ---------------- Reindeer ----------------
function antler(side) {
  const g = new THREE.Group();
  const main = [[0.05, 0.0, 0.0], [0.16, 0.22, -0.08], [0.34, 0.48, -0.06], [0.44, 0.72, 0.08], [0.42, 0.88, 0.22]].map(([x, y, z]) => new THREE.Vector3(x * side, y, z));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(main), 24, 0.03, 6, false), M.antler));
  const tines = [
    [[0.12, 0.15, -0.06], [0.14, 0.26, 0.12], [0.1, 0.3, 0.22]],
    [[0.3, 0.42, -0.07], [0.27, 0.62, -0.12], [0.24, 0.74, -0.1]],
    [[0.4, 0.62, 0.0], [0.56, 0.74, 0.02], [0.62, 0.86, 0.06]],
    [[0.43, 0.8, 0.14], [0.36, 0.94, 0.2]],
  ];
  for (const tp of tines) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tp.map(([x, y, z]) => new THREE.Vector3(x * side, y, z))), 10, 0.02, 5, false), M.antler));
  return g;
}

function leg(x, y, z, upperLen, lowerLen) {
  const hip = new THREE.Group(); hip.position.set(x, y, z);
  const upper = mesh(new THREE.CylinderGeometry(0.075, 0.05, upperLen, 8), M.deer, 0, -upperLen / 2, 0);
  const knee = new THREE.Group(); knee.position.set(0, -upperLen, 0);
  const lower = mesh(new THREE.CylinderGeometry(0.04, 0.032, lowerLen, 8), M.deerLeg, 0, -lowerLen / 2, 0);
  const hoof = mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.07, 8), M.hoof, 0, -lowerLen - 0.02, 0);
  knee.add(lower, hoof);
  hip.add(upper, knee);
  return { hip, knee };
}

export function createReindeer(seed = 0) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const torso = ellipsoid(0.42, 0.75, 0.78, 1.6, M.deer); torso.position.set(0, 1.2, 0);
  const belly = ellipsoid(0.36, 0.7, 0.55, 1.35, M.deerLight); belly.position.set(0, 1.08, 0.02);
  const chest = ellipsoid(0.33, 0.9, 1.05, 0.9, M.deer); chest.position.set(0, 1.25, 0.48);
  const rump = ellipsoid(0.33, 0.95, 0.95, 0.9, M.deer); rump.position.set(0, 1.25, -0.5);
  const tail = ellipsoid(0.08, 1, 1.4, 0.8, M.fur); tail.position.set(0, 1.42, -0.8); tail.rotation.x = -0.6;
  body.add(torso, belly, chest, rump, tail);
  // neck + ruff
  const neck = makeStrap(0.15, M.deer); setStrap(neck, new THREE.Vector3(0, 1.35, 0.55), new THREE.Vector3(0, 1.95, 0.92));
  const ruff = ellipsoid(0.17, 1, 1.5, 0.8, M.deerLight); ruff.position.set(0, 1.5, 0.78); ruff.rotation.x = -0.6;
  body.add(neck, ruff);
  // head
  const head = new THREE.Group(); head.position.set(0, 1.98, 0.95);
  const skull = ellipsoid(0.17, 0.85, 0.85, 1.2, M.deer);
  const muzzle = ellipsoid(0.11, 0.85, 0.8, 1.2, M.deerLight); muzzle.position.set(0, -0.06, 0.22); muzzle.rotation.x = 0.3;
  const nose = mesh(new THREE.SphereGeometry(0.045, 10, 8), M.dark, 0, -0.06, 0.34);
  const eyeL = mesh(new THREE.SphereGeometry(0.028, 8, 6), M.dark, 0.11, 0.04, 0.09), eyeR = eyeL.clone(); eyeR.position.x = -0.11;
  const earL = ellipsoid(0.08, 0.5, 1.4, 0.3, M.deer); earL.position.set(0.15, 0.1, -0.06); earL.rotation.z = -1.0; const earR = earL.clone(); earR.position.x = -0.15; earR.rotation.z = 1.0;
  const aL = antler(1), aR = antler(-1); aL.position.set(0.06, 0.12, -0.04); aR.position.set(-0.06, 0.12, -0.04);
  head.add(skull, muzzle, nose, eyeL, eyeR, earL, earR, aL, aR);
  head.rotation.x = 0.35;
  body.add(head);
  // harness with bells
  const strap = mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 24), M.harness, 0, 1.25, 0.36); strap.scale.set(0.82, 1, 1); strap.rotation.x = 0.25;
  body.add(strap);
  for (let i = 0; i < 3; i++) {
    const a = -0.6 + i * 0.6;
    body.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), M.gold, Math.sin(a) * 0.3, 1.25 - Math.cos(a) * 0.36 + 0.02, 0.45));
  }
  const saddle = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), M.harness, 0, 1.56, 0.0); body.add(saddle);
  // legs
  const legs = {
    fl: leg(0.17, 1.05, 0.5, 0.48, 0.5), fr: leg(-0.17, 1.05, 0.5, 0.48, 0.5),
    hl: leg(0.17, 1.08, -0.52, 0.5, 0.52), hr: leg(-0.17, 1.08, -0.52, 0.5, 0.52),
  };
  for (const k in legs) body.add(legs[k].hip);
  const off = hash1(seed * 31 + 7) * Math.PI * 2;
  const freq = 1.55 + hash1(seed * 17 + 3) * 0.15;
  return {
    group: g,
    chest: new THREE.Vector3(0, 1.3, 0.75),
    update(t) {
      const ph = t * freq * Math.PI * 2 + off;
      const s = Math.sin(ph);
      // flying gallop: fore legs reach forward, hind legs sweep back
      legs.fl.hip.rotation.x = -0.65 + 0.75 * s; legs.fl.knee.rotation.x = 0.4 + 0.9 * Math.max(0, Math.sin(ph + 1.2));
      legs.fr.hip.rotation.x = -0.65 + 0.75 * Math.sin(ph + 0.35); legs.fr.knee.rotation.x = 0.4 + 0.9 * Math.max(0, Math.sin(ph + 1.55));
      legs.hl.hip.rotation.x = 0.55 + 0.75 * Math.sin(ph + Math.PI); legs.hl.knee.rotation.x = -0.35 - 0.8 * Math.max(0, Math.sin(ph + Math.PI + 1.0));
      legs.hr.hip.rotation.x = 0.55 + 0.75 * Math.sin(ph + Math.PI + 0.35); legs.hr.knee.rotation.x = -0.35 - 0.8 * Math.max(0, Math.sin(ph + Math.PI + 1.35));
      body.position.y = 0.09 * Math.sin(ph * 2 + 0.5);
      body.rotation.x = 0.06 * Math.sin(ph + 0.8);
      head.rotation.x = 0.35 - 0.12 * Math.sin(ph + 0.3);
      tail.rotation.x = -0.6 + 0.2 * Math.sin(ph * 2);
    },
  };
}

// ---------------- Whole team (sleigh + 3 pairs of reindeer + harness) ----------------
export function createTeam() {
  const group = new THREE.Group();
  const sleigh = createSleigh();
  group.add(sleigh.group);
  const deer = [];
  const layout = [];
  for (let p = 0; p < 3; p++) for (const side of [-1, 1]) layout.push({ ahead: 3.6 + p * 2.35, lat: side * 0.62 });
  layout.forEach((l, i) => { const d = createReindeer(i + 1); group.add(d.group); deer.push({ ...d, ...l }); });
  const traceMat = new THREE.MeshStandardMaterial({ color: '#e0b04a', metalness: 0.8, roughness: 0.3, emissive: '#4a3008' });
  const traces = layout.map(() => makeStrap(0.018, traceMat));
  const reins = [makeStrap(0.012, M.harness), makeStrap(0.012, M.harness)];
  traces.forEach((m) => group.add(m)); reins.forEach((m) => group.add(m));

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const tmpPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  return {
    group, sleigh, deer, layout,
    // poseAt(aheadMetres, out) -> sets out.pos / out.quat in world space
    update(t, poseAt, scale = 1) {
      poseAt(0, tmpPose);
      sleigh.group.position.copy(tmpPose.pos);
      sleigh.group.quaternion.copy(tmpPose.quat);
      sleigh.group.scale.setScalar(scale);
      sleigh.update(t);
      sleigh.group.updateMatrixWorld(true);
      deer.forEach((d, i) => {
        poseAt(d.ahead * scale, tmpPose);
        d.group.quaternion.copy(tmpPose.quat);
        const lateral = new THREE.Vector3(d.lat * scale, (Math.sin(t * 2.1 + i) * 0.06 - 0.35) * scale, 0).applyQuaternion(tmpPose.quat);
        d.group.position.copy(tmpPose.pos).add(lateral);
        d.group.scale.setScalar(scale);
        d.update(t);
        d.group.updateMatrixWorld(true);
        // trace from sleigh front to each deer's chest strap
        const sx = Math.sign(d.lat) * 0.3;
        b.set(sx, 1.25, 0.42); d.group.localToWorld(b);
        if (i < 2) { a.set(d.lat * 0.55, 0.75, 1.75); sleigh.group.localToWorld(a); }
        else { a.set(sx, 1.25, 0.42); deer[i - 2].group.localToWorld(a); }
        setStrap(traces[i], a, b); traces[i].scale.x = traces[i].scale.z = scale;
      });
      // reins from Santa's mittens to the lead pair
      sleigh.handWorld.forEach((m, k) => {
        m.getWorldPosition(a);
        const lead = deer[4 + k];
        b.set(0, 1.85, 0.9); lead.group.localToWorld(b);
        setStrap(reins[k], a, b); reins[k].scale.x = reins[k].scale.z = scale;
      });
    },
  };
}
