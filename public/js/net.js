// 연못 방 WebSocket 연결. 서버가 없으면(정적 호스팅 등) 혼자 헤엄치는 모드로 동작한다.

export class PondNet extends EventTarget {
  constructor(pond) {
    super();
    this.pond = pond;
    this.id = null;
    this.ws = null;
    this.retry = 0;
    this.getFish = () => ({});
    this.closedByUs = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws?pond=${encodeURIComponent(this.pond)}`);
    } catch (_) {
      this.emit('offline');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: 'hello', fish: this.getFish() });
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      if (m.t === 'welcome') this.id = m.id;
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      this.id = null;
      this.emit('offline');
      if (this.closedByUs) return;
      const wait = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => {};
  }

  get online() {
    return this.ws && this.ws.readyState === 1 && this.id;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
