// 3D 연못: 하늘, 물, 폭포(등용문), 물고기, 효과
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SPECIES, SPECIES_IDS, MOVES } from './data.js';

// ---------- 연못 치수 ----------
const POND_RX = 11; // 타원 반지름 x
const POND_RZ = 8; // 타원 반지름 z
const SWIM_TOP = -0.55;
const SWIM_BOTTOM = -2.6;
const FLOOR_Y = -3.2;
const FISH_LEN = 1.25; // 기본 몸 길이
const TIERS = 7; // 폭포 단 수 (진행도와 별개로 시각적인 단)
const TIER_H = 1.05;
const FALLS_Z = -8.6;
const NPC_TARGET = 6;
const GATE_Z = FALLS_Z - TIERS * 0.75 - 1.4; // 꼭대기 단 위, 홍살문이 서는 자리
const GATE_BASE_Y = TIERS * TIER_H + 0.05; // 꼭대기 단 윗면 높이 // 연못이 너무 비어 보이지 않게 채우는 '연못 친구' 수

const MOVE_IDS = MOVES.map((m) => m.id);
// 스스로 고를 때의 동작 비율
const AUTO_MOVES = { dash: 3, glide: 1, circle: 3, nibble: 2, forage: 2, roll: 1, wag: 1 };

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function pickWeighted(table) {
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, v] of Object.entries(table)) if ((r -= v) < 0) return k;
  return Object.keys(table)[0];
}
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function insidePond(x, z, margin = 1.4) {
  const rx = POND_RX - margin;
  const rz = POND_RZ - margin;
  return (x * x) / (rx * rx) + (z * z) / (rz * rz) <= 1;
}

// 연못 바닥 높이 — 바닥 메시도, 물고기 충돌도 이 함수 하나를 기준으로 한다
function floorHeight(x, z) {
  const e = Math.sqrt((x * x) / (POND_RX * POND_RX) + (z * z) / (POND_RZ * POND_RZ));
  return Math.min(FLOOR_Y + Math.max(0, e - 0.78) * 11 + Math.sin(x * 1.3) * Math.cos(z * 1.1) * 0.12, 0.05);
}

function randomPondPoint(margin = 1.6) {
  for (let i = 0; i < 30; i++) {
    const x = rand(-POND_RX, POND_RX);
    const z = rand(-POND_RZ, POND_RZ);
    if (insidePond(x, z, margin)) {
      const hi = SWIM_TOP - 0.2;
      const lo = Math.min(hi, Math.max(SWIM_BOTTOM + 0.3, floorHeight(x, z) + 0.8));
      return new THREE.Vector3(x, rand(lo, hi), z);
    }
  }
  return new THREE.Vector3(0, -1.5, 0);
}

// 두 선분 사이의 가장 가까운 두 점 (캡슐 충돌용)
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
function closestSegSeg(p1, q1, p2, q2, c1, c2) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s = 0;
  let t = 0;
  if (a > 1e-6 || e > 1e-6) {
    if (a <= 1e-6) t = clamp(f / e, 0, 1);
    else {
      const c = _d1.dot(_r);
      if (e <= 1e-6) s = clamp(-c / a, 0, 1);
      else {
        const b = _d1.dot(_d2);
        const denom = a * e - b * b;
        s = denom > 1e-6 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = clamp(-c / a, 0, 1);
        } else if (t > 1) {
          t = 1;
          s = clamp((b - c) / a, 0, 1);
        }
      }
    }
  }
  c1.copy(p1).addScaledVector(_d1, s);
  c2.copy(p2).addScaledVector(_d2, t);
}

const GRAVITY = 9.8;
const WALL_RX = POND_RX - 1;
const WALL_RZ = POND_RZ - 1;

