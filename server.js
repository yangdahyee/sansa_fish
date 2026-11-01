// 소원 연못 — 내 컴퓨터에서 돌리는 Node 서버
// 규칙은 core/pond.js 에 있고(Cloudflare 와 같은 코드), 여기서는 파일 저장·정적 파일·WebSocket 만 맡는다.
// `npm start` 후 http://localhost:3000

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Pond } from './core/pond.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const DATA_DIR = path.join(ROOT, 'data');
const WISHES_FILE = path.join(DATA_DIR, 'wishes.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------- 실시간 알림 ----------
const sockets = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
}
let onlineTimer = null;
function announceOnline() {
  clearTimeout(onlineTimer);
  onlineTimer = setTimeout(() => broadcast({ t: 'online', n: sockets.size }), 400);
}

// ---------- 소원 저장 (파일) ----------
let dirty = false;
const pond = new Pond({
  goal: Number(process.env.WISH_GOAL) || 5,
  persist: () => {
    dirty = true;
  },
  remove: () => {
    dirty = true;
  },
  // 관리자 페이지 비밀번호: ADMIN_TOKEN=... npm start (없으면 관리자 기능 꺼짐)
  adminToken: process.env.ADMIN_TOKEN || '',
  broadcast,
  online: () => sockets.size,
});
try {
  pond.load(JSON.parse(fs.readFileSync(WISHES_FILE, 'utf8')));
} catch (_) {}
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.mkdir(DATA_DIR, { recursive: true }, () => {
    const tmp = WISHES_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(pond.wishes), (err) => {
      if (!err) fs.rename(tmp, WISHES_FILE, () => {});
    });
  });
}, 2000).unref();

// ---------- HTTP ----------
function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': ext === '.glb' ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

// Node 요청 → 웹 표준 Request 로 바꿔 core 에 넘기고, Response 를 그대로 돌려줌
async function handleApi(req, res) {
  let body;
  if (req.method === 'POST') {
    let tooBig = false;
    body = await new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => {
        if (tooBig) return;
        data += c;
        if (data.length > 4096) tooBig = true; // 더 받지 않고 끝나면 413 으로 답함
      });
      req.on('end', () => resolve(data));
      req.on('error', () => resolve(''));
    });
    if (tooBig) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'too_large' }));
    }
  }
  const headers = { 'content-type': 'application/json' };
  for (const h of ['x-pond-uid', 'authorization']) if (req.headers[h]) headers[h] = req.headers[h];
  const request = new Request(`http://localhost${req.url}`, { method: req.method, body, headers });
  const response = await pond.handle(request, req.socket.remoteAddress || '?');
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch (_) {
    res.writeHead(400);
    return res.end();
  }
  if (p.startsWith('/api/')) {
    handleApi(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
    return;
  }
  if (p === '/admin') p = '/admin.html';
  if (p.startsWith('/vendor/three/')) {
    const f = safeJoin(THREE_DIR, p.slice('/vendor/three/'.length));
    return f ? serveFile(res, f) : (res.writeHead(400), res.end());
  }
  const f = safeJoin(PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  return f ? serveFile(res, f) : (res.writeHead(400), res.end());
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.send(JSON.stringify({ t: 'online', n: sockets.size }));
  announceOnline();
  ws.on('close', () => {
    sockets.delete(ws);
    announceOnline();
  });
  ws.on('error', () => {});
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

server.listen(PORT, () => {
  console.log(`🐟 소원 연못: http://localhost:${PORT}  (별까지 먹이 ${pond.goal}번)`);
});
