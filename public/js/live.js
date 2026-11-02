// 실시간 알림: 새 소원, 먹이, 별, 접속자 수. 끊기면 자동으로 다시 연결.
export class Live extends EventTarget {
  constructor() {
    super();
    this.retry = 0;
    this.ws = null;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch (_) {
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      // 살아 있다는 신호: 25초마다 'ping' (서버가 잠든 채로 'pong'). 오래 없으면 서버가 끊긴 연결로 정리
      clearInterval(this.beat);
      this.beat = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25000);
      this.dispatchEvent(new CustomEvent('open'));
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      if (m && typeof m.t === 'string') this.dispatchEvent(new CustomEvent(m.t, { detail: m }));
    };
    ws.onclose = () => {
      clearInterval(this.beat);
      const wait = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => {};
  }

  // 페이지를 닫거나 앱을 끌 때 바로 나가기 (서버가 끊긴 걸 알아챌 때까지 기다리지 않게)
  bindLeave() {
    window.addEventListener('pagehide', () => {
      clearInterval(this.beat);
      try {
        this.ws?.close(1000, 'bye');
      } catch (_) {}
    });
    // 뒤로가기 캐시에서 돌아오면 다시 연결
    window.addEventListener('pageshow', (e) => {
      if (e.persisted && (!this.ws || this.ws.readyState > 1)) this.connect();
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  on(type, fn) {
    this.addEventListener(type, (e) => fn(e.detail));
  }
}