// 폭포 i번째 단의 물고기 위치(물이 넘치는 턱 바로 앞)
function tierPoint(i, xOff = 0) {
  // i번째 단의 윗면(작은 웅덩이) 위 — 예전에는 한 단 아래 허공에 떠 있었음
  const y = i * TIER_H + 0.35;
  const z = FALLS_Z - i * 0.75 - 0.25;
  return new THREE.Vector3(xOff, y, z);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ======================================================================
// 물고기 한 마리
// ======================================================================
class Fish {
  constructor(world, data, { isMe = false, isNpc = false } = {}) {
    this.world = world;
    this.id = data.id;
    this.isMe = isMe;
    this.isNpc = isNpc;
    this.data = { ...data };
    this.root = new THREE.Group();
    this.pivot = new THREE.Group(); // 크기·흔들림용
    this.root.add(this.pivot);
    this.root.rotation.order = 'YXZ';

    this.pos = randomPondPoint();
    this.vel = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).setLength(0.6);
    this.target = randomPondPoint();
    this.speed = rand(0.7, 1.1);
    this.wiggle = 0; // 먹이 먹을 때 기쁨 흔들림
    this.scaleNow = 0.01; // 방류 시 커지며 등장
    this.action = null; // { type, t, ... } 도약·등용 같은 큰 연출
    this.move = null; // 헤엄 동작 (질주, 맴돌기 …)
    this.moveCooldown = rand(2, 9);
    this.manual = null; // 물을 톡 눌러 정한 목적지
    this.steerYaw = null;
    this.animRate = 1;
    this.animNow = 1;
    this.rollZ = 0;
    this.tiltX = 0;
    this.swayY = 0;
    this.yTop = SWIM_TOP;
    this.opacity = 1;
    this.nextWake = 0;
    this.nextBonk = 0;

    // 클릭 판정용 투명 구
    this.hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.hit.userData.fish = this;
    this.root.add(this.hit);

    // 내 물고기 표시용 고리
    if (isMe) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.035, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = Math.PI / 2;
      this.ring = ring;
      this.root.add(ring);
    }

    this.buildModel(data.species);
    this.root.position.copy(this.pos);
    world.scene.add(this.root);

    // 이름표
    if (!isNpc) {
      this.tag = document.createElement('div');
      this.tag.className = 'tag' + (isMe ? ' me' : '');
      world.labels.appendChild(this.tag);
      this.updateTag();
    }
  }

  buildModel(species) {
    if (this.model) {
      this.pivot.remove(this.model);
      this.mixer?.stopAllAction();
    }
    const src = this.world.models[species] || this.world.models[SPECIES_IDS[0]];
    const model = SkeletonUtils.clone(src.scene);
    // 모델마다 크기·중심이 달라서 길이를 맞추고 가운데로 옮긴다
    const s = FISH_LEN / src.size.z;
    model.scale.setScalar(s);
    model.position.copy(src.center).multiplyScalar(-s);
    model.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false; // 스킨 메시 경계 문제 방지
        o.material = o.material.clone();
        o.material.transparent = false;
        if (this.isNpc) o.material.color?.multiplyScalar(0.75);
      }
    });
    this.model = model;
    this.pivot.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    if (src.clip) {
      const a = this.mixer.clipAction(src.clip);
      a.time = Math.random() * src.clip.duration;
      a.play();
    }
    this.species = species;
  }

  setData(d) {
    const prevSpecies = this.data.species;
    this.data = { ...this.data, ...d };
    if (d.species && d.species !== prevSpecies) this.buildModel(d.species);
    this.updateTag();
  }

  get progress() {
    const { done = 0, total = 0 } = this.data;
    return total ? done / total : 0;
  }

  // 몸통을 캡슐로 본다: 반지름·반길이(꼬리 제외)
  get radius() {
    return (this.world.models[this.species]?.radius ?? 0.35) * this.scaleNow;
  }

  get halfLen() {
    return FISH_LEN * 0.3 * this.scaleNow;
  }

  bodyDir(out) {
    const y = this.root.rotation.y;
    const x = this.root.rotation.x + this.tiltX;
    return out.set(Math.sin(y) * Math.cos(x), -Math.sin(x), Math.cos(y) * Math.cos(x));
  }

  // 바닥에 닿지 않는 최소 높이 (몸이 기울면 머리·꼬리 끝까지 고려)
  minY() {
    const pitch = Math.abs(Math.sin(this.root.rotation.x + this.tiltX));
    return floorHeight(this.pos.x, this.pos.z) + this.radius * 0.8 + pitch * this.halfLen;
  }

  get targetScale() {
    if (this.isNpc) return 0.8;
    return 1 + this.progress * 0.65;
  }

  updateTag() {
    if (!this.tag) return;
    const { name, done = 0, total = 0, sleeping } = this.data;
    this.tag.textContent = '';
    const n = document.createElement('span');
    n.textContent = this.isMe ? `나 · ${name}` : name;
    this.tag.appendChild(n);
    if (total) {
      const p = document.createElement('span');
      p.style.opacity = '.75';
      p.textContent = ` ${done}/${total}`;
      this.tag.appendChild(p);
    }
    if (sleeping) {
      const z = document.createElement('span');
      z.className = 'z';
      z.textContent = 'zzz';
      this.tag.appendChild(z);
    }
  }

  say(text) {
    this.sayEl?.remove();
    const el = document.createElement('div');
    el.className = 'say';
    el.textContent = text;
    this.world.labels.appendChild(el);
    this.sayEl = el;
    clearTimeout(this.sayTimer);
    this.sayTimer = setTimeout(() => {
      el.remove();
      if (this.sayEl === el) this.sayEl = null;
    }, 3800);
  }

  // ---------- 행동 ----------
  // 정한 자리로 헤엄쳐 가기 (너무 오래 걸리면 포기)
  swimTo(p) {
    if (this.action) return false;
    this.manual = p.clone();
    this.manualTime = 0;
    // 거리에 비례한 제한 시간 (느린 기기에서도 실제 '시뮬레이션 시간'으로 셈)
    this.manualLimit = 4 + this.pos.distanceTo(p) * 1.2;
    this.move = null;
    this.data.sleeping = false;
    return true;
  }

  // 도약: 수면을 향해 차고 올라 → 공중에서는 중력만 → 물에 떨어지면 물의 저항으로 감속
  leap() {
    if (this.action) return;
    const dir = this.heading(new THREE.Vector3());
    // 착지할 곳이 연못 밖이면 연못 가운데 쪽으로 뛴다
    const land = tmpV.copy(this.pos).addScaledVector(dir, 3.4);
    if (!insidePond(land.x, land.z, 1.4)) dir.set(-this.pos.x, 0, -this.pos.z).normalize();
    this.move = null;
    this.manual = null;
    this.action = { type: 'leap', phase: 'rise', t: 0, dir };
  }

  ascend(onDone) {
    this.move = null;
    this.manual = null;
    this.action = { type: 'ascend', phase: 'toFalls', t: 0, onDone, from: this.pos.clone() };
  }

  dispose() {
    this.world.scene.remove(this.root);
    this.tag?.remove();
    this.sayEl?.remove();
    this.mixer?.stopAllAction();
  }

  // ---------- 매 프레임 ----------
  update(dt, time) {
    const w = this.world;
    // 기본 애니메이션 속도: 빠를수록 빠르게, 쉴 때는 느리게. 헤엄 동작이 덮어쓴다.
    this.animRate = this.data.sleeping && !this.action ? 0.35 : 1 + this.vel.length() * 0.5;

    if (this.action) this.updateAction(dt, time);
    else this.updateSwim(dt, time);

    this.animNow += (this.animRate - this.animNow) * Math.min(1, dt * 5);
    this.mixer?.update(dt * this.animNow);

    // 크기
    this.scaleNow += (this.targetScale - this.scaleNow) * Math.min(1, dt * 2);
    this.pivot.scale.setScalar(this.scaleNow);

    // 동작이 끝나면 기울기·흔들림을 제자리로
    if (!this.move) {
      const k = Math.min(1, dt * 4);
      this.rollZ += (0 - this.rollZ) * k;
      this.tiltX += (0 - this.tiltX) * k;
      this.swayY += (0 - this.swayY) * k;
    }
    // 기쁨 흔들림
    let wig = 0;
    if (this.wiggle > 0) {
      this.wiggle = Math.max(0, this.wiggle - dt);
      wig = Math.sin(time * 30) * 0.35 * this.wiggle;
    }
    this.pivot.rotation.set(this.tiltX, this.swayY, this.rollZ + wig);

    this.root.position.copy(this.pos);
    const watched = w.view.fishId === this.id;
    const eyeView = w.view.mode === 'eye' && watched;
    if (this.model) this.model.visible = !eyeView;
    if (this.ring) {
      this.ring.material.opacity = 0.5 + Math.sin(time * 3) * 0.3;
      this.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.06);
      this.ring.visible = !watched && (!this.action || this.action.type === 'leap');
    }

    // 이름표·말풍선 위치
    const show = !eyeView && (!this.action || this.action.type === 'leap');
    if (this.tag || this.sayEl) {
      tmpV2.copy(this.pos);
      tmpV2.y += 0.75 * this.scaleNow + 0.2;
      tmpV2.project(w.camera);
      const visible = tmpV2.z < 1 && Math.abs(tmpV2.x) < 1.1 && Math.abs(tmpV2.y) < 1.1;
      const sx = (tmpV2.x * 0.5 + 0.5) * w.width;
      const sy = (-tmpV2.y * 0.5 + 0.5) * w.height;
      if (this.tag) {
        this.tag.style.display = visible && show && w.showTags ? '' : 'none';
        this.tag.style.left = `${sx}px`;
        this.tag.style.top = `${sy}px`;
      }
      if (this.sayEl) {
        this.sayEl.style.display = visible && !eyeView ? '' : 'none';
        this.sayEl.style.left = `${sx}px`;
        this.sayEl.style.top = `${sy - 24}px`;
      }
    }
  }

  heading(out = new THREE.Vector3()) {
    const y = this.root.rotation.y;
    return out.set(Math.sin(y), 0, Math.cos(y));
  }

  // ---------- 헤엄 동작 ----------
  doMove(id) {
    if (this.action || !MOVE_IDS.includes(id)) return;
    const m = { id, t: 0, dur: 2, nextFx: 0 };
    const h = this.heading();
    switch (id) {
      case 'dash':
        m.dur = 1.1;
        m.dir = h.clone();
        if (!insidePond(this.pos.x + h.x * 4, this.pos.z + h.z * 4, 1.4)) m.dir.set(-this.pos.x, 0, -this.pos.z).normalize();
        break;
      case 'glide':
        m.dur = 2.4;
        if (this.vel.length() < 1) this.vel.copy(h).multiplyScalar(1.6);
        break;
      case 'circle': {
        m.dur = 4.6;
        m.r = 1.4;
        m.sign = Math.random() < 0.5 ? 1 : -1;
        const right = tmpV.set(h.z, 0, -h.x).multiplyScalar(m.sign * m.r);
        m.center = this.pos.clone().add(right);
        if (!insidePond(m.center.x, m.center.z, 2.4)) {
          m.sign *= -1;
          m.center = this.pos.clone().addScaledVector(right, -1);
        }
        m.ang = Math.atan2(this.pos.x - m.center.x, this.pos.z - m.center.z);
        break;
      }
      case 'nibble':
        m.dur = 4.2;
        break;
      case 'forage':
        m.dur = 4.2;
        break;
      case 'roll':
        m.dur = 1.1;
        m.dir = h.clone();
        m.side = Math.random() < 0.5 ? 1 : -1;
        break;
      case 'wag':
        m.dur = 2.6;
        break;
    }
    this.move = m;
    if (this.isMe) this.manual = null;
  }

  // 동작별로 원하는 속도 벡터를 out 에 쓰고, 기울기·애니메이션 속도를 정한다
  stepMove(dt, time, out) {
    const m = this.move;
    const w = this.world;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    const ease = Math.sin(k * Math.PI); // 0→1→0
    switch (m.id) {
      case 'dash': {
        // 꼬리를 세게 치며 순간 가속
        out.copy(m.dir).multiplyScalar(4.4 * (1 - k * 0.4));
        this.animRate = 3.4;
        this.tiltX = -0.1 * ease;
        if (m.t > m.nextFx) {
          m.nextFx = m.t + 0.12;
          w.spawnParticle(this.pos, 0xcff4ff, new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 0.8), rand(-0.3, 0.3)), 0.8, 0.12, 0.4);
        }
        break;
      }
      case 'glide': {
        // 꼬리를 멈추고 미끄러지듯
        out.copy(this.vel).multiplyScalar(1 - dt * 0.6);
        this.animRate = 0.12;
        this.rollZ = Math.sin(m.t * 1.4) * 0.12;
        break;
      }
      case 'circle': {
        // 작은 원을 그리며 몸을 안쪽으로 기울임
        m.ang += m.sign * dt * 1.6;
        const tx = m.center.x + Math.sin(m.ang) * m.r;
        const tz = m.center.z + Math.cos(m.ang) * m.r;
        out.set(tx - this.pos.x, 0, tz - this.pos.z).multiplyScalar(2.2);
        out.y = (m.center.y - this.pos.y) * 0.5;
        this.animRate = 1.8;
        this.rollZ = -m.sign * 0.45 * Math.min(1, m.t * 2) * (1 - Math.max(0, (k - 0.85) / 0.15));
        break;
      }
      case 'nibble': {
        // 수면까지 올라가 뻐끔뻐끔
        const surfaceY = -0.22;
        if (this.pos.y < surfaceY - 0.08 && k < 0.85) {
          out.set(this.vel.x * 0.3, 1.2, this.vel.z * 0.3);
          this.tiltX += (-0.7 - this.tiltX) * Math.min(1, dt * 4);
        } else {
          out.set(0, (surfaceY - this.pos.y) * 2, 0);
          this.tiltX += (-0.55 - this.tiltX) * Math.min(1, dt * 4);
          if (m.t > m.nextFx && k < 0.9) {
            m.nextFx = m.t + 0.55;
            const h = this.heading(tmpV);
            w.addRipple(this.pos.x + h.x * 0.4, this.pos.z + h.z * 0.4, 0.35);
            w.spawnParticle(
              tmpV2.set(this.pos.x + h.x * 0.4, -0.05, this.pos.z + h.z * 0.4),
              0xe6fbff,
              new THREE.Vector3(rand(-0.2, 0.2), rand(0.4, 0.9), rand(-0.2, 0.2)),
              0.7,
              0.14,
              -1,
            );
            w.sfx?.bubble();
          }
        }
        this.yTop = -0.15;
        this.animRate = 0.6;
        break;
      }
      case 'forage': {
        // 바닥으로 내려가 코를 박고 모래를 뒤적
        const floorY = floorHeight(this.pos.x, this.pos.z) + this.radius * 0.8 + this.halfLen * 0.7;
        const h = this.heading(tmpV);
        if (this.pos.y > floorY + 0.15 && k < 0.8) {
          out.set(h.x * 0.6, -1.4, h.z * 0.6);
          this.tiltX += (0.6 - this.tiltX) * Math.min(1, dt * 4);
        } else {
          out.set(h.x * 0.3, (floorY - this.pos.y) * 2, h.z * 0.3);
          this.tiltX += (0.75 + Math.sin(m.t * 10) * 0.08 - this.tiltX) * Math.min(1, dt * 6);
          if (m.t > m.nextFx && k < 0.9) {
            m.nextFx = m.t + 0.35;
            for (let i = 0; i < 4; i++) {
              w.spawnParticle(
                tmpV2.set(this.pos.x + h.x * 0.5, floorHeight(this.pos.x, this.pos.z) + 0.15, this.pos.z + h.z * 0.5),
                0xc9b48a,
                new THREE.Vector3(rand(-0.6, 0.6), rand(0.3, 0.9), rand(-0.6, 0.6)),
                1.2,
                0.22,
                -0.6,
                THREE.NormalBlending,
              );
            }
          }
        }
        this.animRate = 1.4;
        break;
      }
      case 'roll': {
        // 앞으로 튀어나가며 한 바퀴 빙글
        out.copy(m.dir).multiplyScalar(2.8);
        out.y = Math.cos(k * Math.PI) * 0.6;
        this.rollZ = m.side * easeInOut(k) * Math.PI * 2;
        this.animRate = 2.2;
        break;
      }
      case 'wag': {
        // 제자리에서 꼬리를 흔들며 들썩들썩
        out.set(0, Math.sin(m.t * 9) * 0.5, 0);
        this.swayY = Math.sin(m.t * 16) * 0.42 * ease;
        this.rollZ = Math.sin(m.t * 8) * 0.18 * ease;
        this.animRate = 3.8;
        break;
      }
    }
    if (m.t >= m.dur) {
      const was = m.id;
      this.move = null;
      this.yTop = SWIM_TOP;
      if (was === 'roll') this.rollZ = 0;
      // 질주 뒤에는 자연스럽게 활공으로 이어짐
      if (was === 'dash' && Math.random() < 0.7) this.doMove('glide');
    }
  }

  updateSwim(dt, time) {
    const w = this.world;
    const sleeping = this.data.sleeping;
    const leader = this.data.followId && w.fishes.get(this.data.followId);
    const following = leader && !leader.action;
    const steering = this.isMe && w.steering(this);

    // 가끔 스스로 동작을 고른다 (잘 때·따라갈 때·조종할 때 제외)
    if (!this.move && !sleeping && !following && !steering && !this.manual) {
      this.moveCooldown -= dt;
      if (this.moveCooldown <= 0) {
        this.moveCooldown = rand(5, 12);
        this.doMove(pickWeighted(AUTO_MOVES));
      }
    }
    if (sleeping || following) this.move = null;
    if (!this.move) this.yTop = SWIM_TOP; // 동작이 중간에 끊겨도 수면 높이 제한을 되돌림

    let desired;
    if (this.move) {
      desired = this.stepMove(dt, time, tmpV) || tmpV;
    } else if (steering) {
      // 키보드로 직접 헤엄치기
      const s = w.keys;
      this.steerYaw ??= this.root.rotation.y;
      const turn = (s.has('left') ? 1 : 0) - (s.has('right') ? 1 : 0);
      this.steerYaw += turn * dt * 2.2;
      const fwd = s.has('fwd') ? 2.6 : s.has('back') ? 0.15 : 0.9;
      const vy = (s.has('up') ? 1.4 : 0) - (s.has('down') ? 1.4 : 0);
      desired = tmpV.set(Math.sin(this.steerYaw) * fwd, vy, Math.cos(this.steerYaw) * fwd);
      this.animRate = 0.8 + fwd;
    } else {
      this.steerYaw = null;
      let speed = this.speed;
      if (following) {
        // 짝꿍 옆에서 나란히
        const gap = (this.radius + leader.radius) * 1.3 + 0.35;
      const side = tmpV.set(-leader.vel.z, 0, leader.vel.x).normalize().multiplyScalar(gap);
        this.target.copy(leader.pos).add(side).addScaledVector(leader.vel, -0.25);
        speed = Math.max(leader.vel.length(), 0.6) * 1.15;
      } else if (sleeping) {
        // 수초 아래, 바닥 가까이에서 쉼
        if (!this.sleepSpot) {
          const k = w.weeds[Math.floor(hashStr(this.id) * w.weeds.length)];
          this.sleepSpot = new THREE.Vector3(k.x + 0.6, 0, k.z + 0.4);
          this.sleepSpot.y = floorHeight(this.sleepSpot.x, this.sleepSpot.z) + this.radius + 0.15;
        }
        this.target.copy(this.sleepSpot);
        speed = 0.25;
      } else if (this.manual) {
        // 물을 톡 누른 곳으로
        this.target.copy(this.manual);
        speed = 2;
        if (this.pos.distanceTo(this.manual) < 0.5) {
          this.manual = null;
          this.wiggle = Math.max(this.wiggle, 0.35); // 도착하면 살짝 꼬리 흔들기
        } else if ((this.manualTime += dt) > this.manualLimit) this.manual = null;
      } else {
        this.sleepSpot = null;
        if (this.pos.distanceTo(this.target) < 1.2) {
          this.target = randomPondPoint();
          this.speed = rand(0.6, 1.15);
        }
      }
      desired = tmpV.subVectors(this.target, this.pos);
      const dist = desired.length();
      desired.setLength(Math.min(speed, dist * 1.5));
    }

    // 개인 공간: 부딪히기 전에 살짝 비켜 감 (실제 충돌은 World.resolveCollisions)
    for (const o of w.fishes.values()) {
      if (o === this || o.action || o.id === this.data.followId) continue;
      const d = this.pos.distanceTo(o.pos);
      const space = (this.radius + o.radius) * 1.6 + this.halfLen;
      if (d < space && d > 0.0001) {
        tmpV2.subVectors(this.pos, o.pos).setLength((space - d) * 1.2);
        desired.add(tmpV2);
      }
    }
    // 벽(연못 가장자리)이 가까워지면 미리 안쪽으로
    const e0 = (this.pos.x * this.pos.x) / (WALL_RX * WALL_RX) + (this.pos.z * this.pos.z) / (WALL_RZ * WALL_RZ);
    if (e0 > 0.72) {
      tmpV2.set(this.pos.x / (WALL_RX * WALL_RX), 0, this.pos.z / (WALL_RZ * WALL_RZ)).normalize();
      desired.addScaledVector(tmpV2, -(e0 - 0.72) * 7);
    }
    // 바닥이 가까워지면 미리 위로
    const clearance = this.pos.y - this.minY();
    if (clearance < 0.35 && this.move?.id !== 'forage' && !sleeping) desired.y += (0.35 - clearance) * 3;

    const resp = this.move?.id === 'dash' || this.move?.id === 'roll' ? 6 : this.move?.id === 'glide' ? 0.6 : steering ? 3 : 1.6;
    this.vel.lerp(desired, Math.min(1, dt * resp));
    this.pos.addScaledVector(this.vel, dt);

    this.constrain(dt, true, steering);

    // 수면 가까이 빠르게 지나가면 물결이 남음
    if (this.pos.y > -0.6 && this.vel.length() > 1.3 && time > this.nextWake) {
      this.nextWake = time + 0.3;
      w.addRipple(this.pos.x, this.pos.z, 0.22);
    }

    // 수직으로만 움직이는 동작(뻐끔, 꼬리 춤)은 방향을 틀지 않는다
    const faceV = this.move && (this.move.id === 'nibble' || this.move.id === 'wag') ? tmpV2.set(this.vel.x, 0, this.vel.z) : this.vel;
    if (this.move?.id === 'nibble' || this.move?.id === 'forage') faceV.y = 0;
    this.face(faceV, dt, this.move?.id === 'circle' ? 8 : 4);
  }

  // 벽·바닥·수면 충돌: 위치를 되돌리고, 부딪힌 방향의 속도는 튕겨 냄
  constrain(dt, underwater = true, steering = false) {
    const w = this.world;
    // 연못 가장자리 (타원 벽)
    const e = (this.pos.x * this.pos.x) / (WALL_RX * WALL_RX) + (this.pos.z * this.pos.z) / (WALL_RZ * WALL_RZ);
    if (e > 1) {
      const k = 1 / Math.sqrt(e);
      this.pos.x *= k;
      this.pos.z *= k;
      const n = tmpV2.set(this.pos.x / (WALL_RX * WALL_RX), 0, this.pos.z / (WALL_RZ * WALL_RZ)).normalize();
      const vn = this.vel.dot(n);
      if (vn > 0) this.vel.addScaledVector(n, -1.3 * vn); // 살짝 튕김
      if (steering && this.steerYaw != null) this.steerYaw = Math.atan2(-this.pos.x, -this.pos.z) * 0.15 + this.steerYaw * 0.85;
    }
    if (!underwater) return;
    // 바닥
    const floor = this.minY();
    if (this.pos.y < floor) {
      const impact = -this.vel.y;
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y *= -0.25;
      if (impact > 1.2 && performance.now() > this.nextBonk) {
        this.nextBonk = performance.now() + 600;
        const fy = floorHeight(this.pos.x, this.pos.z) + 0.1;
        for (let i = 0; i < 6; i++) {
          w.spawnParticle(
            tmpV2.set(this.pos.x, fy, this.pos.z),
            0xc9b48a,
            new THREE.Vector3(rand(-0.8, 0.8), rand(0.3, 1), rand(-0.8, 0.8)),
            1.1,
            0.22,
            -0.6,
            THREE.NormalBlending,
          );
        }
      }
    }
    // 수면 (도약할 때만 넘어감)
    const top = this.yTop - (this.move?.id === 'nibble' ? 0 : this.radius * 0.2);
    if (this.pos.y > top) {
      // 물에 떨어진 직후처럼 많이 넘었을 때도 부드럽게 내려오게
      this.pos.y += (top - this.pos.y) * Math.min(1, dt * 6);
      if (this.vel.y > 0) this.vel.y *= 0.2;
    }
  }

  face(v, dt, k = 4) {
    const horiz = Math.hypot(v.x, v.z);
    if (horiz < 0.02 && Math.abs(v.y) < 0.02) return;
    const yaw = Math.atan2(v.x, v.z);
    const pitch = -Math.atan2(v.y, Math.max(horiz, 0.001));
    let dy = yaw - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const t = Math.min(1, dt * k);
    this.root.rotation.y += dy * t;
    this.root.rotation.x += (clamp(pitch, -1.2, 1.2) - this.root.rotation.x) * t;
  }

  updateAction(dt, time) {
    const a = this.action;
    const w = this.world;

    if (a.type === 'leap') {
      a.t += dt;
      if (a.phase === 'rise') {
        // 꼬리를 힘차게 치며 수면으로
        tmpV.set(a.dir.x * 2.4, 7, a.dir.z * 2.4);
        this.vel.lerp(tmpV, Math.min(1, dt * 7));
        this.animRate = 3.5;
        if (this.pos.y >= 0 || a.t > 1.4) {
          a.phase = 'air';
          this.pos.y = Math.max(this.pos.y, 0);
          this.vel.y = Math.max(this.vel.y, 6.6); // 최고 높이 약 2.2
          w.splash(this.pos, 1);
          w.sfx?.splash();
        }
      } else if (a.phase === 'air') {
        // 공중: 중력만 받는 포물선
        this.vel.y -= GRAVITY * dt;
        this.animRate = 1.2;
        if (this.pos.y < 0 && this.vel.y < 0) {
          a.phase = 'water';
          a.t = 0;
          w.splash(this.pos, 0.8);
        }
      } else {
        // 물속: 강한 저항 + 부력으로 헤엄 높이로 돌아옴
        this.vel.multiplyScalar(Math.exp(-3.2 * dt));
        if (this.pos.y > SWIM_TOP - 0.2) this.vel.y -= 1.5 * dt;
        this.animRate = 0.8;
        if (a.t > 1 || this.vel.length() < 0.6) {
          this.action = null;
          this.target = randomPondPoint();
        }
      }
      this.pos.addScaledVector(this.vel, dt);
      this.constrain(dt, a.phase === 'water');
      this.face(this.vel, dt, 10);
      return;
    }

    if (a.type === 'ascend') {
      const xOff = (hashStr(this.id) - 0.5) * 1.4;
      if (a.phase === 'toFalls') {
        // 폭포 아래로 헤엄쳐 감
        const goal = tierPoint(0, xOff);
        goal.y = -0.8;
        const d = tmpV.subVectors(goal, this.pos);
        if (d.length() < 0.3) {
          a.phase = 'climb';
          a.tier = 0;
          a.t = 0;
          a.from = this.pos.clone();
        } else {
          d.setLength(Math.min(3.2, d.length() * 3));
          this.vel.lerp(d, Math.min(1, dt * 3));
          this.pos.addScaledVector(this.vel, dt);
          this.face(this.vel, dt, 6);
        }
        return;
      }
      if (a.phase === 'climb') {
        // 단마다 한 번씩 뛰어오름
        a.t += dt / 0.55;
        const to = tierPoint(a.tier + 1, xOff);
        const t = Math.min(1, a.t);
        const prev = this.pos.clone();
        this.pos.lerpVectors(a.from, to, easeInOut(t));
        this.pos.y += Math.sin(t * Math.PI) * 0.9;
        this.face(tmpV.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4)), dt, 12);
        if (a.t >= 1) {
          w.splash(this.pos, 0.6, false);
          w.sfx?.plop();
          a.tier++;
          a.t = 0;
          a.from = this.pos.clone();
          if (a.tier >= TIERS) {
            a.phase = 'transform';
            a.t = 0;
            w.burst(this.pos, 0xffd27a, 80);
          }
        }
        return;
      }
      if (a.phase === 'transform') {
        // 폭포 꼭대기에서 금빛으로
        a.t += dt / 1.6;
        const t = Math.min(1, a.t);
        this.model.traverse((o) => {
          if (o.isMesh && o.material.emissive) {
            o.material.emissive.setRGB(1, 0.62, 0.12).multiplyScalar(t * 0.45); // 원래 색이 남도록 은은한 금빛
          }
        });
        this.root.rotation.y += dt * 6 * t;
        this.pos.y += Math.sin(time * 6) * 0.004;
        if (a.t >= 1) {
          a.phase = 'fly';
          a.t = 0;
          a.from = this.pos.clone();
          a.trail = w.makeTrail();
        }
        return;
      }
      if (a.phase === 'fly') {
        // 홍살문을 지나 → 크게 돌아 화면 바로 앞을 스쳐 지나가고 → 하늘로 올라 별이 됨
        if (!a.curve) {
          const cam = w.camera;
          const camPos = cam.position.clone();
          const fwd = cam.getWorldDirection(new THREE.Vector3());
          const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
          const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
          const through = new THREE.Vector3(0, GATE_BASE_Y + 1.2, GATE_Z);
          const behind = new THREE.Vector3(0, GATE_BASE_Y + 3.5, GATE_Z - 3);
          const swoop = a.from.clone().lerp(camPos, 0.45).addScaledVector(UP, 4);
          a.near = camPos.clone().addScaledVector(fwd, 4.6).addScaledVector(right, 1.3).addScaledVector(up, -0.4);
          const past = camPos.clone().addScaledVector(fwd, 1.2).addScaledVector(right, -3.2).addScaledVector(up, 2.4);
          const sky = new THREE.Vector3(a.from.x - 8, 42, -65);
          a.curve = new THREE.CatmullRomCurve3([a.from.clone(), through, behind, swoop, a.near, past, sky], false, 'centripetal');
          a.nearU = 4 / 6; // 화면 앞을 지나는 순간
          a.u = 0;
          a.passed = false;
        }
        // 화면 앞을 지날 때는 천천히 (눈을 맞추듯)
        const slow = 1 - 0.65 * Math.exp(-(((a.u - a.nearU) / 0.06) ** 2));
        a.u = Math.min(1, a.u + (dt / 7) * slow);
        const prev = this.pos.clone();
        a.curve.getPoint(a.u, this.pos);
        this.face(tmpV.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4)), dt, 10);
        this.pivot.scale.multiplyScalar(1 + Math.min(a.u, 0.7) * 0.5);
        this.wiggle = Math.max(this.wiggle, 0.2);
        w.pushTrail(a.trail, this.pos);
        if (Math.random() < 0.5) w.burst(this.pos, 0xffe2a0, 2, 0.5);
        if (!a.passed && a.u > a.nearU) {
          a.passed = true;
          w.burst(this.pos, 0xffffff, 40, 1.2);
          w.sfx?.chime();
        }
        if (a.u >= 1) {
          w.burst(this.pos, 0xffffff, 60, 2);
          w.fadeTrail(a.trail);
          const cb = a.onDone;
          this.action = { type: 'gone' };
          this.root.visible = false;
          cb?.();
        }
        return;
      }
    }
  }
}

