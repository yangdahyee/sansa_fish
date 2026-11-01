// 소원 연못 — 정적 파일 + 소원 저장(REST) + 실시간 알림(WebSocket) 서버
// 의존성: ws 하나뿐. `npm start` 후 http://localhost:3000 접속.
//
// 소원 = 물고기 한 마리. 다른 사람이 하루 한 번씩 먹이(응원)를 주고,
// GOAL 번 모이면 폭포를 올라 용이 되어 하늘의 별이 된다.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const GOAL = Number(process.env.WISH_GOAL) || 21; // 삼칠일(21) — 사람이 늘면 108 로
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const DATA_DIR = path.join(__dirname, 'data');
const WISHES_FILE = path.join(DATA_DIR, 'wishes.json');

const SPECIES = ['berry', 'lemon', 'coral', 'neon'];
const MAX_TEXT = 60;
const POND_LIMIT = 40; // 한 화면 연못에 띄울 최대 소원 수

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

// ---------- 소원 저장 ----------
/**
 * @typedef {{ id: string, text: string, isPublic: boolean, species: string, name: string,
 *   owner: string, createdAt: number, feeds: number, fedBy: Record<string, string>,
 *   status: 'swimming' | 'star', starAt: number | null }} Wish
 */
/** @type {Wish[]} */
let wishes = [];
try {
  wishes = JSON.parse(fs.readFileSync(WISHES_FILE, 'utf8'));
} catch (_) {
  wishes = [];
}
const byId = new Map(wishes.map((w) => [w.id, w]));

let dirty = false;
function markDirty() {
  dirty = true;
}
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.mkdir(DATA_DIR, { recursive: true }, () => {
    const tmp = WISHES_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(wishes), (err) => {
      if (!err) fs.rename(tmp, WISHES_FILE, () => {});
    });
  });
}, 2000).unref();

// 익명 방문자 표시: 브라우저가 만든 비밀값(uid)을 해시해서만 보관
const hashUid = (uid) =>
  typeof uid === 'string' && /^[a-f0-9]{16,64}$/.test(uid) ? crypto.createHash('sha256').update(uid).digest('hex').slice(0, 24) : null;

// 하루 기준은 한국 시간
const dayKey = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function clampStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function view(w, me) {
  return {
    id: w.id,
    text: w.isPublic ? w.text : '',
    isPublic: w.isPublic,
    species: w.species,
    name: w.name,
    feeds: w.feeds,
    goal: GOAL,
    status: w.status,
    createdAt: w.createdAt,
    starAt: w.starAt,
    mine: !!me && w.owner === me,
    fedToday: !!me && w.fedBy[me] === dayKey(),
  };
}

// 간단한 횟수 제한 (IP 기준)
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) {
    b.n = 0;
    b.reset = now + windowMs;
  }
  b.n++;
  buckets.set(key, b);
  return b.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60000).unref();

// ---------- 실시간 (WebSocket) ----------
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

// ---------- HTTP ----------
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4096) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

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

function stats() {
  const today = dayKey();
  let stars = 0;
  let todayN = 0;
  for (const w of wishes) {
    if (w.status === 'star') stars++;
    if (new Date(w.createdAt + 9 * 3600 * 1000).toISOString().slice(0, 10) === today) todayN++;
  }
  return { total: wishes.length, stars, today: todayN, online: sockets.size, goal: GOAL };
}

