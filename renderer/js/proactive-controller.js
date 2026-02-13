/**
 * Proactive Controller (Renderer)
 *
 * Receives proactive-event from main process ProactiveMonitor
 * and makes the pet react appropriately.
 *
 * Two modes:
 *   AI connected: Forward context to AI -> AI decides pet reaction
 *   Autonomous: Use preset messages with probabilistic selection + emotion mapping
 */
const ProactiveController = (() => {
  const REACTION_CHANCE = 0.6;        // 60% chance of reacting to a trigger
  const HIGH_PRIORITY_CHANCE = 0.9;   // 90% for high priority triggers
  let lastReactionTime = 0;
  let enabled = true;

  // High priority triggers that should almost always get a reaction
  const HIGH_PRIORITY = new Set([
    'idle_return', 'error_detected', 'error_loop', 'checkout_detected',
    'clipboard_screenshot', 'late_night', 'dawn_coding',
  ]);

  // Low priority triggers that have a lower chance of reaction
  const LOW_PRIORITY = new Set([
    'app_switch', 'clipboard_copy', 'search_detected', 'login_page',
    'email_copied', 'phone_copied',
  ]);

  const LOW_PRIORITY_CHANCE = 0.3; // 30% for low priority

  function init() {
    if (!window.clawmate.onProactiveEvent) return;

    window.clawmate.onProactiveEvent((event) => {
      if (!enabled) return;
      handleEvent(event);
    });

    // Load config
    if (window.clawmate.getProactiveConfig) {
      window.clawmate.getProactiveConfig().then((config) => {
        enabled = config.enabled !== false;
      });
    }
  }

  /**
   * Handle a proactive event from main process
   */
  function handleEvent(event) {
    const { trigger, context, timestamp } = event;
    const now = Date.now();

    // Global minimum gap between reactions (5s)
    if (now - lastReactionTime < 5000) return;

    // Don't react when sleeping
    if (typeof StateMachine !== 'undefined' && StateMachine.getState() === 'sleeping') return;

    // Probability check based on trigger priority
    let chance = REACTION_CHANCE;
    if (HIGH_PRIORITY.has(trigger)) {
      chance = HIGH_PRIORITY_CHANCE;
    } else if (LOW_PRIORITY.has(trigger)) {
      chance = LOW_PRIORITY_CHANCE;
    }
    if (Math.random() > chance) return;

    // Route based on AI connection status
    const isAI = typeof AIController !== 'undefined' && AIController.isConnected();

    if (isAI) {
      // Main process에서 screen capture와 함께 직접 AI에 전송함
      // Renderer에서는 추가 전송하지 않음 (중복 방지)
      return;
    } else {
      showAutonomousReaction(trigger, context);
    }

    lastReactionTime = now;
  }

  /**
   * AI mode: Send context to AI for decision
   */
  function reportToAI(trigger, context) {
    if (!window.clawmate.reportToAI) return;

    window.clawmate.reportToAI('proactive_trigger', {
      trigger,
      ...context,
      timestamp: Date.now(),
    });
  }

  /**
   * Autonomous mode: Show preset reaction
   */
  function showAutonomousReaction(trigger, context) {
    const msgs = window._messages;
    if (!msgs?.proactive) return;

    const triggerData = msgs.proactive[trigger];
    if (!triggerData?.messages?.length) return;

    // Pick a random message
    const message = triggerData.messages[
      Math.floor(Math.random() * triggerData.messages.length)
    ];

    // Personalize message with context where possible
    const finalMessage = personalizeMessage(message, trigger, context);

    // Show speech bubble
    if (typeof Speech !== 'undefined') {
      Speech.show(finalMessage);
    }

    // Apply emotion
    if (typeof StateMachine !== 'undefined' && triggerData.emotion) {
      applyProactiveEmotion(triggerData.emotion);
    }
  }

  /**
   * Personalize generic messages with specific context
   */
  function personalizeMessage(message, trigger, context) {
    // For app_switch, mention the new app
    if (trigger === 'app_switch' && context.to) {
      const templates = [
        `Switching to ${context.to}!`,
        `${context.to}? Let's see~`,
        `Off to ${context.to}!`,
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }

    // For idle_return, mention duration if long
    if (trigger === 'idle_return' && context.idleDuration > 300) {
      const mins = Math.floor(context.idleDuration / 60);
      return `Welcome back! You were gone for ${mins} minutes!`;
    }

    // For long_focus, mention duration
    if (trigger === 'long_focus' && context.duration) {
      const mins = Math.floor(context.duration / 60);
      return `${mins} minutes focused! Take a stretch?`;
    }

    return message;
  }

  /**
   * Map emotion string to pet state
   */
  function applyProactiveEmotion(emotion) {
    const emotionMap = {
      curious: 'walking',
      excited: 'excited',
      happy: 'excited',
      worried: 'scared',
      scared: 'scared',
      playful: 'playing',
      sleepy: 'sleeping',
      neutral: null, // don't change state
    };

    const state = emotionMap[emotion];
    if (!state) return;

    const currentState = StateMachine.getState();
    // Only change if in idle or walking state
    if (currentState !== 'idle' && currentState !== 'walking') return;

    StateMachine.forceState(state);

    // Return to idle/walking after a short period (except sleeping)
    if (state !== 'sleeping') {
      setTimeout(() => {
        if (StateMachine.getState() === state) {
          StateMachine.forceState('idle');
        }
      }, 2000);
    }
  }

  /**
   * Get time of last reaction (for BrowserWatcher collision avoidance)
   */
  function getLastReactionTime() {
    return lastReactionTime;
  }

  function setEnabled(val) {
    enabled = val;
  }

  return {
    init,
    handleEvent,
    getLastReactionTime,
    setEnabled,
  };
})();
