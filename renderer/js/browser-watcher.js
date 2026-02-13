/**
 * 브라우저 활동 감시 + AI 코멘트 시스템
 *
 * 두 가지 모드:
 *   AI 연결 시: 윈도우 제목 + 화면 캡처 + 커서 위치를 AI에 전송 → AI가 맥락 있는 코멘트 생성
 *   AI 미연결 시: 프리셋 메시지로 폴백 (자율 모드)
 *
 * 동작:
 *   1. 15초마다 활성 윈도우 제목 + 커서 위치 조회
 *   2. 브라우저/앱 감지 시 AI에 컨텍스트 리포트 (제목 + 화면 캡처)
 *   3. AI가 제목/캡처를 분석해서 상황 맞는 코멘트 생성
 *   4. 자율 모드에서는 프리셋 메시지 폴백
 */
const BrowserWatcher = (() => {
  const CHECK_INTERVAL = 15000;     // 활성 윈도우 체크 주기 (15초)
  const AI_COOLDOWN = 45000;        // AI 코멘트 쿨다운 (45초)
  const FALLBACK_COOLDOWN = 90000;  // 자율 모드 코멘트 쿨다운 (90초)
  const COMMENT_CHANCE = 0.4;       // 코멘트 확률 (40%)
  const SITE_CHANGE_BONUS = 0.3;    // 사이트 변경 시 추가 확률

  let intervalId = null;
  let lastCategory = null;
  let lastCommentTime = 0;
  let lastTitle = '';
  let enabled = true;

  function init() {
    intervalId = setInterval(check, CHECK_INTERVAL);
    // 첫 체크는 10초 후 (앱 시작 직후는 건너뜀)
    setTimeout(check, 10000);
  }

  async function check() {
    if (!enabled) return;
    if (typeof Speech === 'undefined') return;

    // sleeping 상태면 참견 안 함
    if (typeof StateMachine !== 'undefined' && StateMachine.getState() === 'sleeping') return;

    try {
      const title = await window.clawmate.getActiveWindowTitle();
      if (!title) return;

      const titleLower = title.toLowerCase();
      const titleChanged = title !== lastTitle;
      lastTitle = title;

      const now = Date.now();

      // 카테고리 매칭 (AI/자율 모두 사용)
      const msgs = window._messages;
      const match = msgs?.browsing ? findCategory(titleLower, msgs.browsing) : null;
      const category = match?.category || 'unknown';

      // 쿨다운 체크
      const isAI = typeof AIController !== 'undefined' && AIController.isConnected();
      const cooldown = isAI ? AI_COOLDOWN : FALLBACK_COOLDOWN;
      if (now - lastCommentTime < cooldown) return;

      // 같은 카테고리 + 제목 미변경 시 스킵
      if (category === lastCategory && !titleChanged) return;

      // 확률 체크
      let chance = COMMENT_CHANCE;
      if (titleChanged) chance += SITE_CHANGE_BONUS;
      if (Math.random() > chance) return;

      // === AI vs 자율 모드 분기 ===
      if (isAI) {
        await reportBrowsingToAI(title, category, titleChanged);
      } else {
        showFallbackComment(match);
      }

      lastCategory = category;
      lastCommentTime = now;
    } catch {
      // IPC 실패 무시
    }
  }

  /**
   * AI에 브라우징 컨텍스트 전송
   * 제목 + 커서 위치 + 화면 캡처를 한번에 전송
   * AI가 분석하고 코멘트 생성
   */
  async function reportBrowsingToAI(title, category, titleChanged) {
    if (!window.clawmate.reportToAI) return;

    // 커서 위치 조회
    let cursorX = 0, cursorY = 0;
    try {
      if (window.clawmate.getCursorPosition) {
        const pos = await window.clawmate.getCursorPosition();
        cursorX = pos.x;
        cursorY = pos.y;
      }
    } catch {}

    // 화면 캡처 (AI가 페이지 내용을 시각적으로 분석하기 위해)
    let screenData = null;
    try {
      const capture = await window.clawmate.screen.capture();
      if (capture?.success) {
        screenData = {
          image: capture.image,
          width: capture.width,
          height: capture.height,
        };
      }
    } catch {}

    // 통합 브라우징 리포트 전송
    window.clawmate.reportToAI('browsing', {
      title,
      category,
      titleChanged,
      cursorX,
      cursorY,
      screen: screenData,
      timestamp: Date.now(),
    });
  }

  /**
   * 자율 모드 폴백: 프리셋 메시지 표시
   */
  function showFallbackComment(match) {
    if (!match?.data?.comments) return;

    const comments = match.data.comments;
    const comment = comments[Math.floor(Math.random() * comments.length)];
    Speech.show(comment);

    // 50% 확률로 흥분 애니메이션
    if (typeof StateMachine !== 'undefined') {
      const state = StateMachine.getState();
      if ((state === 'idle' || state === 'walking') && Math.random() < 0.5) {
        StateMachine.forceState('excited');
        setTimeout(() => {
          if (StateMachine.getState() === 'excited') StateMachine.forceState('idle');
        }, 1500);
      }
    }
  }

  /**
   * 카테고리 매칭 (키워드 기반)
   * general은 다른 카테고리 매칭 안 될 때만 사용
   */
  function findCategory(titleLower, browsingMsgs) {
    let generalMatch = null;
    for (const [category, data] of Object.entries(browsingMsgs)) {
      if (!data.keywords) continue;
      for (const keyword of data.keywords) {
        if (titleLower.includes(keyword.toLowerCase())) {
          if (category === 'general') {
            generalMatch = { category, data };
          } else {
            return { category, data };
          }
        }
      }
    }
    return generalMatch;
  }

  function setEnabled(val) { enabled = val; }
  function stop() { if (intervalId) clearInterval(intervalId); }

  return { init, stop, setEnabled, check };
})();
