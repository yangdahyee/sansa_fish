// 소원 글 거르기: 욕설·성적 표현, 링크·연락처(광고·개인정보)
// 완벽한 필터는 없으므로 신고 + 관리자 페이지와 함께 쓴다. 목록은 필요할 때 늘리면 된다.

// 띄어쓰기·기호를 빼고 비교하는 낱말 (예: "시 발", "시.발" 도 걸림)
const WORDS = [
  '시발', '씨발', '씨빨', '시빨', '씨바', 'ㅅㅂ', 'ㅆㅂ', 'ㅅ1ㅂ', '병신', 'ㅂㅅ', '븅신',
  '개새끼', '개세끼', '개색기', '개색끼', '새끼야', '좆', 'ㅈㄴ같', '좆같', '지랄', 'ㅈㄹ',
  '미친년', '미친놈', '썅', '쌍년', '쌍놈', '창녀', '걸레년', '느금마', '니애미', '애미뒤',
  // '보지·자지·니미'처럼 평범한 문장('보지 않기', '자지 않고', '어머니 미소')에 섞이는 말은 넣지 않음
  '섹스', '야동', '딸딸이',
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'porn',
];

const LINK = /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|kr|co|io|me|org|xyz|site|shop|link|ly)\b|open\.kakao|t\.me\/|discord\.gg)/i;
const PHONE = /(01[016789]|0\d{1,2})[-\s.]?\d{3,4}[-\s.]?\d{4}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const squash = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}_]/gu, '');
// 욕설과 글자가 겹치는 평범한 낱말은 먼저 지우고 비교
const ALLOW = ['시발점', '시발역', '시발택시'];

/** @returns {null | 'blocked_word' | 'blocked_link'} */
export function checkText(text) {
  if (!text) return null;
  if (LINK.test(text) || PHONE.test(text) || EMAIL.test(text)) return 'blocked_link';
  let t = squash(text);
  for (const a of ALLOW) t = t.split(a).join('');
  if (WORDS.some((w) => t.includes(squash(w)))) return 'blocked_word';
  return null;
}
