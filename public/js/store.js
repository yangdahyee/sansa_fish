// 나의 꿈/할 일은 이 브라우저(localStorage)에 저장된다.
import { randomName, SLEEP_AFTER_MS } from './data.js';

const KEY = 'deungyongmun:v1';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') return s;
  } catch (_) {}
  return null;
}

export const state = load() || {
  name: randomName(),
  dream: null, // { text, species, isPublic, todos:[{text, done, doneAt}], createdAt, lastActive }
  stars: [], // 내가 등용시킨 꿈들 [{ text, species, at }]
  sound: false,
};

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (_) {}
}

export function progress() {
  const d = state.dream;
  if (!d) return { done: 0, total: 0 };
  return { done: d.todos.filter((t) => t.done).length, total: d.todos.length };
}

export function isSleeping() {
  const d = state.dream;
  if (!d) return false;
  return Date.now() - (d.lastActive || d.createdAt) > SLEEP_AFTER_MS;
}

export function touch() {
  if (state.dream) state.dream.lastActive = Date.now();
}
