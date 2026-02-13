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

  function show(text) {
    hide(); // 기존 말풍선 제거

    const container = document.getElementById('speech-container');
    const pos = PetEngine.getPosition();

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble speech-${mode}`;

    // 말풍선 위치 (캐릭터 위)
    bubble.style.left = (pos.x - 30) + 'px';
    bubble.style.top = (pos.y - 60) + 'px';

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
    currentBubble.style.left = (pos.x - 30) + 'px';
    currentBubble.style.top = (pos.y - 60) + 'px';
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
