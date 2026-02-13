/**
 * 핵심 이동/물리 엔진 (리뉴얼)
 * requestAnimationFrame 기반 — 스텝 이동 + 점프 + 레펠 + 중력 낙하
 *
 * 이동 모드:
 *   crawling   — 표면 위에서 한발자국씩 기어가는 이동
 *   jumping    — 포물선 궤도 점프
 *   falling    — 중력에 의한 자유 낙하
 *   rappelling — 실(thread)을 타고 진자운동하며 하강
 */
const PetEngine = (() => {
  // --- 물리 상수 ---
  const GRAVITY = 0.3;        // 중력 가속도 (px/frame^2)
  const STEP_SIZE = 4;        // 한 걸음 크기 (px)
  const JUMP_VX = 3;          // 점프 수평 초기 속도
  const JUMP_VY = -7;         // 점프 수직 초기 속도 (위로)
  const BOUNCE_FACTOR = 0.3;  // 착지 바운스 계수
  const CHAR_SIZE = 64;       // 캐릭터 크기 (px)
  const ANIM_INTERVAL = 150;  // 애니메이션 프레임 전환 간격 (ms) — 부드러운 전환
  const THREAD_SPEED = 0.8;   // 레펠 하강 속도 (px/frame)

  // --- 위치 및 속도 ---
  let x = 0, y = 0;
  let vx = 0, vy = 0;         // 현재 속도 벡터

  // --- 표면/방향 ---
  let edge = 'bottom';        // 현재 부착된 가장자리 (bottom, left, right, top, surface)
  let direction = 1;           // 이동 방향: 1=오른쪽/아래, -1=왼쪽/위
  let flipX = false;           // 캐릭터 좌우 반전 여부
  let prevFlipX = false;       // 이전 프레임 flipX (전환 감지용)
  let flipTransition = 0;      // flipX 전환 진행도 (0~1, 1이면 완료)
  const FLIP_DURATION = 120;   // flipX 전환 시간 (ms)
  let flipStartTime = 0;       // flipX 전환 시작 시각
  let screenW, screenH;

  // --- 엔진 상태 ---
  let running = false;
  let petContainer = null;
  let speedMultiplier = 1.0;
  let animFrame = 0;
  let lastAnimTime = 0;
  let animFrameChanged = false;  // 애니메이션 프레임 전환 플래그 (이동과 동기화)

  // --- 이동 모드 ---
  let movementMode = 'crawling';  // crawling | jumping | falling | rappelling
  let onSurface = true;           // 표면 위에 있는지 여부

  // --- 스텝 시스템 (애니메이션 프레임 동기화) ---

  // --- 레펠(thread) 시스템 ---
  // 부착점에서 실을 내려 진자운동하며 하강
  let thread = null;  // { attachX, attachY, length, angle, swingVel } | null

  // --- 윈도우 표면 목록 ---
  // 외부 윈도우의 타이틀바 등을 추가 표면으로 등록
  let windowSurfaces = [];  // [{ id, x, y, width, height }]

  // --- 착지 시 현재 올라가 있는 표면 참조 ---
  let currentSurface = null;

  /**
   * 초기화: 컨테이너 설정 및 화면 하단 중앙 배치
   */
  function init(container) {
    petContainer = container;
    screenW = window.innerWidth;
    screenH = window.innerHeight;

    // 화면 하단 중앙에서 시작
    x = (screenW - CHAR_SIZE) / 2;
    y = screenH - CHAR_SIZE;
    edge = 'bottom';
    direction = 1;
    movementMode = 'crawling';
    onSurface = true;
    currentSurface = null;
    updateVisual();

    // 화면 크기 변경 대응
    window.addEventListener('resize', () => {
      screenW = window.innerWidth;
      screenH = window.innerHeight;
      clampPosition();
      updateVisual();
    });
  }

  /**
   * 속도 배율 설정 (성격/진화 단계에 따른 속도 조절)
   */
  function setSpeedMultiplier(mult) {
    speedMultiplier = mult;
  }

  /**
   * 화면 경계 내로 위치 제한
   */
  function clampPosition() {
    x = Math.max(0, Math.min(x, screenW - CHAR_SIZE));
    y = Math.max(0, Math.min(y, screenH - CHAR_SIZE));
  }

  // ===================================
  //  시각적 업데이트
  // ===================================

  /**
   * 컨테이너 위치 및 회전/반전 업데이트
   * 가장자리별로 캐릭터가 올바른 방향을 향하도록 transform 적용
   *
   * EDGE_OFFSET: 스프라이트 테두리의 빈 픽셀(4px)을 보정하여
   * 다리가 실제로 벽면/바닥/천장에 밀착하도록 렌더링 위치 조정
   */
  const EDGE_OFFSET = 4;

  function updateVisual() {
    if (!petContainer) return;

    // --- flipX 부드러운 전환 처리 ---
    if (flipX !== prevFlipX) {
      // 방향이 바뀌었으면 전환 시작
      flipStartTime = Date.now();
      flipTransition = 0;
      prevFlipX = flipX;
    }
    if (flipTransition < 1) {
      const elapsed = Date.now() - flipStartTime;
      flipTransition = Math.min(1, elapsed / FLIP_DURATION);
    }

    // 전환 중일 때 CSS transition 적용
    if (flipTransition < 1) {
      petContainer.style.transition = `transform ${FLIP_DURATION}ms ease-in-out`;
    } else {
      petContainer.style.transition = 'none';
    }

    let renderX = x;
    let renderY = y;

    // 표면에 붙어있을 때만 오프셋 적용 (공중 상태에서는 불필요)
    if (onSurface && movementMode === 'crawling') {
      switch (edge) {
        case 'bottom':
        case 'surface':
          renderY += EDGE_OFFSET;  // 바닥: 다리를 아래로 밀착
          break;
        case 'top':
          renderY -= EDGE_OFFSET;  // 천장: 다리를 위로 밀착
          break;
        case 'left':
          renderX -= EDGE_OFFSET;  // 왼쪽 벽: 다리를 왼쪽으로 밀착
          break;
        case 'right':
          renderX += EDGE_OFFSET;  // 오른쪽 벽: 다리를 오른쪽으로 밀착
          break;
      }
    }

    petContainer.style.left = renderX + 'px';
    petContainer.style.top = renderY + 'px';

    let transform = '';

    if (movementMode === 'rappelling' || movementMode === 'jumping' || movementMode === 'falling') {
      // 공중 상태: 바닥 기준 기본 자세 (회전 없음)
      if (flipX) transform = 'scaleX(-1)';
    } else if (edge === 'left') {
      // 왼쪽 벽: 다리가 왼쪽 가장자리를 향하도록 반시계 회전
      transform = 'rotate(-90deg)';
      if (flipX) transform += ' scaleX(-1)';
    } else if (edge === 'right') {
      // 오른쪽 벽: 다리가 오른쪽 가장자리를 향하도록 시계 회전
      transform = 'rotate(90deg)';
      if (flipX) transform += ' scaleX(-1)';
    } else if (edge === 'top') {
      // 천장: 다리가 위를 향하도록 상하 반전
      transform = 'scaleY(-1)';
      if (flipX) transform += ' scaleX(-1)';
    } else {
      // 바닥/표면: 기본 자세
      if (flipX) transform = 'scaleX(-1)';
    }

    petContainer.style.transform = transform || 'none';

    // 레펠 스레드 시각화 갱신
    updateThreadVisual();
  }

  /**
   * SVG 라인으로 레펠 실(thread) 시각화
   * thread가 없으면 숨기고, 있으면 부착점 → 캐릭터 상단 연결
   */
  function updateThreadVisual() {
    const line = document.getElementById('thread-line');
    if (!line) return;

    if (!thread) {
      // 실이 없으면 숨김
      line.setAttribute('x1', '0');
      line.setAttribute('y1', '0');
      line.setAttribute('x2', '0');
      line.setAttribute('y2', '0');
      line.style.display = 'none';
      return;
    }

    // 부착점에서 캐릭터 상단 중앙까지 실 표시
    line.style.display = 'block';
    line.setAttribute('x1', thread.attachX);
    line.setAttribute('y1', thread.attachY);
    line.setAttribute('x2', x + CHAR_SIZE / 2);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#888');
    line.setAttribute('stroke-width', '1');
  }

  // ===================================
  //  스텝 기반 이동 (뚝뚝 끊어 걷기)
  // ===================================

  /**
   * 스텝 이동: 애니메이션 프레임 전환 시에만 한 걸음 이동
   * 다리 움직임(프레임 변화)과 실제 위치 이동이 1:1 동기화되어
   * 다리가 움직일 때만 몸이 이동하는 자연스러운 보행 구현
   *
   * @param {number} stepScale - 스텝 크기 배율 (0.6 = 짐 들고 느리게, 1.0 = 기본)
   */
  function stepMove(stepScale) {
    // 애니메이션 프레임이 바뀌지 않았으면 이동 안 함
    if (!animFrameChanged) return;

    // 한 걸음 전진
    const stepDist = STEP_SIZE * stepScale * speedMultiplier;

    if (edge === 'bottom' || edge === 'top' || edge === 'surface') {
      // 수평 이동 (바닥, 천장, 윈도우 표면)
      x += stepDist * direction;
      flipX = direction < 0;
    } else if (edge === 'left') {
      // 왼쪽 벽: y축 이동 (direction=1이면 아래로, -1이면 위로)
      y += stepDist * direction;
    } else if (edge === 'right') {
      // 오른쪽 벽: y축 이동
      y += stepDist * direction;
    }
  }

  // ===================================
  //  윈도우 표면 탐지
  // ===================================

  /**
   * 주어진 위치 아래에 있는 윈도우 표면을 찾음
   * 캐릭터가 수평 범위 안에 있고, 표면 상단 근처에 있을 때 착지 가능
   *
   * @param {number} px - 캐릭터 x 좌표
   * @param {number} py - 캐릭터 하단 y 좌표 (y + CHAR_SIZE)
   * @returns {object|null} 착지 가능한 표면 또는 null
   */
  function findSurfaceBelow(px, py) {
    let closest = null;
    let closestDist = Infinity;

    for (const s of windowSurfaces) {
      // 수평 범위 확인: 캐릭터가 표면 위에 겹치는지
      if (px + CHAR_SIZE > s.x && px < s.x + s.width) {
        // 표면 상단에 근접했는지 (위에서 떨어지는 중)
        if (py >= s.y && py <= s.y + 10) {
          const dist = Math.abs(py - s.y);
          if (dist < closestDist) {
            closestDist = dist;
            closest = s;
          }
        }
      }
    }
    return closest;
  }

  /**
   * 외부에서 윈도우 표면 목록 등록
   * (예: 다른 창의 타이틀바를 걸어다닐 수 있는 표면으로 설정)
   *
   * @param {Array} surfaces - [{ id, x, y, width, height }]
   */
  function setSurfaces(surfaces) {
    windowSurfaces = surfaces || [];
  }

  // ===================================
  //  물리 상태별 이동 처리
  // ===================================

  /**
   * 메인 이동 로직: movementMode에 따라 물리 연산 수행
   *
   * @param {string} state - StateMachine의 현재 상태 (walking, idle 등)
   */
  function moveForState(state) {
    switch (movementMode) {

      // --- 포물선 점프 ---
      case 'jumping':
        vy += GRAVITY;  // 중력 적용
        x += vx;
        y += vy;
        flipX = vx < 0;

        // 바닥 착지 감지
        if (y >= screenH - CHAR_SIZE) {
          y = screenH - CHAR_SIZE;
          // 바운스 효과: 약간 튕김
          if (Math.abs(vy) > 2) {
            vy = -vy * BOUNCE_FACTOR;
          } else {
            edge = 'bottom';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = null;
            vx = 0;
            vy = 0;
          }
        }

        // 윈도우 표면 착지 감지 (아래로 떨어지는 중일 때만)
        if (vy > 0 && movementMode === 'jumping') {
          const landSurface = findSurfaceBelow(x, y + CHAR_SIZE);
          if (landSurface) {
            y = landSurface.y - CHAR_SIZE;
            edge = 'surface';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = landSurface;
            vx = 0;
            vy = 0;
          }
        }

        // 벽/천장 충돌 → 해당 가장자리에 붙음
        if (x <= 0 && movementMode === 'jumping') {
          x = 0;
          edge = 'left';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vx = 0;
          vy = 0;
          direction = 1; // 아래쪽 방향
        }
        if (x >= screenW - CHAR_SIZE && movementMode === 'jumping') {
          x = screenW - CHAR_SIZE;
          edge = 'right';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vx = 0;
          vy = 0;
          direction = 1;
        }
        if (y <= 0 && movementMode === 'jumping') {
          y = 0;
          edge = 'top';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vx = 0;
          vy = 0;
          direction = 1; // 오른쪽 방향
        }
        break;

      // --- 자유 낙하 (중력) ---
      case 'falling':
        vy += GRAVITY;
        y += vy;

        // 윈도우 표면 착지 감지
        if (vy > 0) {
          const fallSurface = findSurfaceBelow(x, y + CHAR_SIZE);
          if (fallSurface) {
            y = fallSurface.y - CHAR_SIZE;
            edge = 'surface';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = fallSurface;
            vy = 0;
          }
        }

        // 바닥 착지
        if (y >= screenH - CHAR_SIZE) {
          y = screenH - CHAR_SIZE;
          edge = 'bottom';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vy = 0;
        }
        break;

      // --- 레펠: 실을 타고 진자운동하며 하강 ---
      case 'rappelling':
        if (thread) {
          // 실 길이 증가 → 하강
          thread.length += THREAD_SPEED * speedMultiplier;

          // 진자 흔들림 물리
          thread.swingVel += Math.sin(thread.angle) * 0.01;
          thread.swingVel *= 0.98; // 감쇠

          thread.angle += thread.swingVel;

          // 부착점 기준 진자 위치 계산
          x = thread.attachX + Math.sin(thread.angle) * thread.length - CHAR_SIZE / 2;
          y = thread.attachY + Math.cos(thread.angle) * thread.length;

          // 좌우 화면 경계 반사
          if (x <= 0) {
            x = 0;
            thread.swingVel = Math.abs(thread.swingVel) * 0.5;
          }
          if (x >= screenW - CHAR_SIZE) {
            x = screenW - CHAR_SIZE;
            thread.swingVel = -Math.abs(thread.swingVel) * 0.5;
          }

          // 윈도우 표면 착지 감지
          const rappelSurface = findSurfaceBelow(x, y + CHAR_SIZE);
          if (rappelSurface) {
            y = rappelSurface.y - CHAR_SIZE;
            thread = null;
            edge = 'surface';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = rappelSurface;
          }

          // 바닥 도달
          if (y >= screenH - CHAR_SIZE) {
            y = screenH - CHAR_SIZE;
            thread = null;
            edge = 'bottom';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = null;
          }
        }
        break;

      // --- 표면 위 기어가기 (스텝 기반) ---
      case 'crawling':
      default:
        switch (state) {
          case 'walking':
          case 'ceiling_walk':
            stepMove(1.0);

            // 수평 이동 시 경계 처리
            if (edge === 'bottom' || edge === 'top') {
              if (x <= 0) { x = 0; direction = 1; }
              if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
            }

            // 윈도우 표면 위 이동 시 가장자리에서 떨어짐
            if (edge === 'surface' && currentSurface) {
              if (x <= currentSurface.x - CHAR_SIZE / 2 ||
                  x >= currentSurface.x + currentSurface.width - CHAR_SIZE / 2) {
                // 표면 가장자리에서 떨어짐 → 낙하 모드
                movementMode = 'falling';
                onSurface = false;
                currentSurface = null;
                vy = 0;
                StateMachine.forceState('falling');
              }
            }
            break;

          case 'climbing_up':
            if (edge === 'bottom' || edge === 'surface') {
              // 바닥/표면에서 벽으로 전환
              if (direction > 0) {
                x = screenW - CHAR_SIZE;
                edge = 'right';
              } else {
                x = 0;
                edge = 'left';
              }
              currentSurface = null;
              direction = -1; // 벽에서 위쪽 방향
            }

            // 벽에서 위로 기어오름: y 감소
            if (edge === 'left' || edge === 'right') {
              stepMove(0.7);
              // stepMove가 direction(-1)을 적용하므로 y가 감소함
            }

            // 천장 도달
            if (y <= 0) {
              y = 0;
              edge = 'top';
              direction = 1; // 천장에서 오른쪽으로 이동
            }
            break;

          case 'climbing_down':
            // 벽에서 아래로 기어내려감: y 증가
            if (edge === 'left' || edge === 'right') {
              // direction을 1(아래)로 설정해서 stepMove
              const prevDir = direction;
              direction = 1;
              stepMove(0.7);
              direction = prevDir;
            } else if (edge === 'top') {
              // 천장에서 벽으로 내려가기 시작
              if (x < screenW / 2) {
                x = 0;
                edge = 'left';
              } else {
                x = screenW - CHAR_SIZE;
                edge = 'right';
              }
              direction = 1; // 아래 방향
            }

            // 바닥 도달
            if (y >= screenH - CHAR_SIZE) {
              y = screenH - CHAR_SIZE;
              edge = 'bottom';
              direction = Math.random() < 0.5 ? 1 : -1; // 랜덤 방향
            }
            break;

          case 'scared':
            // 도망: 스텝 스킵하고 빠르게 연속 이동
            if (edge === 'bottom' || edge === 'top' || edge === 'surface') {
              x += STEP_SIZE * 2.5 * direction * speedMultiplier;
              flipX = direction < 0;
              if (x <= 0) { x = 0; direction = 1; }
              if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
            }
            break;

          case 'carrying':
            // 짐 들고 느리게 이동
            stepMove(0.6);
            if (edge === 'bottom' || edge === 'top' || edge === 'surface') {
              if (x <= 0) { x = 0; direction = 1; }
              if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
            }
            break;

          case 'excited':
            // 작은 점프 효과 (제자리에서 통통 뜀)
            if (typeof StateMachine !== 'undefined') {
              const elapsed = StateMachine.getElapsed();
              const jumpOffset = Math.sin(elapsed / 150) * 8;
              if (edge === 'bottom') {
                y = (screenH - CHAR_SIZE) + jumpOffset;
              } else if (edge === 'surface' && currentSurface) {
                y = (currentSurface.y - CHAR_SIZE) + jumpOffset;
              }
            }
            break;

          // 점프 중 상태 (StateMachine에서 전이된 물리 상태)
          case 'jumping':
            // movementMode가 jumping이 아니면 시작
            if (movementMode === 'crawling') {
              _initiateRandomJump();
            }
            break;

          // 레펠 중 상태
          case 'rappelling':
            if (movementMode === 'crawling') {
              startRappel();
            }
            break;

          // 낙하 중 상태
          case 'falling':
            if (movementMode === 'crawling') {
              movementMode = 'falling';
              onSurface = false;
              vy = 0;
            }
            break;

          // 커스텀 이동 패턴 실행 중
          case 'custom':
            if (activeCustomMovement) {
              updateCustomMovement(now - (updateCustomMovement._lastTime || now));
              updateCustomMovement._lastTime = now;
            }
            break;

          case 'idle':
          case 'sleeping':
          case 'interacting':
          case 'playing':
            // 정지 또는 미세한 흔들림 (이동 없음)
            break;
        }
        break;
    }

    clampPosition();
    updateVisual();
  }

  /**
   * StateMachine이 jumping 상태로 전이했을 때 랜덤 목표로 점프
   * 현재 위치 기준 화면 중앙 방향 또는 랜덤 위치로 도약
   */
  function _initiateRandomJump() {
    // 화면 중앙 근처의 랜덤 목표 지점
    const targetX = screenW * 0.2 + Math.random() * screenW * 0.6;
    const targetY = screenH * 0.3 + Math.random() * screenH * 0.4;
    jumpTo(targetX, targetY);
  }

  // ===================================
  //  점프 명령
  // ===================================

  /**
   * 목표 지점을 향해 포물선 점프 시작
   * 초기 속도(vx, vy)를 계산하여 포물선 궤도 생성
   *
   * @param {number} targetX - 목표 x 좌표
   * @param {number} targetY - 목표 y 좌표
   */
  function jumpTo(targetX, targetY) {
    if (movementMode !== 'crawling') return;

    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.hypot(dx, dy);

    // 비행 시간 추정 (거리 기반)
    const time = Math.max(20, dist / (JUMP_VX * 2 + 2));

    // 포물선 초기 속도 계산
    vx = dx / time;
    vy = (dy / time) - (GRAVITY * time) / 2;

    // vx, vy 범위 제한 (너무 빠르지 않게)
    const maxV = 8;
    vx = Math.max(-maxV, Math.min(maxV, vx));
    vy = Math.max(-12, Math.min(maxV, vy));

    movementMode = 'jumping';
    onSurface = false;
    currentSurface = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('jumping');
    }
  }

  // ===================================
  //  레펠(Thread) 시스템
  // ===================================

  /**
   * 레펠 시작: 천장이나 벽에서 실을 내려 하강
   * 부착점을 현재 위치에 설정하고 진자운동 시작
   */
  function startRappel() {
    // 천장, 왼쪽 벽, 오른쪽 벽에서만 레펠 가능
    if (edge !== 'top' && edge !== 'left' && edge !== 'right') return;

    let attachX, attachY;

    if (edge === 'top') {
      // 천장에서 레펠: 현재 위치 바로 위에 부착
      attachX = x + CHAR_SIZE / 2;
      attachY = 0;
    } else if (edge === 'left') {
      // 왼쪽 벽에서 레펠: 벽의 현재 y 위치에 부착
      attachX = 0;
      attachY = y;
    } else {
      // 오른쪽 벽에서 레펠
      attachX = screenW;
      attachY = y;
    }

    thread = {
      attachX: attachX,
      attachY: attachY,
      length: CHAR_SIZE,                        // 초기 실 길이
      angle: 0,                                  // 진자 각도 (라디안)
      swingVel: (Math.random() - 0.5) * 0.05,   // 초기 흔들림 속도
    };

    movementMode = 'rappelling';
    onSurface = false;
    currentSurface = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('rappelling');
    }
  }

  /**
   * 레펠 해제: 실을 놓아 자유 낙하 전환
   */
  function releaseThread() {
    if (!thread) return;
    thread = null;
    vy = 0;
    movementMode = 'falling';
    onSurface = false;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('falling');
    }
  }

  /**
   * 화면 중앙으로 이동
   * 천장에서는 레펠로 하강, 그 외에는 점프
   */
  function moveToCenter() {
    const cx = (screenW - CHAR_SIZE) / 2;
    const cy = (screenH - CHAR_SIZE) / 2;

    if (edge === 'top') {
      // 천장에서는 레펠로 내려감
      startRappel();
    } else {
      // 바닥/벽에서는 중앙으로 점프
      jumpTo(cx, cy);
    }
  }

  // ===================================
  //  애니메이션 프레임 갱신
  // ===================================

  /**
   * 현재 상태에 맞는 애니메이션 프레임 렌더링
   * 공중 상태일 때는 기존 프레임셋을 재활용
   *
   * @param {string} state     - StateMachine 상태
   * @param {number} timestamp - requestAnimationFrame 타임스탬프
   */
  function updateAnimation(state, timestamp) {
    if (timestamp - lastAnimTime > ANIM_INTERVAL) {
      animFrame++;
      lastAnimTime = timestamp;
      animFrameChanged = true;  // 이동 시스템에 프레임 전환 알림
    }

    // 이동 모드에 따라 적절한 프레임셋으로 매핑
    let effectiveState = state;
    if (movementMode === 'jumping') effectiveState = 'jumping';
    if (movementMode === 'falling') effectiveState = 'falling';
    if (movementMode === 'rappelling') effectiveState = 'rappelling';

    const frameCount = Character.getFrameCount(effectiveState);
    const currentFrame = animFrame % frameCount;
    Character.renderFrame(effectiveState, currentFrame, flipX);
  }

  // ===================================
  //  위치/상태 접근자
  // ===================================

  /**
   * 현재 위치 및 상태 정보 반환
   * @returns {{ x, y, edge, direction, flipX, movementMode, onSurface, thread }}
   */
  function getPosition() {
    return {
      x, y, edge, direction, flipX,
      movementMode, onSurface,
      thread: thread ? true : false,
    };
  }

  /**
   * 위치 직접 설정 (드래그 등)
   */
  function setPosition(nx, ny) {
    x = nx;
    y = ny;
    clampPosition();
    updateVisual();
  }

  function setEdge(newEdge) {
    edge = newEdge;
  }

  function setDirection(dir) {
    direction = dir;
    flipX = dir < 0;
  }

  /**
   * 가장 가까운 가장자리로 즉시 이동 (드래그 후)
   * 모든 물리 상태를 초기화하고 표면에 붙음
   */
  function snapToNearestEdge() {
    const distBottom = screenH - CHAR_SIZE - y;
    const distTop = y;
    const distLeft = x;
    const distRight = screenW - CHAR_SIZE - x;
    const minDist = Math.min(distBottom, distTop, distLeft, distRight);

    if (minDist === distBottom) {
      y = screenH - CHAR_SIZE;
      edge = 'bottom';
    } else if (minDist === distTop) {
      y = 0;
      edge = 'top';
    } else if (minDist === distLeft) {
      x = 0;
      edge = 'left';
    } else {
      x = screenW - CHAR_SIZE;
      edge = 'right';
    }

    // 물리 상태 완전 초기화
    movementMode = 'crawling';
    onSurface = true;
    currentSurface = null;
    vx = 0;
    vy = 0;
    thread = null;

    updateVisual();
  }

  /**
   * 자유 낙하 시작 (화면 중앙 근처에서 놓았을 때)
   * 중력에 의해 바닥 또는 가장 가까운 표면으로 떨어짐
   */
  function startFalling() {
    movementMode = 'falling';
    onSurface = false;
    currentSurface = null;
    vx = 0;
    vy = 0;
    thread = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('falling');
    }
  }

  /**
   * 레펠 스레드 정보 반환
   * @returns {object|null}
   */
  function getThread() {
    return thread;
  }

  // ===================================
  //  커스텀 이동 패턴 레지스트리
  // ===================================

  // 등록된 커스텀 이동 패턴 저장소
  // 각 핸들러: { init(params), update(deltaTime), isComplete(), cleanup() }
  let customMovements = {};
  let activeCustomMovement = null;  // 현재 실행 중인 커스텀 이동 { name, handler, state }

  /**
   * 커스텀 이동 패턴 등록
   * @param {string} name - 패턴 이름 (예: 'zigzag', 'patrol')
   * @param {object} handler - { init, update, isComplete, cleanup }
   */
  function registerMovement(name, handler) {
    if (!handler || typeof handler.update !== 'function') {
      console.error(`[PetEngine] 이동 패턴 '${name}' 등록 실패: update 함수 필수`);
      return false;
    }
    // 기본 메서드 보완
    handler.init = handler.init || (() => {});
    handler.isComplete = handler.isComplete || (() => false);
    handler.cleanup = handler.cleanup || (() => {});
    customMovements[name] = handler;
    console.log(`[PetEngine] 커스텀 이동 패턴 등록: ${name}`);
    return true;
  }

  /**
   * 등록된 커스텀 이동 패턴 제거
   * @param {string} name - 패턴 이름
   */
  function unregisterMovement(name) {
    if (activeCustomMovement && activeCustomMovement.name === name) {
      stopCustomMovement();
    }
    delete customMovements[name];
  }

  /**
   * 커스텀 이동 패턴 실행
   * @param {string} name - 등록된 패턴 이름
   * @param {object} params - 패턴 초기화 파라미터
   * @returns {boolean} 실행 성공 여부
   */
  function executeCustomMovement(name, params = {}) {
    const handler = customMovements[name];
    if (!handler) {
      console.warn(`[PetEngine] 미등록 이동 패턴: ${name}`);
      return false;
    }

    // 기존 커스텀 이동이 있으면 정리
    if (activeCustomMovement) {
      activeCustomMovement.handler.cleanup();
    }

    // 패턴 초기화 시 현재 위치/화면 정보 전달
    const context = {
      x, y, screenW, screenH,
      charSize: CHAR_SIZE,
      direction, edge, flipX,
    };

    const state = handler.init(Object.assign({}, params, context)) || {};
    activeCustomMovement = { name, handler, state };

    // CUSTOM 상태로 전환
    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('custom');
    }

    console.log(`[PetEngine] 커스텀 이동 실행: ${name}`);
    return true;
  }

  /**
   * 커스텀 이동 매 프레임 갱신
   * @param {number} deltaTime - 프레임 간 경과 시간 (ms)
   */
  function updateCustomMovement(deltaTime) {
    if (!activeCustomMovement) return;

    const { handler, state } = activeCustomMovement;
    const context = {
      x, y, screenW, screenH,
      charSize: CHAR_SIZE,
      direction, edge, flipX,
      setPos: (nx, ny) => { x = nx; y = ny; },
      setFlip: (f) => { flipX = f; },
      setDir: (d) => { direction = d; },
    };

    handler.update(deltaTime, state, context);

    // 핸들러가 setPos로 위치를 설정했을 수 있음
    clampPosition();

    // 완료 확인
    if (handler.isComplete(state)) {
      stopCustomMovement();
    }
  }

  /**
   * 현재 커스텀 이동 강제 중지 → IDLE 복귀
   */
  function stopCustomMovement() {
    if (!activeCustomMovement) return;
    activeCustomMovement.handler.cleanup(activeCustomMovement.state);
    activeCustomMovement = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('idle');
    }
  }

  /**
   * 등록된 커스텀 이동 패턴 목록 반환
   */
  function getRegisteredMovements() {
    return Object.keys(customMovements);
  }

  // --- 사전 등록 이동 패턴 ---

  // 지그재그: 대각선 방향 교대로 이동
  registerMovement('zigzag', {
    init(params) {
      return {
        amplitude: params.amplitude || 40,     // 좌우 진폭 (px)
        speed: params.speed || 2,              // 전진 속도
        segmentLength: params.segmentLength || 60, // 한 구간 길이
        traveled: 0,
        totalDistance: params.distance || 300,  // 총 이동 거리
        zigDir: 1,                             // 지그재그 방향
        startX: params.x,
        startY: params.y,
      };
    },
    update(dt, state, ctx) {
      const step = state.speed * (dt / 16);
      state.traveled += step;

      // 수평 전진
      const moveX = step * (ctx.direction || 1);
      // 수직 지그재그
      const segProgress = (state.traveled % state.segmentLength) / state.segmentLength;
      if (segProgress < 0.05) state.zigDir *= -1;
      const moveY = state.zigDir * step * 0.7;

      ctx.setPos(ctx.x + moveX, ctx.y + moveY);
      ctx.setFlip(moveX < 0);
    },
    isComplete(state) {
      return state.traveled >= state.totalDistance;
    },
    cleanup() {},
  });

  // 순찰: 두 지점 사이를 왕복
  registerMovement('patrol', {
    init(params) {
      return {
        pointA: { x: params.pointAX || 100, y: params.pointAY || params.y },
        pointB: { x: params.pointBX || params.screenW - 164, y: params.pointBY || params.y },
        speed: params.speed || 1.5,
        laps: params.laps || 3,                // 왕복 횟수
        currentLap: 0,
        targetIdx: 0,                          // 0=A, 1=B
      };
    },
    update(dt, state, ctx) {
      const target = state.targetIdx === 0 ? state.pointA : state.pointB;
      const dx = target.x - ctx.x;
      const dy = target.y - ctx.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 5) {
        // 목표 도달 → 방향 전환
        state.targetIdx = 1 - state.targetIdx;
        if (state.targetIdx === 0) state.currentLap++;
        return;
      }

      const step = state.speed * (dt / 16);
      const ratio = step / dist;
      ctx.setPos(ctx.x + dx * ratio, ctx.y + dy * ratio);
      ctx.setFlip(dx < 0);
    },
    isComplete(state) {
      return state.currentLap >= state.laps;
    },
    cleanup() {},
  });

  // 원형 회전: 중심점 기준 회전
  registerMovement('circle', {
    init(params) {
      return {
        centerX: params.centerX || params.x,
        centerY: params.centerY || params.y - 50,
        radius: params.radius || 50,
        speed: params.speed || 0.03,           // 각속도 (rad/frame)
        angle: 0,
        totalAngle: params.revolutions ? params.revolutions * Math.PI * 2 : Math.PI * 4,
        traveled: 0,
      };
    },
    update(dt, state, ctx) {
      const step = state.speed * (dt / 16);
      state.angle += step;
      state.traveled += Math.abs(step);

      const nx = state.centerX + Math.cos(state.angle) * state.radius;
      const ny = state.centerY + Math.sin(state.angle) * state.radius;
      ctx.setPos(nx, ny);
      ctx.setFlip(Math.sin(state.angle) < 0);
    },
    isComplete(state) {
      return state.traveled >= state.totalAngle;
    },
    cleanup() {},
  });

  // 떨기: 빠르게 좌우 진동
  registerMovement('shake', {
    init(params) {
      return {
        intensity: params.intensity || 4,      // 떨림 강도 (px)
        duration: params.duration || 800,       // 지속 시간 (ms)
        elapsed: 0,
        originX: params.x,
        originY: params.y,
        phase: 0,
      };
    },
    update(dt, state, ctx) {
      state.elapsed += dt;
      state.phase += dt * 0.05;

      // 감쇠하는 사인파 진동
      const decay = 1 - (state.elapsed / state.duration);
      const offsetX = Math.sin(state.phase) * state.intensity * decay;
      ctx.setPos(state.originX + offsetX, state.originY);
    },
    isComplete(state) {
      return state.elapsed >= state.duration;
    },
    cleanup() {},
  });

  // 댄스: 여러 동작을 연속 수행 (점프 + 회전 + 떨기 조합)
  registerMovement('dance', {
    init(params) {
      return {
        duration: params.duration || 3000,
        elapsed: 0,
        originX: params.x,
        originY: params.y,
        phase: 0,
      };
    },
    update(dt, state, ctx) {
      state.elapsed += dt;
      state.phase += dt * 0.004;

      const t = state.elapsed / state.duration;

      // 구간별 다른 동작
      if (t < 0.25) {
        // 구간 1: 좌우 스윙
        const swingX = Math.sin(state.phase * 8) * 20;
        ctx.setPos(state.originX + swingX, state.originY);
        ctx.setFlip(swingX < 0);
      } else if (t < 0.5) {
        // 구간 2: 상하 바운스
        const bounceY = Math.abs(Math.sin(state.phase * 6)) * -30;
        ctx.setPos(state.originX, state.originY + bounceY);
      } else if (t < 0.75) {
        // 구간 3: 작은 원
        const angle = state.phase * 10;
        ctx.setPos(
          state.originX + Math.cos(angle) * 15,
          state.originY + Math.sin(angle) * 15
        );
        ctx.setFlip(Math.cos(angle) < 0);
      } else {
        // 구간 4: 빠른 좌우 떨기 (피니시)
        const shake = Math.sin(state.phase * 20) * 6 * (1 - t);
        ctx.setPos(state.originX + shake, state.originY);
      }
    },
    isComplete(state) {
      return state.elapsed >= state.duration;
    },
    cleanup() {},
  });

  // ===================================
  //  메인 루프
  // ===================================

  let frameId = null;

  /**
   * 엔진 시작: requestAnimationFrame 루프 가동
   */
  let lastLoopTimestamp = 0;  // 이전 루프 타임스탬프 (deltaTime 계산용)

  function start() {
    if (running) return;
    running = true;
    lastAnimTime = performance.now();
    lastLoopTimestamp = performance.now();

    function loop(timestamp) {
      if (!running) return;

      // 커스텀 이동용 deltaTime 계산
      const deltaTime = timestamp - lastLoopTimestamp;
      lastLoopTimestamp = timestamp;

      const state = StateMachine.update();

      // 애니메이션을 먼저 갱신 → animFrameChanged 플래그 설정
      updateAnimation(state, timestamp);

      // 커스텀 이동이 활성 상태이면 전용 업데이트 실행
      if (activeCustomMovement && state === 'custom') {
        updateCustomMovement(deltaTime);
        clampPosition();
        updateVisual();
      } else {
        moveForState(state);
      }

      // 프레임 전환 플래그 리셋 (다음 프레임까지 대기)
      animFrameChanged = false;
      frameId = requestAnimationFrame(loop);
    }
    frameId = requestAnimationFrame(loop);
  }

  /**
   * 엔진 정지
   */
  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
  }

  // --- 공개 API ---
  return {
    init, start, stop,
    getPosition, setPosition, setEdge, setDirection,
    snapToNearestEdge, setSpeedMultiplier,
    moveForState, updateAnimation,
    // 물리 기반 이동
    jumpTo, startRappel, releaseThread, moveToCenter,
    setSurfaces, getThread, startFalling,
    // 커스텀 이동 패턴 시스템
    registerMovement, unregisterMovement,
    executeCustomMovement, stopCustomMovement,
    getRegisteredMovements,
    CHAR_SIZE,
  };
})();
