// Render the 60 s timeline frame-by-frame in headless Chromium (Playwright)
// and encode with FFmpeg. Free tools only.
// Usage: node tools/render-mp4.mjs [--out file.mp4] [--song 1|2|3|4|0] [--workers 2]
//                                  [--start 0] [--end 60] [--fps 30]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', path.join(here, '..', 'output', 'snow-orchids-60s.mp4')));
const song = arg('song', '1');
const fps = parseInt(arg('fps', '30'), 10);
const start = parseFloat(arg('start', '0')), end = parseFloat(arg('end', '60'));
const workers = parseInt(arg('workers', '2'), 10);
const frames = Math.round((end - start) * fps);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snoworchids-'));
fs.mkdirSync(path.dirname(out), { recursive: true });

const port = 8100 + Math.floor(Math.random() * 500);
const server = await startServer(port);
const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const errors = [];
const t0 = Date.now();
let done = 0;

async function worker(w) {
  const browser = await chromium.launch({ args: launchArgs });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/animation/?export=1`);
  await page.waitForFunction(() => window.__ready && window.__renderFrame, null, { timeout: 180000 });
  for (let f = w; f < frames; f += workers) {
    const t = start + f / fps;
    const url = await page.evaluate((x) => window.__renderFrame(x), t);
    fs.writeFileSync(path.join(tmp, `f${String(f).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    if (++done % 60 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`${done}/${frames} frames  ${el.toFixed(0)} s elapsed  ~${(el / done * (frames - done) / 60).toFixed(1)} min left`);
    }
  }
  await browser.close();
}
await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
server.close();
if (errors.length) console.log('Browser errors:\n' + [...new Set(errors)].join('\n'));

const dur = (end - start).toFixed(3);
const ff = ['-y', '-framerate', String(fps), '-i', path.join(tmp, 'f%05d.jpg')];
const songFile = path.join(repo, `song-${song}.mp3`);
if (song !== '0' && fs.existsSync(songFile)) {
  ff.push('-ss', String(start), '-t', dur, '-i', songFile, '-filter:a', `afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, end - start - 3)}:d=3`, '-c:a', 'aac', '-b:a', '192k');
}
ff.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-t', dur, '-movflags', '+faststart', out);
await new Promise((res, rej) => { const p = spawn('ffmpeg', ff, { stdio: ['ignore', 'ignore', 'inherit'] }); p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))); });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Wrote ${out} (${frames} frames) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