async function api(req, res, p, url) {
  const ip = req.socket.remoteAddress || '?';
  const me = hashUid(url.searchParams.get('uid'));

  // 통계
  if (p === '/api/stats' && req.method === 'GET') return json(res, 200, stats());

  // 소원 목록: status=swimming|star, sort=mix|new|near|recent, mine=1
  if (p === '/api/wishes' && req.method === 'GET') {
    const status = url.searchParams.get('status') || 'swimming';
    const sort = url.searchParams.get('sort') || 'new';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60));
    let list;
    if (url.searchParams.get('mine') === '1') {
      list = me ? wishes.filter((w) => w.owner === me).sort((a, b) => b.createdAt - a.createdAt) : [];
    } else {
      list = wishes.filter((w) => w.status === status);
      if (sort === 'mix') {
        // 연못에 띄울 묶음: 내 소원 + 새 소원 절반 + 곧 별이 될 소원 절반
        const pick = new Map();
        for (const w of list) if (me && w.owner === me) pick.set(w.id, w);
        const newest = [...list].sort((a, b) => b.createdAt - a.createdAt);
        const nearest = [...list].sort((a, b) => b.feeds - a.feeds || b.createdAt - a.createdAt);
        for (let i = 0; pick.size < limit && (i < newest.length || i < nearest.length); i++) {
          if (newest[i]) pick.set(newest[i].id, newest[i]);
          if (pick.size < limit && nearest[i]) pick.set(nearest[i].id, nearest[i]);
        }
        list = [...pick.values()];
      } else if (sort === 'near') list = [...list].sort((a, b) => b.feeds - a.feeds || b.createdAt - a.createdAt);
      else if (sort === 'recent') list = [...list].sort((a, b) => (b.starAt || 0) - (a.starAt || 0));
      else list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    }
    return json(res, 200, { goal: GOAL, wishes: list.slice(0, limit).map((w) => view(w, me)) });
  }

  // 소원 하나
  const one = /^\/api\/wishes\/([a-f0-9]{8,16})$/.exec(p);
  if (one && req.method === 'GET') {
    const w = byId.get(one[1]);
    return w ? json(res, 200, { goal: GOAL, wish: view(w, me) }) : json(res, 404, { error: 'not_found' });
  }

  // 소원 방생
  if (p === '/api/wishes' && req.method === 'POST') {
    const body = await readBody(req);
    const owner = hashUid(body.uid);
    const text = clampStr(body.text, MAX_TEXT);
    if (!owner) return json(res, 400, { error: 'bad_uid' });
    if (!text) return json(res, 400, { error: 'empty' });
    if (limited(`w:${ip}`, 6, 3600 * 1000)) return json(res, 429, { error: 'too_many' });
    if (wishes.some((w) => w.owner === owner && w.status === 'swimming')) return json(res, 409, { error: 'already_swimming' });
    /** @type {Wish} */
    const w = {
      id: crypto.randomBytes(5).toString('hex'),
      text,
      isPublic: body.isPublic !== false,
      species: SPECIES.includes(body.species) ? body.species : SPECIES[0],
      name: clampStr(body.name, 16) || '이름 없는 물고기',
      owner,
      createdAt: Date.now(),
      feeds: 0,
      fedBy: {},
      status: 'swimming',
      starAt: null,
    };
    wishes.push(w);
    byId.set(w.id, w);
    markDirty();
    broadcast({ t: 'wish:new', wish: view(w, null) });
    return json(res, 200, { goal: GOAL, wish: view(w, owner) });
  }

  // 먹이(응원) 주기: 같은 소원에는 하루 한 번, 내 소원에는 못 줌
  const feed = /^\/api\/wishes\/([a-f0-9]{8,16})\/feed$/.exec(p);
  if (feed && req.method === 'POST') {
    const body = await readBody(req);
    const who = hashUid(body.uid);
    const w = byId.get(feed[1]);
    if (!who) return json(res, 400, { error: 'bad_uid' });
    if (!w) return json(res, 404, { error: 'not_found' });
    if (w.status !== 'swimming') return json(res, 409, { error: 'already_star' });
    if (w.owner === who) return json(res, 403, { error: 'own_wish' });
    if (w.fedBy[who] === dayKey()) return json(res, 429, { error: 'fed_today' });
    if (limited(`f:${ip}`, 120, 3600 * 1000)) return json(res, 429, { error: 'too_many' });
    w.fedBy[who] = dayKey();
    w.feeds++;
    let becameStar = false;
    if (w.feeds >= GOAL) {
      w.status = 'star';
      w.starAt = Date.now();
      becameStar = true;
    }
    markDirty();
    broadcast({ t: 'wish:fed', id: w.id, feeds: w.feeds });
    if (becameStar) broadcast({ t: 'wish:star', wish: view(w, null) });
    return json(res, 200, { goal: GOAL, wish: view(w, who), becameStar });
  }

  return json(res, 404, { error: 'unknown' });
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

  if (p === '/api/health') return json(res, 200, { ok: true, wishes: wishes.length, online: sockets.size });
  if (p.startsWith('/api/')) {
    api(req, res, p, url).catch(() => json(res, 500, { error: 'server' }));
    return;
  }
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
  ws.on('message', () => {}); // 클라이언트 → 서버 메시지는 쓰지 않음 (모든 행동은 REST)
  ws.on('close', () => {
    sockets.delete(ws);
    announceOnline();
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

server.listen(PORT, () => {
  console.log(`🐟 소원 연못: http://localhost:${PORT}  (별까지 먹이 ${GOAL}번)`);
});
