// 소원 연못 — 화면(UI) · 3D 연못 · 서버를 잇는 곳
//
//  물속  : 지금 응원이 필요한 소원 (물고기 한 마리 = 소원 하나)
//  수면  : 물고기가 가끔 올라와 소원 한 줄을 띄움
//  하늘 연못 : 먹이를 GOAL 번 받아 폭포를 오른 소원 (금빛 물고기)
import { World } from './world.js';
import { Live } from './live.js';
import { SPECIES, SPECIES_IDS, PHRASES, randomName } from './data.js';
import { state, save } from './store.js';
import { sfx, setSound, isSoundOn, buzz } from './sound.js';

const $ = (id) => document.getElementById(id);
let GOAL = 21;

// ---------------------------------------------------------------------
// 서버
// ---------------------------------------------------------------------
async function api(path, body) {
  // 방문자 아이디는 주소창이 아니라 헤더로 (서버 기록에 남지 않게)
  const headers = { 'x-pond-uid': state.uid };
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify({ uid: state.uid, ...body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (data.goal) GOAL = data.goal;
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error, status: res.status });
  return data;
}

// ---------------------------------------------------------------------
// 작은 화면 도우미
// ---------------------------------------------------------------------
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => (el.style.opacity = '0'), 3800);
  setTimeout(() => el.remove(), 4400);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

function caption(text, ms = 4000) {
  const el = $('caption');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(caption.t);
  caption.t = setTimeout(() => el.classList.remove('on'), ms);
}

// 소원이 이루어지는 마지막 장면
function celebrate({ title, dream, meta = '' }) {
  const box = $('celebrate');
  box.textContent = '';
  const card = document.createElement('div');
  card.className = 'cele-card';
  const mk = (cls, text, delay) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    el.style.animationDelay = `${delay}s`;
    card.appendChild(el);
  };
  mk('cele-orn', '✦ 소원 성취 ✦', 0);
  mk('big', title, 0.15);
  mk('cele-dream', dream, 0.55);
  if (meta) mk('cele-meta', meta, 1.0);
  box.appendChild(card);
  box.classList.remove('out');
  box.hidden = false;
  for (let i = 0; i < 46; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    p.textContent = ['🌸', '✨', '🪷', '✦'][i % 4];
    p.style.left = `${Math.random() * 100}vw`;
    p.style.animationDuration = `${3.5 + Math.random() * 3.5}s`;
    p.style.animationDelay = `${Math.random() * 2}s`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 9500);
  }
  clearTimeout(celebrate.t);
  celebrate.t = setTimeout(() => box.classList.add('out'), 4600);
  clearTimeout(celebrate.t2);
  celebrate.t2 = setTimeout(() => (box.hidden = true), 5400);
}

const fmtDate = (t) => new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const wishLine = (w) => (w.text ? `“${w.text}”` : '🔒 마음속에 간직한 소원');

// 3D 연못에 넘길 물고기 정보
const fishData = (w, extra = {}) => ({
  id: w.id,
  name: w.name,
  species: w.species,
  dream: w.text,
  hasDream: true,
  done: w.feeds,
  total: w.goal || GOAL,
  sleeping: false,
  ...extra,
});

