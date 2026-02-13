/**
 * AI 행동 컨트롤러
 *
 * OpenClaw이 연결되면 → AI가 모든 행동을 결정
 * OpenClaw이 끊기면  → 자율 모드 (기존 FSM) 로 폴백
 *
 * OpenClaw AI가 결정하는 것:
 * - 언제 뭐라고 말할지
 * - 어디로 움직일지
 * - 어떤 감정을 표현할지
 * - 파일을 집을지 말지
 * - 사용자 행동에 어떻게 반응할지
 */
const AIController = (() => {
  let connected = false;
  let autonomousMode = true;  // AI 미연결 시 자율 모드
  let pendingDecision = null;
  let lastAIAction = 0;

  // AI 연결 상태에 따라 preload를 통해 IPC로 통신
  // (main 프로세스의 AIBridge가 WebSocket 관리)

  function init() {
    // main 프로세스에서 AI 명령이 오면 실행
    if (window.clawmate.onAICommand) {
      window.clawmate.onAICommand((command) => {
        handleAICommand(command);
      });
    }

    if (window.clawmate.onAIConnected) {
      window.clawmate.onAIConnected(() => {
        connected = true;
        autonomousMode = false;
        Speech.show('OpenClaw 연결됨... 의식이 깨어난다.');
        StateMachine.forceState('excited');
      });
    }

    if (window.clawmate.onAIDisconnected) {
      window.clawmate.onAIDisconnected(() => {
        connected = false;
        autonomousMode = true;
        Speech.show('...혼자가 됐다. 알아서 놀아야지!');
      });
    }
  }

  /**
   * OpenClaw AI로부터 온 명령 실행
   */
  function handleAICommand(command) {
    const { type, payload } = command;
    lastAIAction = Date.now();

    switch (type) {
      case 'speak':
        Speech.show(payload.text);
        break;

      case 'think':
        Speech.show(`...${payload.text}...`);
        break;

      case 'action':
        StateMachine.forceState(payload.state);
        if (payload.duration) {
          setTimeout(() => {
            if (!autonomousMode) {
              StateMachine.forceState('idle');
            }
          }, payload.duration);
        }
        break;

      case 'move':
        PetEngine.setPosition(payload.x, payload.y);
        if (payload.speed) PetEngine.setSpeedMultiplier(payload.speed);
        break;

      case 'emote':
        applyEmotion(payload.emotion);
        break;

      case 'carry_file':
        StateMachine.forceState('carrying');
        Speech.show(`${payload.fileName} 집었다!`);
        break;

      case 'drop_file':
        StateMachine.forceState('idle');
        Speech.show('내려놨다!');
        break;

      case 'set_mode':
        ModeManager.applyMode(payload.mode);
        break;

      case 'evolve':
        // AI가 직접 진화 결정
        if (typeof Memory !== 'undefined') {
          Speech.show(window._messages?.evolution?.[`stage_${payload.stage}`] || '변하고 있어...!');
        }
        break;

      case 'accessorize':
        // 임시 악세사리
        break;

      case 'ai_decision':
        // 종합 의사결정 — 여러 행동을 순서대로 실행
        executeDecision(payload);
        break;

      // === 공간 이동 명령 ===

      case 'jump_to':
        // 특정 위치로 점프
        // payload: { x, y }
        PetEngine.jumpTo(payload.x, payload.y);
        break;

      case 'rappel':
        // 레펠 시작 (천장/벽에서 실 타고 내려가기)
        PetEngine.startRappel();
        break;

      case 'release_thread':
        // 레펠 실 해제 (낙하)
        PetEngine.releaseThread();
        break;

      case 'move_to_center':
        // 화면 중앙으로 이동 (물리적 방법으로)
        PetEngine.moveToCenter();
        break;

      case 'walk_on_window':
        // 특정 윈도우 타이틀바 위로 이동
        // payload: { windowId, x, y }
        PetEngine.jumpTo(payload.x, payload.y);
        break;
    }
  }

  /**
   * AI 종합 의사결정 실행
   * OpenClaw이 상황을 분석하고 내린 복합적 결정
   *
   * 예시:
   * {
   *   action: 'walking',
   *   speech: '오늘 바탕화면이 좀 어지럽네...',
   *   emotion: 'curious',
   *   reasoning: '바탕화면 파일이 15개 이상 감지됨'
   * }
   */
  function executeDecision(decision) {
    if (decision.emotion) {
      applyEmotion(decision.emotion);
    }

    if (decision.action) {
      StateMachine.forceState(decision.action);
    }

    if (decision.speech) {
      setTimeout(() => Speech.show(decision.speech), 300);
    }

    if (decision.moveTo) {
      // 이동 방법에 따라 다른 물리 동작 사용
      if (decision.moveTo.method === 'jump') {
        PetEngine.jumpTo(decision.moveTo.x, decision.moveTo.y);
      } else if (decision.moveTo.method === 'rappel') {
        PetEngine.startRappel();
      } else if (decision.moveTo.method === 'center') {
        PetEngine.moveToCenter();
      } else {
        PetEngine.setPosition(decision.moveTo.x, decision.moveTo.y);
      }
    }
  }

  /**
   * 감정 → 행동 매핑
   */
  function applyEmotion(emotion) {
    const emotionMap = {
      happy: 'excited',
      curious: 'walking',
      sleepy: 'sleeping',
      scared: 'scared',
      playful: 'playing',
      proud: 'excited',
      neutral: 'idle',
      focused: 'idle',
      affectionate: 'interacting',
    };

    const state = emotionMap[emotion] || 'idle';
    StateMachine.forceState(state);
  }

  // === 사용자 이벤트 → OpenClaw에 리포트 ===

  function reportClick(position) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('click', { position });
    }
  }

  function reportDrag(from, to) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('drag', { from, to });
    }
  }

  function reportCursorNear(distance) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('cursor_near', { distance });
    }
  }

  function reportDesktopChange(files) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('desktop_changed', { files });
    }
  }

  function isConnected() {
    return connected;
  }

  function isAutonomous() {
    return autonomousMode;
  }

  return {
    init, handleAICommand, isConnected, isAutonomous,
    reportClick, reportDrag, reportCursorNear, reportDesktopChange,
    executeDecision,
  };
})();
