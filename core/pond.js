// 소원 연못의 규칙 — Node 서버(server.js)와 Cloudflare(src/worker.js)가 함께 쓰는 한 곳
//
// 웹 표준 Request → Response 로만 동작하므로 어디서든 같은 코드가 돈다.
// 저장은 바깥에서 넣어 주는 persist(wish) 로, 알림은 broadcast(msg) 로.

import { checkText } from './moderation.js';

const SPECIES = ['berry', 'lemon', 'coral', 'neon'];
const MAX_TEXT = 60;
const MAX_BODY = 4096;
const REPORT_HIDE = 3; // 서로 다른 사람에게 이만큼 신고되면 자동으로 숨김 (관리자가 다시 보이게 할 수 있음)
const FEED_PER_IP = 3; // 같은 인터넷 주소에서 한 소원에 하루 최대 (휴대폰 통신사는 주소를 여럿이 함께 쓰므로 1이 아니라 3)

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

async function sha(s, n = 12) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)]
    .slice(0, n)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

// 익명 방문자: 브라우저가 만든 비밀값(uid)을 해시해서만 보관
async function hashUid(uid) {
  if (typeof uid !== 'string' || !/^[a-f0-9]{16,64}$/.test(uid)) return null;
  return sha(uid);
}

// 길이가 달라도 시간이 같게 비교 (관리자 비밀번호)
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
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
  constructor({ goal = 21, persist, remove, broadcast, online, adminToken = '' }) {
    this.goal = goal;
    this.persist = persist;
    this.remove = remove || (() => {});
    this.adminToken = adminToken;
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
    for (const w of this.wishes) {
      // 예전에 저장된 소원에도 새 항목 채우기
      w.hidden ??= false;
      w.reports ??= 0;
      w.reportedBy ??= {};
      w.fedIp ??= {};
    }
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
      reportedByMe: !!me && !!w.reportedBy?.[me],
      hidden: !!me && w.owner === me ? w.hidden : undefined, // 숨김 여부는 주인에게만
    };
  }

  // 관리자용: 비공개 소원 글과 신고 수까지
  adminView(w) {
    return {
      id: w.id,
      text: w.text,
      isPublic: w.isPublic,
      species: w.species,
      name: w.name,
      feeds: w.feeds,
      status: w.status,
      hidden: w.hidden,
      reports: w.reports,
      createdAt: w.createdAt,
      starAt: w.starAt,
      owner: w.owner.slice(0, 6),
    };
  }

  get visible() {
    return this.wishes.filter((w) => !w.hidden);
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
    for (const w of this.visible) {
      if (w.status === 'star') stars++;
      if (dayKey(w.createdAt) === today) todayN++;
    }
    return { total: this.visible.length, stars, today: todayN, online: this.online(), goal: this.goal };
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
    // 방문자 아이디는 헤더로 (예전 방식인 ?uid= 도 받아 줌)
    const me = await hashUid(request.headers.get('x-pond-uid') || url.searchParams.get('uid'));
    let body = null;
    if (method === 'POST') {
      const raw = await request.text().catch(() => '');
      if (raw.length > MAX_BODY) return json(413, { error: 'too_large' });
      try {
        body = JSON.parse(raw || '{}');
      } catch (_) {
        body = {};
      }
      if (!body || typeof body !== 'object') body = {};
    }

    if (p.startsWith('/api/admin/')) return this.admin(request, url, p, method, body, ip);

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
        list = this.visible.filter((w) => w.status === status);
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
      if (!w || (w.hidden && w.owner !== me)) return json(404, { error: 'not_found' });
      return json(200, { goal: this.goal, wish: this.view(w, me) });
    }

    // 소원 방생
    if (p === '/api/wishes' && method === 'POST') {
      const owner = await hashUid(body.uid);
      const text = clampStr(body.text, MAX_TEXT);
      if (!owner) return json(400, { error: 'bad_uid' });
      if (!text) return json(400, { error: 'empty' });
      const bad = checkText(text);
      if (bad) return json(400, { error: bad });
      if (this.limited(`w:${ip}`, 6, 3600 * 1000)) return json(429, { error: 'too_many' });
      if (this.wishes.some((w) => w.owner === owner && w.status === 'swimming')) return json(409, { error: 'already_swimming' });
      /** @type {Wish} */
      const w = {
        id: randomId(5),
        text,
        isPublic: body.isPublic !== false,
        species: SPECIES.includes(body.species) ? body.species : SPECIES[0],
        name: (!checkText(clampStr(body.name, 16)) && clampStr(body.name, 16)) || '이름 없는 물고기',
        owner,
        createdAt: Date.now(),
        feeds: 0,
        fedBy: {},
        status: 'swimming',
        starAt: null,
        hidden: false,
        reports: 0,
        reportedBy: {},
        fedIp: {},
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
      if (!w || w.hidden) return json(404, { error: 'not_found' });
      if (w.status !== 'swimming') return json(409, { error: 'already_star' });
      if (w.owner === who) return json(403, { error: 'own_wish' });
      if (w.fedBy[who] === dayKey()) return json(429, { error: 'fed_today' });
      // 아이디를 새로 만들어 몰아주기 막기: 같은 인터넷 주소에서는 한 소원에 하루 FEED_PER_IP 번까지
      const ipKey = await sha(`ip:${ip}`, 8);
      const today = dayKey();
      const ipRec = w.fedIp[ipKey]?.d === today ? w.fedIp[ipKey] : { d: today, n: 0 };
      if (ipRec.n >= FEED_PER_IP) return json(429, { error: 'fed_today' });
      if (this.limited(`f:${ip}`, 60, 3600 * 1000)) return json(429, { error: 'too_many' });
      ipRec.n++;
      w.fedIp[ipKey] = ipRec;
      // 오래된 주소 기록은 정리
      for (const k of Object.keys(w.fedIp)) if (w.fedIp[k].d !== today) delete w.fedIp[k];
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

    // 신고: 한 사람이 한 소원에 한 번, REPORT_HIDE 명이 신고하면 자동으로 숨김
    const rep = /^\/api\/wishes\/([a-f0-9]{8,16})\/report$/.exec(p);
    if (rep && method === 'POST') {
      const who = await hashUid(body.uid);
      const w = this.byId.get(rep[1]);
      if (!who) return json(400, { error: 'bad_uid' });
      if (!w || w.hidden) return json(404, { error: 'not_found' });
      if (w.owner === who) return json(403, { error: 'own_wish' });
      if (w.reportedBy[who]) return json(200, { ok: true, already: true });
      if (this.limited(`r:${ip}`, 20, 3600 * 1000)) return json(429, { error: 'too_many' });
      w.reportedBy[who] = Date.now();
      w.reports++;
      if (w.reports >= REPORT_HIDE && !w.hidden) {
        w.hidden = true;
        this.broadcast({ t: 'wish:hide', id: w.id });
      }
      await this.persist(w);
      return json(200, { ok: true });
    }

    return json(404, { error: 'unknown' });
  }

  // ---------- 관리자 ----------
  async admin(request, url, p, method, body, ip) {
    if (!this.adminToken) return json(503, { error: 'admin_disabled' });
    const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!sameSecret(auth, this.adminToken)) {
      // 비밀번호 맞히기 막기: 틀린 시도는 한 시간에 10번까지
      if (this.limited(`adm:${ip}`, 10, 3600 * 1000)) return json(429, { error: 'too_many' });
      return json(401, { error: 'unauthorized' });
    }

    if (p === '/api/admin/stats' && method === 'GET') {
      let feeds = 0;
      let hidden = 0;
      let reported = 0;
      for (const w of this.wishes) {
        feeds += w.feeds;
        if (w.hidden) hidden++;
        if (w.reports > 0) reported++;
      }
      return json(200, { ...this.stats(), all: this.wishes.length, feeds, hidden, reported });
    }

    // 목록: filter=all|swimming|star|hidden|reported, q=검색어
    if (p === '/api/admin/wishes' && method === 'GET') {
      const filter = url.searchParams.get('filter') || 'all';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      let list = [...this.wishes];
      if (filter === 'swimming') list = list.filter((w) => w.status === 'swimming' && !w.hidden);
      else if (filter === 'star') list = list.filter((w) => w.status === 'star' && !w.hidden);
      else if (filter === 'hidden') list = list.filter((w) => w.hidden);
      else if (filter === 'reported') list = list.filter((w) => w.reports > 0);
      if (q) list = list.filter((w) => w.text.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || w.id.includes(q));
      list.sort((a, b) => (filter === 'reported' ? b.reports - a.reports : 0) || b.createdAt - a.createdAt);
      return json(200, { total: list.length, wishes: list.slice(0, 500).map((w) => this.adminView(w)) });
    }

    // 백업 내려받기 (주인 해시 포함 — 복원용)
    if (p === '/api/admin/export' && method === 'GET') {
      return new Response(JSON.stringify(this.wishes), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="wishes-${dayKey()}.json"`,
          'cache-control': 'no-store',
        },
      });
    }

    // 하나 처리: action=hide|unhide|delete|clear_reports
    const one = /^\/api\/admin\/wishes\/([a-f0-9]{8,16})$/.exec(p);
    if (one && method === 'POST') {
      const w = this.byId.get(one[1]);
      if (!w) return json(404, { error: 'not_found' });
      const action = body.action;
      if (action === 'delete') {
        this.wishes = this.wishes.filter((x) => x !== w);
        this.byId.delete(w.id);
        await this.remove(w);
        this.broadcast({ t: 'wish:hide', id: w.id });
        return json(200, { ok: true, deleted: true });
      }
      if (action === 'hide') {
        w.hidden = true;
        this.broadcast({ t: 'wish:hide', id: w.id });
      } else if (action === 'unhide') {
        w.hidden = false;
        w.reports = 0;
        w.reportedBy = {};
      } else if (action === 'clear_reports') {
        w.reports = 0;
        w.reportedBy = {};
      } else return json(400, { error: 'bad_action' });
      await this.persist(w);
      return json(200, { ok: true, wish: this.adminView(w) });
    }

    return json(404, { error: 'unknown' });
  }
}
