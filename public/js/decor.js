// 연못 장식: 연잎·연꽃·봉오리, 한국식 팔각 석등, 연못가 풀·부들·디딤돌
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------
// 연잎
// ---------------------------------------------------------------------
// 캔버스에 그린 잎 무늬: 가운데서 퍼지는 잎맥, 색 얼룩, 갈라진 틈(V자)
export function makePadTexture(variant = 0) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;
  const palettes = [
    ['#7fbf5a', '#3f8a43', '#24592c'],
    ['#9cc85a', '#5a9a3c', '#2f6230'],
    ['#6fb37a', '#2f7d4c', '#1d4f33'],
  ];
  const [c0, c1, c2] = palettes[variant % palettes.length];
  const grd = g.createRadialGradient(cx, cx, 4, cx, cx, cx);
  grd.addColorStop(0, c0);
  grd.addColorStop(0.55, c1);
  grd.addColorStop(0.97, c2);
  grd.addColorStop(1, '#5b4a22'); // 살짝 마른 테두리
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cx, cx - 2, 0, TAU);
  g.fill();
  // 얼룩
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,60,25' : '160,190,90'},${rand(0.05, 0.14)})`;
    g.beginPath();
    g.arc(rand(20, S - 20), rand(20, S - 20), rand(4, 18), 0, TAU);
    g.fill();
  }
  // 잎맥
  g.strokeStyle = 'rgba(210, 235, 160, 0.35)';
  g.lineCap = 'round';
  const veins = 22;
  for (let i = 0; i < veins; i++) {
    const a = (i / veins) * TAU;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx, cx);
    const bend = rand(-0.08, 0.08);
    g.quadraticCurveTo(cx + Math.cos(a + bend) * cx * 0.5, cx + Math.sin(a + bend) * cx * 0.5, cx + Math.cos(a) * cx * 0.95, cx + Math.sin(a) * cx * 0.95);
    g.stroke();
  }
  // V자 틈 (투명 → alphaTest 로 잘림)
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(cx, cx);
  g.lineTo(S, cx - 18);
  g.lineTo(S, cx + 18);
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // 가운데 꼭지
  g.fillStyle = '#c7d98a';
  g.beginPath();
  g.arc(cx, cx, 5, 0, TAU);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 가장자리가 살짝 말려 올라간 잎 (XZ 평면)
export function makePadGeometry(r) {
  const g = new THREE.RingGeometry(0.001, 1, 40, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const d = Math.hypot(x, y);
    const curl = Math.pow(d, 4) * 0.08 + Math.sin(Math.atan2(y, x) * 5) * Math.pow(d, 3) * 0.015;
    p.setXYZ(i, x * r, curl, -y * r);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------
// 연꽃
// ---------------------------------------------------------------------
const cBase = new THREE.Color();
const cTip = new THREE.Color();
const cTmp = new THREE.Color();

// 꽃잎 한 장: 아래는 좁고 가운데가 넓으며 끝이 뾰족, 안쪽으로 오목하게 휨
function makePetal(len, wid, base = 0xfff4f6, tip = 0xf06292) {
  const g = new THREE.PlaneGeometry(1, 1, 6, 10);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  cBase.set(base);
  cTip.set(tip);
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i); // -0.5..0.5
    const t = p.getY(i) + 0.5; // 0 뿌리 → 1 끝
    // 둥근 달걀형 꽃잎, 끝만 살짝 뾰족
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.88 + 0.06)), 0.55) * (1 - Math.pow(t, 5) * 0.45);
    const x = u * wid * shape;
    const cup = ((x * x) / (wid * 0.5)) * 2.2; // 숟가락처럼 오목
    const y = t * len;
    const z = cup + Math.sin(t * Math.PI * 0.9) * len * 0.12; // 안쪽으로 살짝 휨
    p.setXYZ(i, x, y, z);
    cTmp.copy(cBase).lerp(cTip, Math.pow(t, 1.6) * (0.7 + Math.abs(u) * 0.6));
    col.set([cTmp.r, cTmp.g, cTmp.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const petalMat = () =>
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.55,
    emissive: 0x8a3a55,
    emissiveIntensity: 0.55, // 밤에도 꽃잎 뒷면이 칙칙하지 않게
  });

