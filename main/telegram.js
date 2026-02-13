/**
 * 텔레그램 봇 통합 모듈
 *
 * 텔레그램 메시지 ↔ ClawMate 양방향 통신.
 * - 텔레그램에서 온 메시지를 파싱하여 AI Bridge에 명령 전달
 * - 펫의 상태/말을 텔레그램으로 역전달
 *
 * 봇 토큰 우선순위:
 *   1. 환경변수 CLAWMATE_TELEGRAM_TOKEN
 *   2. 설정 파일 (Store)
 *   3. 둘 다 없으면 조용히 비활성화 (에러 없음)
 *
 * 의존성: node-telegram-bot-api (npm install node-telegram-bot-api)
 */

const EventEmitter = require('events');
const { parseMessage } = require('./file-command-parser');
const { executeSmartFileOp } = require('./smart-file-ops');

// 텔레그램 봇 API 동적 로드 (미설치 시 조용히 무시)
let TelegramBotAPI = null;
try {
  TelegramBotAPI = require('node-telegram-bot-api');
} catch {
  // node-telegram-bot-api 미설치 — 텔레그램 기능 비활성화
}

class TelegramBot extends EventEmitter {
  /**
   * @param {object} bridge - AIBridge 인스턴스
   * @param {object} options - 추가 옵션
   *   - token: 봇 토큰 (환경변수보다 우선)
   *   - allowedChatIds: 허용된 채팅 ID 목록 (보안)
   */
  constructor(bridge, options = {}) {
    super();
    this.bridge = bridge;
    this.bot = null;
    this.active = false;
    this.allowedChatIds = options.allowedChatIds || null;
    this.activeChatIds = new Set(); // 활성 채팅 ID 추적

    // 진행 중인 파일 작업 추적
    this._fileOpInProgress = false;

    // 봇 토큰 결정
    const token = options.token
      || process.env.CLAWMATE_TELEGRAM_TOKEN
      || null;

    if (!token) {
      console.log('[Telegram] 봇 토큰 없음 — 텔레그램 기능 비활성화');
      return;
    }

    if (!TelegramBotAPI) {
      console.log('[Telegram] node-telegram-bot-api 미설치 — 텔레그램 기능 비활성화');
      console.log('[Telegram] 설치: npm install node-telegram-bot-api');
      return;
    }

    this._init(token);
  }

  /**
   * 봇 초기화 및 메시지 리스너 등록
   */
  _init(token) {
    try {
      this.bot = new TelegramBotAPI(token, { polling: true });
      this.active = true;
      console.log('[Telegram] 봇 초기화 성공 — 메시지 대기 중');

      // 메시지 수신 핸들러
      this.bot.on('message', (msg) => this._handleMessage(msg));

      // 에러 핸들러 (연결 끊김 등)
      this.bot.on('polling_error', (err) => {
        // 토큰 오류 등 치명적 에러가 아니면 조용히 재시도
        if (err.code === 'ETELEGRAM' && err.response?.statusCode === 401) {
          console.error('[Telegram] 봇 토큰이 유효하지 않음 — 텔레그램 비활성화');
          this.stop();
        }
      });

      // AI Bridge에서 펫 이벤트 수신 → 텔레그램으로 전달
      this._setupBridgeListeners();
    } catch (err) {
      console.error('[Telegram] 봇 초기화 실패:', err.message);
      this.active = false;
    }
  }

  /**
   * AI Bridge 이벤트 리스너 설정 (펫 → 텔레그램)
   */
  _setupBridgeListeners() {
    if (!this.bridge) return;

    // 펫이 말할 때 텔레그램으로 전달
    this.bridge.on('speak', (payload) => {
      this._broadcastToChats(`[Claw] ${payload.text}`);
    });

    // AI 의사결정에 speech가 있으면 전달
    this.bridge.on('ai_decision', (payload) => {
      if (payload.speech) {
        this._broadcastToChats(`[Claw] ${payload.speech}`);
      }
    });
  }

