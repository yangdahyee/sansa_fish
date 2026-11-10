// 이 브라우저에만 남는 정보: 익명 아이디, 내가 본 먹이 수, 축하를 본 별, 소리 설정
// 이름은 저장하지 않고 들어올 때마다 새로 뽑음 (이미 띄운 소원은 띄울 때의 이름 그대로)
import { randomName } from './data.js';

const KEY = 'wish-pond:v1';

function newUid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object' && s.uid) return s;
  } catch (_) {}
  return null;
}

export const state = load() || {
  uid: newUid(), // 서버에는 해시로만 저장됨 — 내 소원 확인·하루 한 번 먹이에 쓰임
  sound: false,
  seen: {}, // { [wishId]: 마지막으로 본 먹이 수 } → "n명이 먹이를 줬어요"
  celebrated: [], // 축하 장면을 이미 본 내 별
  fed: [], // 내가 먹이를 준 소원 (그 소원이 별이 되면 함께 기뻐하기)
};
state.name = randomName();
state.seen ||= {};
state.celebrated ||= [];
state.fed ||= [];

export function save() {
  try {
    if (state.fed.length > 300) state.fed = state.fed.slice(-300);
    const { name, ...keep } = state;
    localStorage.setItem(KEY, JSON.stringify(keep));
  } catch (_) {}
}
