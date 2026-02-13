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

      // === 커스텀 이동 패턴 ===

      case 'register_movement':
        // OpenClaw이 JSON으로 이동 패턴 정의를 보내면 등록
        // payload: { name, definition }
        // definition: { type, params } — 각 타입별 파라미터
        _registerAIMovement(payload.name, payload.definition);
        break;

      case 'custom_move':
        // 등록된 커스텀 이동 패턴 실행
        // payload: { name, params? }
        if (!PetEngine.executeCustomMovement(payload.name, payload.params || {})) {
          // 실행 실패 시 AI에 알림
          if (window.clawmate.reportToAI) {
            window.clawmate.reportToAI('custom_move_failed', {
              name: payload.name,
              available: PetEngine.getRegisteredMovements(),
            });
          }
        }
        break;

      case 'stop_custom_move':
        // 현재 커스텀 이동 강제 중지
        PetEngine.stopCustomMovement();
        break;

      case 'list_movements':
        // 등록된 이동 패턴 목록 요청
        if (window.clawmate.reportToAI) {
          window.clawmate.reportToAI('movement_list', {
            movements: PetEngine.getRegisteredMovements(),
          });
        }
        break;

      // === 캐릭터 커스터마이징 ===
      case 'set_character':
        // AI가 생성한 새 캐릭터 데이터 적용
        Character.setCharacterData(payload);
        if (payload.speech) {
          Speech.show(payload.speech);
        } else {
          Speech.show('변신 완료!');
        }
        StateMachine.forceState('excited');
        setTimeout(() => {
          if (StateMachine.getState() === 'excited') StateMachine.forceState('idle');
        }, 2000);
        break;

      case 'reset_character':
        // 원래 캐릭터로 복원
        Character.resetCharacter();
        Speech.show('원래 모습으로 돌아왔어!');
        StateMachine.forceState('excited');
        break;

      // === 스마트 파일 조작 애니메이션 ===
      case 'smart_file_op':
        handleSmartFileOp(payload);
        break;
    }
  }

  /**
   * 스마트 파일 조작 애니메이션 처리
   *
   * 텔레그램이나 AI에서 트리거된 파일 이동 작업의
   * 각 단계(phase)에 따라 펫 애니메이션을 순차 실행.
   *
   * phase:
   *   - start: 작업 시작, 총 파일 수 표시
   *   - pick_up: 파일 집어들기 (carrying 상태 + 말풍선)
   *   - drop: 파일 내려놓기 (걷기 상태 + 말풍선)
   *   - complete: 완료 (excited 상태 + 결과 말풍선)
   *   - error: 오류 (scared 상태 + 에러 말풍선)
   */
  function handleSmartFileOp(payload) {
    switch (payload.phase) {
      case 'start':
        StateMachine.forceState('excited');
        Speech.show(`${payload.totalFiles}개 파일 정리 시작!`);
        break;

      case 'pick_up':
        // 펫이 파일 위치로 이동 (화면 내 랜덤 위치)
        _smartFileJumpToSource(payload.index);
        // 집어들기 애니메이션
        setTimeout(() => {
          StateMachine.forceState('carrying');
          Speech.show(`${payload.fileName} 집었다!`);
        }, 400);
        break;

      case 'drop':
        // 대상 폴더 위치로 이동
        _smartFileJumpToTarget(payload.index);
        // 내려놓기 애니메이션
        setTimeout(() => {
          StateMachine.forceState('walking');
          Speech.show(`여기! (${payload.targetName})`);
        }, 400);
        break;

      case 'complete':
        StateMachine.forceState('excited');
        if (payload.movedCount > 0) {
          Speech.show(`${payload.movedCount}개 파일 옮겼어!`);
        } else {
          Speech.show('옮길 파일이 없었어!');
        }
        break;

      case 'error':
        StateMachine.forceState('scared');
        Speech.show('앗, 뭔가 잘못됐어...');
        break;
    }
  }

  /**
   * 파일 집어들기 위치로 점프
   * 파일 인덱스에 따라 화면 좌측 영역의 다른 위치로 이동
   */
  function _smartFileJumpToSource(index) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    // 화면 왼쪽 1/3 영역에서 세로 위치를 파일 인덱스에 따라 분산
    const targetX = screenW * 0.1 + (index % 3) * 50;
    const targetY = screenH * 0.3 + ((index * 80) % (screenH * 0.5));
    PetEngine.jumpTo(targetX, targetY);
  }

  /**
   * 파일 내려놓기 위치로 점프
   * 화면 오른쪽 영역으로 이동
   */
  function _smartFileJumpToTarget(index) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    // 화면 오른쪽 1/3 영역
    const targetX = screenW * 0.7 + (index % 3) * 50;
    const targetY = screenH * 0.4 + ((index * 60) % (screenH * 0.4));
    PetEngine.jumpTo(targetX, targetY);
  }

  /**
   * OpenClaw AI가 JSON으로 정의한 이동 패턴을 동적으로 등록
   * 안전한 실행을 위해 Function 생성자 대신 사전정의된 행동 유형 조합 사용
   *
   * definition 형식:
   * {
   *   type: 'waypoints' | 'formula' | 'sequence',
   *   waypoints?: [{x, y, pause?}],          // waypoints 타입
   *   formula?: { xExpr, yExpr },             // formula 타입 (sin, cos 기반)
   *   sequence?: ['zigzag', 'shake', ...],    // sequence 타입 (기존 패턴 순차 실행)
   *   duration?: number,
   *   speed?: number,
   * }
   */
  function _registerAIMovement(name, definition) {
    if (!name || !definition || !definition.type) {
      console.warn('[AIController] 이동 패턴 등록 실패: name, definition.type 필수');
      return;
    }

    let handler;

    switch (definition.type) {
      // 웨이포인트 타입: 지정된 좌표들을 순서대로 이동
      case 'waypoints':
        handler = {
          init(params) {
            return {
              waypoints: definition.waypoints || [],
              currentIdx: 0,
              speed: definition.speed || 2,
              pauseTime: 0,
              pausing: false,
            };
          },
          update(dt, state, ctx) {
            if (state.currentIdx >= state.waypoints.length) return;

            const wp = state.waypoints[state.currentIdx];

            // 웨이포인트에서 멈춤 중
            if (state.pausing) {
              state.pauseTime -= dt;
              if (state.pauseTime <= 0) {
                state.pausing = false;
                state.currentIdx++;
              }
              return;
            }

            const dx = wp.x - ctx.x;
            const dy = wp.y - ctx.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 5) {
              // 웨이포인트 도달
              if (wp.pause && wp.pause > 0) {
                state.pausing = true;
                state.pauseTime = wp.pause;
              } else {
                state.currentIdx++;
              }
              return;
            }

            const step = state.speed * (dt / 16);
            const ratio = Math.min(1, step / dist);
            ctx.setPos(ctx.x + dx * ratio, ctx.y + dy * ratio);
            ctx.setFlip(dx < 0);
          },
          isComplete(state) {
            return state.currentIdx >= (state.waypoints || []).length;
          },
          cleanup() {},
        };
        break;

      // 수식 타입: sin/cos 기반 수학적 궤도
      case 'formula':
        handler = {
          init(params) {
            return {
              duration: definition.duration || 3000,
              elapsed: 0,
              originX: params.x,
              originY: params.y,
              xAmp: definition.formula?.xAmp || 50,
              yAmp: definition.formula?.yAmp || 30,
              xFreq: definition.formula?.xFreq || 1,
              yFreq: definition.formula?.yFreq || 1,
              xPhase: definition.formula?.xPhase || 0,
              yPhase: definition.formula?.yPhase || 0,
            };
          },
          update(dt, state, ctx) {
            state.elapsed += dt;
            const t = (state.elapsed / state.duration) * Math.PI * 2;
            const nx = state.originX + Math.sin(t * state.xFreq + state.xPhase) * state.xAmp;
            const ny = state.originY + Math.sin(t * state.yFreq + state.yPhase) * state.yAmp;
            ctx.setPos(nx, ny);
            ctx.setFlip(Math.cos(t * state.xFreq + state.xPhase) < 0);
          },
          isComplete(state) {
            return state.elapsed >= state.duration;
          },
          cleanup() {},
        };
        break;

      // 시퀀스 타입: 기존 등록된 패턴들을 순차 실행
      case 'sequence':
        handler = {
          init(params) {
            return {
              sequence: definition.sequence || [],
              currentIdx: 0,
              subStarted: false,
            };
          },
          update(dt, state, ctx) {
            if (state.currentIdx >= state.sequence.length) return;

            if (!state.subStarted) {
              const subName = state.sequence[state.currentIdx];
              // 서브 패턴을 직접 실행하지 않고 상태만 추적
              PetEngine.executeCustomMovement(subName, {
                x: ctx.x, y: ctx.y,
                screenW: ctx.screenW, screenH: ctx.screenH,
              });
              state.subStarted = true;
            }
          },
          isComplete(state) {
            return state.currentIdx >= (state.sequence || []).length;
          },
          cleanup() {},
        };
        break;

      default:
        console.warn(`[AIController] 알 수 없는 이동 패턴 타입: ${definition.type}`);
        return;
    }

    PetEngine.registerMovement(name, handler);
    console.log(`[AIController] AI 이동 패턴 등록됨: ${name} (${definition.type})`);
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
