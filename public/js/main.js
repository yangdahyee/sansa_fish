// 등용문 연못 — 화면(UI)과 연못(3D)·네트워크를 잇는 곳
import { World } from './world.js';
import { PondNet } from './net.js';
import { SPECIES, SPECIES_IDS, PHRASES, MAX_TODOS, MOVES } from './data.js';
import { state, save, progress, isSleeping, touch } from './store.js';
import { sfx, setSound, isSoundOn, buzz } from './sound.js';

const $ = (id) => document.getElementById(id);
const ME = 'me'; // 연못 안에서 내 물고기 id

// ---------- 연못 방 정하기 ----------
async function resolvePond() {
  const params = new URLSearchParams(location.search);
  let pond = params.get('pond');
  if (pond && /^[a-z0-9-]{1,32}$/.test(pond)) return pond;
  try {
    const r = await fetch('/api/assign');
    pond = (await r.json()).pond;
  } catch (_) {
    pond = 'yeon-1';
  }
  params.set('pond', pond);
  history.replaceState(null, '', `${location.pathname}?${params}`);
  return pond;
}

function pondLabel(id) {
  const m = /^yeon-(\d+)$/.exec(id);
  return m ? `${m[1]}번 연못` : id;
}

// ---------- 토스트 / 축하 ----------
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => (el.style.opacity = '0'), 3600);
  setTimeout(() => el.remove(), 4200);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

function celebrate(title, sub) {
  const box = $('celebrate');
  box.textContent = '';
  const a = document.createElement('div');
  a.className = 'big';
  a.textContent = title;
  const b = document.createElement('div');
  b.className = 'small';
  b.textContent = sub;
  box.append(a, b);
  box.classList.remove('out');
  box.hidden = false;
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    p.textContent = ['🌸', '✨', '🪷', '·'][i % 4];
    p.style.left = `${Math.random() * 100}vw`;
    p.style.animationDuration = `${3 + Math.random() * 3}s`;
    p.style.animationDelay = `${Math.random() * 1.5}s`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 8000);
  }
  clearTimeout(celebrate.t);
  celebrate.t = setTimeout(() => box.classList.add('out'), 4600);
  clearTimeout(celebrate.t2);
  celebrate.t2 = setTimeout(() => (box.hidden = true), 5400);
}

// 화면 아래 자막
function caption(text, ms = 4000) {
  const el = $('caption');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(caption.t);
  caption.t = setTimeout(() => el.classList.remove('on'), ms);
}

// ---------- 내 물고기 데이터 ----------
function myFishData() {
  const d = state.dream;
  const { done, total } = progress();
  return {
    id: ME,
    name: state.name,
    species: d?.species || 'berry',
    dream: d?.text || '',
    isPublic: !!d?.isPublic,
    hasDream: !!d,
    done,
    total,
    sleeping: isSleeping(),
    followId: d?.followId || null,
  };
}

