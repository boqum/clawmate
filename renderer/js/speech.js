/**
 * 말풍선 시스템
 * - 타자기 효과 (30ms/글자)
 * - 5초 유지 → 페이드 아웃
 * - 모드별 스타일: Pet(둥글고 빨간 테두리) / Incarnation(각지고 틸 발광)
 */
const Speech = (() => {
  const CHAR_DELAY = 30;
  const DISPLAY_TIME = 5000;
  const FADE_TIME = 500;

  let currentBubble = null;
  let typeTimer = null;
  let hideTimer = null;
  let mode = 'pet';

  function setMode(m) {
    mode = m;
  }

  /**
   * 캐릭터 위치(edge)에 따라 말풍선 좌표를 계산
   * - bottom(바닥): 캐릭터 위에
   * - left(왼쪽 벽): 캐릭터 오른쪽(머리 쪽)에
   * - right(오른쪽 벽): 캐릭터 왼쪽(머리 쪽)에
   * - top(천장): 캐릭터 아래에
   * - 점프/낙하/레펠 중: 캐릭터 위에 (기본)
   */
  function getBubblePosition(pos) {
    const edge = pos.edge;
    const mode = pos.movementMode;

    // 공중일 때는 항상 위에 표시
    if (mode === 'jumping' || mode === 'falling' || mode === 'rappelling') {
      return { left: pos.x - 30, top: pos.y - 60 };
    }

    switch (edge) {
      case 'left':
        return { left: pos.x + 70, top: pos.y - 10 };
      case 'right':
        return { left: pos.x - 150, top: pos.y - 10 };
      case 'top':
        return { left: pos.x - 30, top: pos.y + 70 };
      case 'bottom':
      default:
        return { left: pos.x - 30, top: pos.y - 60 };
    }
  }

  /**
   * 말풍선이 화면 밖으로 나가지 않도록 좌표를 제한
   */
  function clampBubblePosition(left, top) {
    const maxW = window.innerWidth - 200;  // 말풍선 대략 너비 고려
    const maxH = window.innerHeight - 50;
    return {
      left: Math.max(5, Math.min(left, maxW)),
      top: Math.max(5, Math.min(top, maxH)),
    };
  }

  function show(text) {
    hide(); // 기존 말풍선 제거

    const container = document.getElementById('speech-container');
    const pos = PetEngine.getPosition();

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble speech-${mode}`;

    // edge별 말풍선 위치 계산 + 화면 밖 방지 clamp
    const rawPos = getBubblePosition(pos);
    const clamped = clampBubblePosition(rawPos.left, rawPos.top);
    bubble.style.left = clamped.left + 'px';
    bubble.style.top = clamped.top + 'px';

    const textEl = document.createElement('span');
    textEl.className = 'speech-text';
    bubble.appendChild(textEl);

    container.appendChild(bubble);
    currentBubble = bubble;

    // 타자기 효과
    let charIndex = 0;
    typeTimer = setInterval(() => {
      if (charIndex < text.length) {
        textEl.textContent += text[charIndex];
        charIndex++;
      } else {
        clearInterval(typeTimer);
        typeTimer = null;
      }
    }, CHAR_DELAY);

    // 자동 숨김
    const totalTypeTime = text.length * CHAR_DELAY;
    hideTimer = setTimeout(() => {
      if (currentBubble) {
        currentBubble.classList.add('speech-fade');
        setTimeout(() => hide(), FADE_TIME);
      }
    }, totalTypeTime + DISPLAY_TIME);
  }

  function hide() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (currentBubble) {
      currentBubble.remove();
      currentBubble = null;
    }
  }

  function updatePosition() {
    if (!currentBubble) return;
    const pos = PetEngine.getPosition();
    // edge별 말풍선 위치 재계산 + 화면 밖 방지
    const rawPos = getBubblePosition(pos);
    const clamped = clampBubblePosition(rawPos.left, rawPos.top);
    currentBubble.style.left = clamped.left + 'px';
    currentBubble.style.top = clamped.top + 'px';
  }

  // --- 메시지 선택 헬퍼 ---
  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getReactionMessage() {
    const msgs = window._messages;
    if (!msgs) return '...';
    return randomFrom(msgs.reactions[mode] || msgs.reactions.pet);
  }

  function getGreetingMessage() {
    const msgs = window._messages;
    if (!msgs) return '...';
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return randomFrom(msgs.greetings.morning);
    if (hour >= 12 && hour < 18) return randomFrom(msgs.greetings.afternoon);
    if (hour >= 18 && hour < 23) return randomFrom(msgs.greetings.evening);
    return randomFrom(msgs.greetings.night);
  }

  function getTipMessage() {
    const msgs = window._messages;
    if (!msgs) return '';
    return randomFrom(msgs.tips || []);
  }

  function getMilestoneMessage(milestone) {
    const msgs = window._messages;
    if (!msgs || !msgs.milestones) return '';
    return msgs.milestones[milestone] || '';
  }

  return {
    show, hide, updatePosition, setMode,
    getReactionMessage, getGreetingMessage, getTipMessage, getMilestoneMessage,
  };
})();
