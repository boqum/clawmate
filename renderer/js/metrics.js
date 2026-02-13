/**
 * 펫 동작 품질 실시간 계측기 (Self-Observation System)
 *
 * OpenClaw이 자신의 동작 품질을 관찰하고 계량할 수 있도록
 * 렌더러 측에서 다양한 메트릭을 수집하여 main process로 전송한다.
 *
 * 수집 메트릭:
 *   - frameRate: 실제 FPS (requestAnimationFrame 기반)
 *   - stateTransitions: 상태 전환 횟수/패턴 (최근 60초)
 *   - movementSmoothness: 이동 부드러움 (연속 위치 변화의 분산)
 *   - wallContactAccuracy: 벽면 밀착 정확도 (edge offset 효과)
 *   - interactionResponseTime: 클릭 → 반응까지 시간
 *   - animationFrameConsistency: 프레임 전환 일관성
 *   - idleRatio: 전체 시간 중 idle 비율
 *   - explorationCoverage: 화면 탐험 커버리지 (방문한 영역 비율)
 *   - speechFrequency: 말풍선 빈도
 *   - userEngagement: 사용자 상호작용 빈도
 *
 * 성능 주의:
 *   - requestAnimationFrame 루프에 직접 개입하지 않음
 *   - 가벼운 샘플링 방식 (매 프레임 수집 X, 주기적 폴링 O)
 *   - 30초마다 요약 전송
 */
