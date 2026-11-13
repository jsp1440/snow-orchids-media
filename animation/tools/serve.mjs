// Tiny dependency-free static server. Serves the repository root so the
// animation can reach the shared media (songs, earth texture) one level up.
// Usage: node tools/serve.mjs [port]   ->  http://localhost:8080/animation/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

export function startServer(port = 8080) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(root, url);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.stat(file, (err, st) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) { // needed for <audio> seeking
        const [a, b] = range.replace('bytes=', '').split('-');
        const start = parseInt(a, 10), end = b ? parseInt(b, 10) : st.size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(file).pipe(res);
      }
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parseInt(process.argv[2] || '8080', 10);
  startServer(port).then(() => console.log(`Snow Orchids preview: http://localhost:${port}/animation/`));
}
