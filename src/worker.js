// 소원 연못 — Cloudflare Workers 버전
// 정적 파일(public/)은 Cloudflare 가 바로 내주고, /api/* 와 /ws 만 이 Worker 를 거쳐
// 연못 하나를 맡은 Durable Object(PondDO)로 간다. 규칙은 core/pond.js (Node 서버와 같은 코드).
import { DurableObject } from 'cloudflare:workers';
import { Pond } from '../core/pond.js';
import { newPid, cleanProfile, cleanEmote, EMOTE_GAP_MS, personKey, summarizePresence, STALE_MS } from '../core/presence.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
      const stub = env.POND.get(env.POND.idFromName('main'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class PondDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pond = new Pond({
      goal: Number(env.WISH_GOAL) || 5,
      // 소원 하나 = 저장소 항목 하나 (Durable Object 내장 저장소, 따로 DB 필요 없음)
      persist: (w) => ctx.storage.put(`w:${w.id}`, w),
      remove: (w) => ctx.storage.delete(`w:${w.id}`),
      // 관리자 비밀번호: Cloudflare 대시보드 → Settings → Variables and Secrets → ADMIN_TOKEN (Secret)
      adminToken: env.ADMIN_TOKEN || '',
      broadcast: (msg) => this.broadcast(msg),
      online: () => this.presence().n,
    });
    // 브라우저가 25초마다 보내는 'ping' 에 잠든 채로 'pong' 으로 답함 (깨우지 않아 요금이 들지 않음)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // 깨어날 때 저장된 소원을 모두 불러옴
    ctx.blockConcurrencyWhile(async () => {
      const all = await ctx.storage.list({ prefix: 'w:' });
      this.pond.load([...all.values()]);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      // 잠들기(Hibernation) 방식: 연결만 열어 두고 조용할 땐 요금이 거의 들지 않음
      this.ctx.acceptWebSocket(pair[1]);
      // 잠들었다 깨어나도 누가 누군지 남도록 연결마다 정보를 붙여 둠
      const pid = newPid();
      const now = Date.now();
      pair[1].serializeAttachment({ pid, profile: null, key: null, at: now, seen: now });
      pair[1].send(JSON.stringify({ t: 'welcome', pid }));
      pair[1].send(JSON.stringify({ t: 'online', n: this.presence().n }));
      this.announceOnline();
      // 끊긴 연결 정리를 위해 30초마다 확인 (연결이 남아 있는 동안만)
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 30 * 1000);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return this.pond.handle(request, request.headers.get('cf-connecting-ip') || '?');
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(s);
      } catch (_) {}
    }
  }

  // 지금 연못에 있는 사람들 (열린 연결 하나 = 한 명)
  presence() {
    const conns = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1) continue;
      const a = ws.deserializeAttachment();
      if (a) conns.push(a);
    }
    return summarizePresence(conns);
  }

  announceOnline() {
    clearTimeout(this.onlineTimer);
    this.onlineTimer = setTimeout(() => {
      const { users, n } = this.presence();
      this.broadcast({ t: 'presence', users, n });
    }, 250);
  }

  // 30초마다: 오래 신호가 없는 연결(폰 화면 꺼짐·앱 내림·네트워크 끊김)을 닫아 사람 수와 연못에서 뺌
  async alarm() {
    const now = Date.now();
    let closed = 0;
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const a = ws.deserializeAttachment() || {};
      const pong = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0;
      if (now - Math.max(a.seen || 0, a.at || 0, pong) > STALE_MS) {
        try {
          ws.close(4000, 'stale');
        } catch (_) {}
        closed++;
      }
    }
    if (closed) this.announceOnline();
    if (sockets.length > closed) await this.ctx.storage.setAlarm(now + 30 * 1000);
  }

  // 자기소개(hello)와 몸짓(emote: 응원·헤엄·이동)
  async webSocketMessage(ws, data) {
    let m;
    try {
      m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch (_) {
      return;
    }
    const a = ws.deserializeAttachment() || { pid: newPid(), profile: null, at: Date.now() };
    a.seen = Date.now();
    if (m?.t === 'hello') {
      a.profile = cleanProfile(m.profile);
      a.key = (await personKey(m.uid)) || a.key || null;
      a.at = Date.now();
      ws.serializeAttachment(a);
      ws.send(JSON.stringify({ t: 'you', k: a.key })); // 내 다른 탭·앱을 다른 사람으로 그리지 않게
      this.announceOnline();
    } else if (m?.t === 'emote' && a.profile) {
      const e = cleanEmote(m);
      if (!e) return;
      this.lastEmote ||= new Map();
      const key = `${a.pid}:${e.kind}`;
      const now = Date.now();
      if (now - (this.lastEmote.get(key) || 0) < EMOTE_GAP_MS[e.kind]) return;
      this.lastEmote.set(key, now);
      if (this.lastEmote.size > 5000) this.lastEmote.clear();
      const s = JSON.stringify({ t: 'emote', pid: a.pid, ...e });
      for (const o of this.ctx.getWebSockets()) {
        if (o === ws) continue;
        try {
          o.send(s);
        } catch (_) {}
      }
    }
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code, 'bye');
    } catch (_) {}
    this.announceOnline();
  }

  async webSocketError() {
    this.announceOnline();
  }
}
