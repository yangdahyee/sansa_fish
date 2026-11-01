// 진짜 물처럼 보이게 하는 셰이더들
// - 수면: 여러 겹 파도 + 물결 고리로 만든 표면 기울기, 하늘·달·석등 반사(프레넬),
//         깊이에 따른 색과 투명도, 가장자리 물거품
// - 코스틱: 물을 통과한 빛이 바닥에 만드는 일렁이는 그물무늬
import * as THREE from 'three';

const f = (n) => n.toFixed(4);

// 연못 바닥 높이를 셰이더 안에서도 똑같이 계산 (world.js 의 floorHeight 와 같은 식)
function floorGLSL(RX, RZ, FLOOR_Y) {
  return `
  float floorH(vec2 p) {
    float e = sqrt(p.x * p.x / ${f(RX * RX)} + p.y * p.y / ${f(RZ * RZ)});
    return min(${f(FLOOR_Y)} + max(0.0, e - 0.78) * 11.0 + sin(p.x * 1.3) * cos(p.y * 1.1) * 0.12, 0.05);
  }`;
}

const NOISE = `
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 u = fract(p); u = u * u * (3.0 - 2.0 * u);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
  }`;

// 하늘 셰이더와 같은 색 (반사에 쓰임)
const SKY = `
  vec3 skyColor(vec3 d) {
    float h = d.y;
    vec3 top = vec3(0.03, 0.05, 0.16);
    vec3 mid = vec3(0.10, 0.17, 0.36);
    vec3 hor = vec3(0.55, 0.36, 0.42);
    vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h));
    return mix(c, top, smoothstep(0.18, 0.7, h));
  }`;

/**
 * @param {object} shared  { uTime, uRipples, uUnder } — 모든 물이 같은 값을 공유
 * @param {object} opts    { RX, RZ, FLOOR_Y, moonDir: Vector3, lamps: Vector3[], pool: boolean }
 */