// ======================================================================
// 연못 세계
// ======================================================================
export class World {
  constructor(canvas, labels) {
    this.canvas = canvas;
    this.labels = labels;
    this.fishes = new Map();
    this.models = {};
    this.particles = [];
    this.trails = [];
    this.ripples = [];
    this.showTags = true;
    this.timeScale = 1;
    this.viewShift = 0; // 오른쪽 패널만큼 화면 중심을 왼쪽으로
    this.cinema = false;
    this.onFishClick = null;
    this.sfx = null;
    this.timer = new THREE.Timer();
    this.npcSeq = 0;
    this.floorHeight = floorHeight;
    this.view = { mode: 'pond', fishId: null };
    this.keys = new Set();
    this.under = false;
    this.onViewChange = null;
    this.onSwimTo = null;
  }

  async init(onProgress) {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0d2340, 0.018);
    this.scene = scene;

    const cam = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    cam.position.set(0, 8.5, 19.5);
    this.camera = cam;

    const controls = new OrbitControls(cam, this.canvas);
    controls.target.set(0, 1.6, -3);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 30;
    controls.minPolarAngle = 0.45;
    controls.maxPolarAngle = 1.42;
    controls.minAzimuthAngle = -1.1;
    controls.maxAzimuthAngle = 1.1;
    this.controls = controls;

