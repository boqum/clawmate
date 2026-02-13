/**
 * OpenClaw ↔ ClawMate AI 브릿지
 *
 * OpenClaw 에이전트가 ClawMate의 뇌 역할을 한다.
 * - OpenClaw → ClawMate: 행동 명령, 말풍선, 감정, 이동
 * - ClawMate → OpenClaw: 사용자 이벤트 (클릭, 드래그, 커서, 파일 변화)
 *
 * 통신: WebSocket (로컬 ws://localhost:9320)
 * 프로토콜: JSON 메시지
 *
 * OpenClaw 연결 안 됐을 때 → 자율 모드 (기존 FSM) 로 폴백
 */
const WebSocket = require('ws');
const EventEmitter = require('events');

class AIBridge extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.client = null;           // 연결된 OpenClaw 에이전트
    this.connected = false;
    this.port = 9320;
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;
    this.petState = {
      mode: 'pet',
      position: { x: 0, y: 0, edge: 'bottom' },
      state: 'idle',
      emotion: 'neutral',
      evolutionStage: 0,
      memory: {},
    };
  }

  /**
   * WebSocket 서버 시작 — OpenClaw이 여기에 접속
   */
  start() {
    this.wss = new WebSocket.Server({ port: this.port, host: '127.0.0.1' });

    this.wss.on('connection', (ws) => {
      console.log('[AI Bridge] OpenClaw 연결됨');
      this.client = ws;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');

      // OpenClaw에 현재 상태 전송
      this.send('sync', this.petState);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleCommand(msg);
        } catch (err) {
          console.error('[AI Bridge] 메시지 파싱 실패:', err);
        }
      });

      ws.on('close', () => {
        console.log('[AI Bridge] OpenClaw 연결 해제');
        this.client = null;
        this.connected = false;
        this.emit('disconnected');
      });

      ws.on('error', (err) => {
        console.error('[AI Bridge] WebSocket 오류:', err.message);
      });

      // 하트비트
      this.heartbeatInterval = setInterval(() => {
        if (this.connected) {
          this.send('heartbeat', { timestamp: Date.now() });
        }
      }, 30000);
    });

    this.wss.on('error', (err) => {
      console.error('[AI Bridge] 서버 오류:', err.message);
    });

    console.log(`[AI Bridge] ws://127.0.0.1:${this.port} 에서 대기 중`);
  }

  /**
   * OpenClaw에서 온 명령 처리
   */
  _handleCommand(msg) {
    const { type, payload } = msg;

    switch (type) {
      // === 행동 제어 ===
      case 'action':
        // OpenClaw이 펫의 행동을 직접 지시
        // payload: { state: 'walking'|'excited'|..., duration?: ms }
        this.emit('action', payload);
        break;

      case 'move':
        // 특정 위치로 이동
        // payload: { x, y, speed? }
        this.emit('move', payload);
        break;

      case 'emote':
        // 감정 표현
        // payload: { emotion: 'happy'|'curious'|'sleepy'|... }
        this.emit('emote', payload);
        break;

      // === 말하기 ===
      case 'speak':
        // OpenClaw이 펫을 통해 사용자에게 말함
        // payload: { text: string, style?: 'normal'|'thought'|'shout' }
        this.emit('speak', payload);
        break;

      case 'think':
        // 생각 말풍선 (... 형태)
        // payload: { text: string }
        this.emit('think', payload);
        break;

      // === 파일 작업 ===
      case 'carry_file':
        // 특정 파일을 집어들도록 지시
        // payload: { fileName: string, targetX?: number }
        this.emit('carry_file', payload);
        break;

      case 'drop_file':
        this.emit('drop_file', payload);
        break;

      case 'smart_file_op':
        // 스마트 파일 조작 (텔레그램 또는 AI에서 트리거)
        // payload: { phase: 'pick_up'|'drop'|'complete', fileName?, targetName?, ... }
        this.emit('smart_file_op', payload);
        break;

      // === 외형 변화 ===
      case 'evolve':
        // 진화 트리거
        // payload: { stage: number }
        this.emit('evolve', payload);
        break;

      case 'set_mode':
        // 모드 전환
        // payload: { mode: 'pet'|'incarnation' }
        this.emit('set_mode', payload);
        break;

      case 'accessorize':
        // 임시 악세사리 추가
        // payload: { type: string, duration?: ms }
        this.emit('accessorize', payload);
        break;

      // === 공간 이동 명령 ===
      case 'jump_to':
        // 특정 위치로 점프
        // payload: { x, y }
        this.emit('jump_to', payload);
        break;

      case 'rappel':
        // 레펠 (천장/벽에서 실 타고 내려가기)
        // payload: {}
        this.emit('rappel', payload);
        break;

      case 'release_thread':
        // 레펠 실 해제 (낙하)
        // payload: {}
        this.emit('release_thread', payload);
        break;

      case 'move_to_center':
        // 화면 중앙으로 이동
        // payload: {}
        this.emit('move_to_center', payload);
        break;

      case 'walk_on_window':
        // 특정 윈도우 타이틀바 위로 이동
        // payload: { windowId, x, y }
        this.emit('walk_on_window', payload);
        break;

      case 'query_windows':
        // 윈도우 위치 정보 요청 → main process에서 처리
        this.emit('query_windows', payload);
        break;

      // === 커스텀 이동 패턴 ===
      case 'register_movement':
        // OpenClaw이 커스텀 이동 패턴 등록
        // payload: { name: string, definition: { type: 'waypoints'|'formula'|'sequence', ... } }
        this.emit('register_movement', payload);
        break;

      case 'custom_move':
        // 등록된 커스텀 이동 패턴 실행
        // payload: { name: string, params?: object }
        this.emit('custom_move', payload);
        break;

      case 'stop_custom_move':
        // 현재 커스텀 이동 강제 중지
        // payload: {}
        this.emit('stop_custom_move', payload);
        break;

      case 'list_movements':
        // 등록된 이동 패턴 목록 요청 → 응답은 renderer에서 reportToAI로 전송
        // payload: {}
        this.emit('list_movements', payload);
        break;

      // === 캐릭터 커스터마이징 ===
      case 'set_character':
        // AI가 생성한 캐릭터 데이터 적용
        // payload: { colorMap?: {...}, frames?: {...} }
        this.emit('set_character', payload);
        break;

      case 'reset_character':
        // 원래 캐릭터로 리셋
        this.emit('reset_character', payload);
        break;

      // === 컨텍스트 질의 ===
      case 'query_state':
        // 현재 펫 상태 요청
        this.send('state_response', this.petState);
        break;

      case 'query_screen':
        // 화면 정보 요청
        this.emit('query_screen', payload);
        break;

      // === AI 의사결정 결과 ===
      case 'ai_decision':
        // OpenClaw AI의 종합적 의사결정
        // payload: { action, speech?, emotion?, reasoning? }
        this.emit('ai_decision', payload);
        break;

      default:
        console.log(`[AI Bridge] 알 수 없는 명령: ${type}`);
    }
  }

  /**
   * OpenClaw에 이벤트 전송
   */
  send(type, payload) {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return false;
    try {
      this.client.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
      return true;
    } catch {
      return false;
    }
  }

  // === 사용자 이벤트 리포트 (ClawMate → OpenClaw) ===

  reportUserClick(position) {
    this.send('user_event', {
      event: 'click',
      position,
      petState: this.petState.state,
    });
  }

  reportUserDrag(from, to) {
    this.send('user_event', {
      event: 'drag',
      from, to,
    });
  }

  reportCursorNear(distance, cursorPos) {
    this.send('user_event', {
      event: 'cursor_near',
      distance, cursorPos,
    });
  }

  reportDesktopChange(files) {
    this.send('user_event', {
      event: 'desktop_changed',
      files,
    });
  }

  reportTimeChange(hour, period) {
    this.send('user_event', {
      event: 'time_change',
      hour, period,
    });
  }

  reportMilestone(milestone, data) {
    this.send('user_event', {
      event: 'milestone',
      milestone, data,
    });
  }

  reportIdleTime(seconds) {
    this.send('user_event', {
      event: 'user_idle',
      idleSeconds: seconds,
    });
  }

  reportScreenCapture(imageBase64, width, height) {
    this.send('screen_capture', {
      image: imageBase64,
      width,
      height,
      timestamp: Date.now(),
    });
  }

  /**
   * 메트릭 데이터를 OpenClaw에 전송
   * 렌더러에서 수집한 펫 동작 품질 메트릭을 AI에 전달
   */
  reportMetrics(summary) {
    this.send('metrics_report', {
      metrics: summary,
      timestamp: Date.now(),
    });
  }

  // === 상태 업데이트 ===

  updatePetState(updates) {
    Object.assign(this.petState, updates);
    this.send('pet_state_update', this.petState);
  }

  isConnected() {
    return this.connected;
  }

  stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.client) this.client.close();
    if (this.wss) this.wss.close();
  }
}

module.exports = { AIBridge };
