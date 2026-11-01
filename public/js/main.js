// 소원 연못 — 화면(UI) · 3D 연못 · 서버를 잇는 곳
//
//  물속  : 지금 응원이 필요한 소원 (물고기 한 마리 = 소원 하나)
//  수면  : 물고기가 가끔 올라와 소원 한 줄을 띄움
//  하늘  : 먹이를 GOAL 번 받아 용이 된 소원 (별)
import { World } from './world.js';
import { Live } from './live.js';
import { SPECIES, SPECIES_IDS } from './data.js';
import { state, save } from './store.js';
import { sfx, setSound, isSoundOn, buzz } from './sound.js';

const $ = (id) => document.getElementById(id);
let GOAL = 21;

// ---------------------------------------------------------------------
// 서버
// ---------------------------------------------------------------------
async function api(path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(body ? path : `${path}${sep}uid=${state.uid}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
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

// 별이 되는 마지막 장면
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
  mk('cele-orn', '✦ 登 龍 ✦', 0);
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
  celebrate.t = setTimeout(() => box.classList.add('out'), 6200);
  clearTimeout(celebrate.t2);
  celebrate.t2 = setTimeout(() => (box.hidden = true), 7000);
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

  const wishes = new Map(); // 연못에 있는(또는 본) 소원들
  let myWish = null; // 지금 헤엄치는 내 소원
  let myStars = [];
  let stats = { total: 0, stars: 0, online: 0 };
  const touchOnly = matchMedia('(hover: none)').matches;
  const mobile = () => matchMedia('(max-width: 720px)').matches;

  // ---------- 상단 통계 ----------
  function renderStats() {
    const n = (v) => Number(v || 0).toLocaleString('ko-KR');
    $('stats').textContent = `소원 ${n(stats.total)} · 별 ${n(stats.stars)}${stats.online > 1 ? ` · 지금 ${n(stats.online)}명` : ''}`;
    $('goalText').textContent = GOAL;
  }

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
      $('myLabel').textContent =
        w.feeds === 0 ? `아직 먹이 0 / ${GOAL} — 링크를 보내 첫 응원을 받아 보세요` : `🍚 먹이 ${w.feeds} / ${GOAL} · ${GOAL - w.feeds}번 더 모이면 별이 돼요`;
    }
    $('myStars').hidden = myStars.length === 0;
    const ul = $('myStarList');
    ul.textContent = '';
    myStars.forEach((w) => {
      const li = document.createElement('li');
      li.textContent = `${w.text || '마음속 소원'} (${fmtDate(w.starAt)})`;
      ul.appendChild(li);
    });
  }

  // ---------- 소원 카드 ----------
  let cardId = null;
  function openCard(w) {
    if (!w) return;
    cardId = w.id;
    const star = w.status === 'star';
    $('wishCard').hidden = false;
    $('wishCard').classList.toggle('is-star', star);
    $('cardName').textContent = `${star ? '✦ 별이 된 소원' : SPECIES[w.species]?.label || ''} · ${w.name}${w.mine ? ' (나)' : ''}`;
    $('cardText').textContent = wishLine(w);
    $('cardFill').style.width = `${Math.min(100, (w.feeds / GOAL) * 100)}%`;
    $('cardLabel').textContent = star
      ? `${w.feeds}명의 응원으로 ${fmtDate(w.starAt)}에 별이 되었어요`
      : `🍚 먹이 ${w.feeds} / ${GOAL}`;
    const b = $('btnFeed');
    b.hidden = star;
    b.disabled = w.mine || w.fedToday;
    b.textContent = w.mine ? '내 소원이에요' : w.fedToday ? '오늘 먹이를 줬어요 ✓' : '🍚 먹이 주며 응원하기';
    b.title = w.fedToday ? '같은 소원에는 하루 한 번 — 내일 또 줄 수 있어요' : '';
    // 물고기 이름표를 잠깐 켜서 어떤 물고기인지 보이게
    for (const f of world.fishes.values()) if (f.data.highlight && f.id !== w.id) f.setData({ highlight: false });
    world.getFish(w.id)?.setData({ highlight: true });
  }
  function closeCard() {
    if (cardId) world.getFish(cardId)?.setData({ highlight: false });
    cardId = null;
    $('wishCard').hidden = true;
  }
  $('cardClose').onclick = closeCard;

  world.onFishClick = (f) => {
    if (!f) return closeCard();
    const w = wishes.get(f.id);
    if (!w) return;
    sfx.bubble();
    if (w.mine && mobile()) openPanel(true);
    openCard(w);
  };
  world.onStarClick = (star) => {
    sfx.chime();
    openCard({ ...star, status: 'star' });
  };

  // ---------- 먹이 주기 ----------
  async function feedWish(id) {
    try {
      const { wish, becameStar } = await api(`/api/wishes/${id}/feed`, {});
      wishes.set(wish.id, wish);
      world.getFish(id)?.setData(fishData(wish));
      world.feed(null, id);
      if (!state.fed.includes(id)) state.fed.push(id);
      save();
      sfx.chime();
      buzz([15, 40, 15]);
      toast(becameStar ? '마지막 먹이! 이 소원이 용이 되어 올라가요 ✨' : `🍚 응원을 보냈어요 (${wish.feeds}/${GOAL})`, 'gold');
      if (cardId === id) openCard(wish);
      if (becameStar) onStar(wish); // 실시간 연결이 없을 때를 위해 직접도 처리
      return wish;
    } catch (e) {
      const msg = {
        fed_today: '이 소원에는 오늘 이미 먹이를 줬어요. 내일 또 와 주세요 🌙',
        own_wish: '내 소원에는 먹이를 줄 수 없어요. 다른 소원을 응원해 보세요',
        already_star: '이미 별이 된 소원이에요 ✦',
        too_many: '잠시 쉬었다가 다시 해 주세요',
      }[e.code];
      toast(msg || '먹이를 주지 못했어요. 잠시 뒤 다시 해 주세요');
      return null;
    }
  }
  $('btnFeed').onclick = () => cardId && feedWish(cardId);

  // ---------- 별이 될 때 ----------
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
    playAscend({ ...w, mine: mine || w.mine }, { cine: mine || state.fed.includes(w.id) });
  }

  // 물고기가 폭포를 올라 별이 되는 장면
  function playAscend(w, { cine }) {
    let f = world.getFish(w.id);
    const finish = () => {
      world.removeFish(w.id);
      world.addStar({ ...w, status: 'star' }, { flash: true });
      world.refreshMarkers();
      if (cine) {
        celebrate({
          title: w.mine ? '당신의 소원이 용이 되었어요' : '함께 올린 소원이 별이 되었어요',
          dream: wishLine(w),
          meta: `${w.feeds || GOAL}명의 응원이 모여 하늘의 별이 되었어요`,
        });
      } else toast(`✦ ${w.name} 님의 소원이 별이 되었어요`, 'gold');
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
      caption(w.mine ? `${wishLine(w)} — ${GOAL}번의 응원을 받고 폭포를 오릅니다…` : `${w.name} 님의 소원이 폭포를 오릅니다…`, 5000);
      world.setPlaque(w.text || `${w.name}의 소원`, 1);
      world.startDirector(f, () => {
        cinema(false);
        world.setPlaque(null);
        ceremonyBusy = false;
      });
    }
    f.ascend(finish, world.starPosition(w));
  }

  // ---------- 방생 의식 ----------
  const ritual = { step: 0, knocks: 0, text: '', isPublic: true, holdT: 0, holding: false, raf: 0 };
  function ritualStep(n) {
    ritual.step = n;
    $('ritualStep').textContent = `${n} / 3`;
    $('mokeo').hidden = n !== 1;
    $('mokeoDots').hidden = n !== 1;
    $('pray').hidden = n !== 2;
    if (n === 1) {
      $('ritualTitle').textContent = '목어를 세 번 두드려 마음을 깨워요';
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
    if (ritual.knocks >= 3) setTimeout(() => ritualStep(2), 650);
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

  async function releaseWish() {
    ritualStep(3);
    try {
      const { wish } = await api('/api/wishes', {
        text: ritual.text,
        isPublic: ritual.isPublic,
        species: pickedSpecies,
        name: state.name,
      });
      myWish = wish;
      state.seen[wish.id] = 0;
      save();
      stats.total++;
      renderStats();
      setTimeout(() => {
        closeRitual();
        $('wishInput').value = '';
        renderPanel();
        const f = putFish(wish, { splash: true });
        sfx.splash();
        caption(`${wishLine(wish)} — 연못으로 놓아주었어요`, 4500);
        if (f) setTimeout(() => f.surface(wishLine(wish)), 1500);
        setTimeout(() => toast('🔗 링크를 보내면 친구가 내 소원에 먹이를 줄 수 있어요'), 5000);
      }, 900);
    } catch (e) {
      closeRitual();
      if (e.code === 'already_swimming') {
        toast('이미 헤엄치는 소원이 있어요. 별이 되면 새 소원을 띄울 수 있어요');
        await loadMine();
      } else if (e.code === 'too_many') toast('잠시 뒤에 다시 방생해 주세요');
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
      toast('링크를 복사했어요. 친구에게 보내 먹이를 부탁해 보세요 🍚');
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
      li.textContent = listTab === 'star' ? '아직 별이 된 소원이 없어요. 첫 별을 함께 띄워 볼까요?' : listTab === 'mine' ? '아직 띄운 소원이 없어요' : '아직 헤엄치는 소원이 없어요';
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
        w.status === 'star' ? `✦ ${w.name} · ${fmtDate(w.starAt)} 별이 됨` : `${w.name}${w.mine ? ' (나)' : ''} · 🍚 ${w.feeds}/${GOAL}`;
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
      if (w.status === 'swimming' && !w.mine) {
        const fb = document.createElement('button');
        fb.className = 'small primary';
        fb.disabled = w.fedToday;
        fb.textContent = w.fedToday ? '✓' : '🍚';
        fb.title = w.fedToday ? '오늘 먹이를 줬어요' : '먹이 주며 응원하기';
        fb.onclick = async () => {
          const nw = await feedWish(w.id);
          if (nw) {
            fb.disabled = true;
            fb.textContent = '✓';
            meta.textContent = `${nw.name} · 🍚 ${nw.feeds}/${GOAL}`;
            body.querySelector('.falls-fill').style.width = `${Math.min(100, (nw.feeds / GOAL) * 100)}%`;
          }
        };
        acts.appendChild(fb);
      }
      const look = document.createElement('button');
      look.className = 'small';
      look.textContent = w.status === 'star' ? '✦' : '🐟';
      look.title = w.status === 'star' ? '하늘에서 보기' : '연못에서 보기';
      look.onclick = () => {
        closeList();
        if (w.status === 'swimming') putFish(w, { splash: !world.getFish(w.id) });
        openCard(wishes.get(w.id));
      };
      acts.appendChild(look);
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
    $('panel').classList.toggle('collapsed', !open);
    document.body.classList.toggle('panel-open', open && mobile());
  }
  $('btnPanel').onclick = () => openPanel($('panel').classList.contains('collapsed'));

  // ---------- 실시간 ----------
  const live = new Live();
  live.on('online', (m) => {
    stats.online = m.n;
    renderStats();
  });
  live.on('wish:new', ({ wish }) => {
    if (wishes.has(wish.id)) return;
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
    if (!w || w.feeds >= feeds) return; // 내가 준 먹이는 이미 반영됨
    w.feeds = feeds;
    world.getFish(id)?.setData({ done: feeds });
    world.feed(null, id);
    if (myWish?.id === id) {
      myWish.feeds = feeds;
      state.seen[id] = feeds;
      save();
      renderPanel();
      sfx.chime();
      toast(`🍚 누군가 내 소원에 먹이를 줬어요 (${feeds}/${GOAL})`, 'gold');
    }
    if (cardId === id) openCard(w);
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
      return w && w.text && !f.action && !f.move && f.id !== lastSurfaced;
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
    world.setStars(sky.wishes);
    sky.wishes.forEach((w) => wishes.set(w.id, w));
    await loadMine();

    // 없는 동안 받은 응원
    if (myWish) {
      const before = state.seen[myWish.id] ?? 0; // 처음 보는 브라우저면 받은 먹이 전부가 새 소식
      const diff = myWish.feeds - before;
      if (diff > 0) setTimeout(() => (toast(`🍚 없는 동안 ${diff}명이 내 소원에 먹이를 줬어요`, 'gold'), sfx.chime()), 1200);
      state.seen[myWish.id] = myWish.feeds;
      save();
    }
    // 없는 동안 별이 된 내 소원 → 지금 축하
    const fresh = myStars.filter((w) => !state.celebrated.includes(w.id));
    fresh.forEach((w) => state.celebrated.push(w.id));
    save();
    if (fresh[0]) {
      const w = fresh[0];
      setTimeout(() => {
        // 하늘에 미리 있던 별은 잠시 빼고, 물고기가 올라가 다시 별이 되게
        const s = world.dreamStars.children.find((x) => x.userData.star?.id === w.id);
        if (s) world.dreamStars.remove(s);
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
  live.connect();
  openPanel(!(mobile() && myWish)); // 휴대폰: 내 소원이 있으면 연못부터, 없으면 소원 적기부터

  // 개발 확인용
  window.__pond = { world, state, wishes, api, feedWish, get myWish() { return myWish; } };
}

main().catch((e) => {
  console.error(e);
  $('loading').querySelector('p').textContent = '연못을 여는 데 문제가 생겼어요. 새로고침해 주세요.';
});
