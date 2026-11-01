// 소원 연못 — Cloudflare Workers 버전
// 정적 파일(public/)은 Cloudflare 가 바로 내주고, /api/* 와 /ws 만 이 Worker 를 거쳐
// 연못 하나를 맡은 Durable Object(PondDO)로 간다. 규칙은 core/pond.js (Node 서버와 같은 코드).
import { DurableObject } from 'cloudflare:workers';
import { Pond } from '../core/pond.js';

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
      goal: Number(env.WISH_GOAL) || 21,
      // 소원 하나 = 저장소 항목 하나 (Durable Object 내장 저장소, 따로 DB 필요 없음)
      persist: (w) => ctx.storage.put(`w:${w.id}`, w),
      remove: (w) => ctx.storage.delete(`w:${w.id}`),
      // 관리자 비밀번호: Cloudflare 대시보드 → Settings → Variables and Secrets → ADMIN_TOKEN (Secret)
      adminToken: env.ADMIN_TOKEN || '',
      broadcast: (msg) => this.broadcast(msg),
      online: () => ctx.getWebSockets().length,
    });
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
      pair[1].send(JSON.stringify({ t: 'online', n: this.ctx.getWebSockets().length }));
      this.announceOnline();
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

  announceOnline() {
    clearTimeout(this.onlineTimer);
    this.onlineTimer = setTimeout(() => this.broadcast({ t: 'online', n: this.ctx.getWebSockets().length }), 400);
  }

  async webSocketMessage() {
    // 클라이언트 → 서버 메시지는 쓰지 않음 (모든 행동은 /api)
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
