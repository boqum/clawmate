/**
 * Browser activity watcher + AI comment system
 *
 * Two modes:
 *   When AI connected: Send window title + screen capture + cursor position to AI -> AI generates contextual comments
 *   When AI disconnected: Fall back to preset messages (autonomous mode)
 *
 * Behavior:
 *   1. Check active window title + cursor position every 15 seconds
 *   2. Report context to AI when browser/app detected (title + screen capture)
 *   3. AI analyzes title/capture and generates situation-appropriate comments
 *   4. Fall back to preset messages in autonomous mode
 */
const BrowserWatcher = (() => {
  const CHECK_INTERVAL = 15000;     // Active window check interval (15s)
  const AI_COOLDOWN = 45000;        // AI comment cooldown (45s)
  const FALLBACK_COOLDOWN = 90000;  // Autonomous mode comment cooldown (90s)
  const COMMENT_CHANCE = 0.4;       // Comment probability (40%)
  const SITE_CHANGE_BONUS = 0.3;    // Additional probability on site change

  let intervalId = null;
  let lastCategory = null;
  let lastCommentTime = 0;
  let lastTitle = '';
  let enabled = true;

  function init() {
    intervalId = setInterval(check, CHECK_INTERVAL);
    // First check after 10 seconds (skip right after app start)
    setTimeout(check, 10000);
  }

  async function check() {
    if (!enabled) return;
    if (typeof Speech === 'undefined') return;

    // Don't comment when in sleeping state
    if (typeof StateMachine !== 'undefined' && StateMachine.getState() === 'sleeping') return;

    // Skip if ProactiveController reacted within last 5 seconds (avoid duplicate reactions)
    if (typeof ProactiveController !== 'undefined') {
      const lastProactive = ProactiveController.getLastReactionTime();
      if (Date.now() - lastProactive < 5000) return;
    }

    try {
      const title = await window.clawmate.getActiveWindowTitle();
      if (!title) return;

      const titleLower = title.toLowerCase();
      const titleChanged = title !== lastTitle;
      lastTitle = title;

      const now = Date.now();

      // Category matching (used by both AI and autonomous modes)
      const msgs = window._messages;
      const match = msgs?.browsing ? findCategory(titleLower, msgs.browsing) : null;
      const category = match?.category || 'unknown';

      // Cooldown check
      const isAI = typeof AIController !== 'undefined' && AIController.isConnected();
      const cooldown = isAI ? AI_COOLDOWN : FALLBACK_COOLDOWN;
      if (now - lastCommentTime < cooldown) return;

      // Skip if same category and title unchanged
      if (category === lastCategory && !titleChanged) return;

      // Probability check
      let chance = COMMENT_CHANCE;
      if (titleChanged) chance += SITE_CHANGE_BONUS;
      if (Math.random() > chance) return;

      // === AI vs autonomous mode branch ===
      if (isAI) {
        await reportBrowsingToAI(title, category, titleChanged);
      } else {
        showFallbackComment(match);
      }

      lastCategory = category;
      lastCommentTime = now;
    } catch {
      // Ignore IPC failure
    }
  }

  /**
   * Send browsing context to AI
   * Transmit title + cursor position + screen capture together
   * AI analyzes and generates comments
   */
  async function reportBrowsingToAI(title, category, titleChanged) {
    if (!window.clawmate.reportToAI) return;

    // Get cursor position
    let cursorX = 0, cursorY = 0;
    try {
      if (window.clawmate.getCursorPosition) {
        const pos = await window.clawmate.getCursorPosition();
        cursorX = pos.x;
        cursorY = pos.y;
      }
    } catch {}

    // Screen capture (for AI to visually analyze page content)
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

    // Send unified browsing report
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
   * Autonomous mode fallback: display preset messages
   */
  function showFallbackComment(match) {
    if (!match?.data?.comments) return;

    const comments = match.data.comments;
    const comment = comments[Math.floor(Math.random() * comments.length)];
    Speech.show(comment);

    // 50% chance of excitement animation
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
   * Category matching (keyword-based)
   * 'general' is only used when no other category matches
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