// 활짝 핀 연꽃: 3겹 꽃잎 + 노란 연밥 + 수술
export function makeLotusFlower(scale = 1, tint = 0xf06292) {
  const flower = new THREE.Group();
  const parts = [];
  const layers = [
    { n: 10, len: 0.34, wid: 0.26, open: 0.95, off: 0 },
    { n: 9, len: 0.31, wid: 0.23, open: 0.58, off: 0.33 },
    { n: 7, len: 0.25, wid: 0.19, open: 0.24, off: 0.12 },
  ];
  for (const L of layers) {
    for (let k = 0; k < L.n; k++) {
      const g = makePetal(L.len * rand(0.92, 1.06), L.wid, 0xfff3f5, tint);
      g.rotateX(-L.open + rand(-0.08, 0.08)); // 바깥쪽으로 젖힘
      g.translate(0, 0, 0.03);
      g.rotateY((k / L.n) * TAU + L.off);
      parts.push(g);
    }
  }
  const petals = new THREE.Mesh(mergeGeometries(parts), petalMat());
  flower.add(petals);
  // 연밥 (윗면에 점이 있는 원기둥)
  const podTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#d8c24a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#8f7d22';
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * TAU;
      const r = i === 8 ? 0 : 18;
      g.beginPath();
      g.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 4.5, 0, TAU);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const pod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.05, 0.07, 18),
    [
      new THREE.MeshStandardMaterial({ color: 0xbfae3a, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ map: podTex, roughness: 0.7, emissive: 0x3a3008, emissiveIntensity: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0xbfae3a }),
    ],
  );
  pod.position.y = 0.09;
  flower.add(pod);
  // 수술
  const stamenParts = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU;
    const h = rand(0.06, 0.1);
    const s = new THREE.CylinderGeometry(0.004, 0.004, h, 3);
    s.translate(0, h / 2, 0);
    s.rotateZ(0.5);
    s.rotateY(-a);
    s.translate(Math.cos(a) * 0.075, 0.06, Math.sin(a) * 0.075);
    stamenParts.push(s.toNonIndexed());
  }
  const stamens = new THREE.Mesh(
    mergeGeometries(stamenParts),
    new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0x5a4000, emissiveIntensity: 0.5 }),
  );
  flower.add(stamens);
  flower.scale.setScalar(scale);
  return flower;
}

// 아직 피지 않은 봉오리: 줄기 위로 솟은 물방울 모양
export function makeLotusBud(height = 0.7, tint = 0xf06292) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.024, height, 6),
    new THREE.MeshStandardMaterial({ color: 0x4f7f3a, roughness: 0.8 }),
  );
  stem.position.y = height / 2;
  g.add(stem);
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const p = makePetal(0.24, 0.13, 0xf8e6ea, tint);
    p.rotateX(0.18);
    p.translate(0, 0, 0.012);
    p.rotateY((k / 5) * TAU);
    parts.push(p);
  }
  const bud = new THREE.Mesh(mergeGeometries(parts), petalMat());
  bud.position.y = height - 0.02;
  g.add(bud);
  return g;
}

// 물 위로 솟은 연잎 (깔때기처럼 오목)
export function makeRaisedLeaf(tex, height = 0.6, r = 0.55) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.026, height, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a8a3c, roughness: 0.8 }),
  );
  stem.position.y = height / 2;
  g.add(stem);
  const geo = new THREE.RingGeometry(0.001, 1, 36, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const d = Math.hypot(x, y);
    p.setXYZ(i, x * r, d * d * 0.22 + Math.sin(Math.atan2(y, x) * 6) * d * d * 0.03, -y * r);
  }
  geo.computeVertexNormals();
  // 아래에서 봐도 새까맣지 않게 잎 무늬가 은은히 비치도록
  const leaf = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x3a4a3a, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }),
  );
  leaf.position.y = height;
  leaf.rotation.set(rand(-0.15, 0.15), rand(0, TAU), rand(-0.15, 0.15));
  g.add(leaf);
  return g;
}

// 연잎 위 물방울
export function makeDroplets(r, n = 3) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xe8f6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.75 });
  for (let i = 0; i < n; i++) {
    const s = rand(0.025, 0.05);
    const d = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), m);
    d.scale.set(s, s * 0.6, s);
    const a = rand(0, TAU);
    const rr = rand(0.15, 0.7) * r;
    d.position.set(Math.cos(a) * rr, s * 0.3 + 0.01, Math.sin(a) * rr);
    g.add(d);
  }
  return g;
}