// ---------------------------------------------------------------------
async function main() {
  const world = new World($('scene'), $('labels'));
  world.sfx = sfx;
  await world.init((p) => {
    $('loading').querySelector('p').textContent = `물고기를 부르는 중… ${Math.round(p * 100)}%`;
  });
  $('loading').classList.add('done');

  const live = new Live(); // 실시간: 새 소원·먹이·별, 지금 있는 사람·몸짓
  const wishes = new Map(); // 연못에 있는(또는 본) 소원들
  let myWish = null; // 지금 헤엄치는 내 소원
  let myStars = [];
  let stats = { total: 0, stars: 0, online: 0 };
  const touchOnly = matchMedia('(hover: none)').matches;
  const mobile = () => matchMedia('(max-width: 720px)').matches;

  // ---------- 상단 통계 ----------
  function renderStats() {
    const n = (v) => Number(v || 0).toLocaleString('ko-KR');
    $('stats').textContent = `소원 ${n(stats.total)} · 이룬 소원 ${n(stats.stars)}${stats.online > 1 ? ` · 지금 ${n(stats.online)}명` : ''}`;
    // 휴대폰은 제목줄이 숨겨지므로 접속자 수를 따로 (나 포함)
    const pill = $('onlinePill');
    const on = Math.max(1, stats.online || 0);
    pill.hidden = !stats.online;
    if ($('onlineN').textContent !== String(on)) {
      $('onlineN').textContent = String(on);
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
    }
    $('goalText').textContent = GOAL;
  }

  $('onlinePill').onclick = () => {
    const names = [...online.values()].map((u) => u.name);
    const n = Math.max(1, stats.online || 0);
    const me = myTabs ? `나(탭 ${myTabs + 1}개)` : '나';
    if (names.length) toast(`🐟 지금 연못에: ${me}, ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` 외 ${names.length - 6}명` : ''}`);
    else if (myTabs) toast(`🐟 지금 ${n}명 · 모두 이 기기에서 연 탭이에요`);
    else if (n > 1) toast(`🐟 지금 ${n}명이 있어요 · 다른 분은 아직 연못에 들어오는 중이에요`); // 접속 수는 먼저, 이름은 조금 뒤에 옴
    else toast('🐟 지금은 나 혼자 연못에 있어요');
  };

  // ---------- 영화 같은 장면 (별이 될 때) ----------
  let cinemaTimer = null;
  function cinema(on, { maxMs = 45000 } = {}) {
    document.body.classList.toggle('cinema', on);
    world.setCinema(on);
    clearTimeout(cinemaTimer);
    if (on) cinemaTimer = setTimeout(() => cinema(false), maxMs);
  }
  const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  let ceremonyBusy = false;

  // ---------- 연못에 소원 물고기 넣기 ----------
  function putFish(w, opts = {}) {
    wishes.set(w.id, w);
    if (w.status !== 'swimming') return null;
    const f = world.upsertFish(fishData(w, opts.highlight ? { highlight: true } : {}), { isMe: !!w.mine, splashIn: !!opts.splash });
    world.refreshMarkers();
    if (typeof syncPresence === 'function' && online.size) syncPresence();
    return f;
  }

  // ---------- 내 소원 패널 ----------
  let pickedSpecies = SPECIES_IDS[Math.floor(Math.random() * SPECIES_IDS.length)];
  function renderSpecies() {
    const box = $('speciesPicker');
    box.textContent = '';
    for (const id of SPECIES_IDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = id === pickedSpecies ? 'on' : '';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = SPECIES[id].color;
      const t = document.createElement('span');
      t.textContent = SPECIES[id].label;
      b.append(dot, t);
      b.onclick = () => {
        pickedSpecies = id;
        renderSpecies();
        syncAvatar(); // 고른 물고기로 내 물고기가 바뀜
        sfx.bubble();
      };
      box.appendChild(b);
    }
  }

  function renderPanel() {
    $('releaseView').hidden = !!myWish;
    $('myView').hidden = !myWish;
    if (!myWish) renderSpecies();
    else {
      const w = myWish;
      $('myName').textContent = `${SPECIES[w.species]?.label || ''} · ${w.name}`;
      $('myBadge').textContent = w.isPublic ? '소원 공개' : '마음속 소원';
      $('myText').textContent = w.text ? `“${w.text}”` : '🔒 마음속 소원';
      $('myFill').style.width = `${Math.min(100, (w.feeds / GOAL) * 100)}%`;
      $('myLabel').textContent = w.hidden
        ? '🙈 신고가 들어와 잠시 숨겨졌어요. 관리자가 확인하면 다시 보여요'
        : `✨ 먹이 ${w.feeds} / ${GOAL} · ${GOAL - w.feeds}번 더 주면 소원이 이루어져요`;
    }
    $('myStars').hidden = myStars.length === 0;
    $('myStars').textContent = `✦ 이루어진 내 소원 ${myStars.length}개 · 하늘 연못에서 보기`;
    $('meName').textContent = state.name;
    syncAvatar();
    applyFollow();
    renderMini();
    sendHello();
  }

  // ---------- 이루어진 내 소원: 하늘 연못에서 하나씩 찾아가기 ----------
  let myStarIdx = 0;
  $('myStars').onclick = () => {
    if (!myStars.length) return;
    const w = myStars[myStarIdx++ % myStars.length];
    if (mobile()) openPanel(false);
    showStar(w, true);
    openCard({ ...w, status: 'star', mine: true });
    if (myStars.length > 1) toast(`✦ ${((myStarIdx - 1) % myStars.length) + 1} / ${myStars.length} · 한 번 더 누르면 다음 소원`);
  };

  // ---------- 내 이름 바꾸기 ----------
  function showNameEdit(on) {
    $('meEdit').hidden = !on;
    $('meRow').hidden = on;
    if (on) {
      $('meInput').value = state.name;
      $('meInput').focus();
      $('meInput').select();
    }
  }
  async function setName(name) {
    try {
      const r = await api('/api/name', { name });
      state.name = r.name;
      save();
      if (myWish) myWish = { ...myWish, name: r.name };
      myStars = myStars.map((w) => ({ ...w, name: r.name }));
      for (const w of wishes.values()) if (w.mine) w.name = r.name;
      if (myWish) world.getFish(myWish.id)?.setData({ name: r.name });
      world.getFish(AVATAR)?.setData({ name: r.name });
      renderPanel();
      sendHello(); // 다른 사람 화면의 이름표도
      toast(`🐟 이제 ‘${r.name}’(이)에요`);
      return true;
    } catch (e) {
      toast({ bad_name: '그 이름은 쓸 수 없어요. 다른 이름으로 해 주세요', empty: '이름을 적어 주세요', too_many: '잠시 뒤 다시 바꿔 주세요' }[e.code] || '이름을 바꾸지 못했어요');
      return false;
    }
  }
  $('btnRename').onclick = () => showNameEdit(true);
  $('meCancel').onclick = () => showNameEdit(false);
  $('meEdit').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('meInput').value.trim();
    if (name === state.name) return showNameEdit(false);
    if (await setName(name)) showNameEdit(false);
  };
  $('btnReroll').onclick = async () => {
    let name = randomName();
    for (let i = 0; i < 5 && name === state.name; i++) name = randomName();
    sfx.bubble();
    await setName(name);
  };

  // ---------- 지금 연못에 있는 사람들 ----------
  let myPid = null;
  let presenceReady = false;
  const online = new Map(); // pid → { name, species, wishId }
  let lastHello = '';
  let followPid = null; // 내가 같이 헤엄치는 사람
  function sendHello(force = false) {
    const profile = { name: state.name, species: myWish?.species || pickedSpecies, wishId: myWish?.id || null, follow: followPid };
    const key = JSON.stringify(profile);
    if (!force && key === lastHello) return;
    lastHello = key;
    live.send({ t: 'hello', profile, uid: state.uid }); // uid: 같은 브라우저의 여러 탭을 한 사람으로 (서버는 해시만 씀)
  }
  const myFish = () => world.getFish(myWish?.id) || world.getFish(AVATAR);
  // 접속한 사람의 물고기: 소원이 연못에 있으면 그 물고기, 없으면 그 사람만의 물고기(p:아이디)
  const fishOfUser = (pid) => {
    const u = online.get(pid);
    if (!u) return null;
    return (u.wishId && world.getFish(u.wishId)) || world.getFish(`p:${pid}`);
  };
  function syncPresence() {
    const onlineWish = new Set();
    for (const [pid, u] of online) {
      const wf = u.wishId && world.getFish(u.wishId);
      if (wf) {
        onlineWish.add(u.wishId);
        wf.setData({ online: true, name: u.name });
        if (world.getFish(`p:${pid}`)) world.removeFish(`p:${pid}`);
      } else {
        const id = `p:${pid}`;
        const had = world.getFish(id);
        world.upsertFish(
          { id, name: u.name, species: u.species, dream: '', hasDream: true, done: 0, total: 0, sleeping: false, online: true },
          { splashIn: !had },
        );
      }
    }
    for (const f of [...world.fishes.values()]) {
      if (f.id.startsWith('p:') && !online.has(f.id.slice(2))) world.removeFish(f.id);
      else if (f.data.online && !f.id.startsWith('p:') && !onlineWish.has(f.id)) f.setData({ online: false, followId: null });
    }
    // 같이 헤엄치기: 다른 사람끼리, 그리고 나를 따라오는 사람
    for (const [pid, u] of online) {
      const f = fishOfUser(pid);
      if (!f) continue;
      const leader = !u.follow ? null : u.follow === myPid ? myFish() : fishOfUser(u.follow);
      const followId = leader && leader !== f ? leader.id : null;
      if ((f.data.followId || null) !== followId) f.setData({ followId });
    }
    applyFollow();
  }

  // ---------- 같이 헤엄치기 ----------
  // 내 물고기가 그 사람 물고기 옆에 나란히 붙어 다님 (World 의 followId). 접속 정보(hello)에 담아 모두에게 보임
  function applyFollow() {
    const me = myFish();
    if (followPid && !online.has(followPid)) {
      followPid = null;
      toast('🐟 같이 헤엄치던 사람이 연못을 떠났어요');
      sendHello();
      renderFollowBtn();
    }
    const lf = followPid ? fishOfUser(followPid) : null;
    const followId = lf ? lf.id : null;
    for (const f of world.fishes.values()) if (f.isMe && f !== me && f.data.followId) f.setData({ followId: null });
    if (me && (me.data.followId || null) !== followId) me.setData({ followId });
  }
  function setFollow(pid) {
    const u = pid && online.get(pid);
    if (pid && !u) return;
    if (u && u.follow === myPid) {
      toast(`🐟 ${u.name} 님이 이미 내 옆에서 헤엄치고 있어요`);
      return;
    }
    const prev = followPid && online.get(followPid);
    followPid = pid || null;
    const me = myFish();
    if (me && pid) me.manual = null;
    applyFollow();
    sendHello();
    renderFollowBtn();
    if (u) {
      sayPhrase(4, pid, true); // "같이 헤엄쳐요 🐟"
      toast(`🐟 ${u.name} 님과 같이 헤엄쳐요 · 연못을 누르면 그만둬요`);
      buzz(15);
    } else if (prev) toast(`${prev.name} 님과 헤어졌어요 👋`);
  }
  // 지금 열린 카드의 주인이 접속 중이면 그 사람 아이디
  function cardPid() {
    if (cheerTarget && online.has(cheerTarget)) return cheerTarget;
    if (cardId) for (const [pid, u] of online) if (u.wishId === cardId) return pid;
    return null;
  }
  function renderFollowBtn() {
    const b = $('btnFollow');
    const pid = $('wishCard').hidden ? null : cardPid();
    b.hidden = !pid;
    b.textContent = pid && pid === followPid ? '👋 그만 헤엄치기' : '🐟 같이 헤엄치기';
  }
  $('btnFollow').onclick = () => {
    const pid = cardPid();
    if (!pid) return;
    setFollow(pid === followPid ? null : pid);
  };
  live.on('open', () => sendHello(true));
  let myKey = null; // 같은 브라우저(나)의 다른 탭·앱을 알아보는 값
  let myTabs = 0; // 지금 열려 있는 내 다른 탭 수
  live.on('you', ({ k }) => {
    myKey = k || null;
  });
  live.on('welcome', ({ pid }) => {
    myPid = pid;
    sendHello(true);
  });
  live.on('presence', ({ users, n }) => {
    const before = new Map(online);
    online.clear();
    myTabs = 0;
    for (const u of users) {
      if (u.pid === myPid) continue;
      if (myKey && u.k === myKey) myTabs++; // 내 다른 탭: 사람 수엔 들어가지만 내 연못엔 안 그림
      else online.set(u.pid, u);
    }
    stats.online = n;
    renderStats();
    syncPresence();
    if (presenceReady) {
      for (const [pid, u] of online) {
        // 새로 들어온 사람 알림 (처음 받는 목록은 조용히)
        if (!before.has(pid)) toast(`🐟 ${u.name} 님이 연못에 들어왔어요`);
        // 누군가 내 옆에 붙어 같이 헤엄치기 시작
        if (u.follow === myPid && before.get(pid)?.follow !== myPid) {
          sfx.bubble();
          buzz([15, 40, 15]);
          toast(`🐟 ${u.name} 님이 같이 헤엄쳐요`, 'gold');
        }
      }
    }
    presenceReady = true;
    renderFollowBtn();
  });

  // 다른 사람의 몸짓
  live.on('emote', (m) => {
    const f = fishOfUser(m.pid);
    const who = online.get(m.pid);
    if (m.kind === 'cheer') {
      if (f) cheerMotion(f, m.jump);
      const target = m.to === myPid ? myFish() : fishOfUser(m.to);
      if (target) {
        target.wiggle = Math.max(target.wiggle, 1);
        world.burst(target.pos, 0xffd27a, 16, 0.6);
      }
      if (m.to === myPid) {
        sfx.chime();
        buzz([20, 50, 20]);
        toast(`💛 ${who?.name || '누군가'} 님이 응원을 보냈어요`, 'gold');
      }
    } else if (m.kind === 'say') {
      const text = PHRASES[m.i];
      if (!text) return;
      const toMe = m.to === myPid;
      f?.say(text, toMe ? 'to-me' : '');
      if (toMe) {
        sfx.bubble();
        buzz(15);
        toast(`💬 ${who?.name || '누군가'}: ${text}`);
      }
    } else if (m.kind === 'sky') world.skySprinkle(m.p[0], m.p[1]); // 누군가 하늘 연못에 반짝이를 뿌림
    else if (m.kind === 'swim') f?.doMove(m.move);
    else if (m.kind === 'goto') world.swimFishTo(f?.id, m.p);
  });

  // 응원 몸짓: 빙그르르 돌거나 물 위로 점프 + 반짝이
  function cheerMotion(f, jump) {
    if (!f || f.action) return;
    if (jump) f.leap();
    else f.doMove('roll');
    world.burst(f.pos, 0xffc6d9, 22, 0.8);
    world.floatText('💛', f.pos, 'emote', 1.8);
  }

  // ---------- 내 물고기 (소원을 빌기 전에도 항상 연못에) ----------
  const AVATAR = 'me-avatar';
  function syncAvatar() {
    if (myWish) {
      if (world.getFish(AVATAR)) world.removeFish(AVATAR);
      return;
    }
    const had = !!world.getFish(AVATAR);
    world.upsertFish(
      { id: AVATAR, name: state.name, species: pickedSpecies, dream: '', hasDream: true, done: 0, total: 0, sleeping: false },
      { isMe: true, splashIn: !had && document.readyState === 'complete' },
    );
  }

  // ---------- 휴대폰 아래 작은 막대 ----------
  function renderMini() {
    const bar = $('miniBar');
    if (!bar) return;
    const w = myWish;
    $('miniText').textContent = w
      ? w.hidden
        ? '🙈 내 소원이 잠시 숨겨졌어요'
        : `${w.text ? `“${w.text}”` : '마음속 소원'}`
      : '연못을 누르면 내 물고기가 헤엄쳐요';
    $('miniSub').textContent = w ? `✨ ${w.feeds} / ${GOAL}` : '';
    $('miniFeed').hidden = !w || !!w.hidden;
    $('miniOpen').textContent = w ? '자세히' : '🙏 소원 빌기';
    const badge = $('feedBadge');
    badge.hidden = !w;
    if (w) badge.textContent = `${w.feeds}/${GOAL}`;
  }

  // ---------- 소원 카드 ----------
  let cardId = null;
  let cheerTarget = null; // 응원을 받을 사람 (접속한 사람의 물고기 카드를 열었을 때)
  function openCard(w) {
    if (!w) return;
    if (mobile()) openPanel(false); // 휴대폰: 카드와 패널이 겹치지 않게 하나만
    if (cheerTarget) world.getFish(`p:${cheerTarget}`)?.setData({ highlight: false });
    cheerTarget = null; // 전에 열었던 접속자 카드의 대상이 남지 않게
    $('cardFalls').hidden = false;
    $('btnCheerTo').hidden = !!w.mine || w.status === 'star' || ![...online.values()].some((u) => u.wishId === w.id);
    cardId = w.id;
    const star = w.status === 'star';
    $('wishCard').hidden = false;
    document.body.classList.add('card-open'); // 안내 문구가 카드 위에 겹치지 않게
    $('wishCard').classList.toggle('is-star', star);
    $('cardName').textContent = `${star ? '✦ 이루어진 소원' : SPECIES[w.species]?.label || ''} · ${w.name}${w.mine ? ' (나)' : ''}`;
    $('cardText').textContent = wishLine(w);
    $('cardFill').style.width = `${Math.min(100, (w.feeds / GOAL) * 100)}%`;
    $('cardLabel').textContent = star
      ? `먹이 ${w.feeds}번으로 ${fmtDate(w.starAt)}에 이루어져 하늘 연못에서 헤엄쳐요`
      : `✨ 먹이 ${w.feeds} / ${GOAL}${w.feeders ? ` · ${w.feeders}명이 응원` : ''}`;
    const b = $('btnFeed');
    b.hidden = star;
    b.disabled = false;
    b.textContent = w.mine ? `✨ 내 소원에 먹이 주기 (${w.feeds}/${GOAL})` : `✨ 먹이 주기 (${w.feeds}/${GOAL})`;
    $('btnDelete').hidden = !w.mine;
    const r = $('btnReport');
    r.hidden = !!w.mine || !w.text;
    r.disabled = !!w.reportedByMe;
    r.textContent = w.reportedByMe ? '신고함' : '🚩 신고';
    b.title = `먹이가 ${GOAL}번 모이면 소원이 이루어져요`;
    // 물고기 이름표를 잠깐 켜서 어떤 물고기인지 보이게
    for (const f of world.fishes.values()) if (f.data.highlight && f.id !== w.id) f.setData({ highlight: false });
    world.getFish(w.id)?.setData({ highlight: true });
    renderFollowBtn();
  }
  // 아직 소원이 없는, 지금 접속한 사람의 물고기 카드
  function openPresenceCard(u, f) {
    closeCard();
    if (mobile()) openPanel(false);
    cardId = null;
    $('wishCard').hidden = false;
    document.body.classList.add('card-open');
    $('wishCard').classList.remove('is-star');
    $('cardName').textContent = `● 지금 연못에 있어요 · ${u.name}`;
    $('cardText').textContent = '아직 소원을 빌지 않은 물고기예요';
    $('cardFalls').hidden = true;
    $('btnFeed').hidden = true;
    $('btnReport').hidden = true;
    $('btnDelete').hidden = true;
    $('btnCheerTo').hidden = false;
    f.setData({ highlight: true });
    sfx.bubble();
  }
  // 접속한 사람 물고기 카드: cheerTarget 을 정한 뒤 버튼을 그림
  function openPresence(pid, u, f) {
    openPresenceCard(u, f);
    cheerTarget = pid;
    renderFollowBtn();
  }

  function closeCard() {
    if (cheerTarget) world.getFish(`p:${cheerTarget}`)?.setData({ highlight: false });
    cheerTarget = null;
    if (cardId) world.getFish(cardId)?.setData({ highlight: false });
    cardId = null;
    $('wishCard').hidden = true;
    document.body.classList.remove('card-open');
  }
  $('cardClose').onclick = closeCard;

  world.onFishClick = (f) => {
    if (!f) return closeCard();
    if (f.id.startsWith('p:')) {
      const u = online.get(f.id.slice(2));
      if (!u) return;
      openPresence(f.id.slice(2), u, f);
      return;
    }
    if (f.id === AVATAR) {
      // 아직 소원이 없는 내 물고기 → 소원 빌기
      openPanel(true);
      if (!mobile()) $('wishInput').focus();
      return;
    }
    const w = wishes.get(f.id);
    if (!w) return;
    sfx.bubble();
    openCard(w);
  };
  let lastGoto = 0;
  world.onSwimTo = (p) => {
    sfx.bubble();
    if (followPid) setFollow(null); // 직접 움직이면 같이 헤엄치기는 그만
    const now = performance.now();
    if (now - lastGoto < 220) return;
    lastGoto = now;
    live.send({ t: 'emote', kind: 'goto', p: [p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100) });
  };
  // 하늘 연못 말풍선이 소원 카드에 가리지 않게: 카드가 열려 있으면 카드 윗변까지만
  world.bubbleFloor = () => ($('wishCard').hidden ? window.innerHeight : $('wishCard').getBoundingClientRect().top);

  // 하늘 연못 빈 물을 누르면 반짝이 → 다른 사람 화면에도
  let lastSkyTap = 0;
  world.onSkyTap = (x, z) => {
    sfx.bubble();
    const now = performance.now();
    if (now - lastSkyTap < 380) return;
    lastSkyTap = now;
    live.send({ t: 'emote', kind: 'sky', p: [Math.round(x * 100) / 100, Math.round(z * 100) / 100] });
  };
  // 하늘 연못의 금빛 물고기를 누르면: 물고기 위에 소원 제목 + 카드
  world.onSkyFishClick = (w, f) => {
    const known = wishes.get(w.id) || myStars.find((x) => x.id === w.id) || w;
    f.say(known.text ? `“${known.text}”` : `🔒 ${known.name} 님의 마음속 소원`);
    openCard({ ...known, status: 'star' });
  };

  // ---------- 먹이 주기 ----------
  // 내가 준 먹이의 실시간 알림은 '누군가 줬어요'로 보이지 않게 (응답보다 알림이 먼저 올 수 있음)
  const myPendingFeeds = new Map(); // id → [보낸 시각…]
  async function feedWish(id) {
    myPendingFeeds.set(id, [...(myPendingFeeds.get(id) || []).filter((t) => Date.now() - t < 10000), Date.now()]);
    try {
      const { wish, becameStar } = await api(`/api/wishes/${id}/feed`, {});
      wishes.set(wish.id, wish);
      world.getFish(id)?.setData(fishData(wish));
      world.feed(null, id);
      if (myWish?.id === id && !becameStar) {
        myWish = { ...myWish, ...wish };
        state.seen[id] = wish.feeds;
        renderPanel();
      }
      if (!state.fed.includes(id)) state.fed.push(id);
      save();
      sfx.chime();
      buzz([15, 40, 15]);
      toast(becameStar ? '마지막 먹이! 소원이 이루어져요 ✨' : `✨ 먹이를 줬어요 (${wish.feeds}/${GOAL})`, 'gold');
      if (cardId === id) openCard(wish);
      if (becameStar) onStar(wish); // 실시간 연결이 없을 때를 위해 직접도 처리
      return wish;
    } catch (e) {
      const msg = {
        too_fast: '천천히, 한 번씩 주세요 🐟',
        already_star: '이미 이루어진 소원이에요 ✦',
        too_many: '잠시 쉬었다가 다시 해 주세요',
      }[e.code];
      toast(msg || '먹이를 주지 못했어요. 잠시 뒤 다시 해 주세요');
      return null;
    }
  }
  $('btnFeed').onclick = () => cardId && feedWish(cardId);

  $('btnDelete').onclick = () => cardId && deleteWish(cardId);
  $('btnCheerTo').onclick = () => $('actCheer').click();
  $('btnDeleteMine').onclick = () => myWish && deleteWish(myWish.id);

  // ---------- 하늘 보기 ----------
  $('btnSky').onclick = () => world.setSkyView(!world.skyView || world.skyView.returning);
  world.onSkyChange = (on) => {
    $('btnSky').classList.toggle('on', on);
    $('btnSky').querySelector('span').textContent = on ? ' 연못으로' : ' 하늘 연못';
    document.body.classList.toggle('sky-view', on);
    if (!ceremonyBusy) world.setCinema(on); // 패널을 잠깐 숨기니 화면 한가운데로
    if (on) {
      closeCard();
      caption(
        world.skyFish.size
          ? '금빛 물고기를 누르면 소원이 보여요 · 물을 누르면 반짝이를 뿌려요'
          : '아직 하늘 연못이 비어 있어요. 먹이 다섯 번이면 첫 물고기가 올라와요',
        4200,
      );
    }
  };

  // ---------- 아래 버튼 막대: 헤엄 · 소원 · 먹이주기 · 응원 ----------
  const SWIMS = ['dash', 'circle', 'roll', 'wag', 'nibble', 'glide', 'forage'];
  $('actSwim').onclick = () => {
    const f = myFish();
    if (!f || f.action) return;
    const move = SWIMS[Math.floor(Math.random() * SWIMS.length)];
    f.manual = null;
    f.doMove(move);
    live.send({ t: 'emote', kind: 'swim', move });
    sfx.bubble();
    buzz(10);
  };
  $('actWish').onclick = () => {
    openPanel(true);
    if (!myWish && !mobile()) $('wishInput').focus();
  };
  $('actFeed').onclick = () => {
    if (!myWish) {
      toast('먼저 소원을 빌어 주세요 🙏');
      openPanel(true);
      return;
    }
    feedWish(myWish.id);
  };
  $('actCheer').onclick = () => {
    const f = myFish();
    if (!f) return;
    // 카드를 열어 둔 물고기가 지금 접속한 사람이면 그 사람에게 응원
    let to = null;
    if (cardId) {
      for (const [pid, u] of online) if (u.wishId === cardId) to = pid;
    }
    if (cheerTarget && online.has(cheerTarget)) to = cheerTarget;
    const jump = Math.random() < 0.5;
    cheerMotion(f, jump);
    live.send({ t: 'emote', kind: 'cheer', to, jump });
    sfx.chime();
    buzz(15);
    if (to) {
      const tf = fishOfUser(to);
      if (tf) tf.wiggle = Math.max(tf.wiggle, 1);
      toast(`💛 ${online.get(to)?.name} 님에게 응원을 보냈어요`);
    } else if (online.size === 0) toast('💛 응원! 다른 사람이 들어오면 함께 보여요');
  };
  // ---------- 💬 말: 정해진 말풍선 ----------
  // 카드를 열어 둔 물고기가 지금 접속한 사람이면 그 사람에게 (상대 화면엔 알림도 뜸)
  let lastSay = 0;
  let sayTarget = null; // 말을 걸 사람 (💬 를 눌렀을 때 열려 있던 카드의 주인)
  function sayPhrase(i, to = null, quiet = false) {
    const f = myFish();
    if (!f || !PHRASES[i]) return false;
    const now = performance.now();
    if (now - lastSay < 1300) {
      if (!quiet) toast('천천히 한 마디씩 해 주세요 🐟');
      return false;
    }
    lastSay = now;
    f.say(PHRASES[i]);
    live.send({ t: 'emote', kind: 'say', i, to });
    return true;
  }
  function renderSayTo() {
    const pid = sayTarget && online.has(sayTarget) ? sayTarget : null;
    $('sayTo').textContent = pid
      ? `${online.get(pid).name} 님에게 말하기`
      : online.size
        ? '내 물고기가 말해요 · 접속한 사람 물고기를 누르면 그 사람에게'
        : '내 물고기가 말해요 · 다른 사람이 들어오면 함께 보여요';
  }
  $('sayList').append(
    ...PHRASES.map((text, i) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.setAttribute('role', 'menuitem');
      b.onclick = () => {
        const to = sayTarget && online.has(sayTarget) ? sayTarget : null;
        if (!sayPhrase(i, to)) return;
        sfx.bubble();
        buzz(10);
        if (to) toast(`💬 ${online.get(to)?.name} 님에게 말했어요`);
        showSay(false);
      };
      return b;
    }),
  );
  // 휴대폰에선 카드와 겹치므로, 고르는 동안 카드는 잠깐 숨김 (받는 사람은 기억)
  function showSay(on) {
    if (on) sayTarget = $('wishCard').hidden ? null : cardPid();
    document.body.classList.toggle('say-open', on);
    $('sayPop').hidden = !on;
    $('actSay').classList.toggle('on', on);
    $('actSay').setAttribute('aria-expanded', String(on));
    if (on) renderSayTo();
  }
  $('actSay').onclick = (e) => {
    e.stopPropagation();
    showSay($('sayPop').hidden);
  };
  document.addEventListener('pointerdown', (e) => {
    if (!$('sayPop').hidden && !e.target.closest('#sayPop, #actSay')) showSay(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && showSay(false));

  // ---------- 신고 ----------
  $('btnReport').onclick = async () => {
    const id = cardId;
    if (!id) return;
    if (!confirm('이 소원을 신고할까요?\n욕설·광고·개인정보처럼 연못에 어울리지 않는 글이면 알려 주세요.\n여러 명이 신고하면 자동으로 숨겨지고, 관리자가 확인해요.')) return;
    try {
      await api(`/api/wishes/${id}/report`, {});
      const w = wishes.get(id);
      if (w) w.reportedByMe = true;
      toast('신고했어요. 알려 주셔서 고마워요 🙏');
      if (cardId === id && w) openCard(w);
    } catch (e) {
      toast(e.code === 'too_many' ? '잠시 뒤 다시 해 주세요' : '신고하지 못했어요');
    }
  };

  // 하늘 연못에서 그 물고기 보기 (쉬러 갔던 오래된 소원이면 다시 불러옴)
  function showStar(w, say = false) {
    const f = world.getSkyFish(w.id) || world.addSkyFish({ ...w, status: 'star' }, { splash: true });
    world.setSkyView(true, w.id);
    if (say && f) f.say(w.text ? `“${w.text}”` : '🔒 마음속 소원');
  }

  // 내 소원 지우기 (헤엄치는 소원이든 별이든)
  async function deleteWish(id) {
    const w = wishes.get(id) || myStars.find((x) => x.id === id) || (myWish?.id === id ? myWish : null);
    if (!confirm(`이 소원을 지울까요? 연못과 하늘에서 사라지고 되돌릴 수 없어요.${w?.text ? `\n\n“${w.text}”` : ''}`)) return false;
    try {
      await api(`/api/wishes/${id}/delete`, {});
      if (myWish?.id === id) myWish = null;
      myStars = myStars.filter((x) => x.id !== id);
      dropWish(id);
      stats.total = Math.max(0, stats.total - 1);
      if (w?.status === 'star') stats.stars = Math.max(0, stats.stars - 1);
      renderStats();
      renderPanel();
      toast('소원을 지웠어요. 언제든 새 소원을 빌 수 있어요');
      return true;
    } catch (e) {
      toast(e.code === 'not_owner' ? '내 소원만 지울 수 있어요' : '지우지 못했어요. 잠시 뒤 다시 해 주세요');
      return false;
    }
  }

  function dropWish(id) {
    wishes.delete(id);
    if (world.getFish(id) && !world.getFish(id).action) world.removeFish(id);
    world.removeSkyFish(id);
    if (cardId === id) closeCard();
    if (myWish?.id === id) loadMine().catch(() => {});
  }

  // ---------- 소원이 이루어질 때 ----------
  const starred = new Set();
  function onStar(w) {
    if (starred.has(w.id)) return;
    starred.add(w.id);
    wishes.set(w.id, { ...wishes.get(w.id), ...w, status: 'star' });
    stats.stars++;
    renderStats();
    const mine = myWish?.id === w.id;
    if (mine) {
      myStars.unshift({ ...myWish, ...w, status: 'star' });
      myWish = null;
      state.celebrated.push(w.id);
      save();
      renderPanel();
    }
    if (cardId === w.id) closeCard();
    // 내가 막 준 먹이로 이루어졌으면 (실시간 알림이 응답보다 먼저 와도) 장면으로
    playAscend({ ...w, mine: mine || w.mine }, { cine: mine || state.fed.includes(w.id) || myPendingFeeds.has(w.id) });
  }

  // 물고기가 폭포를 올라 하늘 연못으로 가는 장면
  function playAscend(w, { cine }) {
    let f = world.getFish(w.id);
    const finish = () => {
      world.removeFish(w.id);
      world.addSkyFish({ ...w, status: 'star' }, { splash: true });
      world.refreshMarkers();
      if (cine) {
        celebrate({
          title: w.mine ? '소원이 이루어졌어요' : '함께 빌어 준 소원이 이루어졌어요',
          dream: wishLine(w),
          meta: `먹이 ${GOAL}번이 모여 하늘 연못의 금빛 물고기가 되었어요`,
        });
      } else toast(`✦ ${w.name} 님의 소원이 이루어졌어요`, 'gold');
    };
    if (!f && cine) {
      // 연못에 없던 내 소원이면 잠깐 불러와서 올라가게
      f = world.upsertFish(fishData(w), { isMe: !!w.mine, splashIn: true });
    }
    if (!f) return finish();
    const useCine = cine && !typing() && !ceremonyBusy;
    sfx.ascend();
    if (useCine) {
      ceremonyBusy = true;
      closeCard();
      world.setView('pond');
      cinema(true);
      caption(w.mine ? `${wishLine(w)} — 소원이 이루어지러 폭포를 오릅니다…` : `${w.name} 님의 소원이 폭포를 오릅니다…`, 3500);
      world.setPlaque(w.text || `${w.name}의 소원`, 1);
      world.startDirector(f, () => {
        cinema(false);
        world.setPlaque(null);
        ceremonyBusy = false;
      });
    }
    f.ascend(finish, world.skyEntryPoint());
  }

  // ---------- 방생 의식 ----------
  const ritual = { step: 0, knocks: 0, text: '', isPublic: true, holdT: 0, holding: false, raf: 0 };
  function ritualStep(n) {
    ritual.step = n;
    $('ritualStep').textContent = '';
    $('mokeo').hidden = n !== 1;
    $('mokeoDots').hidden = n !== 1;
    $('pray').hidden = n !== 2;
    if (n === 1) {
      $('ritualTitle').textContent = '목어를 세 번 두드리면 물고기가 연못으로 가요';
      $('ritualHelp').textContent = '목어는 늘 눈을 뜨고 있는 물고기 — 깨어 있는 마음을 뜻해요';
    } else if (n === 2) {
      $('ritualTitle').textContent = '두 손을 모으고 소원을 떠올려요';
      $('ritualHelp').textContent = touchOnly ? '🙏 를 꾹 누르고 있어 주세요' : '🙏 를 꾹 누르고 있어 주세요 (스페이스 바도 돼요)';
    } else {
      $('ritualTitle').textContent = '물고기를 연못으로 놓아줍니다';
      $('ritualHelp').textContent = '';
    }
  }
  function openRitual(text, isPublic) {
    ritual.text = text;
    ritual.isPublic = isPublic;
    ritual.knocks = 0;
    $('ritualWish').textContent = `“${text}”`;
    document.querySelectorAll('#mokeoDots i').forEach((i) => i.classList.remove('on'));
    $('prayRing').style.strokeDashoffset = '339';
    $('ritual').hidden = false;
    document.body.classList.add('in-ritual');
    ritualStep(1);
  }
  function closeRitual() {
    $('ritual').hidden = true;
    document.body.classList.remove('in-ritual');
    ritual.step = 0;
    cancelAnimationFrame(ritual.raf);
  }
  $('ritualCancel').onclick = closeRitual;

  $('mokeo').onclick = () => {
    if (ritual.step !== 1) return;
    ritual.knocks++;
    sfx.mok();
    buzz(20);
    const m = $('mokeo');
    m.classList.remove('knock');
    void m.offsetWidth;
    m.classList.add('knock');
    document.querySelectorAll('#mokeoDots i')[ritual.knocks - 1]?.classList.add('on');
    world.addRipple(0, 2, 0.6 + ritual.knocks * 0.3);
    if (ritual.knocks >= 3) setTimeout(() => releaseWish(), 450); // 세 번 두드리면 바로 놓아줌
  };

  // 길게 누르기 (합장)
  const HOLD_MS = 1800;
  function holdLoop(ts) {
    if (!ritual.holding) return;
    ritual.holdT += ts - (ritual.last || ts);
    ritual.last = ts;
    const k = Math.min(1, ritual.holdT / HOLD_MS);
    $('prayRing').style.strokeDashoffset = String(339 * (1 - k));
    $('ritualWish').style.textShadow = `0 0 ${8 + k * 26}px rgba(255, 210, 120, ${0.3 + k * 0.6})`;
    if (k >= 1) {
      ritual.holding = false;
      sfx.chime();
      buzz([30, 60, 30]);
      releaseWish();
      return;
    }
    ritual.raf = requestAnimationFrame(holdLoop);
  }
  function holdStart(e) {
    if (ritual.step !== 2 || ritual.holding) return;
    e?.preventDefault?.();
    ritual.holding = true;
    ritual.holdT = 0;
    ritual.last = 0;
    ritual.raf = requestAnimationFrame(holdLoop);
  }
  function holdEnd() {
    if (!ritual.holding) return;
    ritual.holding = false;
    cancelAnimationFrame(ritual.raf);
    $('prayRing').style.strokeDashoffset = '339';
    $('ritualWish').style.textShadow = '';
  }
  $('pray').addEventListener('pointerdown', holdStart);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('pray').addEventListener(ev, holdEnd));
  window.addEventListener('keydown', (e) => {
    if (ritual.step === 2 && e.code === 'Space' && !e.repeat) holdStart(e);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') holdEnd();
  });

  let creatingWish = false;
  async function releaseWish() {
    ritualStep(3);
    creatingWish = true;
    try {
      const { wish } = await api('/api/wishes', {
        text: ritual.text,
        isPublic: ritual.isPublic,
        species: pickedSpecies,
        name: state.name,
      });
      myWish = wish;
      wishes.set(wish.id, wish);
      creatingWish = false;
      state.seen[wish.id] = 0;
      save();
      stats.total++;
      renderStats();
      setTimeout(() => {
        closeRitual();
        $('wishInput').value = '';
        // 내 물고기가 그대로 소원을 품고 헤엄치게 (자리 이어받기)
        const av = world.getFish(AVATAR);
        const at = av ? av.pos.clone() : null;
        renderPanel();
        if (mobile()) openPanel(false); // 휴대폰: 놓아준 뒤엔 연못이 보이게
        const f = putFish(wish, { splash: !at });
        if (f && at) {
          f.pos.copy(at);
          world.burst(at, 0xffd27a, 30, 0.8);
          world.addRipple(at.x, at.z, 0.9);
        }
        sfx.splash();
        caption(`${wishLine(wish)} — 연못으로 놓아주었어요`, 4500);
        if (f) setTimeout(() => f.surface(wishLine(wish)), 1500);
        setTimeout(() => toast('🔗 링크를 보내면 친구가 내 소원에 먹이를 줄 수 있어요'), 5000);
      }, 500);
    } catch (e) {
      creatingWish = false;
      closeRitual();
      if (e.code === 'already_swimming') {
        toast('이미 헤엄치는 소원이 있어요. 소원이 이루어지면 새 소원을 띄울 수 있어요');
        await loadMine();
      } else if (e.code === 'blocked_word') toast('연못에 어울리지 않는 말이 있어요. 소원을 고쳐 적어 주세요');
      else if (e.code === 'blocked_link') toast('링크·전화번호·이메일은 소원에 적을 수 없어요');
      else if (e.code === 'too_many') toast('잠시 뒤에 다시 방생해 주세요');
      else toast('방생하지 못했어요. 잠시 뒤 다시 해 주세요');
    }
  }

  $('btnRelease').onclick = () => {
    const text = $('wishInput').value.trim();
    if (!text) {
      $('wishInput').focus();
      return toast('먼저 소원을 한 줄 적어 주세요');
    }
    openRitual(text.slice(0, 60), $('publicInput').checked);
  };
  $('wishInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) $('btnRelease').click();
  });

  // ---------- 링크 공유 ----------
  $('btnShareWish').onclick = async () => {
    if (!myWish) return;
    const url = `${location.origin}/?wish=${myWish.id}`;
    if (navigator.share && mobile()) {
      try {
        await navigator.share({ title: '소원 연못', text: '내 소원 물고기에게 먹이 주러 와 줘 🐟', url });
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('링크를 복사했어요. 친구에게 보내 먹이를 부탁해 보세요 ✨');
    } catch (_) {
      prompt('이 링크를 복사해 보내 주세요', url);
    }
  };

  // ---------- 모아 보기 ----------
  let listTab = 'swimming';
  let listSort = 'new';
  async function renderList() {
    const ul = $('listItems');
    ul.textContent = '';
    $('listSort').hidden = listTab !== 'swimming';
    const loading = document.createElement('li');
    loading.className = 'list-empty';
    loading.textContent = '불러오는 중…';
    ul.appendChild(loading);
    let list = [];
    try {
      const q =
        listTab === 'mine' ? '/api/wishes?mine=1&limit=100' : listTab === 'star' ? '/api/wishes?status=star&sort=recent&limit=150' : `/api/wishes?status=swimming&sort=${listSort}&limit=150`;
      list = (await api(q)).wishes;
    } catch (_) {}
    ul.textContent = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'list-empty';
      li.textContent = listTab === 'star' ? '아직 하늘 연못에 올라간 소원이 없어요. 첫 물고기를 함께 올려 볼까요?' : listTab === 'mine' ? '아직 띄운 소원이 없어요' : '아직 헤엄치는 소원이 없어요';
      ul.appendChild(li);
      return;
    }
    for (const w of list) {
      wishes.set(w.id, { ...wishes.get(w.id), ...w });
      const li = document.createElement('li');
      li.className = `list-item ${w.status === 'star' ? 'is-star' : ''}`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = SPECIES[w.species]?.color || '#ffd27a';
      const body = document.createElement('div');
      body.className = 'li-body';
      const t = document.createElement('p');
      t.className = 'li-text';
      t.textContent = wishLine(w);
      const meta = document.createElement('p');
      meta.className = 'li-meta';
      meta.textContent =
        w.status === 'star' ? `✦ ${w.name} · ${fmtDate(w.starAt)} 이루어짐` : `${w.name}${w.mine ? ' (나)' : ''} · ✨ ${w.feeds}/${GOAL}`;
      body.append(t, meta);
      if (w.status !== 'star') {
        const bar = document.createElement('div');
        bar.className = 'falls-bar';
        const fill = document.createElement('div');
        fill.className = 'falls-fill';
        fill.style.width = `${Math.min(100, (w.feeds / GOAL) * 100)}%`;
        bar.appendChild(fill);
        body.appendChild(bar);
      }
      const acts = document.createElement('div');
      acts.className = 'li-acts';
      if (w.status === 'swimming') {
        const fb = document.createElement('button');
        fb.className = 'small primary';
        fb.textContent = '✨';
        fb.title = '먹이 주기';
        fb.onclick = async () => {
          const nw = await feedWish(w.id);
          if (nw) {
            meta.textContent = `${nw.name}${nw.mine ? ' (나)' : ''} · ✨ ${nw.feeds}/${GOAL}`;
            body.querySelector('.falls-fill').style.width = `${Math.min(100, (nw.feeds / GOAL) * 100)}%`;
          }
        };
        acts.appendChild(fb);
      }
      const look = document.createElement('button');
      look.className = 'small';
      look.textContent = w.status === 'star' ? '✦' : '🐟';
      look.title = w.status === 'star' ? '하늘 연못에서 보기' : '연못에서 보기';
      look.onclick = () => {
        closeList();
        if (w.status === 'swimming') {
          if (world.skyView) world.setSkyView(false);
          putFish(w, { splash: !world.getFish(w.id) });
        } else showStar(w);
        openCard(wishes.get(w.id));
      };
      acts.appendChild(look);
      if (w.mine) {
        const del = document.createElement('button');
        del.className = 'small';
        del.textContent = '🗑';
        del.title = '내 소원 지우기';
        del.onclick = async () => {
          if (await deleteWish(w.id)) li.remove();
        };
        acts.appendChild(del);
      }
      li.append(dot, body, acts);
      ul.appendChild(li);
    }
  }
  function openList() {
    $('listModal').hidden = false;
    renderList();
  }
  function closeList() {
    $('listModal').hidden = true;
  }
  $('btnList').onclick = openList;
  $('listClose').onclick = closeList;
  $('listModal').addEventListener('click', (e) => {
    if (e.target === $('listModal')) closeList();
  });
  document.querySelectorAll('#listTabs button').forEach((b) => {
    b.onclick = () => {
      listTab = b.dataset.tab;
      document.querySelectorAll('#listTabs button').forEach((x) => x.classList.toggle('on', x === b));
      renderList();
    };
  });
  document.querySelectorAll('#listSort button').forEach((b) => {
    b.onclick = () => {
      listSort = b.dataset.sort;
      document.querySelectorAll('#listSort button').forEach((x) => x.classList.toggle('on', x === b));
      renderList();
    };
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('listModal').hidden) closeList();
      else if (ritual.step) closeRitual();
      else closeCard();
    }
  });

  // ---------- 소리 ----------
  function renderSoundBtn() {
    $('btnSound').textContent = isSoundOn() ? '🔊' : '🔇';
  }
  $('btnSound').onclick = () => {
    setSound(!isSoundOn());
    state.sound = isSoundOn();
    save();
    renderSoundBtn();
  };
  if (state.sound) window.addEventListener('pointerdown', () => (setSound(true), renderSoundBtn()), { once: true });
  renderSoundBtn();

  // ---------- 모바일 패널 ----------
  function openPanel(open) {
    if (open && mobile()) closeCard();
    $('panel').classList.toggle('collapsed', !open);
    document.body.classList.toggle('panel-open', open && mobile());
  }
  $('btnPanel').onclick = () => openPanel($('panel').classList.contains('collapsed'));
  $('panelClose').onclick = () => openPanel(false);
  $('miniOpen').onclick = () => openPanel(true);
  $('miniFeed').onclick = () => myWish && feedWish(myWish.id);
  $('btnFeedMine').onclick = () => myWish && feedWish(myWish.id);

  // ---------- 실시간 ----------
  live.on('online', (m) => {
    stats.online = m.n;
    renderStats();
  });
  live.on('wish:new', ({ wish }) => {
    if (wishes.has(wish.id)) return;
    if (creatingWish) {
      // 내가 방금 만든 소원일 수 있으니 응답을 기다렸다가 다시 확인
      setTimeout(() => !wishes.has(wish.id) && live.dispatchEvent(new CustomEvent('wish:new', { detail: { wish } })), 1500);
      return;
    }
    stats.total++;
    renderStats();
    const swimming = [...world.fishes.values()].filter((f) => !f.isNpc).length;
    if (swimming < 40) {
      const f = putFish(wish, { splash: true });
      if (f && wish.text) setTimeout(() => f.surface(wishLine(wish)), 1800);
    } else wishes.set(wish.id, wish);
    toast(`🐟 ${wish.name} 님이 소원을 방생했어요`);
  });
  live.on('wish:fed', ({ id, feeds }) => {
    const w = wishes.get(id);
    const pend = (myPendingFeeds.get(id) || []).filter((t) => Date.now() - t < 10000);
    if (pend.length) {
      // 내가 준 먹이 → 숫자만 맞추고 조용히
      pend.shift();
      myPendingFeeds.set(id, pend);
      return;
    }
    if (!w || w.feeds >= feeds) return;
    w.feeds = feeds;
    world.getFish(id)?.setData({ done: feeds });
    world.feed(null, id);
    if (myWish?.id === id) {
      myWish.feeds = feeds;
      state.seen[id] = feeds;
      save();
      renderPanel();
      sfx.chime();
      toast(`✨ 누군가 내 소원에 먹이를 줬어요 (${feeds}/${GOAL})`, 'gold');
    }
    if (cardId === id) openCard(w);
  });
  live.on('wish:hide', ({ id }) => dropWish(id));
  // 누군가 이름을 바꿈 → 그 사람 소원 물고기의 이름표도
  live.on('wish:name', ({ id, name }) => {
    const w = wishes.get(id);
    if (w) w.name = name;
    world.getFish(id)?.setData({ name });
    const sf = world.getSkyFish(id);
    if (sf) sf.data.name = name;
  });
  live.on('wish:star', ({ wish }) => {
    const known = wishes.get(wish.id);
    onStar({ ...known, ...wish, mine: known?.mine || myWish?.id === wish.id });
  });

  // ---------- 수면에 소원 띄우기 ----------
  // 가만히 보고 있으면 물고기가 하나씩 올라와 소원을 보여 줌
  let lastSurfaced = null;
  setInterval(() => {
    if (document.hidden || document.body.classList.contains('cinema')) return;
    const cands = [...world.fishes.values()].filter((f) => {
      const w = wishes.get(f.id);
      return w && w.text && !f.action && !f.move && !f.manual && f.id !== lastSurfaced;
    });
    if (!cands.length) return;
    const f = cands[Math.floor(Math.random() * cands.length)];
    lastSurfaced = f.id;
    f.surface(wishLine(wishes.get(f.id)));
  }, 6500);

  // ---------- 처음 불러오기 ----------
  async function loadMine() {
    const mine = (await api('/api/wishes?mine=1&limit=50')).wishes;
    myWish = mine.find((w) => w.status === 'swimming') || null;
    myStars = mine.filter((w) => w.status === 'star');
    renderPanel();
    return mine;
  }

  try {
    const [st, pond, sky] = await Promise.all([
      api('/api/stats'),
      api('/api/wishes?status=swimming&sort=mix&limit=40'),
      api('/api/wishes?status=star&sort=recent&limit=200'),
    ]);
    stats = st;
    GOAL = st.goal || GOAL;
    pond.wishes.forEach((w) => putFish(w));
    world.setSkyFish(sky.wishes);
    sky.wishes.forEach((w) => wishes.set(w.id, w));
    await loadMine();

    // 없는 동안 받은 응원
    if (myWish) {
      const before = state.seen[myWish.id] ?? 0; // 처음 보는 브라우저면 받은 먹이 전부가 새 소식
      const diff = myWish.feeds - before;
      if (diff > 0) setTimeout(() => (toast(`✨ 없는 동안 내 소원에 먹이가 ${diff}번 들어왔어요`, 'gold'), sfx.chime()), 1200);
      state.seen[myWish.id] = myWish.feeds;
      save();
    }
    // 없는 동안 이루어진 내 소원 → 지금 축하
    const fresh = myStars.filter((w) => !state.celebrated.includes(w.id));
    fresh.forEach((w) => state.celebrated.push(w.id));
    save();
    if (fresh[0]) {
      const w = fresh[0];
      setTimeout(() => {
        // 하늘 연못에 미리 있던 물고기는 잠시 빼고, 아래에서 폭포를 올라가 다시 들어가게
        world.removeSkyFish(w.id);
        starred.add(w.id);
        playAscend({ ...w, mine: true }, { cine: true });
      }, 1500);
    }
    // 공유 링크로 들어온 경우
    const shared = new URLSearchParams(location.search).get('wish');
    if (shared && /^[a-f0-9]{8,16}$/.test(shared)) {
      try {
        const { wish } = await api(`/api/wishes/${shared}`);
        if (wish.status === 'swimming') putFish(wish, { splash: !world.getFish(wish.id) });
        else wishes.set(wish.id, wish);
        setTimeout(() => openCard(wish), 900);
      } catch (_) {
        toast('찾을 수 없는 소원이에요');
      }
    }
  } catch (e) {
    console.error(e);
    toast('소원을 불러오지 못했어요. 새로고침해 주세요');
    renderPanel();
  }
  renderStats();
  world.balanceNpcs();
  setTimeout(() => $('steerHint').classList.add('fade'), 25000); // 안내는 잠시 뒤 사라짐
  live.bindLeave();
  live.connect();
  openPanel(!mobile()); // 휴대폰은 연못 화면부터 (아래 작은 막대에서 소원 빌기·먹이)

  // 개발 확인용
  window.__pond = { world, state, wishes, api, feedWish, get myWish() { return myWish; } };
}

main().catch((e) => {
  console.error(e);
  $('loading').querySelector('p').textContent = '연못을 여는 데 문제가 생겼어요. 새로고침해 주세요.';
});
