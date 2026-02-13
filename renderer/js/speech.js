/**
 * Speech bubble system
 * - Typewriter effect (30ms/char)
 * - Hold for 5s -> fade out
 * - Mode-based styling: Pet (rounded, red border) / Incarnation (angular, teal glow)
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
   * Calculate speech bubble coordinates based on character position (edge)
   * - bottom (floor): above character
   * - left (left wall): to character's right (head side)
   * - right (right wall): to character's left (head side)
   * - top (ceiling): below character
   * - jumping/falling/rappelling: above character (default)
   */
  function getBubblePosition(pos) {
    const edge = pos.edge;
    const mode = pos.movementMode;

    // Always show above when in mid-air
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
   * Clamp coordinates to prevent speech bubble from going off-screen
   */
  function clampBubblePosition(left, top) {
    const maxW = window.innerWidth - 200;  // Account for approximate bubble width
    const maxH = window.innerHeight - 50;
    return {
      left: Math.max(5, Math.min(left, maxW)),
      top: Math.max(5, Math.min(top, maxH)),
    };
  }

  function show(text) {
    hide(); // Remove existing bubble

    const container = document.getElementById('speech-container');
    const pos = PetEngine.getPosition();

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble speech-${mode}`;

    // Calculate bubble position per edge + off-screen prevention clamp
    const rawPos = getBubblePosition(pos);
    const clamped = clampBubblePosition(rawPos.left, rawPos.top);
    bubble.style.left = clamped.left + 'px';
    bubble.style.top = clamped.top + 'px';

    const textEl = document.createElement('span');
    textEl.className = 'speech-text';
    bubble.appendChild(textEl);

    container.appendChild(bubble);
    currentBubble = bubble;

    // Typewriter effect
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

    // Auto-hide
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
    // Recalculate bubble position per edge + off-screen prevention
    const rawPos = getBubblePosition(pos);
    const clamped = clampBubblePosition(rawPos.left, rawPos.top);
    currentBubble.style.left = clamped.left + 'px';
    currentBubble.style.top = clamped.top + 'px';
  }

  // --- Message selection helpers ---
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
