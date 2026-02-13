/**
 * ClawMate 렌더러 초기화
 *
 * 아키텍처:
 *   AI (뇌) ←→ AI Bridge (WebSocket) ←→ AI Controller (렌더러)
 *                                                       ↓
 *                                          StateMachine / PetEngine / Speech
 *
 * AI 연결 시: AI가 모든 행동/말/감정 결정
 * AI 미연결 시: 자율 모드 (FSM 기반) 로 혼자 놀기
 */
(async function initClawMate() {
  const petContainer = document.getElementById('pet-container');

  // 캐릭터 캔버스 생성
  Character.createCanvas(petContainer);

  // 기본 색상 설정 (Pet 모드)
  Character.setColorMap({
    primary: '#ff4f40',
    secondary: '#ff775f',
    dark: '#8B4513',
    eye: '#ffffff',
    pupil: '#111111',
    claw: '#ff4f40',
  });

  // 상태 변화 콜백
  StateMachine.setOnStateChange((prevState, newState) => {
    if (newState === 'sleeping') {
      const pet = document.getElementById('pet-container');
      for (let i = 0; i < 3; i++) {
        const z = document.createElement('div');
        z.className = 'sleep-z';
        z.textContent = 'z';
        pet.appendChild(z);
      }
    }

    if (prevState === 'sleeping') {
      document.querySelectorAll('.sleep-z').forEach(el => el.remove());
    }

    if (newState === 'excited') {
      Interactions.spawnStarEffect();
    }

    // 모션 히스토리 기록
    Memory.recordMotion(newState);

    // 상태 변화를 AI에 리포트
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('state_change', {
        from: prevState, to: newState,
      });
    }
  });

  // 이동 엔진 초기화
  PetEngine.init(petContainer);

  // 모드 매니저 초기화
  await ModeManager.init();

  // 메모리 초기화 (진화 상태 포함)
  await Memory.init();

  // AI 컨트롤러 초기화 (AI 연결 관리)
  AIController.init();

  // 상호작용 초기화
  Interactions.init();

  // 시간 인식 초기화 (자율 모드에서만 주도적으로 동작)
  TimeAware.init();

  // 메트릭 수집기 초기화 (선택적 — 없어도 앱 정상 동작)
  if (typeof Metrics !== 'undefined') {
    Metrics.init();
  }

  // 브라우저 감시 초기화 (참견쟁이 모드)
  if (typeof BrowserWatcher !== 'undefined') {
    BrowserWatcher.init();
  }

  // 엔진 시작
  PetEngine.start();

  // 말풍선 위치 업데이트 루프
  setInterval(() => {
    Speech.updatePosition();
  }, 100);

  // AI 연결 상태 표시
  const connected = await window.clawmate.isAIConnected();
  if (connected) {
    Speech.show('AI와 연결됨. 지시를 기다리는 중...');
  } else {
    Speech.show('안녕! 나 혼자서도 잘 놀 수 있어!');
  }

  addDynamicStyles();
  console.log('ClawMate initialized (AI Bridge: ws://127.0.0.1:9320)');
})();

function addDynamicStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse-aura {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.05); }
    }
    @keyframes spin-slow {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
