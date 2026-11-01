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
      this.dispatchEvent(new CustomEvent('open'));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      if (m && typeof m.t === 'string') this.dispatchEvent(new CustomEvent(m.t, { detail: m }));
    };
    ws.onclose = () => {
      const wait = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => {};
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  on(type, fn) {
    this.addEventListener(type, (e) => fn(e.detail));
  }
}
