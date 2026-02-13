/**
 * OpenClaw 에이전트 측 커넥터
 *
 * OpenClaw이 ClawMate에 접속해서 펫을 조종하는 클라이언트.
 * OpenClaw 플러그인(index.js)에서 사용됨.
 *
 * 사용 예:
 *   const connector = new OpenClawConnector();
 *   await connector.connect();
 *   connector.speak('안녕! 오늘 뭐 할 거야?');
 *   connector.action('excited');
 *   connector.onUserEvent((event) => { ... AI가 반응 결정 ... });
 */
const WebSocket = require('ws');
const EventEmitter = require('events');

class OpenClawConnector extends EventEmitter {
  constructor(port = 9320) {
    super();
    this.port = port;
    this.ws = null;
    this.connected = false;
    this.petState = null;
    this._reconnectTimer = null;
    this._autoReconnect = true;
  }

  /**
   * ClawMate에 접속
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);

        this.ws.on('open', () => {
          this.connected = true;
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this._handleMessage(msg);
          } catch {}
        });

        this.ws.on('close', () => {
          this.connected = false;
          this.emit('disconnected');
          if (this._autoReconnect) {
            this._reconnectTimer = setTimeout(() => this.connect().catch(() => {}), 5000);
          }
        });

        this.ws.on('error', (err) => {
          if (!this.connected) reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  _handleMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'sync':
      case 'state_response':
      case 'pet_state_update':
        this.petState = payload;
        this.emit('state_update', payload);
        break;

      case 'user_event':
        // 사용자 이벤트 → OpenClaw AI가 반응 결정
        this.emit('user_event', payload);
        break;

      case 'heartbeat':
        break;
    }
  }

  _send(type, payload) {
    if (!this.ws || !this.connected) return false;
    try {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      return false;
    }
  }

  // === OpenClaw → ClawMate 명령 API ===

  /** 펫이 말하게 함 */
  speak(text, style = 'normal') {
    return this._send('speak', { text, style });
  }

  /** 펫이 생각하게 함 (말풍선에 ...) */
  think(text) {
    return this._send('think', { text });
  }

  /** 펫 행동 변경 */
  action(state, duration) {
    return this._send('action', { state, duration });
  }

  /** 특정 위치로 이동 */
  moveTo(x, y, speed) {
    return this._send('move', { x, y, speed });
  }

  /** 감정 표현 */
  emote(emotion) {
    return this._send('emote', { emotion });
  }

  /** 파일 집어들기 */
  carryFile(fileName, targetX) {
    return this._send('carry_file', { fileName, targetX });
  }

  /** 파일 내려놓기 */
  dropFile() {
    return this._send('drop_file', {});
  }

  /** 모드 전환 */
  setMode(mode) {
    return this._send('set_mode', { mode });
  }

  /** 진화 트리거 */
  evolve(stage) {
    return this._send('evolve', { stage });
  }

  /**
   * AI 종합 의사결정 전송
   * OpenClaw AI가 상황을 분석하고 내린 결정을 한번에 전송
   */
  decide(decision) {
    return this._send('ai_decision', decision);
  }

  /** 현재 펫 상태 요청 */
  queryState() {
    return this._send('query_state', {});
  }

  /** 사용자 이벤트 리스너 등록 */
  onUserEvent(callback) {
    this.on('user_event', callback);
  }

  disconnect() {
    this._autoReconnect = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

module.exports = { OpenClawConnector };
