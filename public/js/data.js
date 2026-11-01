// 공용 상수: 물고기 종류, 정해진 말, 무작위 이름

export const SPECIES = {
  berry: { label: '베리', color: '#8f3fae', file: '/assets/fish/berry.glb' },
  lemon: { label: '레몬', color: '#e9cf25', file: '/assets/fish/lemon.glb' },
  coral: { label: '코랄', color: '#f2786c', file: '/assets/fish/coral.glb' },
  neon: { label: '네온', color: '#e21aa6', file: '/assets/fish/neon.glb' },
};
export const SPECIES_IDS = Object.keys(SPECIES);

// 자유 채팅 대신 정해진 말만 (server.js 의 PHRASE_COUNT 와 개수를 맞출 것)
export const PHRASES = [
  '응원해요 🙌',
  '같이 가요 🐟',
  '오늘 하나 했어요 ✔',
  '천천히 가도 돼요 🌙',
  '멋진 꿈이에요 ✨',
  '잠깐 쉬어 갈게요 💤',
];

const COLORS = ['푸른', '붉은', '은빛', '금빛', '노을', '새벽', '달빛', '물빛', '연둣빛', '복숭아'];
const PARTS = ['비늘', '지느러미', '꼬리', '물결', '방울', '물살', '윤슬', '조약돌'];

export function randomName() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return `${pick(COLORS)} ${pick(PARTS)}`;
}

export const MAX_TODOS = 10;
export const SLEEP_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3일 동안 아무것도 안 하면 수초 아래에서 쉼

// 헤엄 동작 (server.js 의 MOVE_COUNT 와 개수를 맞출 것)
export const MOVES = [
  { id: 'dash', label: '💨 질주' },
  { id: 'glide', label: '🪶 활공' },
  { id: 'circle', label: '🌀 맴돌기' },
  { id: 'nibble', label: '🫧 뻐끔뻐끔' },
  { id: 'forage', label: '🪸 바닥 탐색' },
  { id: 'roll', label: '🔄 공중제비' },
  { id: 'wag', label: '💃 꼬리 춤' },
];
