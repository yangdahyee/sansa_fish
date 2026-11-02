// 지금 연못에 있는 사람(접속 정보)과 몸짓(응원·헤엄·이동) — Node 와 Cloudflare 공용
import { checkText } from './moderation.js';

const SPECIES = ['berry', 'lemon', 'coral', 'neon'];
const SWIM_MOVES = ['dash', 'glide', 'circle', 'nibble', 'forage', 'roll', 'wag'];
export const EMOTE_GAP_MS = { cheer: 700, swim: 600, goto: 200, say: 1200, sky: 350 };
// 정해진 말 개수 (글은 public/js/data.js 의 PHRASES — 개수를 맞출 것). 자유 채팅이 아니라서 거를 필요가 없음
export const PHRASE_COUNT = 8;
const PID_RE = /^[a-f0-9]{6,16}$/;

export function newPid() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 접속한 사람이 보내는 '나는 이런 물고기' 정보
export function cleanProfile(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 16) : '';
  if (!name || checkText(name)) name = '물고기';
  return {
    name,
    species: SPECIES.includes(r.species) ? r.species : SPECIES[0],
    wishId: typeof r.wishId === 'string' && /^[a-f0-9]{8,16}$/.test(r.wishId) ? r.wishId : null,
    // 같이 헤엄치는 상대 (그 사람 물고기 옆에 붙어 다님). 접속 정보에 담아야 새로 온 사람에게도 보임
    follow: typeof r.follow === 'string' && PID_RE.test(r.follow) ? r.follow : null,
  };
}

// 몸짓: cheer(응원, to=받는 사람), say(정해진 말, to=받는 사람), swim(헤엄 동작), goto(이동 목적지), sky(하늘 연못 반짝이)
export function cleanEmote(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.kind === 'cheer') {
    return { kind: 'cheer', to: typeof r.to === 'string' && PID_RE.test(r.to) ? r.to : null, jump: !!r.jump };
  }
  if (r.kind === 'say' && Number.isInteger(r.i) && r.i >= 0 && r.i < PHRASE_COUNT) {
    return { kind: 'say', i: r.i, to: typeof r.to === 'string' && PID_RE.test(r.to) ? r.to : null };
  }
  if (r.kind === 'swim' && SWIM_MOVES.includes(r.move)) return { kind: 'swim', move: r.move };
  // 하늘 연못에 반짝이 뿌리기 (섬 기준 x, z)
  if (r.kind === 'sky' && Array.isArray(r.p) && r.p.length === 2 && r.p.every((v) => Number.isFinite(Number(v)))) {
    return { kind: 'sky', p: r.p.map((v) => clamp(Number(v), -15, 15)) };
  }
  if (r.kind === 'goto' && Array.isArray(r.p) && r.p.length === 3 && r.p.every((v) => Number.isFinite(Number(v)))) {
    return { kind: 'goto', p: r.p.map((v) => clamp(Number(v), -30, 30)) };
  }
  return null;
}

// 같은 브라우저(같은 익명 아이디)의 탭인지 알아보는 짧은 값 — 내 다른 탭을 내 화면에 남의 물고기로 그리지 않게.
// 아이디를 한 번 더 해시해 앞부분만 쓰므로, 이 값으로 아이디를 알아낼 수 없음
export async function personKey(uid) {
  if (typeof uid !== 'string' || !/^[a-f0-9]{16,64}$/.test(uid)) return null;
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`person:${uid}`));
  return [...new Uint8Array(d)]
    .slice(0, 6)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

// 열린 연결들 → 접속자 목록 + 접속자 수 (탭·창 하나하나가 한 명. 끊긴 연결은 STALE_MS 로 정리됨)
// conns: [{ pid, key, profile, at }]
export function summarizePresence(conns) {
  const users = conns.filter((c) => c.profile).map((c) => ({ pid: c.pid, k: c.key || null, ...c.profile }));
  return { users, n: conns.length };
}

// 연결이 살아 있는지: 브라우저가 이 간격보다 오래 아무 신호(ping)도 없으면 끊긴 것으로 봄
export const STALE_MS = 75 * 1000;