// ======================================================================
async function main() {
  const pond = await resolvePond();
  $('pondName').textContent = pondLabel(pond);

  const world = new World($('scene'), $('labels'));
  world.sfx = sfx;
  await world.init((p) => {
    $('loading').querySelector('p').textContent = `물고기를 부르는 중… ${Math.round(p * 100)}%`;
  });
  $('loading').classList.add('done');

  // 엔딩(등용) 장면: 패널·버튼을 숨기고 장면을 화면 정중앙으로
  let cinemaTimer = null;
  function cinema(on, { maxMs = 40000 } = {}) {
    document.body.classList.toggle('cinema', on);
    world.setCinema(on);
    clearTimeout(cinemaTimer);
    if (on) cinemaTimer = setTimeout(() => cinema(false), maxMs); // 혹시 끝나지 않아도 풀리게
  }
  const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);

  const net = new PondNet(pond);
  const others = new Map(); // netId → 공개 정보
  const toLocal = (id) => (id === net.id ? ME : id);
  // 다른 물고기가 '나'를 따라 헤엄칠 때 followId 를 연못 안의 id 로 바꿔 준다
  const localView = (f) => ({ ...f, followId: f.followId ? toLocal(f.followId) : null });

  // 내 물고기는 netId 대신 'me' 로 쓰고, 서버에는 followId 를 netId 로 보낸다
  net.getFish = () => {
    const f = myFishData();
    return { ...f, followId: f.followId && others.has(f.followId) ? f.followId : null };
  };

  function syncMe({ spawn = false } = {}) {
    const data = myFishData();
    world.upsertFish(data, { isMe: true, splashIn: spawn });
    world.refreshMarkers();
    net.send({ t: 'update', fish: net.getFish() });
  }

  function updateOnline() {
    const n = others.size + 1;
    $('online').textContent = net.online ? (n === 1 ? '지금 혼자 헤엄 중' : `${n}명이 함께 헤엄 중`) : '혼자 헤엄치는 중 (오프라인)';
  }

  // ---------- 네트워크 이벤트 ----------
  net.addEventListener('welcome', (e) => {
    const m = e.detail;
    // 오래된 원격 물고기 정리 후 다시 그림
    for (const id of others.keys()) world.removeFish(id);
    others.clear();
    m.fishes.forEach((f) => {
      others.set(f.id, f);
      world.upsertFish(localView(f));
    });
    world.setStars([...m.stars, ...state.stars.filter((s) => s.offline)]);
    world.refreshMarkers();
    updateOnline();
  });
  net.addEventListener('join', (e) => {
    const f = e.detail.fish;
    others.set(f.id, f);
    world.upsertFish(localView(f));
    world.refreshMarkers();
    updateOnline();
    if (f.hasDream) toast(`${f.name} 물고기가 연못에 들어왔어요`);
  });
  net.addEventListener('update', (e) => {
    const f = e.detail.fish;
    const prev = others.get(f.id);
    others.set(f.id, f);
    const fish = world.upsertFish(localView(f), { splashIn: !prev?.hasDream && f.hasDream });
    if (!prev?.hasDream && f.hasDream) toast(`${f.name} 님이 새 꿈을 방류했어요 🌊`);
    world.refreshMarkers();
    if (fish && openCard === f.id) renderCard(f.id);
  });
  net.addEventListener('leave', (e) => {
    const id = e.detail.id;
    const f = world.getFish(id);
    if (f && !f.action) world.removeFish(id);
    others.delete(id);
    if (state.dream?.followId === id) {
      state.dream.followId = null;
      save();
      syncMe();
    }
    world.refreshMarkers();
    updateOnline();
    if (openCard === id) closeCard();
  });
  net.addEventListener('leap', (e) => {
    const f = world.getFish(e.detail.from);
    if (f) {
      f.leap();
      sfx.splash();
    }
  });
  net.addEventListener('feed', (e) => {
    const { from, to, fromName } = e.detail;
    world.feed(toLocal(from), toLocal(to));
    if (to === net.id) {
      sfx.chime();
      buzz([20, 60, 20]);
      toast(`${fromName} 님이 응원 먹이를 줬어요 🍚`, 'gold');
    } else if (from === net.id) {
      sfx.plop();
    }
  });
  net.addEventListener('bubble', (e) => {
    const f = world.getFish(toLocal(e.detail.from));
    f?.say(PHRASES[e.detail.i] || '');
    sfx.bubble();
  });
  net.addEventListener('goto', (e) => world.swimFishTo(e.detail.from, e.detail.p));
  net.addEventListener('act', (e) => {
    const m = MOVES[e.detail.i];
    if (m) world.getFish(e.detail.from)?.doMove(m.id);
  });
  net.addEventListener('ascend', (e) => {
    const { from, star } = e.detail;
    if (from === net.id) return; // 내 등용은 직접 처리
    const f = world.getFish(from);
    // 내가 무언가 입력하던 중이면 화면을 가리지 않는다
    const cine = !typing();
    const done = () => {
      world.removeFish(from);
      world.addStar(star, { flash: true });
      world.refreshMarkers();
      celebrate(`${star.name} 님의 꿈이 용이 되었어요`, star.dream ? `“${star.dream}”` : '연못 하늘에 별이 하나 늘었어요');
      if (cine) setTimeout(() => cinema(false), 5600);
    };
    if (cine) {
      cinema(true);
      caption(`${star.name} 님의 물고기가 폭포를 거슬러 오릅니다…`);
    } else toast(`${star.name} 님의 물고기가 폭포를 오르고 있어요`, 'gold');
    sfx.ascend();
    if (world.view.fishId === from) world.setView('pond');
    if (f) f.ascend(done);
    else done();
  });
  net.addEventListener('full', (e) => {
    const p = new URLSearchParams(location.search);
    p.set('pond', e.detail.suggest);
    location.search = p.toString();
  });
  net.addEventListener('offline', updateOnline);

  // ---------- 패널 렌더 ----------
  let pickedSpecies = SPECIES_IDS[Math.floor(Math.random() * SPECIES_IDS.length)];
  const draft = [];

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

  function renderDraft() {
    const ol = $('todoDraft');
    ol.textContent = '';
    draft.forEach((text, i) => {
      const li = document.createElement('li');
      const s = document.createElement('span');
      s.textContent = text;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.onclick = () => {
        draft.splice(i, 1);
        renderDraft();
      };
      li.append(s, x);
      ol.appendChild(li);
    });
    $('btnAddDraft').disabled = draft.length >= MAX_TODOS;
  }

  function renderPanel() {
    const d = state.dream;
    $('releaseView').hidden = !!d;
    $('dreamView').hidden = !d;
    document.querySelectorAll('#bubbleBar button').forEach((b) => (b.disabled = !d));
    $('moveBar').hidden = !d;
    $('bubbleBar').title = d ? '' : '꿈을 방류하면 물방울 말을 보낼 수 있어요';

    if (!d) {
      renderSpecies();
      renderDraft();
    } else {
      const { done, total } = progress();
      $('myFishName').textContent = `${SPECIES[d.species].label} · ${state.name}`;
      $('myVisibility').textContent = d.isPublic ? '꿈 공개' : '꿈 비공개';
      $('myDream').textContent = d.text;
      $('fallsFill').style.width = `${total ? (done / total) * 100 : 0}%`;
      $('fallsLabel').textContent =
        total === 0
          ? '물길(할 일)을 하나 이상 내 주세요'
          : done === total
            ? '폭포 꼭대기에 닿았어요!'
            : `폭포 ${done}/${total}단 · 다음 물길까지 한 걸음`;

      const ul = $('todoList');
      ul.textContent = '';
      d.todos.forEach((t, i) => {
        const li = document.createElement('li');
        li.className = t.done ? 'done' : '';
        const box = document.createElement('span');
        box.className = 'box';
        box.textContent = t.done ? '✓' : '';
        const txt = document.createElement('span');
        txt.textContent = t.text;
        li.append(box, txt);
        if (!t.done) {
          const del = document.createElement('button');
          del.className = 'del';
          del.type = 'button';
          del.textContent = '×';
          del.title = '이 물길 지우기';
          del.onclick = (ev) => {
            ev.stopPropagation();
            d.todos.splice(i, 1);
            save();
            renderPanel();
            syncMe();
            maybeAscend();
          };
          li.appendChild(del);
          li.onclick = () => completeTodo(i);
        }
        ul.appendChild(li);
      });
      $('btnAddTodo').disabled = d.todos.length >= MAX_TODOS;
      $('sleepNote').hidden = !isSleeping();
    }

    const stars = state.stars;
    $('myStars').hidden = stars.length === 0;
    const sl = $('myStarList');
    sl.textContent = '';
    stars
      .slice()
      .reverse()
      .forEach((s) => {
        const li = document.createElement('li');
        li.textContent = `${s.text} (${new Date(s.at).toLocaleDateString('ko-KR')})`;
        sl.appendChild(li);
      });
  }

  // ---------- 꿈 방류 ----------
  function addDraft() {
    const v = $('todoDraftInput').value.trim();
    if (!v || draft.length >= MAX_TODOS) return;
    draft.push(v.slice(0, 60));
    $('todoDraftInput').value = '';
    renderDraft();
    $('todoDraftInput').focus();
  }
  $('btnAddDraft').onclick = addDraft;
  $('todoDraftInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      addDraft();
    }
  });

  $('btnRelease').onclick = () => {
    const text = $('dreamInput').value.trim();
    if (!text) {
      $('dreamInput').focus();
      toast('먼저 미뤄둔 꿈을 한 줄 적어 주세요');
      return;
    }
    // 입력칸에 남아 있는 할 일도 함께
    const pending = $('todoDraftInput').value.trim();
    if (pending && draft.length < MAX_TODOS) draft.push(pending);
    if (draft.length === 0) {
      $('todoDraftInput').focus();
      toast('꿈을 이룰 첫 물길(할 일)을 하나 이상 적어 주세요');
      return;
    }
    state.dream = {
      text: text.slice(0, 80),
      species: pickedSpecies,
      isPublic: $('publicInput').checked,
      todos: draft.map((t) => ({ text: t, done: false })),
      createdAt: Date.now(),
      lastActive: Date.now(),
      followId: null,
    };
    draft.length = 0;
    $('dreamInput').value = '';
    $('todoDraftInput').value = '';
    save();
    renderPanel();
    syncMe({ spawn: true });
    sfx.splash();
    buzz(30);
    toast('꿈이 물고기가 되어 연못으로 들어갔어요 🌊', 'gold');
    setTimeout(() => toast('💡 연못을 누르면 내 물고기가 그곳으로 헤엄쳐요'), 1800);
  };

  // ---------- 할 일 ----------
  function addTodo() {
    const d = state.dream;
    const v = $('todoAddInput').value.trim();
    if (!d || !v || d.todos.length >= MAX_TODOS) return;
    d.todos.push({ text: v.slice(0, 60), done: false });
    $('todoAddInput').value = '';
    touch();
    save();
    renderPanel();
    syncMe();
  }
  $('btnAddTodo').onclick = addTodo;
  $('todoAddInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      addTodo();
    }
  });

  function completeTodo(i) {
    const d = state.dream;
    if (!d || d.todos[i].done) return;
    d.todos[i].done = true;
    d.todos[i].doneAt = Date.now();
    touch();
    save();
    renderPanel();
    syncMe();
    world.getFish(ME)?.leap();
    net.send({ t: 'leap' });
    sfx.splash();
    buzz([15, 40, 15]);
    const { done, total } = progress();
    if (done < total) toast(`한 단 거슬러 올랐어요! (${done}/${total})`, 'gold');
    maybeAscend(1700);
  }

  // 모든 물길을 다 해내면 → 등용
  let ascending = false;
  function maybeAscend(delay = 300) {
    const { done, total } = progress();
    if (!state.dream || total === 0 || done < total || ascending) return;
    ascending = true;
    setTimeout(() => {
      const d = state.dream;
      const fish = world.getFish(ME);
      // 화면 앞을 스쳐 가는 장면이 보이도록 연못 전체 시점으로
      world.setView('pond');
      net.send({ t: 'ascend' });
      sfx.ascend();
      buzz([40, 80, 40, 80, 120]);
      cinema(true);
      caption('물고기가 폭포를 거슬러 오릅니다…');
      const finish = () => {
        const star = { name: state.name, dream: d.isPublic ? d.text : '', species: d.species, at: Date.now() };
        state.stars.push({ text: d.text, species: d.species, at: star.at, offline: !net.online, name: star.name, dream: star.dream });
        state.dream = null;
        save();
        world.removeFish(ME);
        world.addStar(star, { flash: true });
        world.refreshMarkers();
        celebrate('등용! 꿈이 용이 되었어요', `“${d.text}”`);
        setTimeout(() => cinema(false), 5600);
        net.send({ t: 'update', fish: net.getFish() });
        renderPanel();
        ascending = false;
      };
      if (fish) fish.ascend(finish);
      else finish();
      world.refreshMarkers();
    }, delay);
  }

  $('btnLetGo').onclick = () => {
    if (!state.dream) return;
    if (!confirm('이 꿈을 놓아줄까요? 물고기는 연못을 떠나요. 언제든 다시 띄울 수 있어요.')) return;
    const f = world.getFish(ME);
    if (f) world.splash(f.pos, 0.8);
    state.dream = null;
    save();
    world.removeFish(ME);
    world.refreshMarkers();
    net.send({ t: 'update', fish: net.getFish() });
    renderPanel();
    toast('꿈을 잠시 놓아주었어요. 괜찮아요.');
  };

  // ---------- 다른 물고기 카드 ----------
  let openCard = null;
  function renderCard(id) {
    const f = others.get(id);
    if (!f) return closeCard();
    openCard = id;
    $('fishCard').hidden = false;
    $('cardName').textContent = `${SPECIES[f.species]?.label || ''} · ${f.name}${f.sleeping ? ' · 쉬는 중 💤' : ''}`;
    $('cardDream').textContent = f.dream ? `“${f.dream}”` : '마음속에 간직한 꿈 (비공개)';
    $('cardFill').style.width = `${f.total ? (f.done / f.total) * 100 : 0}%`;
    $('cardLabel').textContent = `폭포 ${f.done}/${f.total}단`;
    const following = state.dream?.followId === id;
    $('btnFollow').textContent = following ? '🐟 따로 헤엄치기' : '🐟 같이 헤엄치기';
    $('btnFollow').disabled = !state.dream;
    $('btnFollow').title = state.dream ? '' : '꿈을 방류하면 나란히 헤엄칠 수 있어요';
  }
  function closeCard() {
    openCard = null;
    $('fishCard').hidden = true;
  }
  $('cardClose').onclick = closeCard;

  world.onFishClick = (f) => {
    if (!f) return closeCard();
    if (f.isMe) {
      closeCard();
      openPanel(true);
      return;
    }
    sfx.bubble();
    renderCard(f.id);
  };

  $('btnWatch').onclick = () => {
    if (!openCard) return;
    const id = openCard;
    world.setView(world.view.mode === 'eye' ? 'eye' : 'chase', id);
  };

  $('btnFeed').onclick = () => {
    if (!openCard) return;
    if (!net.online) return toast('연결되면 응원 먹이를 줄 수 있어요');
    net.send({ t: 'feed', to: openCard });
  };
  $('btnFollow').onclick = () => {
    if (!openCard || !state.dream) return;
    const now = state.dream.followId === openCard;
    state.dream.followId = now ? null : openCard;
    touch();
    save();
    syncMe();
    renderCard(openCard);
    if (!now) {
      net.send({ t: 'bubble', i: 1 });
      toast(`${others.get(openCard)?.name} 물고기와 나란히 헤엄쳐요`);
    }
  };

  // ---------- 헤엄 동작 ----------
  MOVES.forEach((m, i) => {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.onclick = () => {
      const f = world.getFish(ME);
      if (!f) return;
      f.doMove(m.id);
      net.send({ t: 'act', i });
      sfx.bubble();
      buzz(10);
    };
    $('moveBar').appendChild(b);
  });

  // ---------- 시점 ----------
  const touchOnly = matchMedia('(hover: none)').matches;
  document.querySelectorAll('.views button').forEach((b) => {
    b.onclick = () => {
      const mode = b.dataset.view;
      if (mode === 'pond') return world.setView('pond');
      // 지금 다른 물고기를 보고 있으면 그 물고기, 아니면 내 물고기
      const cur = world.view.fishId;
      const target = cur && cur !== ME && world.getFish(cur) ? cur : state.dream ? ME : null;
      if (!target) return toast('꿈을 방류하면 내 물고기 시점으로 볼 수 있어요');
      world.setView(mode, target);
    };
  });
  world.onViewChange = (v) => {
    document.querySelectorAll('.views button').forEach((b) => b.classList.toggle('on', b.dataset.view === v.mode));
    const hint = $('steerHint');
    if (v.mode === 'pond') {
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    if (v.fishId === ME) {
      hint.textContent = touchOnly
        ? '물을 톡 누르면 그쪽으로 헤엄쳐요 · 화면을 끌어 둘러보기'
        : '물을 클릭하면 그쪽으로 · WASD/방향키 조종 · Space 위 · Shift 아래 · Esc 연못';
    } else {
      hint.textContent = `${others.get(v.fishId)?.name || '친구'} 물고기를 보고 있어요 · Esc 또는 🗺️로 돌아가기`;
    }
    if (mobile()) openPanel(false);
    closeCard();
  };
  world.onSwimTo = (p) => {
    sfx.bubble();
    buzz(8);
    // 다른 사람 화면에서도 내 물고기가 같은 곳으로 가게
    net.send({ t: 'goto', p: [p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100) });
  };

  // ---------- 물방울 말 ----------
  PHRASES.forEach((p, i) => {
    const b = document.createElement('button');
    b.textContent = p;
    b.onclick = () => {
      if (!state.dream) return toast('꿈을 방류하면 물방울 말을 보낼 수 있어요');
      if (net.online) net.send({ t: 'bubble', i });
      else {
        world.getFish(ME)?.say(p);
        sfx.bubble();
      }
    };
    $('bubbleBar').appendChild(b);
  });

  // ---------- 상단 버튼 ----------
  $('btnShare').onclick = async () => {
    const url = `${location.origin}${location.pathname}?pond=${encodeURIComponent(pond)}`;
    if (navigator.share && matchMedia('(max-width: 720px)').matches) {
      try {
        await navigator.share({ title: '등용문 연못', text: '같이 꿈 물고기 띄워요 🐟', url });
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('연못 링크를 복사했어요. 친구에게 보내 같이 헤엄쳐요!');
    } catch (_) {
      prompt('이 링크를 복사해 보내 주세요', url);
    }
  };

  function renderSoundBtn() {
    $('btnSound').textContent = isSoundOn() ? '🔊' : '🔇';
  }
  $('btnSound').onclick = () => {
    setSound(!isSoundOn());
    state.sound = isSoundOn();
    save();
    renderSoundBtn();
  };
  // 브라우저 정책상 소리는 첫 터치 이후에 켤 수 있다
  if (state.sound) {
    const once = () => {
      setSound(true);
      renderSoundBtn();
    };
    window.addEventListener('pointerdown', once, { once: true });
  }
  renderSoundBtn();

  // 모바일: 패널 접기/펴기
  const mobile = () => matchMedia('(max-width: 720px)').matches;
  function openPanel(open) {
    $('panel').classList.toggle('collapsed', !open);
    document.body.classList.toggle('panel-open', open && mobile());
  }
  $('btnPanel').onclick = () => openPanel($('panel').classList.contains('collapsed'));
  if (mobile() && state.dream) openPanel(false);
  else openPanel(true);

  // ---------- 시작 ----------
  renderPanel();
  if (state.dream) syncMe();
  world.setStars(state.stars.map((s) => ({ name: s.name || state.name, dream: s.dream || '', species: s.species, at: s.at })));
  world.balanceNpcs();
  updateOnline();
  net.connect();

  // 쉬는 상태는 시간이 지나며 바뀔 수 있다
  setInterval(() => {
    if (!state.dream) return;
    const f = world.getFish(ME);
    if (f && f.data.sleeping !== isSleeping()) {
      syncMe();
      renderPanel();
    }
  }, 60_000);

  // 개발 확인용
  window.__pond = { world, net, state };
}

main().catch((e) => {
  console.error(e);
  $('loading').querySelector('p').textContent = '연못을 여는 데 문제가 생겼어요. 새로고침해 주세요.';
});
