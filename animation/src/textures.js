// Procedural canvas textures (glows, sparkles, mist, leaf patterns).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,255,255,0.65)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}

export function sparkleTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const r = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.12, 'rgba(255,255,255,0.8)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (const [dx, dy, len] of [[1, 0, 0.5], [0, 1, 0.5], [0.707, 0.707, 0.22], [-0.707, 0.707, 0.22]]) {
      const lg = g.createLinearGradient(cx - dx * w * len, cy - dy * h * len, cx + dx * w * len, cy + dy * h * len);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = lg; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - dx * w * len, cy - dy * h * len); g.lineTo(cx + dx * w * len, cy + dy * h * len); g.stroke();
    }
  });
}

export function mistTexture(seed = 3) {
  const rng = mulberry32(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = w * (0.2 + rng() * 0.6), y = h * (0.3 + rng() * 0.4);
      const rad = w * (0.08 + rng() * 0.2);
      const r = g.createRadialGradient(x, y, 0, x, y, rad);
      const a = 0.05 + rng() * 0.08;
      r.addColorStop(0, `rgba(255,255,255,${a})`);
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }
  });
}

// Goodyera oblongifolia leaf: dark blue-green blade, broad white midvein
// stripe and fine pale reticulation (the species' diagnostic foliage).
export function goodyeraLeafTexture() {
  const rng = mulberry32(77);
  return canvasTex(256, 512, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, 0);
    bg.addColorStop(0, '#1d3a2a'); bg.addColorStop(0.5, '#2c5338'); bg.addColorStop(1, '#1d3a2a');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // reticulate pale veins
    g.strokeStyle = 'rgba(205,230,205,0.55)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const y = (i / 26) * h;
      for (const side of [-1, 1]) {
        g.beginPath(); g.moveTo(w / 2, y);
        g.quadraticCurveTo(w / 2 + side * w * 0.25, y - h * 0.03, w / 2 + side * w * 0.5, y - h * 0.08);
        g.stroke();
      }
    }
    g.strokeStyle = 'rgba(205,230,205,0.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < 160; i++) {
      const x = rng() * w, y = rng() * h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 18, y + (rng() - 0.5) * 18); g.stroke();
    }
    // white midvein stripe
    const st = g.createLinearGradient(w * 0.38, 0, w * 0.62, 0);
    st.addColorStop(0, 'rgba(235,245,235,0)'); st.addColorStop(0.3, 'rgba(235,245,235,0.95)');
    st.addColorStop(0.7, 'rgba(235,245,235,0.95)'); st.addColorStop(1, 'rgba(235,245,235,0)');
    g.fillStyle = st; g.fillRect(w * 0.38, 0, w * 0.24, h);
  });
}

export function textTexture(lines, { width = 2048, height = 512 } = {}) {
  return canvasTex(width, height, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of lines) {
      g.font = l.font;
      g.shadowColor = l.shadow || 'rgba(255,200,110,0.85)';
      g.shadowBlur = l.blur ?? 24;
      g.fillStyle = l.color || '#fff4dc';
      if (l.spacing) { try { g.letterSpacing = l.spacing; } catch (e) { /* older browsers */ } }
      g.fillText(l.text, w / 2, h * l.y);
      if (l.spacing) { try { g.letterSpacing = '0px'; } catch (e) {} }
    }
  });
}