  /**
   * 텔레그램 메시지 처리
   */
  async _handleMessage(msg) {
    if (!this.active) return;
    if (!msg.text) return;

    const chatId = msg.chat.id;

    // 보안: 허용된 채팅 ID만 처리
    if (this.allowedChatIds && !this.allowedChatIds.includes(chatId)) {
      return;
    }

    // 활성 채팅 ID 추적 (역전달용)
    this.activeChatIds.add(chatId);

    const text = msg.text.trim();
    console.log(`[Telegram] 수신 (${chatId}): ${text}`);

    // 특수 명령 처리
    if (text === '/start') {
      await this.bot.sendMessage(chatId,
        'ClawMate 연결됨! \n\n' +
        '사용 가능한 명령:\n' +
        '- 아무 메시지: 펫에게 말하기\n' +
        '- 행동 키워드: 점프해, 잠자, 춤춰, 걸어...\n' +
        '- 파일 정리: "바탕화면의 .md 파일을 docs 폴더에 넣어줘"\n' +
        '- 캐릭터 변경: "파란 고양이로 바꿔줘"\n' +
        '- /reset: 원래 캐릭터로 되돌리기\n' +
        '- /status: 펫 상태 확인\n' +
        '- /undo: 마지막 파일 이동 되돌리기'
      );
      return;
    }

    if (text === '/status') {
      await this._sendStatus(chatId);
      return;
    }

    if (text === '/undo') {
      await this._undoLastMove(chatId);
      return;
    }

    if (text === '/reset') {
      this._sendToBridge('reset_character', {});
      await this.bot.sendMessage(chatId, '원래 캐릭터로 되돌렸어!');
      return;
    }

    // 메시지 파싱 및 처리
    const parsed = parseMessage(text);
    await this._executeCommand(chatId, parsed);
  }

  /**
   * 파싱된 명령 실행
   */
  async _executeCommand(chatId, command) {
    switch (command.type) {
      case 'speak':
        // 일반 대화 → 펫 말풍선에 표시
        this._sendToBridge('speak', { text: command.text, style: 'normal' });
        this._sendToBridge('ai_decision', {
          speech: command.text,
          emotion: 'happy',
        });
        break;

      case 'action':
        // 행동 명령 → 펫 행동 변경
        this._sendToBridge('action', { state: command.action });
        await this.bot.sendMessage(chatId, `펫이 "${command.action}" 행동을 합니다!`);
        break;

      case 'smart_file_op':
        // 파일 조작 명령
        await this._executeFileOp(chatId, command);
        break;

      case 'character_change':
        // 캐릭터 변경 명령 → AI 생성 요청
        await this._handleCharacterChange(chatId, command.concept);
        break;
    }
  }

  /**
   * 캐릭터 변경 요청 처리
   *
   * 컨셉 텍스트를 AI(OpenClaw 플러그인)에 전달하여
   * 색상 + 프레임 데이터를 생성하고 펫에 적용.
   *
   * AI가 없으면 컨셉에서 색상만 추출하여 기본 변환.
   */
  async _handleCharacterChange(chatId, concept) {
    await this.bot.sendMessage(chatId, `"${concept}" 캐릭터 생성 중...`);

    // AI Bridge를 통해 OpenClaw 플러그인에 캐릭터 생성 요청
    this._sendToBridge('ai_decision', {
      speech: `${concept}(으)로 변신 준비 중...`,
      emotion: 'curious',
      action: 'excited',
    });

    // user_event로 캐릭터 변경 요청 전달 (OpenClaw 플러그인이 AI로 생성)
    if (this.bridge) {
      this.bridge.send('user_event', {
        event: 'character_request',
        concept,
        chatId,
      });
    }

    // 폴백: AI 응답이 3초 내에 없으면 키워드 기반 색상 변환
    this._characterFallbackTimer = setTimeout(() => {
      const colorMap = this._extractColorsFromConcept(concept);
      if (colorMap) {
        this._sendToBridge('set_character', {
          colorMap,
          speech: `${concept} 변신!`,
        });
        this.bot.sendMessage(chatId, `"${concept}" 캐릭터로 바꿨어! (색상 기반)`);
      }
    }, 3000);

    // AI가 캐릭터를 생성하면 이 타이머를 취소
    this._pendingCharacterChatId = chatId;
  }

  /**
   * AI가 캐릭터 생성을 완료했을 때 호출
   * 폴백 타이머를 취소하고 텔레그램에 알림
   */
  onCharacterGenerated(concept) {
    if (this._characterFallbackTimer) {
      clearTimeout(this._characterFallbackTimer);
      this._characterFallbackTimer = null;
    }
    if (this._pendingCharacterChatId) {
      this.bot?.sendMessage(this._pendingCharacterChatId,
        `"${concept}" 캐릭터 생성 완료! AI가 만든 커스텀 캐릭터야!`);
      this._pendingCharacterChatId = null;
    }
  }

