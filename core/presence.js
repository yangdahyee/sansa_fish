// 지금 연못에 있는 사람(접속 정보)과 몸짓(응원·헤엄·이동) — Node 와 Cloudflare 공용
import { checkText } from './moderation.js';

const SPECIES = ['berry', 'lemon', 'coral', 'neon'];
const SWIM_MOVES = ['dash', 'glide', 'circle', 'nibble', 'forage', 'roll', 'wag'];
export const EMOTE_GAP_MS = { cheer: 700, swim: 600, goto: 200 };

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
  };
}

// 몸짓: cheer(응원, to=받는 사람), swim(헤엄 동작), goto(이동 목적지)
export function cleanEmote(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.kind === 'cheer') {
    return { kind: 'cheer', to: typeof r.to === 'string' && /^[a-f0-9]{6,16}$/.test(r.to) ? r.to : null, jump: !!r.jump };
  }
  if (r.kind === 'swim' && SWIM_MOVES.includes(r.move)) return { kind: 'swim', move: r.move };
  if (r.kind === 'goto' && Array.isArray(r.p) && r.p.length === 3 && r.p.every((v) => Number.isFinite(Number(v)))) {
    return { kind: 'goto', p: r.p.map((v) => clamp(Number(v), -30, 30)) };
  }
  return null;
}