const Metrics = (() => {
  // --- 설정 상수 ---
  const REPORT_INTERVAL = 30000;       // 메트릭 보고 주기 (30초)
  const SAMPLE_INTERVAL = 200;         // 위치 샘플링 주기 (200ms)
  const FPS_SAMPLE_INTERVAL = 1000;    // FPS 측정 주기 (1초)
  const GRID_SIZE = 8;                 // 탐험 커버리지 그리드 (8x8 = 64칸)
  const TRANSITION_WINDOW = 60000;     // 상태 전환 기록 유지 시간 (60초)

  // --- 내부 상태 ---
  let initialized = false;
  let reportTimer = null;
  let sampleTimer = null;
  let fpsRafId = null;

  // FPS 측정
  let fpsFrameCount = 0;
  let fpsLastTime = 0;
  let currentFps = 60;
  let fpsHistory = [];                 // 최근 30초간 FPS 기록

  // 상태 전환 추적
  let stateTransitions = [];           // [{ from, to, timestamp }]
  let stateTimeAccum = {};             // { 'idle': totalMs, 'walking': totalMs, ... }
  let lastStateChangeTime = 0;
  let lastObservedState = null;

  // 이동 부드러움 측정
  let positionSamples = [];            // [{ x, y, timestamp }]

  // 벽면 밀착 정확도
  let wallContactSamples = 0;         // 벽면 접촉 중 샘플 수
  let wallContactAccurateSamples = 0; // 정확한 밀착 샘플 수

  // 상호작용 응답 시간
  let lastClickTime = 0;              // 마지막 클릭 시각
  let interactionResponseTimes = [];  // [ms] 응답 시간 기록

  // 프레임 전환 일관성
  let animFrameTimestamps = [];       // 애니메이션 프레임 전환 시각 기록

  // 탐험 커버리지 (8x8 그리드)
  let visitedGrid = new Set();        // 방문한 그리드 셀 (문자열 키)
  let screenW = 0;
  let screenH = 0;

  // 말풍선 빈도
  let speechCount = 0;

  // 사용자 상호작용 빈도
  let userClickCount = 0;

  // 보고 기간 시작 시각
  let periodStartTime = 0;

  // ===================================
  //  초기화
  // ===================================

  /**
   * 메트릭 시스템 초기화
   * 기존 엔진/FSM에 간섭하지 않고 외부에서 관찰만 수행
   */
  function init() {
    if (initialized) return;
    initialized = true;

    screenW = window.innerWidth;
    screenH = window.innerHeight;
    periodStartTime = Date.now();
    lastStateChangeTime = Date.now();

    window.addEventListener('resize', () => {
      screenW = window.innerWidth;
      screenH = window.innerHeight;
    });

    // FPS 측정 루프 (별도 rAF — 기존 엔진 루프에 무개입)
    _startFpsMeasurement();

    // 주기적 위치/상태 샘플링 (200ms 간격)
    sampleTimer = setInterval(_sampleState, SAMPLE_INTERVAL);

    // 30초마다 요약 보고
    reportTimer = setInterval(_reportSummary, REPORT_INTERVAL);

    // StateMachine 상태 변화 감시 (기존 콜백 체인 비파괴적 래핑)
    _hookStateChanges();

    // 사용자 클릭 이벤트 감시
    _hookUserInteractions();

    // 말풍선 이벤트 감시
    _hookSpeechEvents();

    console.log('[Metrics] 자기 관찰 시스템 초기화 완료');
  }

  // ===================================
  //  FPS 측정
  // ===================================

  /**
   * 별도의 rAF 루프로 실제 프레임레이트를 측정
   * PetEngine의 rAF 루프와 독립적으로 동작
   */
  function _startFpsMeasurement() {
    fpsFrameCount = 0;
    fpsLastTime = performance.now();

    function fpsLoop(timestamp) {
      fpsFrameCount++;

      // 1초마다 FPS 계산
      const elapsed = timestamp - fpsLastTime;
      if (elapsed >= FPS_SAMPLE_INTERVAL) {
        currentFps = Math.round((fpsFrameCount / elapsed) * 1000 * 10) / 10;
        fpsHistory.push(currentFps);

        // 최근 30개 (30초) 유지
        if (fpsHistory.length > 30) fpsHistory.shift();

        fpsFrameCount = 0;
        fpsLastTime = timestamp;
      }

      fpsRafId = requestAnimationFrame(fpsLoop);
    }

    fpsRafId = requestAnimationFrame(fpsLoop);
  }

  // ===================================
  //  주기적 상태 샘플링
  // ===================================

  /**
   * 200ms마다 펫의 위치/상태를 샘플링
   * PetEngine과 StateMachine에서 읽기 전용으로 데이터를 가져옴
   */
  function _sampleState() {
    const now = Date.now();

    // 위치 샘플링 (이동 부드러움 계산용)
    if (typeof PetEngine !== 'undefined') {
      const pos = PetEngine.getPosition();
      positionSamples.push({ x: pos.x, y: pos.y, timestamp: now });

      // 최근 30초분만 유지 (150개)
      if (positionSamples.length > 150) positionSamples.shift();

      // 탐험 커버리지: 현재 위치를 그리드에 기록
      if (screenW > 0 && screenH > 0) {
        const gridX = Math.floor((pos.x / screenW) * GRID_SIZE);
        const gridY = Math.floor((pos.y / screenH) * GRID_SIZE);
        const clampedX = Math.max(0, Math.min(GRID_SIZE - 1, gridX));
        const clampedY = Math.max(0, Math.min(GRID_SIZE - 1, gridY));
        visitedGrid.add(`${clampedX},${clampedY}`);
      }

      // 벽면 밀착 정확도 샘플링
      if (pos.onSurface && pos.movementMode === 'crawling') {
        wallContactSamples++;
        // 가장자리에 정확히 밀착해 있는지 확인 (CHAR_SIZE = 64 기준)
        const charSize = PetEngine.CHAR_SIZE || 64;
        let isAccurate = false;

        switch (pos.edge) {
          case 'bottom':
            isAccurate = pos.y >= (screenH - charSize - 6); // EDGE_OFFSET(4) + 2 허용오차
            break;
          case 'top':
            isAccurate = pos.y <= 6;
            break;
          case 'left':
            isAccurate = pos.x <= 6;
            break;
          case 'right':
            isAccurate = pos.x >= (screenW - charSize - 6);
            break;
          case 'surface':
            isAccurate = true; // 표면 위는 항상 정확
            break;
        }
        if (isAccurate) wallContactAccurateSamples++;
      }
    }

    // 상태별 누적 시간 갱신
    if (typeof StateMachine !== 'undefined') {
      const state = StateMachine.getState();
      if (state !== lastObservedState) {
        // 이전 상태의 시간 누적
        if (lastObservedState) {
          const duration = now - lastStateChangeTime;
          stateTimeAccum[lastObservedState] = (stateTimeAccum[lastObservedState] || 0) + duration;
        }
        lastObservedState = state;
        lastStateChangeTime = now;
      }
    }
  }

  // ===================================
  //  이벤트 훅 (비파괴적)
  // ===================================

  /**
   * StateMachine 상태 전환 감시
   * 기존 onStateChange 콜백을 래핑하여 메트릭도 수집
   */
  function _hookStateChanges() {
    if (typeof StateMachine === 'undefined') return;

    // 기존 콜백 보존
    const originalCallback = StateMachine._metricsOriginalCallback;

    StateMachine.setOnStateChange((prevState, newState) => {
      // 메트릭 수집: 상태 전환 기록
      const now = Date.now();
      stateTransitions.push({ from: prevState, to: newState, timestamp: now });

      // TRANSITION_WINDOW 이전 기록 제거
      while (stateTransitions.length > 0 &&
             stateTransitions[0].timestamp < now - TRANSITION_WINDOW) {
        stateTransitions.shift();
      }

      // 이전 상태 시간 누적
      if (prevState) {
        const duration = now - lastStateChangeTime;
        stateTimeAccum[prevState] = (stateTimeAccum[prevState] || 0) + duration;
      }
      lastObservedState = newState;
      lastStateChangeTime = now;

      // 기존 app.js 콜백 체인 실행
      // (app.js에서 setOnStateChange를 먼저 호출했으므로,
      //  Metrics.init()가 그 뒤에 호출되면 기존 콜백이 덮어씌워짐.
      //  따라서 app.js의 콜백 로직을 여기서 재현한다.)
      _invokeOriginalStateChangeHandler(prevState, newState);
    });
  }

  /**
   * app.js에서 설정한 기존 상태 변화 콜백 로직 재현
   * Metrics가 setOnStateChange를 덮어쓰므로, 원래 동작을 보존한다.
   */
  function _invokeOriginalStateChangeHandler(prevState, newState) {
    // 수면 'z' 파티클
    if (newState === 'sleeping') {
      const pet = document.getElementById('pet-container');
      if (pet) {
        for (let i = 0; i < 3; i++) {
          const z = document.createElement('div');
          z.className = 'sleep-z';
          z.textContent = 'z';
          pet.appendChild(z);
        }
      }
    }
    if (prevState === 'sleeping') {
      document.querySelectorAll('.sleep-z').forEach(el => el.remove());
    }
    if (newState === 'excited') {
      if (typeof Interactions !== 'undefined') {
        Interactions.spawnStarEffect();
      }
    }

    // OpenClaw에 상태 변화 리포트
    if (window.clawmate && window.clawmate.reportToAI) {
      window.clawmate.reportToAI('state_change', {
        from: prevState, to: newState,
      });
    }
  }

  /**
   * 사용자 상호작용 감시 (클릭 이벤트)
   * 클릭 → 상태 변화까지의 응답 시간을 측정
   */
  function _hookUserInteractions() {
    const petContainer = document.getElementById('pet-container');
    if (!petContainer) return;

    petContainer.addEventListener('mousedown', () => {
      lastClickTime = Date.now();
      userClickCount++;
    });

    // 클릭 후 상태 변화가 발생하면 응답 시간 기록
    // (stateTransitions에 새 항목이 추가될 때 체크)
    const origPush = Array.prototype.push;
    const responseTimes = interactionResponseTimes;
    const clickTimeRef = { get: () => lastClickTime };

    // MutationObserver 방식 대신, _hookStateChanges 내부에서 처리
    // 상태 전환 시점에 클릭으로부터의 시간을 계산
    setInterval(() => {
      if (lastClickTime > 0 && stateTransitions.length > 0) {
        const lastTransition = stateTransitions[stateTransitions.length - 1];
        if (lastTransition.timestamp > lastClickTime) {
          const responseTime = lastTransition.timestamp - lastClickTime;
          // 3초 이내의 응답만 유효 (그 이상은 클릭과 무관한 전환)
          if (responseTime < 3000) {
            interactionResponseTimes.push(responseTime);
            if (interactionResponseTimes.length > 50) {
              interactionResponseTimes.shift();
            }
          }
          lastClickTime = 0; // 측정 완료, 초기화
        }
      }
    }, 500);
  }

  /**
   * 말풍선 이벤트 감시
   * Speech 모듈의 show() 호출을 감지하여 카운트
   */
  function _hookSpeechEvents() {
    if (typeof Speech === 'undefined') return;

    // Speech.show를 래핑하여 호출 횟수 카운트
    const originalShow = Speech.show;
    if (typeof originalShow === 'function') {
      Speech.show = function(...args) {
        speechCount++;
        return originalShow.apply(this, args);
      };
    }
  }

  // ===================================
  //  메트릭 계산
  // ===================================

  /**
   * 이동 부드러움 계산
   * 연속 위치 변화의 분산이 작을수록 부드러움
   *
   * @returns {number} 0~1 (1이 가장 부드러움)
   */
  function _calcMovementSmoothness() {
    if (positionSamples.length < 3) return 1.0;

    // 연속 이동 벡터의 크기 변화 분산을 계산
    const deltas = [];
    for (let i = 1; i < positionSamples.length; i++) {
      const dx = positionSamples[i].x - positionSamples[i - 1].x;
      const dy = positionSamples[i].y - positionSamples[i - 1].y;
      deltas.push(Math.sqrt(dx * dx + dy * dy));
    }

    if (deltas.length < 2) return 1.0;

    // 연속 delta 간 차이의 분산 (가속도의 변화)
    const accelChanges = [];
    for (let i = 1; i < deltas.length; i++) {
      accelChanges.push(Math.abs(deltas[i] - deltas[i - 1]));
    }

    const avgAccelChange = accelChanges.reduce((a, b) => a + b, 0) / accelChanges.length;

    // 분산을 0~1 점수로 변환 (avgAccelChange가 클수록 덜 부드러움)
    // 10px 이상의 급격한 변화 = 0점, 0 = 1점
    const smoothness = Math.max(0, Math.min(1, 1 - (avgAccelChange / 10)));
    return Math.round(smoothness * 100) / 100;
  }

  /**
   * 프레임 전환 일관성 계산
   * 애니메이션 프레임 간격의 일관성 (FPS 안정성)
   *
   * @returns {number} 0~1 (1이 가장 일관)
   */
  function _calcFrameConsistency() {
    if (fpsHistory.length < 2) return 1.0;

    const avg = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
    if (avg === 0) return 0;

    // FPS 표준편차 / 평균 (변동계수)
    const variance = fpsHistory.reduce((sum, fps) => sum + Math.pow(fps - avg, 2), 0) / fpsHistory.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / avg; // 변동계수

    // cv가 0이면 완벽한 일관성, 0.5 이상이면 매우 불안정
    const consistency = Math.max(0, Math.min(1, 1 - cv * 2));
    return Math.round(consistency * 100) / 100;
  }

  /**
   * 상태 전환 카운트 집계
   * 최근 60초 내 각 상태별 전환 횟수
   *
   * @returns {object} { idle: n, walking: n, ... }
   */
  function _calcStateTransitionCounts() {
    const counts = {};
    const now = Date.now();
    for (const t of stateTransitions) {
      if (now - t.timestamp <= TRANSITION_WINDOW) {
        counts[t.to] = (counts[t.to] || 0) + 1;
      }
    }
    return counts;
  }

  /**
   * idle 비율 계산
   * 보고 기간 내 idle 상태로 보낸 시간 비율
   *
   * @returns {number} 0~1
   */
  function _calcIdleRatio() {
    const totalTime = Date.now() - periodStartTime;
    if (totalTime <= 0) return 0;

    const idleTime = stateTimeAccum['idle'] || 0;
    const ratio = idleTime / totalTime;
    return Math.round(Math.min(1, ratio) * 100) / 100;
  }

  /**
   * 탐험 커버리지 계산
   * 8x8 그리드 중 방문한 셀의 비율
   *
   * @returns {number} 0~1
   */
  function _calcExplorationCoverage() {
    const totalCells = GRID_SIZE * GRID_SIZE;
    const coverage = visitedGrid.size / totalCells;
    return Math.round(coverage * 100) / 100;
  }

  /**
   * 벽면 밀착 정확도 계산
   *
   * @returns {number} 0~1
   */
  function _calcWallContactAccuracy() {
    if (wallContactSamples === 0) return 1.0;
    const accuracy = wallContactAccurateSamples / wallContactSamples;
    return Math.round(accuracy * 100) / 100;
  }

  /**
   * 상호작용 평균 응답 시간 계산
   *
   * @returns {number} ms (응답 기록이 없으면 0)
   */
  function _calcAvgInteractionResponse() {
    if (interactionResponseTimes.length === 0) return 0;
    const avg = interactionResponseTimes.reduce((a, b) => a + b, 0) / interactionResponseTimes.length;
    return Math.round(avg);
  }

  // ===================================
  //  스냅샷 및 요약
  // ===================================

  /**
   * 현재 시점의 메트릭 스냅샷 반환 (실시간)
   * @returns {object}
   */
  function getSnapshot() {
    return {
      timestamp: Date.now(),
      fps: currentFps,
      stateTransitions: _calcStateTransitionCounts(),
      movementSmoothness: _calcMovementSmoothness(),
      wallContactAccuracy: _calcWallContactAccuracy(),
      interactionResponseMs: _calcAvgInteractionResponse(),
      animationFrameConsistency: _calcFrameConsistency(),
      idleRatio: _calcIdleRatio(),
      explorationCoverage: _calcExplorationCoverage(),
      speechCount: speechCount,
      userClicks: userClickCount,
    };
  }

  /**
   * 30초 기간 요약 생성 + 카운터 리셋
   * @returns {object} 메트릭 요약 데이터
   */
  function getSummary() {
    const now = Date.now();
    const period = now - periodStartTime;

    // 마지막 관찰 상태의 시간도 누적
    if (lastObservedState) {
      const duration = now - lastStateChangeTime;
      stateTimeAccum[lastObservedState] = (stateTimeAccum[lastObservedState] || 0) + duration;
      lastStateChangeTime = now;
    }

    // 평균 FPS 계산
    const avgFps = fpsHistory.length > 0
      ? Math.round((fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length) * 10) / 10
      : 60;

    const summary = {
      timestamp: now,
      fps: avgFps,
      stateTransitions: _calcStateTransitionCounts(),
      movementSmoothness: _calcMovementSmoothness(),
      wallContactAccuracy: _calcWallContactAccuracy(),
      interactionResponseMs: _calcAvgInteractionResponse(),
      animationFrameConsistency: _calcFrameConsistency(),
      idleRatio: _calcIdleRatio(),
      explorationCoverage: _calcExplorationCoverage(),
      speechCount: speechCount,
      userClicks: userClickCount,
      period: period,
    };

    // 기간 카운터 리셋 (누적 데이터는 유지, 기간 카운터만 초기화)
    periodStartTime = now;
    speechCount = 0;
    userClickCount = 0;
    stateTimeAccum = {};
    fpsHistory = [];
    interactionResponseTimes = [];
    // visitedGrid는 리셋하지 않음 (누적 탐험 기록)
    // positionSamples는 자동으로 오래된 것 제거됨

    return summary;
  }

  // ===================================
  //  보고
  // ===================================

  /**
   * 30초마다 메트릭 요약을 main process로 전송
   */
  function _reportSummary() {
    const summary = getSummary();

    // main process로 전송 (preload 브릿지 경유)
    if (window.clawmate && typeof window.clawmate.reportMetrics === 'function') {
      window.clawmate.reportMetrics(summary);
    }

    // 콘솔에도 간략히 출력 (디버그용)
    console.log(
      `[Metrics] FPS:${summary.fps} | ` +
      `부드러움:${summary.movementSmoothness} | ` +
      `idle:${(summary.idleRatio * 100).toFixed(0)}% | ` +
      `탐험:${(summary.explorationCoverage * 100).toFixed(0)}% | ` +
      `클릭:${summary.userClicks} | ` +
      `말풍선:${summary.speechCount}`
    );
  }

  /**
   * 탐험 커버리지 그리드 리셋
   * 외부에서 새 탐험 세션을 시작할 때 사용
   */
  function resetExplorationGrid() {
    visitedGrid.clear();
  }

  /**
   * 시스템 정리
   */
  function destroy() {
    if (reportTimer) clearInterval(reportTimer);
    if (sampleTimer) clearInterval(sampleTimer);
    if (fpsRafId) cancelAnimationFrame(fpsRafId);
    initialized = false;
    console.log('[Metrics] 자기 관찰 시스템 종료');
  }

  // --- 공개 API ---
  return {
    init,
    getSnapshot,
    getSummary,
    resetExplorationGrid,
    destroy,
  };
})();