  /**
   * 컨셉 텍스트에서 색상 추출 (AI 없을 때 폴백)
   * 키워드 매칭으로 색상 팔레트 결정
   */
  _extractColorsFromConcept(concept) {
    const c = concept.toLowerCase();

    // 색상 키워드 → 팔레트 매핑
    const colorKeywords = {
      // 파란 계열
      '파란': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
      '파랑': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
      'blue': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
      // 초록 계열
      '초록': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
      '녹색': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
      'green': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
      // 보라 계열
      '보라': { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', claw: '#8844cc' },
      'purple': { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', claw: '#8844cc' },
      // 노란 계열
      '노란': { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', claw: '#ffcc00' },
      '금색': { primary: '#ffd700', secondary: '#ffe44d', dark: '#8B7500', claw: '#ffd700' },
      'yellow': { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', claw: '#ffcc00' },
      'gold': { primary: '#ffd700', secondary: '#ffe44d', dark: '#8B7500', claw: '#ffd700' },
      // 분홍 계열
      '분홍': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
      '핑크': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
      'pink': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
      // 하얀 계열
      '하얀': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
      '흰': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
      'white': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
      // 검정 계열
      '검정': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
      '까만': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
      'black': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
      // 주황 계열
      '주황': { primary: '#ff8800', secondary: '#ffaa33', dark: '#884400', claw: '#ff8800' },
      'orange': { primary: '#ff8800', secondary: '#ffaa33', dark: '#884400', claw: '#ff8800' },
      // 틸/민트 계열
      '민트': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
      '틸': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
      'teal': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
    };

    for (const [keyword, palette] of Object.entries(colorKeywords)) {
      if (c.includes(keyword)) {
        return {
          ...palette,
          eye: '#ffffff',
          pupil: '#111111',
        };
      }
    }

    // 생물 키워드 → 특징적 색상
    const creatureColors = {
      '고양이': { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', claw: '#ff9944' },
      'cat': { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', claw: '#ff9944' },
      '강아지': { primary: '#cc8844', secondary: '#ddaa66', dark: '#664422', claw: '#cc8844' },
      'dog': { primary: '#cc8844', secondary: '#ddaa66', dark: '#664422', claw: '#cc8844' },
      '로봇': { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', claw: '#66aaff' },
      'robot': { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', claw: '#66aaff' },
      '슬라임': { primary: '#44dd44', secondary: '#88ff88', dark: '#228822', claw: '#44dd44' },
      'slime': { primary: '#44dd44', secondary: '#88ff88', dark: '#228822', claw: '#44dd44' },
      '유령': { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', claw: '#ccccff' },
      'ghost': { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', claw: '#ccccff' },
      '드래곤': { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', claw: '#ffaa00' },
      'dragon': { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', claw: '#ffaa00' },
      '펭귄': { primary: '#222222', secondary: '#ffffff', dark: '#111111', claw: '#ff8800' },
      'penguin': { primary: '#222222', secondary: '#ffffff', dark: '#111111', claw: '#ff8800' },
      '토끼': { primary: '#ffcccc', secondary: '#ffeeee', dark: '#ff8888', claw: '#ffcccc' },
      'rabbit': { primary: '#ffcccc', secondary: '#ffeeee', dark: '#ff8888', claw: '#ffcccc' },
      '악마': { primary: '#660066', secondary: '#880088', dark: '#330033', claw: '#ff0000' },
      'demon': { primary: '#660066', secondary: '#880088', dark: '#330033', claw: '#ff0000' },
      '천사': { primary: '#ffffff', secondary: '#ffffcc', dark: '#ddddaa', claw: '#ffdd00' },
      'angel': { primary: '#ffffff', secondary: '#ffffcc', dark: '#ddddaa', claw: '#ffdd00' },
    };

    for (const [keyword, palette] of Object.entries(creatureColors)) {
      if (c.includes(keyword)) {
        return {
          ...palette,
          eye: '#ffffff',
          pupil: '#111111',
        };
      }
    }

    // 매칭 안 되면 랜덤 색상
    const hue = Math.floor(Math.random() * 360);
    return {
      primary: `hsl(${hue}, 70%, 55%)`,
      secondary: `hsl(${hue}, 70%, 70%)`,
      dark: `hsl(${hue}, 60%, 25%)`,
      eye: '#ffffff',
      pupil: '#111111',
      claw: `hsl(${hue}, 70%, 55%)`,
    };
  }

  /**
   * 스마트 파일 조작 실행 + 펫 애니메이션 + 텔레그램 피드백
   */
  async _executeFileOp(chatId, command) {
    if (this._fileOpInProgress) {
      await this.bot.sendMessage(chatId, '이미 파일 작업이 진행 중이야! 잠시만 기다려줘.');
      return;
    }

    this._fileOpInProgress = true;

    const callbacks = {
      onStart: (totalFiles) => {
        this.bot.sendMessage(chatId, `${totalFiles}개 파일을 발견했어! 나르기 시작할게~`);
        this._sendToBridge('ai_decision', {
          action: 'excited',
          speech: `${totalFiles}개 파일 정리 시작!`,
          emotion: 'happy',
        });
      },

      onPickUp: (fileName, index) => {
        // 펫이 파일을 집어드는 애니메이션
        this._sendToBridge('smart_file_op', {
          phase: 'pick_up',
          fileName,
          index,
        });
        this._sendToBridge('ai_decision', {
          action: 'carrying',
          speech: `${fileName} 집었다!`,
          emotion: 'focused',
        });
      },

      onDrop: (fileName, targetName, index) => {
        // 펫이 파일을 내려놓는 애니메이션
        this._sendToBridge('smart_file_op', {
          phase: 'drop',
          fileName,
          targetName,
          index,
        });
        this._sendToBridge('ai_decision', {
          action: 'walking',
          speech: `${fileName} → ${targetName}에 놓았다!`,
          emotion: 'happy',
        });
      },

      onComplete: (result) => {
        this._fileOpInProgress = false;

        let message;
        if (result.movedCount === 0) {
          message = '옮길 파일이 없었어!';
        } else {
          message = `${result.movedCount}개 파일 옮겼어!`;
          if (result.errors.length > 0) {
            message += `\n(${result.errors.length}개 실패)`;
          }
        }

        this.bot.sendMessage(chatId, message);
        this._sendToBridge('ai_decision', {
          action: 'excited',
          speech: message,
          emotion: 'proud',
        });

        // smart_file_op 완료 이벤트
        this._sendToBridge('smart_file_op', {
          phase: 'complete',
          movedCount: result.movedCount,
          errors: result.errors,
        });
      },

      onError: (error) => {
        this._fileOpInProgress = false;
        this.bot.sendMessage(chatId, `파일 작업 중 오류 발생: ${error}`);
        this._sendToBridge('ai_decision', {
          action: 'scared',
          speech: '앗, 뭔가 잘못됐어...',
          emotion: 'scared',
        });
      },
    };

    await executeSmartFileOp(command, callbacks);
  }

  /**
   * 펫 상태 조회 후 텔레그램으로 전송
   */
  async _sendStatus(chatId) {
    if (!this.bridge) {
      await this.bot.sendMessage(chatId, 'AI Bridge에 연결되지 않았어.');
      return;
    }

    const state = this.bridge.petState;
    const statusText =
      `상태: ${state.state}\n` +
      `위치: (${state.position.x}, ${state.position.y})\n` +
      `모드: ${state.mode}\n` +
      `감정: ${state.emotion}\n` +
      `진화: ${state.evolutionStage}단계\n` +
      `AI 연결: ${this.bridge.isConnected() ? 'O' : 'X'}`;

    await this.bot.sendMessage(chatId, statusText);
  }

  /**
   * 마지막 파일 이동 되돌리기
   */
  async _undoLastMove(chatId) {
    try {
      const { undoAllSmartMoves } = require('./smart-file-ops');
      const result = undoAllSmartMoves();

      if (result.restoredCount === 0) {
        await this.bot.sendMessage(chatId, '되돌릴 파일 이동이 없어.');
      } else {
        let message = `${result.restoredCount}개 파일을 원래 위치로 되돌렸어!`;
        if (result.errors.length > 0) {
          message += `\n(${result.errors.length}개 복원 실패)`;
        }
        await this.bot.sendMessage(chatId, message);
        this._sendToBridge('ai_decision', {
          action: 'walking',
          speech: '파일들을 원래대로 돌려놨어!',
          emotion: 'happy',
        });
      }
    } catch (err) {
      await this.bot.sendMessage(chatId, `되돌리기 실패: ${err.message}`);
    }
  }

  /**
   * AI Bridge에 명령 전달
   */
  _sendToBridge(type, payload) {
    if (!this.bridge) return;

    // bridge의 _handleCommand를 직접 호출 (내부 이벤트 방출)
    // telegram에서 온 명령임을 표시
    payload._fromTelegram = true;
    this.bridge.emit(type, payload);
  }

  /**
   * 모든 활성 채팅에 메시지 브로드캐스트
   */
  _broadcastToChats(text) {
    if (!this.bot || !this.active) return;

    for (const chatId of this.activeChatIds) {
      this.bot.sendMessage(chatId, text).catch(() => {
        // 전송 실패 시 해당 채팅 ID 제거
        this.activeChatIds.delete(chatId);
      });
    }
  }

  /**
   * 특정 채팅에 메시지 전송
   */
  async sendMessage(chatId, text) {
    if (!this.bot || !this.active) return;
    try {
      await this.bot.sendMessage(chatId, text);
    } catch (err) {
      console.error('[Telegram] 메시지 전송 실패:', err.message);
    }
  }

  /**
   * 봇 중지
   */
  stop() {
    if (this.bot && this.active) {
      this.bot.stopPolling();
      this.active = false;
      console.log('[Telegram] 봇 중지');
    }
  }

  /**
   * 활성 상태 확인
   */
  isActive() {
    return this.active;
  }
}

module.exports = { TelegramBot };