export function makeWaterMaterial(shared, opts) {
  const { RX, RZ, FLOOR_Y, moonDir, lamps, pool = false } = opts;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: shared.uTime,
      uRipples: shared.uRipples,
      uUnder: shared.uUnder,
      uMoon: { value: moonDir.clone().normalize() },
      uLamp0: { value: lamps[0] },
      uLamp1: { value: lamps[1] },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec4 uRipples[8];
      varying vec3 vW;
      float ripH(vec2 p) {
        float h = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (age > 0.0 && age < 2.5) {
            float d = distance(p, r.xy) - age * 2.4;
            h += cos(d * 9.0) * exp(-d * d * 4.0) * (1.0 - age / 2.5) * r.w;
          }
        }
        return h;
      }
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        // 아주 작은 높이 변화 (물결 고리가 실제로 솟았다 가라앉음)
        ${pool ? '' : 'w.y += ripH(w.xz) * 0.05 + sin(w.x * 1.1 + uTime * 1.3) * sin(w.z * 0.9 + uTime) * 0.015;'}
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uUnder;
      uniform vec4 uRipples[8];
      uniform vec3 uMoon;
      uniform vec3 uLamp0;
      uniform vec3 uLamp1;
      varying vec3 vW;
      ${NOISE}
      ${SKY}
      ${floorGLSL(RX, RZ, FLOOR_Y)}

      // 수면 높이장: 방향이 다른 파도 여러 겹 + 잔물결 노이즈 + 물결 고리
      float height(vec2 p) {
        float t = uTime;
        float h = 0.0;
        h += sin(dot(p, vec2(0.80, 0.60)) * 1.6 + t * 1.10) * 0.040;
        h += sin(dot(p, vec2(-0.55, 0.83)) * 2.4 + t * 1.55) * 0.025;
        h += sin(dot(p, vec2(0.95, -0.31)) * 4.3 - t * 2.10) * 0.012;
        h += (vnoise(p * 3.2 + vec2(t * 0.35, -t * 0.25)) - 0.5) * 0.03;
        h += (vnoise(p * 7.5 - vec2(t * 0.6, t * 0.4)) - 0.5) * 0.012;
        for (int i = 0; i < 8; i++) {
          vec4 r = uRipples[i];
          float age = t - r.z;
          if (age > 0.0 && age < 2.5) {
            float d = distance(p, r.xy) - age * 2.4;
            h += cos(d * 9.0) * exp(-d * d * 4.0) * (1.0 - age / 2.5) * r.w * 0.06;
          }
        }
        return h;
      }

      void main() {
        vec2 p = vW.xz;
        float e = 0.04;
        vec3 N = normalize(vec3(
          -(height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0))) / (2.0 * e),
          1.0,
          -(height(p + vec2(0.0, e)) - height(p - vec2(0.0, e))) / (2.0 * e)
        ));
        vec3 V = normalize(cameraPosition - vW);

        if (uUnder > 0.5) {
          // 물속에서 올려다본 수면: 위가 열린 창(스넬의 창), 비스듬히는 거울처럼 어두운 반사
          vec3 Nd = -N;
          float up = clamp(dot(-V, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
          float window = smoothstep(0.62, 0.8, up + (N.x + N.z) * 0.6);
          vec3 inside = vec3(0.04, 0.22, 0.28);
          vec3 sky = skyColor(refract(-V, Nd, 1.33)) * 1.6 + vec3(0.25, 0.35, 0.4);
          vec3 c = mix(inside, sky, window);
          c += pow(max(dot(refract(-V, Nd, 1.33), uMoon), 0.0), 60.0) * 1.5 * window;
          gl_FragColor = vec4(c, mix(0.85, 0.55, window));
          return;
        }

        // 물 깊이 → 얕은 곳은 맑은 청록, 깊은 곳은 짙은 남청
        float depth = ${pool ? '0.25' : 'max(0.0, vW.y - floorH(p))'};
        vec3 shallow = vec3(0.18, 0.46, 0.44);
        vec3 deep = vec3(0.015, 0.08, 0.13);
        vec3 body = mix(shallow, deep, smoothstep(0.0, 2.6, depth));

        // 프레넬: 비스듬히 볼수록 하늘이 더 비침
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 refl = skyColor(R);

        // 달빛 줄기와 석등 불빛 반사
        float moon = pow(max(dot(R, uMoon), 0.0), 700.0) * 1.3 + pow(max(dot(R, uMoon), 0.0), 50.0) * 0.18;
        vec3 spec = vec3(1.0, 0.9, 0.72) * moon; // 은은한 달빛 길
        vec3 L0 = normalize(uLamp0 - vW);
        vec3 L1 = normalize(uLamp1 - vW);
        // 석등: 가까운 물에만 은은한 금빛 (멀어질수록 빠르게 약해짐)
        float d0 = distance(uLamp0, vW);
        float d1 = distance(uLamp1, vW);
        float l0 = pow(max(dot(N, normalize(L0 + V)), 0.0), 120.0) * 0.45 / (1.0 + d0 * d0 * 0.12);
        float l1 = pow(max(dot(N, normalize(L1 + V)), 0.0), 120.0) * 0.45 / (1.0 + d1 * d1 * 0.12);
        spec += vec3(1.0, 0.7, 0.35) * (l0 + l1) + vec3(1.0, 0.6, 0.3) * 0.05 * (1.0 / (1.0 + d0 * d0 * 0.2) + 1.0 / (1.0 + d1 * d1 * 0.2));

        vec3 c = mix(body, refl, F) + spec;
        // 투명도: 얕은 곳은 바닥이 훤히, 깊은 곳은 물빛이 진하게 (물고기는 보이도록 상한)
        float a = mix(0.16, 0.5, smoothstep(0.0, 3.0, depth)) + F * 0.55 + moon * 0.3;

        ${
          pool
            ? ''
            : `// 바위와 닿는 가장자리 물거품
        float shore = 1.0 - smoothstep(0.0, 0.45, depth);
        float fn = vnoise(p * 5.0 + vec2(uTime * 0.25, -uTime * 0.2)) * 0.7 + vnoise(p * 13.0 - uTime * 0.4) * 0.3;
        float foam = smoothstep(0.55, 0.8, fn + shore * 0.55) * shore;
        c = mix(c, vec3(0.85, 0.92, 0.95), foam * 0.75);
        a = max(a, foam * 0.85);`
        }
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
      }`,
  });
}

// 바닥·조약돌 같은 물속 물체에 일렁이는 빛 무늬를 더한다
const CAUSTIC = `
  float caustic(vec2 uv, float t) {
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return pow(abs(c), 8.0);
  }`;

export function addCaustics(material, uTime, strength = 0.5) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vCWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCWorld;\nuniform float uTime;\n${CAUSTIC}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float under = 1.0 - smoothstep(-0.15, 0.0, vCWorld.y);
          float fade = 1.0 - clamp(-vCWorld.y * 0.12, 0.0, 0.5);
          float c1 = caustic(vCWorld.xz * 0.21, uTime * 0.55);
          float c2 = caustic(vCWorld.xz * 0.21 + 0.37, uTime * 0.55 + 1.7);
          vec3 cc = vec3(c1 * 0.9, (c1 + c2) * 0.5, c2) ; // 살짝 무지갯빛으로 갈라짐
          totalEmissiveRadiance += cc * vec3(0.55, 0.85, 0.95) * ${f(strength)} * under * fade * (0.4 + diffuseColor.rgb);
        }`,
      );
  };
  material.customProgramCacheKey = () => `caustic-${strength}`;
  return material;
}

// ======================================================================
// 폭포
// ======================================================================
const FBM = `
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += vnoise(p) * a;
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return s;
  }`;

