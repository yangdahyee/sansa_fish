// 파일 없이 WebAudio 로 만드는 물소리·풍경 소리
let ctx = null;
let enabled = false;
let master = null;
let ambient = null;

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function startAmbient() {
  if (ambient) return;
  const c = ensure();
  // 갈색 잡음 → 저역 통과 = 잔잔한 폭포 소리
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.2;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = c.createGain();
  g.gain.value = 0.18;
  src.connect(lp).connect(g).connect(master);
  src.start();
  ambient = { src, g };
}

function stopAmbient() {
  if (!ambient) return;
  ambient.src.stop();
  ambient = null;
}

export function setSound(on) {
  enabled = on;
  if (on) startAmbient();
  else stopAmbient();
}

export function isSoundOn() {
  return enabled;
}

function tone(freq, { type = 'sine', dur = 0.4, vol = 0.25, when = 0, slide = 0 } = {}) {
  if (!enabled) return;
  const c = ensure();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  plop() {
    tone(520, { dur: 0.18, vol: 0.3, slide: 0.35 });
    tone(900, { dur: 0.12, vol: 0.12, when: 0.05, slide: 0.5 });
  },
  splash() {
    tone(300, { dur: 0.35, vol: 0.25, slide: 0.4 });
    tone(1200, { dur: 0.2, vol: 0.08, type: 'triangle', when: 0.1, slide: 0.6 });
  },
  chime() {
    [880, 1320].forEach((f, i) => tone(f, { dur: 0.9, vol: 0.12, type: 'triangle', when: i * 0.08 }));
  },
  bubble() {
    tone(700, { dur: 0.1, vol: 0.15, slide: 1.8 });
  },
  ascend() {
    // 오음계로 올라가는 소리
    [392, 440, 523, 587, 659, 784, 880, 1047].forEach((f, i) =>
      tone(f, { dur: 1.2, vol: 0.12, type: 'triangle', when: i * 0.12 }),
    );
  },
};

export function buzz(pattern = 15) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
