import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, RotateCcw, BookOpen } from 'lucide-react';
import type { FlightRoute } from '@/data/flightRoutes';

/**
 * The sleigh's flight on a turning globe of the real Earth (NASA Blue Marble, December).
 * The globe is drawn with WebGL, which every modern iPad and computer has built in: the flat NASA picture
 * is wrapped onto a sphere, and the globe turns beneath the sleigh as it flies its route.
 * Nothing plays until the reader asks; it can be closed at any moment; reduced motion shows the finished route.
 */

const EARTH = 'https://raw.githubusercontent.com/jsp1440/snow-orchids-media/main/earth-december.jpg.jpg';
const rad = Math.PI / 180;
type V3 = [number, number, number];
const toVec = (lat: number, lon: number): V3 => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
const toLatLon = (v: V3) => ({ lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad, lon: Math.atan2(v[1], v[0]) / rad });
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The route as a dense line of points along great circles, with each stop's place along it (0 to 1). */
function buildPath(route: FlightRoute) {
  const pts: V3[] = []; const at: number[] = [0];
  let total = 0; const lens: number[] = [];
  const S = route.stops.map(s => toVec(s.lat, s.lon));
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1]; const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    const n = Math.max(4, Math.ceil(ang / (1.2 * rad)));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const sa = Math.sin((1 - t) * ang), sb = Math.sin(t * ang), s = Math.sin(ang) || 1;
      const v: V3 = ang < 1e-6 ? a : [ (sa * a[0] + sb * b[0]) / s, (sa * a[1] + sb * b[1]) / s, (sa * a[2] + sb * b[2]) / s ];
      pts.push(v);
    }
    total += ang; lens.push(ang);
  }
  let acc = 0; for (const l of lens) { acc += l; at.push(acc / total); }
  // cumulative fraction for each path point
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.acos(Math.max(-1, Math.min(1, dot(pts[i - 1], pts[i])))));
  return { pts, cum: cum.map(c => c / (cum[cum.length - 1] || 1)), stopAt: at, total };
}
function pointAt(path: ReturnType<typeof buildPath>, f: number): V3 {
  const { pts, cum } = path; if (f <= 0) return pts[0]; if (f >= 1) return pts[pts.length - 1];
  let i = 1; while (i < cum.length && cum[i] < f) i++;
  const t = (f - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = pts[i - 1], b = pts[i];
  const v: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; const m = Math.hypot(...v);
  return [v[0] / m, v[1] / m, v[2] / m];
}
/** Camera basis looking straight down at a point on the globe: forward, east, north. */
function basis(lat: number, lon: number) {
  const la = lat * rad, lo = lon * rad;
  const f: V3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const e: V3 = [-Math.sin(lo), Math.cos(lo), 0];
  const n: V3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  return { f, e, n };
}

const VERT = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision highp float; varying vec2 v; uniform sampler2D tex; uniform vec3 f; uniform vec3 e; uniform vec3 n; uniform float zoom; uniform float ready;
void main(){
  vec2 q = v / zoom; float r2 = dot(q, q);
  if (r2 > 1.0) {
    float d = sqrt(r2) - 1.0; float glow = exp(-d * 18.0 * zoom) * 0.75;
    gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * glow, glow); return;
  }
  float z = sqrt(1.0 - r2);
  vec3 w = z * f + q.x * e + q.y * n;
  float lat = asin(clamp(w.z, -1.0, 1.0)); float lon = atan(w.y, w.x);
  vec2 uv = vec2((lon + 3.14159265) / 6.2831853, (1.5707963 - lat) / 3.14159265);
  vec3 col = mix(vec3(0.06, 0.14, 0.32), texture2D(tex, uv).rgb, ready);
  float light = 0.55 + 0.45 * z;
  col = col * light + vec3(0.35, 0.55, 1.0) * pow(1.0 - z, 3.0) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}`;

interface Props { route: FlightRoute; onClose: () => void }

const GlobeFlight: React.FC<Props> = ({ route, onClose }) => {
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const glRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);            // restart counter for "Fly again"
  const [stopIdx, setStopIdx] = useState(0);    // the place the sleigh is passing now
  const [arrived, setArrived] = useState(false);
  const [noGL, setNoGL] = useState(false);
  const path = useMemo(() => buildPath(route), [route]);
  const dest = route.stops[route.stops.length - 1];
  // Each leg: a quick streak that slows into the next place, then a pause there so its name and fact can be read.
  const legSec = useMemo(() => route.stops.slice(1).map((_, i) => 1.1 + (path.stopAt[i + 1] - path.stopAt[i]) * path.total * 2.2), [route, path]);
  const HOLD = 3.6;
  const flightSec = legSec.reduce((a, b) => a + b, 0) + HOLD * Math.max(0, legSec.length - 1);
  const zoomSec = 2.2;
  const pathAt = useCallback((t: number) => {
    let start = 0;
    for (let i = 0; i < legSec.length; i++) {
      const a = path.stopAt[i], b = path.stopAt[i + 1];
      if (t < start + legSec[i]) return a + (b - a) * ease((t - start) / legSec[i]);
      start += legSec[i];
      if (i < legSec.length - 1) { if (t < start + HOLD) return b; start += HOLD; }
    }
    return 1;
  }, [legSec, path]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [close]);

  useEffect(() => {
    setArrived(false); setStopIdx(0);
    const cv = glRef.current, fx = fxRef.current; if (!cv || !fx) return;
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, antialias: true }) as WebGLRenderingContext | null;
    if (!gl) { setNoGL(true); return; }
    const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setNoGL(true); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 40, 90, 255]));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    let ready = 0; const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); ready = 1; };
    im.src = EARTH;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const t0 = performance.now(); let raf = 0, lastStop = -1, done = false;
    const trail: { x: number; y: number; life: number }[] = [];
    const frame = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), size = cv.clientWidth;
      if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); fx.width = fx.height = cv.width; }
      const t = reduce ? flightSec + zoomSec : (now - t0) / 1000;
      const fRaw = Math.min(1, t / flightSec), fPath = pathAt(t);
      const zoomF = ease((t - flightSec + 0.6) / zoomSec);
      const zoom = 0.92 + 1.15 * zoomF;
      const here = pointAt(path, fPath); const { lat, lon } = toLatLon(here);
      // the camera follows the sleigh, so the globe turns beneath it
      const B = basis(Math.min(89.5, lat), lon);
      gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform3fv(U('f'), B.f); gl.uniform3fv(U('e'), B.e); gl.uniform3fv(U('n'), B.n); gl.uniform1f(U('zoom'), zoom); gl.uniform1f(U('ready'), ready);
      gl.uniform1i(U('tex'), 0); gl.drawArrays(gl.TRIANGLES, 0, 6);

      // the route, the trail and the sleigh, drawn over the globe
      const g = fx.getContext('2d')!; const W = fx.width, R = W / 2 * zoom, cx = W / 2, cy = W / 2;
      g.clearRect(0, 0, W, W);
      const proj = (v: V3) => { const z = dot(v, B.f); return { x: cx + dot(v, B.e) * R, y: cy - dot(v, B.n) * R, vis: z > 0.02 }; };
      // northern lights around the pole as the flight begins
      const aur = Math.max(0, 1 - fRaw * 4);
      if (aur > 0) {
        g.lineWidth = 10 * dpr; g.globalCompositeOperation = 'screen';
        ['rgba(80,255,170,', 'rgba(170,120,255,'].forEach((c, i) => {
          g.beginPath(); let first = true;
          for (let lo2 = -180; lo2 <= 180; lo2 += 4) {
            const p = proj(toVec(72 + i * 3 + Math.sin((lo2 + now / 40) * rad * 3) * 2, lo2));
            if (!p.vis) { first = true; continue; } if (first) { g.moveTo(p.x, p.y); first = false; } else g.lineTo(p.x, p.y);
          }
          g.strokeStyle = c + (0.55 * aur) + ')'; g.shadowColor = c + '0.9)'; g.shadowBlur = 18 * dpr; g.stroke(); g.shadowBlur = 0;
        });
        g.globalCompositeOperation = 'source-over';
      }
      // the whole route, faint, then the part already flown, bright
      const drawLine = (upto: number, style: string, width: number, dash: number[]) => {
        g.beginPath(); let first = true;
        for (let i = 0; i < path.pts.length && path.cum[i] <= upto + 1e-9; i++) {
          const p = proj(path.pts[i]); if (!p.vis) { first = true; continue; }
          if (first) { g.moveTo(p.x, p.y); first = false; } else g.lineTo(p.x, p.y);
        }
        if (upto < 1) { const p = proj(here); if (p.vis) g.lineTo(p.x, p.y); }
        g.setLineDash(dash.map(d => d * dpr)); g.strokeStyle = style; g.lineWidth = width * dpr; g.stroke(); g.setLineDash([]);
      };
      drawLine(1, 'rgba(255,255,255,0.35)', 1.6, [4, 6]);
      drawLine(fPath, 'rgba(255,214,110,0.95)', 3, []);
      // the stops along the way
      route.stops.forEach((s, i) => {
        const p = proj(toVec(s.lat, s.lon)); if (!p.vis) return;
        const passed = fPath >= path.stopAt[i] - 0.002, isDest = i === route.stops.length - 1;
        g.beginPath(); g.arc(p.x, p.y, (isDest ? 6 : 4) * dpr, 0, Math.PI * 2);
        g.fillStyle = passed ? '#ffd66e' : 'rgba(255,255,255,0.7)'; g.fill();
        if (isDest) { const pulse = 1 + 0.5 * Math.sin(now / 300); g.beginPath(); g.arc(p.x, p.y, 13 * pulse * dpr, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,214,110,0.7)'; g.lineWidth = 2 * dpr; g.stroke(); }
      });
      // the sleigh: a bright star with a sparkling trail
      const sp = proj(here);
      if (sp.vis && fRaw < 1) { trail.push({ x: sp.x, y: sp.y, life: 1 }); }
      for (let i = trail.length - 1; i >= 0; i--) {
        const tr = trail[i]; tr.life -= 0.03; if (tr.life <= 0) { trail.splice(i, 1); continue; }
        g.fillStyle = `rgba(255,236,170,${tr.life * 0.8})`; g.beginPath(); g.arc(tr.x + (Math.random() - 0.5) * 6 * dpr, tr.y + (Math.random() - 0.5) * 6 * dpr, 2.2 * tr.life * dpr, 0, Math.PI * 2); g.fill();
      }
      if (sp.vis) {
        const gr = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 22 * dpr); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,214,110,0.8)'); gr.addColorStop(1, 'rgba(255,214,110,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(sp.x, sp.y, 22 * dpr, 0, Math.PI * 2); g.fill();
      }
      // which place the sleigh is passing
      let si = 0; for (let i = 0; i < route.stops.length; i++) if (fPath >= path.stopAt[i] - 0.004) si = i;
      if (si !== lastStop) { lastStop = si; setStopIdx(si); }
      if (!done && t >= flightSec + zoomSec) { done = true; setArrived(true); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); };
  }, [run, path, route, flightSec, pathAt, reduce]);

  const stop = route.stops[stopIdx];
  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center overflow-y-auto"
      style={{ background: 'radial-gradient(ellipse at 50% 35%, #0d1a3a 0%, #050914 70%)' }}
      role="dialog" aria-modal="true" aria-label={`The flight to ${route.destination}`}>
      <div aria-hidden className="absolute inset-0 opacity-60 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 80%, #fff, transparent), radial-gradient(1px 1px at 85% 65%, #fff, transparent), radial-gradient(1px 1px at 10% 75%, #fff, transparent), radial-gradient(1.5px 1.5px at 55% 12%, #fff, transparent), radial-gradient(1px 1px at 92% 40%, #fff, transparent)' }} />
      <button onClick={close} className="absolute right-4 top-4 z-10 min-h-[48px] min-w-[48px] rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" aria-label="Close the flight">
        <X className="w-6 h-6" aria-hidden />
      </button>
      <p className="relative z-10 text-amber-200/80 uppercase tracking-wider text-sm mt-4">Flying with Santa to</p>
      <h2 className="relative z-10 font-serif text-3xl sm:text-4xl text-amber-50 text-center px-4">{route.destination.replace(/^the /, 'The ')}</h2>
      <div className="relative w-[min(92vw,62vh)] aspect-square my-3">
        {noGL
          ? <div className="absolute inset-0 rounded-full bg-[#0e2552] flex items-center justify-center text-center p-8 text-amber-50">This device can't draw the turning globe, but here is the journey.</div>
          : <div className="absolute inset-0 rounded-full overflow-hidden"><canvas ref={glRef} className="absolute inset-0 w-full h-full" aria-hidden /><canvas ref={fxRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden /></div>}
      </div>
      <div className="relative z-10 max-w-xl px-5 text-center min-h-[110px]" aria-live="polite">
        {!arrived ? (
          <>
            <p className="font-serif text-2xl text-amber-100">{stop.name}</p>
            <p className="text-lg text-amber-50/85 leading-relaxed">{stop.fact}</p>
          </>
        ) : (
          <>
            <p className="font-serif text-3xl text-amber-100">{dest.name}</p>
            <p className="text-amber-200/80 mb-1">{route.where}</p>
            <p className="text-lg text-amber-50/85 leading-relaxed">{dest.fact}</p>
          </>
        )}
      </div>
      {noGL && (
        <ol className="relative z-10 max-w-xl px-6 space-y-2 text-amber-50/90 list-decimal list-inside">
          {route.stops.map(s => <li key={s.name}><strong className="text-amber-100">{s.name}:</strong> {s.fact}</li>)}
        </ol>
      )}
      <div className="relative z-10 flex flex-wrap justify-center gap-3 my-5">
        {(arrived || noGL) && (
          <button onClick={close} className="min-h-[52px] px-6 rounded-full bg-amber-400 hover:bg-amber-300 text-[#2a1a00] font-semibold inline-flex items-center gap-2">
            <BookOpen className="w-5 h-5" aria-hidden /> Begin the chapter
          </button>
        )}
        {arrived && !noGL && (
          <button onClick={() => setRun(r => r + 1)} className="min-h-[52px] px-5 rounded-full border border-amber-200/50 text-amber-50 inline-flex items-center gap-2">
            <RotateCcw className="w-5 h-5" aria-hidden /> Fly again
          </button>
        )}
        {!arrived && !noGL && (
          <button onClick={close} className="min-h-[48px] px-5 rounded-full text-amber-100/80 hover:text-white">Skip</button>
        )}
      </div>
      <p className="relative z-10 text-xs text-white/40 pb-3">Earth image: NASA Blue Marble, December</p>
    </div>
  );
};

export default GlobeFlight;