    this.glowTex = makeGlowTexture();
    this.buildSky();
    this.buildLights();
    this.buildPond();
    this.buildFalls();
    this.buildDecor();
    this.buildParticles();

    await this.loadModels(onProgress);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindPointer();
    this.bindKeys();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  async loadModels(onProgress) {
    const loader = new GLTFLoader();
    let n = 0;
    await Promise.all(
      SPECIES_IDS.map(async (id) => {
        const g = await loader.loadAsync(SPECIES[id].file);
        const box = new THREE.Box3().setFromObject(g.scene);
        const size = box.getSize(new THREE.Vector3());
        // 몸 길이를 FISH_LEN 으로 맞췄을 때의 몸통 반지름 (지느러미 끝은 조금 겹쳐도 되게 0.8배)
        const k = FISH_LEN / size.z;
        this.models[id] = {
          scene: g.scene,
          clip: g.animations[0] || null,
          size,
          center: box.getCenter(new THREE.Vector3()),
          radius: (Math.max(size.x, size.y) * k * 0.5) * 0.8,
        };
        onProgress?.(++n / SPECIES_IDS.length);
      }),
    );
  }

  // ---------- 하늘 ----------
  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(200, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        uniforms: {},
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 top = vec3(0.03,0.05,0.16);
            vec3 mid = vec3(0.10,0.17,0.36);
            vec3 hor = vec3(0.55,0.36,0.42);
            vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h));
            c = mix(c, top, smoothstep(0.18, 0.7, h));
            c = mix(c, vec3(0.03,0.08,0.14), smoothstep(0.0, -0.2, h));
            gl_FragColor = vec4(c,1.);
          }`,
      }),
    );
    this.scene.add(sky);

    // 배경 별
    const N = 700;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = rand(0, Math.PI * 2);
      const ph = rand(0.08, 1.3);
      const R = 150;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * R;
      pos[i * 3 + 1] = Math.sin(ph) * R;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * R;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.9, color: 0xcfe0ff, transparent: true, opacity: 0.8, fog: false, sizeAttenuation: true }),
    );
    this.scene.add(stars);

    // 달
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xfff2d0, fog: false, depthWrite: false }));
    moon.position.set(-60, 55, -120);
    moon.scale.setScalar(26);
    this.scene.add(moon);
    const moonCore = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ color: 0xfff6e0, fog: false }));
    moonCore.position.copy(moon.position);
    moonCore.lookAt(0, 0, 0);
    this.scene.add(moonCore);

    // 등용한 꿈의 별자리
    this.dreamStars = new THREE.Group();
    this.scene.add(this.dreamStars);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9cc8ff, 0x1a2a20, 1.4));
    const moon = new THREE.DirectionalLight(0xdfe8ff, 1.6);
    moon.position.set(-8, 14, 6);
    this.scene.add(moon);
    const warm = new THREE.DirectionalLight(0xffb58a, 0.6);
    warm.position.set(10, 4, -10);
    this.scene.add(warm);
  }

  // ---------- 연못 ----------
  buildPond() {
    // 바닥 모래
    // 촘촘한 격자로 만들어야 floorHeight() 와 실제 바닥 모양이 맞는다
    const floorG = new THREE.PlaneGeometry((POND_RX + 1.4) * 2, (POND_RZ + 1.4) * 2, 110, 80);
    floorG.rotateX(-Math.PI / 2);
    const fp = floorG.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setY(i, floorHeight(fp.getX(i), fp.getZ(i)));
    floorG.computeVertexNormals();
    const floor = new THREE.Mesh(floorG, new THREE.MeshStandardMaterial({ color: 0x5f6f58, roughness: 1 }));
    this.scene.add(floor);

    // 주변 땅
    const ground = new THREE.Mesh(
      new THREE.RingGeometry(1, 6, 64, 1),
      new THREE.MeshStandardMaterial({ color: 0x1d3326, roughness: 1 }),
    );
    ground.scale.set(POND_RX + 0.6, POND_RZ + 0.6, 1);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.12;
    this.scene.add(ground);

    // 물 표면
    this.rippleData = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uRipples: { value: this.rippleData },
        uUnder: { value: 0 },
      },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform float uTime; uniform float uUnder; uniform vec4 uRipples[8]; varying vec3 vW;
        float n(vec2 p){ return sin(p.x)*sin(p.y); }
        void main(){
          vec2 p = vW.xz;
          float s = n(p*1.3 + uTime*0.6) + n(p*2.1 - uTime*0.4 + 2.0)*0.6 + n(p*4.0 + vec2(uTime, -uTime)*0.5)*0.3;
          float ring = 0.0;
          for(int i=0;i<8;i++){
            vec4 r = uRipples[i];
            float age = uTime - r.z;
            if(age > 0.0 && age < 2.5){
              float d = distance(p, r.xy);
              float front = age * 2.4;
              ring += exp(-pow((d-front)*3.0, 2.0)) * (1.0 - age/2.5) * r.w;
            }
          }
          vec3 deep = vec3(0.05,0.22,0.32);
          vec3 lite = vec3(0.45,0.75,0.85);
          vec3 c = mix(deep, lite, clamp(s*0.25+0.35 + ring*0.8, 0.0, 1.0));
          float a = 0.34 + s*0.05 + ring*0.4;
          if (uUnder > 0.5) {
            // 물속에서 올려다본 수면: 은빛으로 일렁임
            c = mix(vec3(0.25,0.55,0.68), vec3(0.88,0.97,1.0), clamp(s*0.3+0.45+ring, 0.0, 1.0));
            a = 0.62 + ring*0.3;
          }
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.waterMat = waterMat;
    const waterG = new THREE.CircleGeometry(1, 96);
    waterG.scale(POND_RX + 0.4, POND_RZ + 0.4, 1);
    const water = new THREE.Mesh(waterG, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.renderOrder = 2;
    this.scene.add(water);

    // 둘레 바위
    const rockG = new THREE.DodecahedronGeometry(1, 0);
    const rockM = new THREE.MeshStandardMaterial({ color: 0x55606b, roughness: 0.95, flatShading: true });
    const count = 46;
    const rocks = new THREE.InstancedMesh(rockG, rockM, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.05, 0.05);
      const x = Math.cos(a) * (POND_RX + rand(0.1, 0.7));
      const z = Math.sin(a) * (POND_RZ + rand(0.1, 0.7));
      if (z < -POND_RZ + 1.5 && Math.abs(x) < 3.5) {
        m.makeScale(0, 0, 0); // 폭포 자리 비우기
      } else {
        const s = rand(0.5, 1.1);
        q.setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3)));
        m.compose(new THREE.Vector3(x, rand(-0.2, 0.2), z), q, new THREE.Vector3(s * 1.3, s * 0.8, s));
      }
      rocks.setMatrixAt(i, m);
    }
    this.scene.add(rocks);
  }

  // ---------- 등용문 폭포 ----------
  buildFalls() {
    const rockM = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.9, flatShading: true });
    const mossM = new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 1, flatShading: true });
    this.fallsMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        float h(float x){ return fract(sin(x*127.1)*43758.5453); }
        void main(){
          float col = floor(vUv.x*56.0);
          float sp = 1.2 + h(col)*1.2;
          float s = fract(vUv.y*1.2 + uTime*sp + h(col)*7.0);
          float streak = smoothstep(0.0, 0.5, s) * smoothstep(1.0, 0.7, s) * (0.5 + h(col+3.0)*0.5);
          float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          float foam = smoothstep(0.25, 0.0, vUv.y);
          vec3 c = mix(vec3(0.62,0.84,0.95), vec3(1.0), clamp(streak*0.8 + foam, 0.0, 1.0));
          gl_FragColor = vec4(c, (0.55 + streak*0.35 + foam*0.2) * edge);
        }`,
    });

    const fallsGroup = new THREE.Group();
    for (let i = 0; i <= TIERS; i++) {
      const top = i === TIERS; // 맨 위는 홍살문이 서는 넓은 단
      const w = top ? 4.4 : 6.2 - i * 0.45;
      const y = i * TIER_H;
      const z = FALLS_Z - i * 0.75;
      const depth = top ? 3.4 : 1.6;
      // 단(바위 턱)
      const step = new THREE.Mesh(new THREE.BoxGeometry(w + 2.2, TIER_H, depth, 4, 2, 2), rockM);
      const sp = step.geometry.attributes.position;
      for (let k = 0; k < sp.count; k++) {
        sp.setXYZ(k, sp.getX(k) + rand(-0.12, 0.12), sp.getY(k) + rand(-0.08, 0.08), sp.getZ(k) + rand(-0.12, 0.12));
      }
      step.geometry.computeVertexNormals();
      // 윗면은 평평하게 두어야 문·물고기가 뜨지 않음 (옆면만 울퉁불퉁)
      for (let k = 0; k < sp.count; k++) if (sp.getY(k) > TIER_H / 2 - 0.1) sp.setY(k, TIER_H / 2);
      step.geometry.computeVertexNormals();
      step.position.set(0, y - TIER_H / 2 + 0.05, z + 0.3 - depth / 2);
      fallsGroup.add(step);
      // 이끼
      const moss = new THREE.Mesh(new THREE.BoxGeometry(w + 2.3, 0.08, depth - 0.2), mossM);
      moss.position.set(0, y + 0.07, z + 0.2 - depth / 2);
      fallsGroup.add(moss);
      // 작은 웅덩이 물
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(top ? 2.6 : w, top ? depth - 0.4 : 1.2), this.waterMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, y + 0.16, top ? z + 0.1 - (depth - 0.4) / 2 : z - 0.3);
      fallsGroup.add(pool);
      // 떨어지는 물줄기
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, TIER_H + 0.15), this.fallsMat);
      fall.position.set(0, y - TIER_H / 2 + 0.12, z + 0.56);
      fall.renderOrder = 3;
      fallsGroup.add(fall);
    }
    // 폭포 양옆 절벽 — 탑이 아니라 산에서 떨어지는 폭포처럼 보이게
    const cliffM = new THREE.MeshStandardMaterial({ color: 0x3d4752, roughness: 1, flatShading: true });
    const cliffG = new THREE.DodecahedronGeometry(1, 0);
    const cliffs = new THREE.InstancedMesh(cliffG, cliffM, TIERS * 6 + 8);
    const cm = new THREE.Matrix4();
    const cq = new THREE.Quaternion();
    let ci = 0;
    for (let i = 0; i <= TIERS; i++) {
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3 && ci < cliffs.count; k++) {
          const w = 6.2 - Math.min(i, TIERS - 1) * 0.45;
          const sc = rand(0.8, 1.35) * (1 + (TIERS - i) * 0.05);
          cq.setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3)));
          cm.compose(
            new THREE.Vector3(side * (w / 2 + 1.5 + k * 1.5), i * TIER_H - 0.5 - k * 0.5, FALLS_Z - i * 0.75 - 0.6 - k * 0.5),
            cq,
            new THREE.Vector3(sc * 1.2, sc, sc),
          );
          cliffs.setMatrixAt(ci++, cm);
        }
      }
    }
    cliffs.count = ci;
    fallsGroup.add(cliffs);
    // 뒤쪽 산 능선
    const ridgeM = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 1, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const r = rand(6, 11);
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, rand(9, 16), 6), ridgeM);
      m.position.set((i - 4) * 7 + rand(-2, 2), rand(1, 3), FALLS_Z - 12 - rand(0, 8));
      m.rotation.y = rand(0, 3);
      fallsGroup.add(m);
    }

    // 꼭대기 문(등용문)
    const gateM = new THREE.MeshStandardMaterial({ color: 0xb8352c, roughness: 0.6 });
    const gate = new THREE.Group();
    for (const sx of [-1.7, 1.7]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.2, 10), gateM);
      p.position.set(sx, 1.6, 0);
      gate.add(p);
    }
    // 홍살문: 두 기둥 + 가로대 두 줄 + 위로 솟은 붉은 살
    for (const by of [2.2, 2.75]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.14, 0.16), gateM);
      beam.position.y = by;
      gate.add(beam);
    }
    for (let k = 0; k < 13; k++) {
      const x = -1.5 + (k / 12) * 3;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.25, 5), gateM);
      rod.position.set(x, 2.75, 0);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), gateM);
      tip.position.set(x, 3.45, 0);
      gate.add(rod, tip);
    }
    // 가운데 태극 문양 대신 금빛 원
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), new THREE.MeshBasicMaterial({ color: 0xffcf6b }));
    disc.position.set(0, 2.48, 0.1);
    gate.add(disc);
    // 기둥 받침돌 — 문이 바닥에 단단히 서 있게
    const baseM = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.9, flatShading: true });
    for (const sx of [-1.7, 1.7]) {
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.55), baseM);
      stone.position.set(sx, 0.15, 0);
      gate.add(stone);
    }
    gate.position.set(0, GATE_BASE_Y, GATE_Z);
    fallsGroup.add(gate);
    const gateGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffc070, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    gateGlow.scale.setScalar(7);
    gateGlow.position.set(0, GATE_BASE_Y + 2.2, GATE_Z - 0.2);
    fallsGroup.add(gateGlow);
    this.gateGlow = gateGlow;

    // 폭포 아래 물안개
    this.mist = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: 0xcfeaff, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      s.userData = { x: rand(-3, 3), ph: rand(0, 6), sp: rand(0.3, 0.8) };
      s.scale.setScalar(rand(1.5, 3));
      fallsGroup.add(s);
      this.mist.push(s);
    }
    this.scene.add(fallsGroup);

    // 진행도 등불: 꿈을 가진 물고기마다 폭포의 어느 단까지 왔는지 작은 빛으로 표시
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
  }

  buildDecor() {
    // 수초
    this.weeds = [];
    const weedM = new THREE.MeshStandardMaterial({ color: 0x2f7a4f, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 26; i++) {
      const p = randomPondPoint(1.2);
      if (p.z < -5 && Math.abs(p.x) < 4) continue;
      const h = rand(1.2, 2.6);
      const g = new THREE.ConeGeometry(0.12, h, 5, 6, true);
      g.translate(0, h / 2, 0);
      const weed = new THREE.Mesh(g, weedM);
      const base = floorHeight(p.x, p.z);
      weed.position.set(p.x, base - 0.05, p.z);
      weed.userData.ph = rand(0, 6);
      this.scene.add(weed);
      this.weeds.push({ mesh: weed, x: p.x, z: p.z, base, h, bx: 0, bz: 0 });
    }

    // 연잎·연꽃
    const padM = new THREE.MeshStandardMaterial({ color: 0x3f8a4a, roughness: 0.7, side: THREE.DoubleSide });
    const petalM = new THREE.MeshStandardMaterial({ color: 0xffa6c1, roughness: 0.5, emissive: 0x401020 });
    this.pads = [];
    for (let i = 0; i < 9; i++) {
      const p = randomPondPoint(1.3);
      const r = rand(0.5, 0.9);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 20, 0.3, Math.PI * 2 - 0.4), padM);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = rand(0, 6);
      pad.position.set(p.x, 0.03, p.z);
      pad.userData = { ax: p.x, az: p.z, ox: 0, oz: 0, lift: 0, r };
      this.scene.add(pad);
      this.pads.push(pad);
      if (i % 3 === 0) {
        const flower = new THREE.Group();
        for (let k = 0; k < 7; k++) {
          const petal = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), petalM);
          petal.scale.set(0.6, 1.4, 0.35);
          const a = (k / 7) * Math.PI * 2;
          petal.position.set(Math.cos(a) * 0.13, 0.18, Math.sin(a) * 0.13);
          petal.lookAt(Math.cos(a) * 2, 1.4, Math.sin(a) * 2);
          flower.add(petal);
        }
        flower.position.set(p.x + 0.15, 0.03, p.z);
        this.scene.add(flower);
        pad.userData.flower = flower;
      }
    }

    // 석등 두 개
    const stoneM = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9, flatShading: true });
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffc574 });
    for (const [x, z] of [
      [-POND_RX - 0.4, -3.5],
      [POND_RX + 0.2, 1.5],
    ]) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 6), stoneM);
      base.position.y = 0.3;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 6), stoneM);
      pole.position.y = 1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), stoneM);
      box.position.y = 1.85;
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.26, 0.4), lampM);
      light.position.y = 1.85;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.65, 0.45, 6), stoneM);
      roof.position.y = 2.3;
      g.add(base, pole, box, light, roof);
      g.position.set(x, 0, z);
      this.scene.add(g);
      const pl = new THREE.PointLight(0xffb060, 9, 12, 1.6);
      pl.position.set(x, 2, z);
      this.scene.add(pl);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffb060, transparent: true, opacity: 0.6, depthWrite: false }),
      );
      glow.position.set(x, 1.85, z);
      glow.scale.setScalar(2.2);
      this.scene.add(glow);
    }
  }

  // ---------- 파티클 ----------
  buildParticles() {
    // 떠오르는 물방울
    const N = 120;
    const pos = new Float32Array(N * 3);
    this.bubbleSeeds = [];
    for (let i = 0; i < N; i++) {
      const p = randomPondPoint(1);
      pos.set([p.x, rand(FLOOR_Y, 0), p.z], i * 3);
      this.bubbleSeeds.push(rand(0.3, 0.9));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.bubbles = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.16, map: this.glowTex, color: 0xcff4ff, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.scene.add(this.bubbles);

    // 반딧불
    const F = 40;
    const fpos = new Float32Array(F * 3);
    this.flySeeds = [];
    for (let i = 0; i < F; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(0.9, 1.25);
      this.flySeeds.push({ a, r, y: rand(0.6, 4), ph: rand(0, 6), sp: rand(0.05, 0.15) });
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    this.flies = new THREE.Points(
      fg,
      new THREE.PointsMaterial({
        size: 0.35,
        map: this.glowTex,
        color: 0xfff09a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.flies);

    // 효과용 스프라이트 풀
    this.fxMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  spawnParticle(pos, color, vel, life = 1, size = 0.25, gravity = -6, blending = THREE.AdditiveBlending) {
    const s = new THREE.Sprite(this.fxMat.clone());
    s.material.blending = blending;
    s.material.color.set(color);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.particles.push({ s, vel, life, max: life, size, gravity });
  }

  splash(pos, strength = 1, ripple = true) {
    const p = pos.clone();
    if (ripple) {
      p.y = 0.05;
      this.addRipple(p.x, p.z, strength);
    }
    for (let i = 0; i < 26 * strength; i++) {
      const v = new THREE.Vector3(rand(-1.4, 1.4), rand(2.5, 5) * strength, rand(-1.4, 1.4));
      this.spawnParticle(p, 0xdff6ff, v, rand(0.6, 1.1), rand(0.12, 0.28), -9);
    }
  }

  burst(pos, color, n = 30, speed = 1) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).setLength(rand(1, 4) * speed);
      this.spawnParticle(pos, color, v, rand(0.8, 1.6), rand(0.15, 0.4), 0);
    }
  }

  addRipple(x, z, strength = 1) {
    const r = this.rippleData.reduce((a, b) => (a.z < b.z ? a : b));
    r.set(x, z, this.waterMat.uniforms.uTime.value, strength);
  }

  makeTrail() {
    const N = 60;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setDrawRange(0, 0);
    const pts = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.55,
        map: this.glowTex,
        color: 0xffd27a,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.scene.add(pts);
    const t = { pts, list: [], fading: false, life: 1 };
    this.trails.push(t);
    return t;
  }

  pushTrail(t, pos) {
    t.list.unshift(pos.clone());
    if (t.list.length > 60) t.list.pop();
    const arr = t.pts.geometry.attributes.position.array;
    t.list.forEach((p, i) => arr.set([p.x, p.y, p.z], i * 3));
    t.pts.geometry.attributes.position.needsUpdate = true;
    t.pts.geometry.setDrawRange(0, t.list.length);
  }

  fadeTrail(t) {
    t.fading = true;
  }

  // ---------- 별자리 ----------
  starPosition(star) {
    const h1 = hashStr(`${star.name}|${star.at}`);
    const h2 = hashStr(`${star.at}|${star.dream}`);
    return new THREE.Vector3((h1 - 0.5) * 90, 22 + h2 * 38, -70 - h1 * 20);
  }

  addStar(star, { flash = false } = {}) {
    const color = SPECIES[star.species]?.color || '#ffd27a';
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    s.position.copy(this.starPosition(star));
    s.userData = { base: flash ? 14 : 3.2, ph: rand(0, 6), star };
    s.scale.setScalar(s.userData.base);
    this.dreamStars.add(s);
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, depthWrite: false, fog: false }),
    );
    core.scale.setScalar(0.35);
    s.add(core);
  }

  setStars(list) {
    this.dreamStars.clear();
    list.forEach((s) => this.addStar(s));
  }

  // ---------- 물고기 관리 ----------
  upsertFish(data, opts = {}) {
    let f = this.fishes.get(data.id);
    if (!data.hasDream) {
      if (f && !f.action) this.removeFish(data.id);
      return null;
    }
    if (f) {
      f.setData(data);
    } else {
      f = new Fish(this, data, opts);
      this.fishes.set(data.id, f);
      if (opts.spawnAt) f.pos.copy(opts.spawnAt);
      if (opts.splashIn) {
        f.pos.set(rand(-3, 3), -0.6, rand(2, 5));
        this.splash(f.pos, 0.9);
      }
    }
    this.balanceNpcs();
    return f;
  }

  removeFish(id) {
    const f = this.fishes.get(id);
    if (!f) return;
    f.dispose();
    this.fishes.delete(id);
    this.balanceNpcs();
  }

  balanceNpcs() {
    const real = [...this.fishes.values()].filter((f) => !f.isNpc).length;
    const npcs = [...this.fishes.values()].filter((f) => f.isNpc);
    const want = Math.max(0, NPC_TARGET - real);
    while (npcs.length < want) {
      const id = `npc-${this.npcSeq++}`;
      const species = SPECIES_IDS[Math.floor(Math.random() * SPECIES_IDS.length)];
      const f = new Fish(this, { id, species, name: '', hasDream: false }, { isNpc: true });
      this.fishes.set(id, f);
      npcs.push(f);
    }
    while (npcs.length > want) {
      const f = npcs.pop();
      f.dispose();
      this.fishes.delete(f.id);
    }
  }

  getFish(id) {
    return this.fishes.get(id);
  }

  feed(fromFish, toId) {
    const f = this.fishes.get(toId);
    if (!f) return;
    // 수면에서 밥알이 떨어져 물고기에게
    const top = f.pos.clone();
    top.y = 0.1;
    this.addRipple(top.x, top.z, 0.6);
    for (let i = 0; i < 14; i++) {
      const p = top.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5)));
      const v = new THREE.Vector3(0, -rand(1, 2.2), 0).add(tmpV.subVectors(f.pos, p).multiplyScalar(0.6));
      this.spawnParticle(p, 0xfff1c4, v, 1.1, 0.16, -0.5);
    }
    setTimeout(() => {
      f.wiggle = 1.2;
      this.burst(f.pos, 0xffe08a, 18, 0.6);
    }, 900);
  }

  // 폭포의 진행도 등불 다시 그리기
  refreshMarkers() {
    this.markers.clear();
    for (const f of this.fishes.values()) {
      if (f.isNpc || !f.data.total || f.action) continue;
      const tier = Math.min(TIERS, Math.round(f.progress * TIERS));
      const xOff = (hashStr(f.id) - 0.5) * (6 - tier * 0.45);
      const p = tierPoint(tier, xOff);
      p.y += 0.2;
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTex,
          color: SPECIES[f.data.species]?.color || '#fff',
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      s.position.copy(p);
      s.scale.setScalar(f.isMe ? 1.3 : 0.8);
      s.userData = { ph: hashStr(f.id) * 6 };
      this.markers.add(s);
    }
  }

  // ---------- 물리: 물고기끼리 부딪힘 ----------
  // 물고기 몸을 캡슐(선분 + 반지름)로 보고, 겹치면 무게 비율로 밀어내고 속도를 튕긴다
  resolveCollisions(dt, time) {
    const list = [];
    for (const f of this.fishes.values()) {
      if (f.action && !(f.action.type === 'leap' && f.action.phase !== 'air')) continue;
      const d = f.bodyDir(new THREE.Vector3()).multiplyScalar(f.halfLen);
      list.push({ f, a: f.pos.clone().add(d), b: f.pos.clone().sub(d), r: f.radius, m: f.radius ** 3 });
    }
    const c1 = new THREE.Vector3();
    const c2 = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const reach = A.r + B.r;
        if (A.f.pos.distanceToSquared(B.f.pos) > (reach + A.f.halfLen + B.f.halfLen) ** 2) continue;
        closestSegSeg(A.a, A.b, B.a, B.b, c1, c2);
        n.subVectors(c1, c2);
        let dist = n.length();
        if (dist >= reach) continue;
        if (dist < 1e-4) {
          n.set(rand(-1, 1), 0, rand(-1, 1));
          dist = 1e-4;
        }
        n.normalize();
        // 겹친 만큼 밀어내기 (가벼운 쪽이 더 많이)
        const overlap = reach - dist;
        const wa = B.m / (A.m + B.m);
        const wb = A.m / (A.m + B.m);
        A.f.pos.addScaledVector(n, overlap * wa);
        B.f.pos.addScaledVector(n, -overlap * wb);
        // 다가오던 속도만 튕기기 (반발 계수 0.35)
        const vn = tmpV.subVectors(A.f.vel, B.f.vel).dot(n);
        if (vn < 0) {
          const jImp = (-(1 + 0.35) * vn) / (1 / A.m + 1 / B.m);
          A.f.vel.addScaledVector(n, jImp / A.m);
          B.f.vel.addScaledVector(n, -jImp / B.m);
          if (-vn > 0.9) this.bonk(A.f, B.f, n, c1.lerp(c2, 0.5), time);
        }
        for (const f of [A.f, B.f]) {
          const floor = f.minY();
          if (f.pos.y < floor) f.pos.y = floor;
        }
      }
    }
  }

  // 세게 부딪히면: 몸을 흔들고 물방울, 놀란 물고기는 반대쪽으로 질주
  bonk(a, b, n, at, time) {
    a.wiggle = Math.max(a.wiggle, 0.5);
    b.wiggle = Math.max(b.wiggle, 0.5);
    for (let i = 0; i < 5; i++) {
      this.spawnParticle(at, 0xdff6ff, new THREE.Vector3(rand(-0.5, 0.5), rand(0.4, 1.2), rand(-0.5, 0.5)), 0.8, 0.14, 0.5);
    }
    if (time - (this.lastBonkSfx || 0) > 0.4) {
      this.lastBonkSfx = time;
      this.sfx?.bubble();
    }
    for (const [f, sign] of [
      [a, 1],
      [b, -1],
    ]) {
      if (f.isMe || f.move || f.action || f.data.sleeping || Math.random() < 0.4) continue;
      f.doMove('dash');
      if (f.move) f.move.dir.set(n.x * sign, 0, n.z * sign).normalize();
    }
  }

  // 수초는 물고기에 밀려 휘었다가 돌아오고, 연잎은 밀려나며 들썩인다
  pushPlants(dt, time) {
    const fishes = [...this.fishes.values()].filter((f) => !f.action || f.action.type === 'leap');
    for (const w of this.weeds) {
      let tx = 0;
      let tz = 0;
      for (const f of fishes) {
        if (f.pos.y > w.base + w.h + 0.3) continue;
        const dx = w.x - f.pos.x;
        const dz = w.z - f.pos.z;
        const d = Math.hypot(dx, dz);
        const reach = f.radius + f.halfLen * 0.6 + 0.3;
        if (d < reach && d > 1e-4) {
          const k = (reach - d) / reach;
          tx += (dx / d) * k * 0.9;
          tz += (dz / d) * k * 0.9;
          f.vel.multiplyScalar(1 - Math.min(0.5, dt * 1.2 * k)); // 수초 사이는 조금 느리게
        }
      }
      const pushing = tx !== 0 || tz !== 0;
      const rate = Math.min(1, dt * (pushing ? 8 : 2.2));
      w.bx += (clamp(tx, -0.9, 0.9) - w.bx) * rate;
      w.bz += (clamp(tz, -0.9, 0.9) - w.bz) * rate;
      const ph = w.mesh.userData.ph;
      w.mesh.rotation.z = -w.bx + Math.sin(time * 0.9 + ph) * 0.12;
      w.mesh.rotation.x = w.bz + Math.cos(time * 0.7 + ph) * 0.08;
    }
    for (const [i, p] of this.pads.entries()) {
      const u = p.userData;
      let px = 0;
      let pz = 0;
      let lift = 0;
      for (const f of fishes) {
        if (f.pos.y < -1.0) continue;
        const dx = p.position.x - f.pos.x;
        const dz = p.position.z - f.pos.z;
        const d = Math.hypot(dx, dz);
        const reach = u.r + f.radius;
        if (d < reach && d > 1e-4) {
          const k = (reach - d) / reach;
          px += (dx / d) * k * 1.6;
          pz += (dz / d) * k * 1.6;
          lift = Math.max(lift, k * 0.12 * clamp((f.pos.y + 1) * 1.5, 0, 1));
        }
      }
      u.ox += (px * 0.8 - u.ox * 0.6) * dt;
      u.oz += (pz * 0.8 - u.oz * 0.6) * dt;
      u.lift += (lift - u.lift) * Math.min(1, dt * 6);
      p.position.set(u.ax + u.ox, 0.03 + Math.sin(time + i) * 0.015 + u.lift, u.az + u.oz);
      if (u.flower) u.flower.position.set(p.position.x + 0.15, p.position.y, p.position.z);
    }
  }

  // ---------- 시점 ----------
  // pond: 연못 전체 / chase: 물고기 따라가기(3인칭) / eye: 물고기 눈(1인칭)
  applyPondLimits() {
    const c = this.controls;
    c.enabled = true;
    c.minDistance = 8;
    c.maxDistance = 30;
    c.minPolarAngle = 0.45;
    c.maxPolarAngle = 1.42;
    c.minAzimuthAngle = -1.1;
    c.maxAzimuthAngle = 1.1;
  }

  setView(mode, fishId = null) {
    const c = this.controls;
    const f = fishId && this.fishes.get(fishId);
    if (mode !== 'pond' && !f) mode = 'pond';
    if (this.view.mode === 'pond' && mode !== 'pond') {
      this.savedCam = { pos: this.camera.position.clone(), target: c.target.clone() };
    }
    this.view = { mode, fishId: mode === 'pond' ? null : fishId };
    this.keys.clear();

    if (mode === 'pond') {
      this.applyPondLimits();
      if (this.savedCam) {
        this.camera.position.copy(this.savedCam.pos);
        c.target.copy(this.savedCam.target);
      }
    } else if (mode === 'chase') {
      c.enabled = true;
      c.minDistance = 1.8;
      c.maxDistance = 12;
      c.minPolarAngle = 0.05;
      c.maxPolarAngle = Math.PI - 0.05;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      const h = f.heading();
      c.target.copy(f.pos);
      this.camera.position.copy(f.pos).addScaledVector(h, -4.2);
      this.camera.position.y += 1.6;
      this.focusLast = f.pos.clone();
    } else {
      c.enabled = false;
      this.eyeLook = f.pos.clone().addScaledVector(f.heading(), 6);
      this.camera.position.copy(f.pos);
    }
    this.onViewChange?.(this.view);
  }

  // 이 물고기를 지금 키보드로 조종 중인가
  steering(fish) {
    return this.view.mode !== 'pond' && this.view.fishId === fish.id && this.keys.size > 0;
  }

  bindKeys() {
    const map = {
      KeyW: 'fwd', ArrowUp: 'fwd',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'up', KeyE: 'up',
      ShiftLeft: 'down', ShiftRight: 'down', KeyQ: 'down',
    };
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (e.code === 'Escape' && this.view.mode !== 'pond') return this.setView('pond');
      const k = map[e.code];
      const f = this.view.fishId && this.fishes.get(this.view.fishId);
      if (!k || !f?.isMe || this.view.mode === 'pond') return;
      e.preventDefault();
      if (!this.keys.has(k)) {
        this.keys.add(k);
        f.manual = null;
        f.move = null;
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = map[e.code];
      if (k) this.keys.delete(k);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  updateCamera(dt) {
    const v = this.view;
    const c = this.controls;
    if (v.mode !== 'pond') {
      const f = this.fishes.get(v.fishId);
      if (!f || f.action?.type === 'gone') {
        this.setView('pond');
      } else if (v.mode === 'chase') {
        // 물고기가 움직인 만큼 카메라도 같이 (각도는 사용자가 돌릴 수 있음)
        tmpV.subVectors(f.pos, this.focusLast);
        this.camera.position.add(tmpV);
        c.target.copy(f.pos);
        this.focusLast.copy(f.pos);
        if (this.steering(f)) {
          // 조종 중에는 등 뒤로 천천히 돌아감
          const dist = this.camera.position.distanceTo(f.pos);
          const behind = tmpV.copy(f.pos).addScaledVector(f.heading(tmpV2), -dist);
          behind.y = f.pos.y + dist * 0.35;
          this.camera.position.lerp(behind, Math.min(1, dt * 2));
        }
      } else {
        // 물고기 눈: 머리 앞쪽에서 바라보는 방향으로 (몸의 구르기는 따라가지 않아 멀미 방지)
        const dir = tmpV.set(0, 0, 1).applyQuaternion(f.root.quaternion);
        const eye = tmpV2.copy(f.pos).addScaledVector(dir, 0.55 * f.scaleNow);
        eye.y += 0.12 * f.scaleNow;
        this.camera.position.lerp(eye, 1 - Math.exp(-dt * 14));
        const look = eye.clone().addScaledVector(dir, 6);
        this.eyeLook.lerp(look, 1 - Math.exp(-dt * 4));
        this.camera.lookAt(this.eyeLook);
      }
    }
    if (c.enabled) c.update();
    if (v.mode === 'chase') {
      const cp = this.camera.position;
      if (insidePond(cp.x, cp.z, -1)) cp.y = Math.max(cp.y, floorHeight(cp.x, cp.z) + 0.35);
    }

    // 물속인지에 따라 안개·수면 모습 바꾸기
    const p = this.camera.position;
    const under = p.y < -0.02 && insidePond(p.x, p.z, -0.2);
    if (under !== this.under) {
      this.under = under;
      this.scene.fog.color.set(under ? 0x0c4058 : 0x0d2340);
      this.scene.fog.density = under ? 0.07 : 0.018;
      this.waterMat.uniforms.uUnder.value = under ? 1 : 0;
      document.body.classList.toggle('underwater', under);
    }
  }

  // ---------- 입력 ----------
  bindPointer() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      ndc.set((e.clientX / this.width) * 2 - 1, -(e.clientY / this.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects([...this.fishes.values()].map((f) => f.hit), false);
      const f = hits[0]?.object.userData.fish;

      // 다른 사람 물고기 → 카드
      if (f && !f.isNpc && !f.isMe) return this.onFishClick?.(f);
      // 연못 전체 시점에서 내 물고기 → 내 꿈 패널
      if (f?.isMe && this.view.mode === 'pond') return this.onFishClick?.(f);

      // 빈 물(또는 연못 친구 물고기)을 눌렀을 때: 내 물고기가 있으면 그 자리로 헤엄쳐 감
      const focus = this.view.fishId && this.fishes.get(this.view.fishId);
      const mine =
        this.view.mode === 'pond' ? [...this.fishes.values()].find((x) => x.isMe) : focus?.isMe ? focus : null;
      if (mine && !mine.action) {
        const p = this.pickSwimPoint(ray.ray, mine);
        if (p && mine.swimTo(p)) {
          this.showMarker(mine, p);
          this.addRipple(p.x, p.z, 0.5);
          this.onSwimTo?.(p);
        }
        this.onFishClick?.(null);
        return;
      }
      if (f?.isMe) return;

      // 그 밖에는 물결만
      const t = -ray.ray.origin.y / ray.ray.direction.y;
      if (t > 0) {
        const p = ray.ray.at(t, tmpV);
        if (insidePond(p.x, p.z, 0.2)) {
          this.addRipple(p.x, p.z, 0.7);
          this.sfx?.bubble();
        }
      }
      this.onFishClick?.(null);
    });
  }

  // 화면에서 누른 곳 → 물고기가 갈 3D 위치
  pickSwimPoint(r, fish) {
    let p = null;
    if (this.view.mode === 'pond') {
      // 위에서 볼 때는 물 너머로 보이는 '바닥' 지점을 찾는다 (광선을 따라 조금씩 전진)
      for (let t = 0; t < 90; t += 0.12) {
        const q = r.at(t, tmpV2);
        if (q.y > 0.2) continue;
        if (insidePond(q.x, q.z, 0) && q.y <= floorHeight(q.x, q.z)) {
          p = q.clone();
          break;
        }
        if (q.y < FLOOR_Y - 1) break;
      }
      if (!p) {
        const t = -r.origin.y / r.direction.y;
        if (t > 0 && Number.isFinite(t)) p = r.at(t, new THREE.Vector3());
      }
    } else {
      // 물고기 시점에서는 물고기와 같은 높이의 평면
      const t = (fish.pos.y - r.origin.y) / r.direction.y;
      if (t > 0 && Number.isFinite(t)) p = r.at(t, new THREE.Vector3());
    }
    if (!p) return null;
    // 연못 안쪽으로 끌어오기
    for (let i = 0; i < 30 && !insidePond(p.x, p.z, 1.3); i++) {
      p.x *= 0.93;
      p.z *= 0.93;
    }
    if (!insidePond(p.x, p.z, 1.0)) return null;
    const lo = floorHeight(p.x, p.z) + fish.radius + 0.45;
    const hi = SWIM_TOP - 0.1;
    p.y = this.view.mode === 'pond' ? clamp(fish.pos.y, Math.min(lo, hi), hi) : clamp(p.y, Math.min(lo, hi), hi);
    return p;
  }

  // 목적지 표시: 금빛 고리 + 수면 위 빛 기둥, 도착하면 사라짐
  showMarker(fish, p) {
    if (!this.marker) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.42, 40),
        new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, depthTest: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 6;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      beam.renderOrder = 6;
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a, transparent: true, depthWrite: false, depthTest: false }),
      );
      glow.renderOrder = 6;
      g.add(ring, beam, glow);
      g.userData = { ring, beam, glow };
      this.scene.add(g);
      this.marker = g;
    }
    const m = this.marker;
    m.visible = true;
    m.position.copy(p);
    m.userData.fish = fish;
    m.userData.life = 1;
    m.userData.t = 0;
    // 목적지에서 수면까지 가는 빛 기둥
    const h = Math.max(0.05, -p.y);
    m.userData.beam.scale.set(1, h, 1);
    m.userData.beam.position.y = h / 2;
  }

  updateMarker(dt) {
    const m = this.marker;
    if (!m?.visible) return;
    const u = m.userData;
    u.t += dt;
    const going = u.fish?.manual && u.fish.manual.distanceToSquared(m.position) < 1e-6;
    if (!going) u.life -= dt * 2.5;
    if (u.life <= 0) {
      m.visible = false;
      return;
    }
    const pulse = 1 + Math.sin(u.t * 6) * 0.12;
    u.ring.scale.setScalar(pulse * (going ? 1 : 1 + (1 - u.life)));
    u.ring.material.opacity = 0.9 * u.life;
    u.beam.material.opacity = 0.45 * u.life;
    u.glow.material.opacity = 0.8 * u.life;
    u.glow.scale.setScalar(0.9 * pulse);
  }

  // 다른 사람이 보낸 '여기로 헤엄쳐' 신호
  swimFishTo(id, arr) {
    const f = this.fishes.get(id);
    if (!f || !Array.isArray(arr)) return;
    f.swimTo(new THREE.Vector3(arr[0], arr[1], arr[2]));
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    // 세로 화면에서는 조금 더 멀리
    this.camera.fov = this.camera.aspect < 0.8 ? 62 : 48;
    // 데스크톱에서는 오른쪽 패널에 가리지 않게 장면을 왼쪽으로 조금 민다
    this.applyViewShift(true);
  }

  // 엔딩 장면에서는 패널이 사라지므로 장면을 다시 화면 정중앙으로 (부드럽게)
  setCinema(on) {
    this.cinema = on;
  }

  applyViewShift(snap = false, dt = 0) {
    const target = !this.cinema && this.width > 720 ? 180 : 0;
    const prev = this.viewShift;
    this.viewShift = snap ? target : this.viewShift + (target - this.viewShift) * Math.min(1, dt * 3);
    if (Math.abs(this.viewShift - target) < 0.5) this.viewShift = target;
    if (!snap && prev === this.viewShift) return;
    if (this.viewShift) this.camera.setViewOffset(this.width, this.height, this.viewShift, 0, this.width, this.height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ---------- 루프 ----------
  tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05) * this.timeScale;
    const time = this.timer.getElapsed();
    this.waterMat.uniforms.uTime.value = time;
    this.fallsMat.uniforms.uTime.value = time;
    for (const f of [...this.fishes.values()]) f.update(dt, time);

    this.resolveCollisions(dt, time);
    this.pushPlants(dt, time);
    this.applyViewShift(false, dt);
    this.updateCamera(dt);
    this.updateMarker(dt);


    // 물방울
    const bp = this.bubbles.geometry.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      let y = bp.getY(i) + dt * this.bubbleSeeds[i];
      if (y > -0.05) y = floorHeight(bp.getX(i), bp.getZ(i)) + 0.2;
      bp.setY(i, y);
      bp.setX(i, bp.getX(i) + Math.sin(time * 2 + i) * 0.002);
    }
    bp.needsUpdate = true;

    // 반딧불
    const fp = this.flies.geometry.attributes.position;
    this.flySeeds.forEach((s, i) => {
      const a = s.a + time * s.sp;
      fp.setXYZ(
        i,
        Math.cos(a) * POND_RX * s.r,
        s.y + Math.sin(time * 1.3 + s.ph) * 0.4,
        Math.sin(a) * POND_RZ * s.r,
      );
    });
    fp.needsUpdate = true;
    this.flies.material.opacity = 0.6 + Math.sin(time * 2) * 0.25;

    // 물안개
    for (const m of this.mist) {
      const u = m.userData;
      const k = (time * u.sp + u.ph) % 3;
      m.position.set(u.x + Math.sin(time + u.ph) * 0.3, -0.2 + k * 0.6, FALLS_Z + 1.4);
      m.material.opacity = 0.2 * (1 - k / 3);
    }
    this.gateGlow.material.opacity = 0.4 + Math.sin(time * 1.5) * 0.12;

    // 진행도 등불 깜빡임
    for (const s of this.markers.children) s.material.opacity = 0.75 + Math.sin(time * 3 + s.userData.ph) * 0.25;

    // 꿈 별 반짝임
    for (const s of this.dreamStars.children) {
      const u = s.userData;
      if (u.base > 3.2) u.base += (3.2 - u.base) * dt * 0.6;
      s.scale.setScalar(u.base * (0.85 + Math.sin(time * 2 + u.ph) * 0.15));
    }

    // 효과 파티클
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.s);
        p.s.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.s.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.s.material.opacity = k;
      p.s.scale.setScalar(p.size * (0.5 + k * 0.5));
    }

    // 꼬리 빛
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      if (!t.fading) continue;
      t.life -= dt * 0.5;
      t.pts.material.opacity = Math.max(0, t.life);
      if (t.life <= 0) {
        this.scene.remove(t.pts);
        t.pts.geometry.dispose();
        this.trails.splice(i, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
