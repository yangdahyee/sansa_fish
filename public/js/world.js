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
const NPC_TARGET = 6; // 연못이 너무 비어 보이지 않게 채우는 '연못 친구' 수

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

function randomPondPoint(margin = 1.6) {
  for (let i = 0; i < 30; i++) {
    const x = rand(-POND_RX, POND_RX);
    const z = rand(-POND_RZ, POND_RZ);
    if (insidePond(x, z, margin)) return new THREE.Vector3(x, rand(SWIM_BOTTOM + 0.3, SWIM_TOP - 0.2), z);
  }
  return new THREE.Vector3(0, -1.5, 0);
}

// 폭포 i번째 단의 물고기 위치(물이 넘치는 턱 바로 앞)
function tierPoint(i, xOff = 0) {
  const y = i * TIER_H + 0.25;
  const z = FALLS_Z - i * 0.75 + 0.9;
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
  leap() {
    if (this.action) return;
    const dir = tmpV.set(this.vel.x, 0, this.vel.z);
    if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
    dir.normalize();
    const from = this.pos.clone();
    const to = from.clone().addScaledVector(dir, 3.2);
    if (!insidePond(to.x, to.z, 1.2)) to.set(from.x * 0.4, from.y, from.z * 0.4);
    to.y = clamp(from.y, SWIM_BOTTOM, SWIM_TOP);
    this.move = null;
    this.action = { type: 'leap', t: 0, dur: 1.5, from, to, splashed: 0 };
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
        const floorY = FLOOR_Y + 0.5;
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
                tmpV2.set(this.pos.x + h.x * 0.5, FLOOR_Y + 0.2, this.pos.z + h.z * 0.5),
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
        const side = tmpV.set(-leader.vel.z, 0, leader.vel.x).normalize().multiplyScalar(1.1);
        this.target.copy(leader.pos).add(side).addScaledVector(leader.vel, -0.25);
        speed = Math.max(leader.vel.length(), 0.6) * 1.15;
      } else if (sleeping) {
        // 수초 아래, 바닥 가까이에서 쉼
        if (!this.sleepSpot) {
          const k = w.weeds[Math.floor(hashStr(this.id) * w.weeds.length)];
          this.sleepSpot = new THREE.Vector3(k.x + 0.6, FLOOR_Y + 0.55, k.z + 0.4);
        }
        this.target.copy(this.sleepSpot);
        speed = 0.25;
      } else if (this.manual) {
        // 물을 톡 누른 곳으로
        this.target.copy(this.manual);
        speed = 2;
        if (this.pos.distanceTo(this.manual) < 0.5) this.manual = null;
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

    // 다른 물고기와 너무 붙지 않게
    for (const o of w.fishes.values()) {
      if (o === this || o.action) continue;
      const d = this.pos.distanceTo(o.pos);
      const minD = 1.0 * (this.scaleNow + o.scaleNow) * 0.6;
      if (d < minD && d > 0.0001) {
        tmpV2.subVectors(this.pos, o.pos).setLength((minD - d) * 2.5);
        desired.add(tmpV2);
      }
    }

    const resp = this.move?.id === 'dash' || this.move?.id === 'roll' ? 6 : this.move?.id === 'glide' ? 0.6 : steering ? 3 : 1.6;
    this.vel.lerp(desired, Math.min(1, dt * resp));
    this.pos.addScaledVector(this.vel, dt);

    // 연못 안에 가두기
    const rx = POND_RX - 1;
    const rz = POND_RZ - 1;
    const e = (this.pos.x * this.pos.x) / (rx * rx) + (this.pos.z * this.pos.z) / (rz * rz);
    if (e > 1) {
      const k = 1 / Math.sqrt(e);
      this.pos.x *= k;
      this.pos.z *= k;
      if (steering) this.steerYaw = Math.atan2(-this.pos.x, -this.pos.z) * 0.15 + this.steerYaw * 0.85;
    }
    const bob = this.move ? 0 : Math.sin(time * 1.3 + this.pos.x) * 0.002;
    this.pos.y = clamp(this.pos.y + bob, FLOOR_Y + 0.4, this.yTop);

    // 수직으로만 움직이는 동작(뻐끔, 꼬리 춤)은 방향을 틀지 않는다
    const faceV = this.move && (this.move.id === 'nibble' || this.move.id === 'wag') ? tmpV2.set(this.vel.x, 0, this.vel.z) : this.vel;
    if (this.move?.id === 'nibble' || this.move?.id === 'forage') faceV.y = 0;
    this.face(faceV, dt, this.move?.id === 'circle' ? 8 : 4);
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
      a.t += dt / a.dur;
      const t = Math.min(1, a.t);
      const prev = this.pos.clone();
      this.pos.lerpVectors(a.from, a.to, t);
      this.pos.y = THREE.MathUtils.lerp(a.from.y, a.to.y, t) + Math.sin(t * Math.PI) * 3.2;
      const v = tmpV.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4));
      this.face(v, dt, 10);
      // 물 밖으로 나갈 때·들어올 때 물보라
      if (a.splashed === 0 && this.pos.y > 0) {
        a.splashed = 1;
        w.splash(this.pos, 1);
      } else if (a.splashed === 1 && t > 0.5 && this.pos.y < 0) {
        a.splashed = 2;
        w.splash(this.pos, 0.8);
      }
      if (a.t >= 1) {
        this.action = null;
        this.vel.copy(v).setLength(0.8);
        this.target = randomPondPoint();
      }
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
            o.material.emissive.setRGB(1, 0.72, 0.25).multiplyScalar(t * 0.9);
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
        // 용처럼 휘감으며 하늘로
        a.t += dt / 4.5;
        const t = Math.min(1, a.t);
        const prev = this.pos.clone();
        const ang = t * Math.PI * 3;
        const r = 3 * (1 - t * 0.6);
        this.pos.set(a.from.x + Math.sin(ang) * r, a.from.y + t * t * 26, a.from.z - t * 18 + Math.cos(ang) * r * 0.5);
        this.face(tmpV.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-4)), dt, 10);
        this.pivot.scale.multiplyScalar(1 + t * 0.6);
        w.pushTrail(a.trail, this.pos);
        if (Math.random() < 0.5) w.burst(this.pos, 0xffe2a0, 2, 0.5);
        if (a.t >= 1) {
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
    this.onFishClick = null;
    this.sfx = null;
    this.timer = new THREE.Timer();
    this.npcSeq = 0;
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
        this.models[id] = {
          scene: g.scene,
          clip: g.animations[0] || null,
          size: box.getSize(new THREE.Vector3()),
          center: box.getCenter(new THREE.Vector3()),
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
    const floorG = new THREE.CircleGeometry(1, 64, 0, Math.PI * 2);
    floorG.scale(POND_RX + 1, POND_RZ + 1, 1);
    floorG.rotateX(-Math.PI / 2);
    const fp = floorG.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      const z = fp.getZ(i);
      const e = Math.sqrt((x * x) / (POND_RX * POND_RX) + (z * z) / (POND_RZ * POND_RZ));
      fp.setY(i, FLOOR_Y + Math.max(0, e - 0.8) * 9 + Math.sin(x * 1.3) * Math.cos(z * 1.1) * 0.12);
    }
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
    for (let i = 0; i < TIERS; i++) {
      const w = 6.2 - i * 0.45;
      const y = i * TIER_H;
      const z = FALLS_Z - i * 0.75;
      // 단(바위 턱)
      const step = new THREE.Mesh(new THREE.BoxGeometry(w + 2.2, TIER_H, 1.6, 4, 2, 2), rockM);
      const sp = step.geometry.attributes.position;
      for (let k = 0; k < sp.count; k++) {
        sp.setXYZ(k, sp.getX(k) + rand(-0.12, 0.12), sp.getY(k) + rand(-0.08, 0.08), sp.getZ(k) + rand(-0.12, 0.12));
      }
      step.geometry.computeVertexNormals();
      step.position.set(0, y - TIER_H / 2 + 0.05, z - 0.5);
      fallsGroup.add(step);
      // 이끼
      const moss = new THREE.Mesh(new THREE.BoxGeometry(w + 2.3, 0.12, 1.4), mossM);
      moss.position.set(0, y + 0.08, z - 0.6);
      fallsGroup.add(moss);
      // 작은 웅덩이 물
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), this.waterMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, y + 0.16, z - 0.3);
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
    const top = tierPoint(TIERS, 0);
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
    gate.position.set(0, top.y - 0.3, top.z - 0.9);
    fallsGroup.add(gate);
    const gateGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffc070, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    gateGlow.scale.setScalar(7);
    gateGlow.position.set(0, top.y + 1.5, top.z - 1);
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
      weed.position.set(p.x, FLOOR_Y, p.z);
      weed.userData.ph = rand(0, 6);
      this.scene.add(weed);
      this.weeds.push({ mesh: weed, x: p.x, z: p.z });
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
        size: 0.9,
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
    if (v.mode === 'chase') this.camera.position.y = Math.max(this.camera.position.y, FLOOR_Y + 0.35);

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
      const focus = this.view.fishId && this.fishes.get(this.view.fishId);
      if (!f || f === focus) {
        // 내 물고기 시점일 때: 누른 곳으로 헤엄쳐 가기
        if (focus?.isMe && this.view.mode !== 'pond' && !focus.action) {
          const t = (focus.pos.y - ray.ray.origin.y) / ray.ray.direction.y;
          if (t > 0 && Number.isFinite(t)) {
            const p = ray.ray.at(t, new THREE.Vector3());
            if (!insidePond(p.x, p.z, 1.2)) p.multiplyScalar(0.8);
            if (insidePond(p.x, p.z, 1.0)) {
              focus.manual = p;
              focus.move = null;
              this.burst(p, 0xbff3ff, 12, 0.3);
              this.onSwimTo?.();
            }
          }
          return;
        }
      }
      if (f && !f.isNpc) this.onFishClick?.(f);
      else if (!f) {
        // 빈 물을 톡 치면 물결
        const t = -ray.ray.origin.y / ray.ray.direction.y;
        if (t > 0) {
          const p = ray.ray.at(t, tmpV);
          if (insidePond(p.x, p.z, 0.2)) {
            this.addRipple(p.x, p.z, 0.7);
            this.sfx?.bubble();
          }
        }
        this.onFishClick?.(null);
      } else this.onFishClick?.(null);
    });
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    // 세로 화면에서는 조금 더 멀리
    this.camera.fov = this.camera.aspect < 0.8 ? 62 : 48;
    // 데스크톱에서는 오른쪽 패널에 가리지 않게 장면을 왼쪽으로 조금 민다
    this.viewShift = this.width > 720 ? 180 : 0;
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

    // 수초 흔들림
    for (const w of this.weeds) {
      w.mesh.rotation.z = Math.sin(time * 0.9 + w.mesh.userData.ph) * 0.12;
      w.mesh.rotation.x = Math.cos(time * 0.7 + w.mesh.userData.ph) * 0.08;
    }
    this.updateCamera(dt);

    for (const [i, p] of this.pads.entries()) p.position.y = 0.03 + Math.sin(time + i) * 0.015;

    // 물방울
    const bp = this.bubbles.geometry.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      let y = bp.getY(i) + dt * this.bubbleSeeds[i];
      if (y > -0.05) y = FLOOR_Y + 0.2;
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