// 단 끝에서 휘어 넘쳐흐르는 물줄기 곡면 (u: 가로, v: 위→아래)
export function makeFallSheet(width, lipY, lipZ, drop, out = 0.5) {
  const W = 28;
  const V = 20;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= V; j++) {
    const v = j / V;
    // 2차 베지어: 턱 위 → 앞으로 살짝 → 아래로 떨어짐
    const p0 = [lipZ - 0.2, lipY + 0.02];
    const p1 = [lipZ + out, lipY + 0.04];
    const p2 = [lipZ + out + 0.15, lipY - drop];
    const k = 1 - v;
    const z = k * k * p0[0] + 2 * k * v * p1[0] + v * v * p2[0];
    const y = k * k * p0[1] + 2 * k * v * p1[1] + v * v * p2[1];
    for (let i = 0; i <= W; i++) {
      const u = i / W;
      pos.push((u - 0.5) * width * (1 + v * 0.1), y, z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < W; i++) {
      const a = j * (W + 1) + i;
      const b = a + W + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeFallsMaterial(uTime) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      ${NOISE}
      ${FBM}
      void main() {
        float u = vUv.x;
        float v = vUv.y;
        // 가장자리는 물이 갈라지듯 흔들림
        float wob = (vnoise(vec2(v * 5.0 - uTime * 1.6, u * 2.0)) - 0.5) * 0.08;
        float edge = smoothstep(0.0, 0.1, u + wob) * smoothstep(1.0, 0.9, u - wob);
        // 위에서 아래로 흐르는 결 (세로로 길게 늘인 노이즈)
        float s1 = fbm(vec2(u * 9.0, v * 1.6 - uTime * 1.9));
        float s2 = fbm(vec2(u * 26.0, v * 3.4 - uTime * 3.1));
        float streak = smoothstep(0.38, 0.8, s1 * 0.65 + s2 * 0.45);
        // 턱 위 거품, 떨어지는 아래쪽 거품
        float foamTop = smoothstep(0.2, 0.0, v) * (0.55 + 0.45 * s2);
        float foamBot = smoothstep(0.6, 1.0, v) * (0.45 + 0.55 * fbm(vec2(u * 12.0, v * 5.0 - uTime * 4.0)));
        float foam = clamp(foamTop + foamBot, 0.0, 1.0);
        vec3 deep = vec3(0.14, 0.33, 0.43);
        vec3 lite = vec3(0.76, 0.91, 0.98);
        vec3 c = mix(deep, lite, clamp(streak * 0.85 + foam * 0.5, 0.0, 1.0));
        c = mix(c, vec3(0.95, 0.99, 1.0), foam * 0.7);
        c += vec3(1.0, 0.95, 0.85) * pow(s2, 7.0) * 0.9; // 달빛에 반짝이는 물방울
        float a = (0.48 + streak * 0.35 + foam * 0.4) * edge;
        a *= 1.0 - smoothstep(0.86, 1.0, v) * (0.65 - 0.5 * s2); // 아래로 갈수록 흩어지며 물보라로
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
      }`,
  });
}

// 물줄기가 떨어지는 자리의 하얀 거품
export function makeFoamMaterial(uTime) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime, uSeed: { value: Math.random() * 10 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uSeed; varying vec2 vUv;
      ${NOISE}
      ${FBM}
      void main() {
        vec2 p = vUv - 0.5;
        float d = length(p * vec2(1.0, 1.6)) * 2.0;
        float churn = fbm(p * 7.0 + vec2(uSeed, uTime * 0.9)) + fbm(p * 15.0 - vec2(uTime * 1.3, uSeed)) * 0.5;
        float a = smoothstep(1.0, 0.25, d) * smoothstep(0.45, 0.8, churn * 0.8 + (1.0 - d) * 0.45);
        gl_FragColor = vec4(vec3(0.94, 0.98, 1.0), a * 0.9);
      }`,
  });
}

// ======================================================================
// 이끼 낀 바위: 돌 얼룩 + 위를 향한 면에만 이끼
// ======================================================================
export function makeMossyRockMaterial({ color = 0x4f5a64, moss = 0x3f6f3a, amount = 1, roughness = 0.92 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
  const mossC = new THREE.Color(moss);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMoss = { value: mossC };
    sh.uniforms.uMossAmt = { value: amount };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;\nvarying vec3 vRN;').replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
        vRW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRN = normalize(mat3(modelMatrix) * objectNormal);
      #endif`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRW;\nvarying vec3 vRN;\nuniform vec3 uMoss;\nuniform float uMossAmt;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float nn = vnoise(vRW.xz * 1.7 + vRW.y * 0.3) * 0.6 + vnoise(vRW.xz * 5.3 + vRW.y * 2.1) * 0.4;
          diffuseColor.rgb *= 0.74 + nn * 0.5;                                 // 돌 얼룩
          diffuseColor.rgb *= 0.9 + (sin(vRW.y * 7.0 + nn * 3.0) * 0.5 + 0.5) * 0.14; // 결
          float up = smoothstep(0.42, 0.85, normalize(vRN).y + (nn - 0.5) * 0.4);
          float dry = smoothstep(-0.4, 0.15, vRW.y);                           // 물속은 이끼 적게
          diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.6 + nn * 0.5), up * uMossAmt * dry * (0.75 + nn * 0.25));
        }`,
      );
  };
  m.customProgramCacheKey = () => 'mossy-rock';
  return m;
}
