// 등용문 연못 — 정적 파일 서버 + WebSocket 연못 방(room) 서버
// 의존성: ws 하나뿐. `npm start` 후 http://localhost:3000 접속.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_CAP = Number(process.env.ROOM_CAP) || 24; // 한 연못에 함께 헤엄칠 수 있는 최대 인원
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const DATA_DIR = path.join(__dirname, 'data');
const STARS_FILE = path.join(DATA_DIR, 'stars.json');

const SPECIES = ['berry', 'lemon', 'coral', 'neon'];
// 자유 채팅 대신 정해진 말만 주고받는다 (클라이언트 public/js/phrases.js 와 같은 순서)
const PHRASE_COUNT = 6;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------- 별(등용한 꿈) 저장 ----------
let stars = {}; // { [pondId]: [{ name, dream, species, at }] }
try {
  stars = JSON.parse(fs.readFileSync(STARS_FILE, 'utf8'));
} catch (_) {
  stars = {};
}
let starsDirty = false;
setInterval(() => {
  if (!starsDirty) return;
  starsDirty = false;
  fs.mkdir(DATA_DIR, { recursive: true }, () => {
    fs.writeFile(STARS_FILE, JSON.stringify(stars), () => {});
  });
}, 5000).unref();

// ---------- 방 관리 ----------
/** @type {Map<string, Map<string, Client>>} */
const rooms = new Map();

function roomOf(id) {
  if (!rooms.has(id)) rooms.set(id, new Map());
  return rooms.get(id);
}

function validPondId(s) {
  return typeof s === 'string' && /^[a-z0-9-]{1,32}$/.test(s);
}

// 사람이 덜 찬 연못부터 배정 (yeon-1, yeon-2 …)
function assignPond() {
  for (let i = 1; i < 1000; i++) {
    const id = `yeon-${i}`;
    const r = rooms.get(id);
    if (!r || r.size < ROOM_CAP) return id;
  }
  return `yeon-${Date.now() % 100000}`;
}

function clampStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function sanitizeFish(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const total = clampInt(f.total, 0, 12);
  return {
    name: clampStr(f.name, 16) || '이름 없는 물고기',
    species: SPECIES.includes(f.species) ? f.species : 'berry',
    dream: clampStr(f.dream, 80),
    isPublic: !!f.isPublic,
    done: clampInt(f.done, 0, total),
    total,
    sleeping: !!f.sleeping,
    followId: typeof f.followId === 'string' ? f.followId.slice(0, 40) : null,
    hasDream: !!f.hasDream,
  };
}

function publicView(c) {
  const f = c.fish;
  return {
    id: c.id,
    name: f.name,
    species: f.species,
    dream: f.isPublic ? f.dream : '',
    hasDream: f.hasDream,
    done: f.done,
    total: f.total,
    sleeping: f.sleeping,
    followId: f.followId,
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const c of room.values()) {
    if (c.id !== exceptId && c.ws.readyState === 1) c.ws.send(s);
  }
}

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/assign') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ pond: assignPond() }));
    return;
  }
  if (p === '/api/health') {
    let n = 0;
    for (const r of rooms.values()) n += r.size;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, swimmers: n }));
    return;
  }
  if (p.startsWith('/vendor/three/')) {
    const f = safeJoin(THREE_DIR, p.slice('/vendor/three/'.length));
    return f ? serveFile(res, f) : (res.writeHead(400), res.end());
  }
  const f = safeJoin(PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  return f ? serveFile(res, f) : (res.writeHead(400), res.end());
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

/**
 * @typedef {{ id: string, ws: import('ws').WebSocket, pond: string, fish: any, lastAction: number }} Client
 */

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  let pond = url.searchParams.get('pond');
  if (!validPondId(pond)) pond = assignPond();
  const room = roomOf(pond);

  if (room.size >= ROOM_CAP) {
    send(ws, { t: 'full', suggest: assignPond() });
    ws.close();
    return;
  }

  /** @type {Client} */
  const client = {
    id: crypto.randomBytes(6).toString('hex'),
    ws,
    pond,
    fish: sanitizeFish({}),
    lastAction: 0,
    joined: false,
  };

  // 너무 잦은 행동(먹이 연타 등)을 막는 간단한 제한
  const allow = (ms) => {
    const now = Date.now();
    if (now - client.lastAction < ms) return false;
    client.lastAction = now;
    return true;
  };

  ws.on('message', (data) => {
    let m;
    try {
      m = JSON.parse(data);
    } catch (_) {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'hello': {
        client.fish = sanitizeFish(m.fish);
        if (!client.joined) {
          client.joined = true;
          room.set(client.id, client);
          send(ws, {
            t: 'welcome',
            id: client.id,
            pond,
            cap: ROOM_CAP,
            fishes: [...room.values()].filter((c) => c.id !== client.id).map(publicView),
            stars: (stars[pond] || []).slice(-200),
          });
          broadcast(room, { t: 'join', fish: publicView(client) }, client.id);
        }
        break;
      }
      case 'update': {
        if (!client.joined) return;
        client.fish = sanitizeFish(m.fish);
        broadcast(room, { t: 'update', fish: publicView(client) }, client.id);
        break;
      }
      case 'feed': {
        // 다른 사람 물고기에게 응원 먹이 던지기
        if (!client.joined || !allow(700)) return;
        const target = room.get(m.to);
        if (!target || target.id === client.id) return;
        broadcast(room, { t: 'feed', from: client.id, to: target.id, fromName: client.fish.name });
        break;
      }
      case 'bubble': {
        // 정해진 문구 말풍선
        if (!client.joined || !allow(1200)) return;
        const idx = clampInt(m.i, 0, PHRASE_COUNT - 1);
        broadcast(room, { t: 'bubble', from: client.id, i: idx });
        break;
      }
      case 'leap': {
        // TODO 하나 완료 → 폭포 한 칸 도약
        if (!client.joined) return;
        broadcast(room, { t: 'leap', from: client.id, done: client.fish.done, total: client.fish.total }, client.id);
        break;
      }
      case 'ascend': {
        // 꿈 완료 → 등용. 연못 하늘에 별로 남는다.
        if (!client.joined || !allow(3000)) return;
        const star = {
          name: client.fish.name,
          dream: client.fish.isPublic ? client.fish.dream : '',
          species: client.fish.species,
          at: Date.now(),
        };
        (stars[pond] ||= []).push(star);
        if (stars[pond].length > 500) stars[pond].splice(0, stars[pond].length - 500);
        starsDirty = true;
        broadcast(room, { t: 'ascend', from: client.id, star });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (room.get(client.id) === client) {
      room.delete(client.id);
      broadcast(room, { t: 'leave', id: client.id });
    }
  });

  ws.on('error', () => {});
});

// 끊긴 연결 정리
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
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
});

server.listen(PORT, () => {
  console.log(`🐟 등용문 연못: http://localhost:${PORT}`);
});
