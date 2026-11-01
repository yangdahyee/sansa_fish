// 소원 연못 관리자 화면: 신고 확인, 숨기기/다시 보이기/삭제, 검색, 백업
const $ = (id) => document.getElementById(id);
const KEY = 'wish-pond:admin';
let token = sessionStorage.getItem(KEY) || '';
let filter = 'reported';
let q = '';

const fmt = (t) =>
  t ? new Date(t).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

async function call(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { code: 401 });
  if (res.status === 503) throw Object.assign(new Error('disabled'), { code: 503 });
  if (res.status === 429) throw Object.assign(new Error('too_many'), { code: 429 });
  if (!res.ok) throw new Error(`error ${res.status}`);
  return res;
}

function showLogin(msg = '') {
  $('adminView').hidden = true;
  $('loginView').hidden = false;
  $('loginErr').textContent = msg;
  $('token').focus();
}

async function enter() {
  try {
    await loadStats();
    sessionStorage.setItem(KEY, token);
    $('loginView').hidden = true;
    $('adminView').hidden = false;
    await loadList();
  } catch (e) {
    sessionStorage.removeItem(KEY);
    showLogin(
      e.code === 401
        ? '비밀번호가 맞지 않아요'
        : e.code === 503
          ? '관리자 기능이 꺼져 있어요. 서버에 ADMIN_TOKEN 을 설정해 주세요'
          : e.code === 429
            ? '너무 많이 틀렸어요. 한 시간 뒤 다시 해 주세요'
            : '서버에 연결하지 못했어요',
    );
  }
}

async function loadStats() {
  const s = await (await call('/api/admin/stats')).json();
  const items = [
    ['전체 소원', s.all],
    ['헤엄치는 / 별', `${s.all - s.stars - s.hidden} / ${s.stars}`],
    ['오늘 방생', s.today],
    ['받은 먹이', s.feeds],
    ['신고된 소원', s.reported, s.reported > 0],
    ['숨긴 소원', s.hidden],
    ['지금 접속', s.online],
    ['별까지 먹이', s.goal],
  ];
  const box = $('stats');
  box.textContent = '';
  for (const [label, val, warn] of items) {
    const d = document.createElement('div');
    d.className = `stat${warn ? ' warn' : ''}`;
    const b = document.createElement('b');
    b.textContent = Number.isFinite(val) ? val.toLocaleString('ko-KR') : val;
    const sp = document.createElement('span');
    sp.textContent = label;
    d.append(b, sp);
    box.appendChild(d);
  }
  $('updated').textContent = `${fmt(Date.now())} 기준`;
}

async function loadList() {
  const data = await (await call(`/api/admin/wishes?filter=${filter}&q=${encodeURIComponent(q)}`)).json();
  const tb = $('rows');
  tb.textContent = '';
  if (!data.wishes.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty';
    td.textContent = filter === 'reported' ? '신고된 소원이 없어요 🌿' : '해당하는 소원이 없어요';
    tr.appendChild(td);
    tb.appendChild(tr);
  }
  for (const w of data.wishes) tb.appendChild(row(w));
  $('count').textContent = `${data.total.toLocaleString('ko-KR')}개${data.total > data.wishes.length ? ` 중 ${data.wishes.length}개 표시` : ''}`;
}

function row(w) {
  const tr = document.createElement('tr');
  if (w.hidden) tr.className = 'is-hidden';
  const td = (cls) => {
    const el = document.createElement('td');
    if (cls) el.className = cls;
    tr.appendChild(el);
    return el;
  };
  const tag = (cls, text) => {
    const s = document.createElement('span');
    s.className = `tag ${cls}`;
    s.textContent = text;
    return s;
  };

  const c1 = td('txt');
  const t = document.createElement('div');
  t.textContent = w.text;
  const meta = document.createElement('div');
  meta.className = 'muted';
  meta.textContent = `${w.name} · ${w.species} · #${w.id} · 주인 ${w.owner}`;
  c1.append(t, meta);
  if (w.status === 'star') c1.appendChild(tag('star', `✦ 별 ${fmt(w.starAt)}`));
  if (w.hidden) c1.appendChild(tag('hidden', '숨김'));
  if (!w.isPublic) c1.appendChild(tag('private', '비공개 소원'));

  td().textContent = `🍚 ${w.feeds}`;
  const c3 = td();
  if (w.reports > 0) c3.appendChild(tag('rep', `🚩 ${w.reports}`));
  else c3.textContent = '-';
  td('muted').textContent = fmt(w.createdAt);

  const c5 = td();
  const acts = document.createElement('div');
  acts.className = 'acts';
  const btn = (label, action, cls = '', confirmText = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = async () => {
      if (confirmText && !confirm(confirmText)) return;
      b.disabled = true;
      try {
        await call(`/api/admin/wishes/${w.id}`, { action });
        toast({ hide: '숨겼어요', unhide: '다시 보이게 했어요', delete: '삭제했어요', clear_reports: '신고를 지웠어요' }[action]);
        await Promise.all([loadStats(), loadList()]);
      } catch (e) {
        if (e.code === 401) return showLogin('다시 로그인해 주세요');
        toast('처리하지 못했어요');
        b.disabled = false;
      }
    };
    acts.appendChild(b);
  };
  if (w.hidden) btn('다시 보이기', 'unhide');
  else btn('🙈 숨기기', 'hide');
  if (w.reports > 0 && !w.hidden) btn('신고 지우기', 'clear_reports');
  btn('🗑 삭제', 'delete', 'danger', `이 소원을 완전히 지울까요? 되돌릴 수 없어요.\n\n“${w.text}”`);
  c5.appendChild(acts);
  return tr;
}

// ---------- 이벤트 ----------
$('btnLogin').onclick = () => {
  token = $('token').value.trim();
  if (token) enter();
};
$('token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnLogin').click();
});
$('btnLogout').onclick = () => {
  sessionStorage.removeItem(KEY);
  token = '';
  $('token').value = '';
  showLogin();
};
$('btnRefresh').onclick = () => Promise.all([loadStats(), loadList()]).catch(() => toast('새로고침하지 못했어요'));
$('btnExport').onclick = async () => {
  try {
    const res = await call('/api/admin/export');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wishes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (_) {
    toast('백업을 내려받지 못했어요');
  }
};
document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    loadList().catch(() => toast('불러오지 못했어요'));
  };
});
let qTimer = null;
$('q').addEventListener('input', () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    q = $('q').value.trim();
    loadList().catch(() => toast('불러오지 못했어요'));
  }, 250);
});

if (token) enter();
else showLogin();
