// Render selected timeline times to PNG stills (for checks / evidence).
// Usage: node tools/snap.mjs out_dir t1 t2 ...
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const [outDir, ...times] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const server = await startServer(8091);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:8091/animation/?export=1');
await page.waitForFunction(() => window.__ready && window.__renderFrame, null, { timeout: 120000 });
for (const t of times) {
  const t0 = Date.now();
  const url = await page.evaluate((x) => window.__renderFrame(parseFloat(x), 'image/png'), t);
  fs.writeFileSync(path.join(outDir, `t${Number(t).toFixed(2).padStart(5, "0")}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`t=${t} rendered in ${Date.now() - t0} ms`);
}
console.log(errors.length ? 'CONSOLE:\n' + [...new Set(errors)].join('\n') : 'no console errors/warnings');
await browser.close(); server.close();