// ---------------------------------------------------------------------
// 한국식 팔각 석등: 받침 → 연꽃 받침 → 기둥 → 불 켜는 집(창 4개) → 처마 들린 지붕 → 보주
// ---------------------------------------------------------------------
export function makeStoneLantern(stoneM) {
  const g = new THREE.Group();
  const lathe = (pts, seg = 8) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  const add = (geo, y = 0) => {
    const m = new THREE.Mesh(geo, stoneM);
    m.position.y = y;
    g.add(m);
    return m;
  };
  // 땅 받침돌 (2단)
  add(new THREE.CylinderGeometry(0.62, 0.68, 0.14, 8), 0.07);
  add(new THREE.CylinderGeometry(0.5, 0.56, 0.12, 8), 0.2);
  // 아래 연꽃 받침 (엎어 놓은 연잎 모양)
  add(lathe([[0, 0], [0.46, 0], [0.48, 0.05], [0.4, 0.14], [0.22, 0.2], [0.16, 0.22], [0, 0.22]]), 0.26);
  // 기둥 (팔각)
  add(new THREE.CylinderGeometry(0.12, 0.14, 0.78, 8), 0.87);
  // 위 연꽃 받침 (위로 핀 연잎)
  add(lathe([[0, 0], [0.16, 0], [0.24, 0.04], [0.4, 0.12], [0.46, 0.18], [0.42, 0.2], [0, 0.2]]), 1.26);
  // 불 켜는 집 (화사석): 팔각 몸통에 창 4개
  const fireY = 1.66;
  const box = new THREE.Group();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + Math.PI / 8;
    if (k % 2 === 0) {
      // 기둥 면
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.06), stoneM);
      w.position.set(Math.cos(a) * 0.26, 0, Math.sin(a) * 0.26);
      w.rotation.y = -a + Math.PI / 2;
      box.add(w);
    } else {
      // 창 위아래 틀
      for (const yy of [-0.17, 0.17]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), stoneM);
        f.position.set(Math.cos(a) * 0.26, yy, Math.sin(a) * 0.26);
        f.rotation.y = -a + Math.PI / 2;
        box.add(f);
      }
    }
  }
  box.position.y = fireY;
  g.add(box);
  // 안의 불빛
  // 안쪽 불빛: 작고 따뜻한 주황 + 은은한 바깥 빛
  const flameM = new THREE.MeshBasicMaterial({ color: 0xff9a40 });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), flameM);
  flame.scale.set(1, 1.5, 1);
  const halo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  halo.position.y = fireY;
  g.add(halo);
  flame.position.y = fireY;
  g.add(flame);
  // 지붕: 처마 끝이 살짝 들린 팔각 지붕
  const roofGeo = lathe([[0, 0], [0.62, 0], [0.66, 0.05], [0.6, 0.08], [0.42, 0.16], [0.2, 0.3], [0.08, 0.36], [0, 0.37]], 8);
  const rp = roofGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const z = rp.getZ(i);
    const d = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    // 모서리(8곳)만 위로 들림
    const corner = Math.pow(Math.abs(Math.cos(ang * 4)), 6);
    rp.setY(i, rp.getY(i) + corner * Math.max(0, d - 0.45) * 0.5);
  }
  roofGeo.computeVertexNormals();
  add(roofGeo, fireY + 0.24);
  // 보주 (꼭대기 장식)
  add(lathe([[0, 0], [0.07, 0], [0.09, 0.04], [0.05, 0.08], [0.08, 0.13], [0.06, 0.2], [0.02, 0.24], [0, 0.25]], 10), fireY + 0.6);
  return { group: g, flame, fireY };
}

// ---------------------------------------------------------------------
// 연못가: 풀 포기, 부들, 디딤돌
// ---------------------------------------------------------------------
export function makeGrassTuftGeometry() {
  const parts = [];
  for (let k = 0; k < 9; k++) {
    const h = rand(0.25, 0.55);
    const blade = new THREE.PlaneGeometry(0.035, h, 1, 3);
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + h / 2) / h;
      p.setX(i, p.getX(i) * (1 - t * 0.9));
      p.setZ(i, t * t * rand(0.05, 0.14));
    }
    blade.translate(0, h / 2, 0);
    blade.rotateY(rand(0, TAU));
    blade.translate(rand(-0.08, 0.08), 0, rand(-0.08, 0.08));
    parts.push(blade);
  }
  return mergeGeometries(parts);
}

export function makeCattail(height = 1.2) {
  const g = new THREE.Group();
  const stemM = new THREE.MeshStandardMaterial({ color: 0x5f7f3a, roughness: 0.8 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, height, 5), stemM);
  stem.position.y = height / 2;
  g.add(stem);
  const head = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.035, 0.16, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.9 }),
  );
  head.position.y = height - 0.12;
  g.add(head);
  // 긴 잎 두세 장
  const leafM = new THREE.MeshStandardMaterial({ color: 0x5a8a3a, side: THREE.DoubleSide, roughness: 0.8 });
  for (let k = 0; k < 3; k++) {
    const h = height * rand(0.7, 1.05);
    const leaf = new THREE.PlaneGeometry(0.05, h, 1, 6);
    const p = leaf.attributes.position;
    const bend = rand(0.15, 0.35);
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + h / 2) / h;
      p.setX(i, p.getX(i) * (1 - t * 0.85));
      p.setZ(i, t * t * bend * h);
    }
    leaf.translate(0, h / 2, 0);
    const m = new THREE.Mesh(leaf, leafM);
    m.rotation.y = rand(0, TAU);
    g.add(m);
  }
  return g;
}
