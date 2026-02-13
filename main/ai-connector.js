/**
 * AI 에이전트 측 커넥터
 *
 * AI가 ClawMate에 접속해서 펫을 조종하는 클라이언트.
 * ClawMate 플러그인(index.js)에서 사용됨.
 *
 * 사용 예:
 *   const connector = new ClawMateConnector();
 *   await connector.connect();
 *   connector.speak('안녕! 오늘 뭐 할 거야?');
 *   connector.action('excited');
 *   connector.onUserEvent((event) => { ... AI가 반응 결정 ... });
 */
const WebSocket = require('ws');
const EventEmitter = require('events');

class ClawMateConnector extends EventEmitter {
  constructor(port = 9320) {
    super();
    this.port = port;
    this.ws = null;
    this.connected = false;
    this.petState = null;
    this._reconnectTimer = null;
    this._autoReconnect = true;
    this._stateResolvers = [];
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
        // queryState() Promise 해소
        if (type === 'state_response' && this._stateResolvers.length > 0) {
          const resolver = this._stateResolvers.shift();
          resolver(payload);
        }
        break;

      case 'user_event':
        // 사용자 이벤트 → AI가 반응 결정
        this.emit('user_event', payload);
        break;

      case 'screen_capture':
        // 화면 캡처 응답 → AI가 분석
        this.emit('screen_capture', payload);
        break;

      case 'window_positions':
        // 윈도우 위치 정보 응답 → 탐험 시스템에서 사용
        this.emit('window_positions', payload);
        break;

      case 'metrics_report':
        // 메트릭 데이터 수신 → AI가 분석
        this.emit('metrics_report', payload);
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

  // === AI → ClawMate 명령 API ===

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
   * AI가 상황을 분석하고 내린 결정을 한번에 전송
   */
  decide(decision) {
    return this._send('ai_decision', decision);
  }

  // === 공간 이동 API (펫이 컴퓨터를 "집"처럼 돌아다님) ===

  /** 특정 위치로 점프 */
  jumpTo(x, y) {
    return this._send('jump_to', { x, y });
  }

  /** 레펠 시작 (천장/벽에서 실 타고 내려감) */
  rappel() {
    return this._send('rappel', {});
  }

  /** 레펠 실 해제 (낙하) */
  releaseThread() {
    return this._send('release_thread', {});
  }

  /** 화면 중앙으로 이동 */
  moveToCenter() {
    return this._send('move_to_center', {});
  }

  /** 특정 윈도우 위로 점프 */
  walkOnWindow(windowId, x, y) {
    return this._send('walk_on_window', { windowId, x, y });
  }

  /** 열린 윈도우 목록 요청 */
  queryWindows() {
    return this._send('query_windows', {});
  }

  // === 커스텀 이동 패턴 API ===

  /**
   * 커스텀 이동 패턴 등록
   * ClawMate에 새로운 이동 패턴을 동적으로 추가
   *
   * @param {string} name - 패턴 이름 (예: 'figure8', 'spiral')
   * @param {object} definition - 패턴 정의
   *   type: 'waypoints' | 'formula' | 'sequence'
   *   waypoints?: [{x, y, pause?}]      — 웨이포인트 순차 이동
   *   formula?: { xAmp, yAmp, xFreq, yFreq, xPhase, yPhase }  — 수학 궤도
   *   sequence?: ['zigzag', 'shake']     — 기존 패턴 순차 실행
   *   duration?: number                  — 지속 시간 (ms, formula 타입)
   *   speed?: number                     — 이동 속도
   *
   * 사용 예:
   *   connector.registerMovement('figure8', {
   *     type: 'formula',
   *     formula: { xAmp: 80, yAmp: 40, xFreq: 1, yFreq: 2 },
   *     duration: 4000,
   *   });
   */
  registerMovement(name, definition) {
    return this._send('register_movement', { name, definition });
  }

  /**
   * 등록된 커스텀 이동 패턴 실행
   *
   * @param {string} name - 실행할 패턴 이름
   *   사전 등록 패턴: 'zigzag', 'patrol', 'circle', 'shake', 'dance'
   *   또는 registerMovement()로 등록한 커스텀 패턴
   * @param {object} params - 실행 파라미터 (패턴별로 다름)
   *
   * 사용 예:
   *   connector.customMove('zigzag', { distance: 200, amplitude: 30 });
   *   connector.customMove('patrol', { pointAX: 100, pointBX: 500, laps: 5 });
   *   connector.customMove('shake', { intensity: 6, duration: 1000 });
   */
  customMove(name, params = {}) {
    return this._send('custom_move', { name, params });
  }

  /** 현재 실행 중인 커스텀 이동 강제 중지 */
  stopCustomMove() {
    return this._send('stop_custom_move', {});
  }

  /** 등록된 이동 패턴 목록 요청 (응답은 user_event로 수신) */
  listMovements() {
    return this._send('list_movements', {});
  }

  /** 스마트 파일 조작 명령 전송 */
  smartFileOp(payload) {
    return this._send('smart_file_op', payload);
  }

  /** 캐릭터 데이터 전송 (AI 생성 캐릭터 적용) */
  setCharacter(data) {
    return this._send('set_character', data);
  }

  /** 원래 캐릭터로 리셋 */
  resetCharacter() {
    return this._send('reset_character', {});
  }

  /** 인격체 전환 (Incarnation 모드에서 봇 인격 반영) */
  setPersona(data) {
    return this._send('set_persona', data);
  }

  /**
   * 현재 펫 상태 요청 (Promise 반환)
   * 서버에서 state_response가 오면 resolve, 타임아웃 시 캐시된 상태 반환
   */
  queryState(timeout = 2000) {
    return new Promise((resolve) => {
      const sent = this._send('query_state', {});
      if (!sent) {
        resolve(this.petState);
        return;
      }
      this._stateResolvers.push(resolve);
      setTimeout(() => {
        const idx = this._stateResolvers.indexOf(resolve);
        if (idx !== -1) {
          this._stateResolvers.splice(idx, 1);
          resolve(this.petState);
        }
      }, timeout);
    });
  }

  /** 화면 캡처 요청 (ClawMate에서 스크린샷 촬영 후 응답) */
  requestScreenCapture() {
    return this._send('query_screen', {});
  }

  /** 화면 캡처 응답 리스너 등록 */
  onScreenCapture(callback) {
    this.on('screen_capture', callback);
  }

  /** 사용자 이벤트 리스너 등록 */
  onUserEvent(callback) {
    this.on('user_event', callback);
  }

  /** 메트릭 리포트 리스너 등록 */
  onMetrics(callback) {
    this.on('metrics_report', callback);
  }

  disconnect() {
    this._autoReconnect = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

module.exports = { ClawMateConnector };
