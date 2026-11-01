// 소원 연못의 규칙 — Node 서버(server.js)와 Cloudflare(src/worker.js)가 함께 쓰는 한 곳
//
// 웹 표준 Request → Response 로만 동작하므로 어디서든 같은 코드가 돈다.
// 저장은 바깥에서 넣어 주는 persist(wish) 로, 알림은 broadcast(msg) 로.

const SPECIES = ['berry', 'lemon', 'coral', 'neon'];
const MAX_TEXT = 60;

// 하루 기준은 한국 시간
export const dayKey = (t = Date.now()) => new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);

function clampStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function randomId(bytes = 5) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 익명 방문자: 브라우저가 만든 비밀값(uid)을 해시해서만 보관
async function hashUid(uid) {
  if (typeof uid !== 'string' || !/^[a-f0-9]{16,64}$/.test(uid)) return null;
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
  return [...new Uint8Array(d)]
    .slice(0, 12)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

const json = (code, body) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * @typedef {{ id: string, text: string, isPublic: boolean, species: string, name: string,
 *   owner: string, createdAt: number, feeds: number, fedBy: Record<string, string>,
 *   status: 'swimming' | 'star', starAt: number | null }} Wish
 */
export class Pond {
  /**
   * @param {{ goal?: number, persist: (w: Wish) => void | Promise<void>, broadcast: (msg: any) => void, online: () => number }} opts
   */
  constructor({ goal = 21, persist, broadcast, online }) {
    this.goal = goal;
    this.persist = persist;
    this.broadcast = broadcast;
    this.online = online;
    /** @type {Wish[]} */
    this.wishes = [];
    this.byId = new Map();
    this.buckets = new Map();
  }

  /** @param {Wish[]} list */
  load(list) {
    this.wishes = list.filter((w) => w && w.id).sort((a, b) => a.createdAt - b.createdAt);
    this.byId = new Map(this.wishes.map((w) => [w.id, w]));
  }

  view(w, me) {
    return {
      id: w.id,
      text: w.isPublic ? w.text : '',
      isPublic: w.isPublic,
      species: w.species,
      name: w.name,
      feeds: w.feeds,
      goal: this.goal,
      status: w.status,
      createdAt: w.createdAt,
      starAt: w.starAt,
      mine: !!me && w.owner === me,
      fedToday: !!me && w.fedBy[me] === dayKey(),
    };
  }

  // 간단한 횟수 제한 (IP 기준, 메모리에만)
  limited(key, max, windowMs) {
    const now = Date.now();
    if (this.buckets.size > 5000) for (const [k, b] of this.buckets) if (now > b.reset) this.buckets.delete(k);
    const b = this.buckets.get(key) || { n: 0, reset: now + windowMs };
    if (now > b.reset) {
      b.n = 0;
      b.reset = now + windowMs;
    }
    b.n++;
    this.buckets.set(key, b);
    return b.n > max;
  }

  stats() {
    const today = dayKey();
    let stars = 0;
    let todayN = 0;
    for (const w of this.wishes) {
      if (w.status === 'star') stars++;
      if (dayKey(w.createdAt) === today) todayN++;
    }
    return { total: this.wishes.length, stars, today: todayN, online: this.online(), goal: this.goal };
  }

  /**
   * /api/* 요청 처리
   * @param {Request} request
   * @param {string} ip
   */
  async handle(request, ip = '?') {
    const url = new URL(request.url);
    const p = url.pathname;
    const method = request.method;
    const me = await hashUid(url.searchParams.get('uid'));
    const body = method === 'POST' ? await request.json().catch(() => ({})) : null;

    if (p === '/api/health') return json(200, { ok: true, wishes: this.wishes.length, online: this.online() });
    if (p === '/api/stats' && method === 'GET') return json(200, this.stats());

    // 목록: status=swimming|star, sort=mix|new|near|recent, mine=1
    if (p === '/api/wishes' && method === 'GET') {
      const status = url.searchParams.get('status') || 'swimming';
      const sort = url.searchParams.get('sort') || 'new';
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60));
      let list;
      if (url.searchParams.get('mine') === '1') {
        list = me ? this.wishes.filter((w) => w.owner === me).sort((a, b) => b.createdAt - a.createdAt) : [];
      } else {
        list = this.wishes.filter((w) => w.status === status);
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
      return json(200, { goal: this.goal, wishes: list.slice(0, limit).map((w) => this.view(w, me)) });
    }

    // 소원 하나
    const one = /^\/api\/wishes\/([a-f0-9]{8,16})$/.exec(p);
    if (one && method === 'GET') {
      const w = this.byId.get(one[1]);
      return w ? json(200, { goal: this.goal, wish: this.view(w, me) }) : json(404, { error: 'not_found' });
    }

    // 소원 방생
    if (p === '/api/wishes' && method === 'POST') {
      const owner = await hashUid(body.uid);
      const text = clampStr(body.text, MAX_TEXT);
      if (!owner) return json(400, { error: 'bad_uid' });
      if (!text) return json(400, { error: 'empty' });
      if (this.limited(`w:${ip}`, 6, 3600 * 1000)) return json(429, { error: 'too_many' });
      if (this.wishes.some((w) => w.owner === owner && w.status === 'swimming')) return json(409, { error: 'already_swimming' });
      /** @type {Wish} */
      const w = {
        id: randomId(5),
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
      this.wishes.push(w);
      this.byId.set(w.id, w);
      await this.persist(w);
      this.broadcast({ t: 'wish:new', wish: this.view(w, null) });
      return json(200, { goal: this.goal, wish: this.view(w, owner) });
    }

    // 먹이(응원): 같은 소원에는 하루 한 번, 내 소원에는 못 줌
    const feed = /^\/api\/wishes\/([a-f0-9]{8,16})\/feed$/.exec(p);
    if (feed && method === 'POST') {
      const who = await hashUid(body.uid);
      const w = this.byId.get(feed[1]);
      if (!who) return json(400, { error: 'bad_uid' });
      if (!w) return json(404, { error: 'not_found' });
      if (w.status !== 'swimming') return json(409, { error: 'already_star' });
      if (w.owner === who) return json(403, { error: 'own_wish' });
      if (w.fedBy[who] === dayKey()) return json(429, { error: 'fed_today' });
      if (this.limited(`f:${ip}`, 120, 3600 * 1000)) return json(429, { error: 'too_many' });
      w.fedBy[who] = dayKey();
      w.feeds++;
      let becameStar = false;
      if (w.feeds >= this.goal) {
        w.status = 'star';
        w.starAt = Date.now();
        becameStar = true;
      }
      await this.persist(w);
      this.broadcast({ t: 'wish:fed', id: w.id, feeds: w.feeds });
      if (becameStar) this.broadcast({ t: 'wish:star', wish: this.view(w, null) });
      return json(200, { goal: this.goal, wish: this.view(w, who), becameStar });
    }

    return json(404, { error: 'unknown' });
  }
}
