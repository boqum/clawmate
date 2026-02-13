/**
 * Time-based behavior change system
 * - Morning greetings, lunch alerts, sleeping at night
 * - Random idle chatter
 * - Random tip messages
 */
const TimeAware = (() => {
  let lastGreetingHour = -1;
  let lastChatterTime = 0;
  let lastTipTime = 0;
  const CHATTER_COOLDOWN = 60000;     // 1 minute minimum interval
  const TIP_COOLDOWN = 5 * 60000;     // 5 minute minimum interval
  let chatterChance = 0.15;

  function init() {
    // Greet on start
    showTimeGreeting();
    // Periodic check
    setInterval(tick, 30000); // Every 30 seconds
  }

  function setChatterChance(chance) {
    chatterChance = chance;
  }

  function tick() {
    const hour = new Date().getHours();
    const now = Date.now();

    // Detect time period change -> greet
    if (hour !== lastGreetingHour && [6, 12, 18, 23].includes(hour)) {
      showTimeGreeting();
      lastGreetingHour = hour;
    }

    // Sleep time check (23:00~06:00)
    if (hour >= 23 || hour < 6) {
      const state = StateMachine.getState();
      if (state !== 'sleeping' && state !== 'interacting') {
        if (Math.random() < 0.2) {
          StateMachine.forceState('sleeping');
          showSleepEffect();
        }
      }
    }

    // Idle chatter when in idle state
    const state = StateMachine.getState();
    if (state === 'idle' && now - lastChatterTime > CHATTER_COOLDOWN) {
      if (Math.random() < chatterChance) {
        const msgs = window._messages;
        if (msgs && msgs.idle_chatter) {
          const msg = msgs.idle_chatter[Math.floor(Math.random() * msgs.idle_chatter.length)];
          Speech.show(msg);
          lastChatterTime = now;
        }
      }
    }

    // Tip messages (less frequently)
    if (now - lastTipTime > TIP_COOLDOWN && Math.random() < 0.05) {
      const tip = Speech.getTipMessage();
      if (tip) {
        Speech.show(tip);
        lastTipTime = now;
      }
    }
  }

  function showTimeGreeting() {
    const msg = Speech.getGreetingMessage();
    if (msg) Speech.show(msg);
    lastGreetingHour = new Date().getHours();
  }

  function showSleepEffect() {
    const pet = document.getElementById('pet-container');
    // Add Z-z-z sleep effect
    for (let i = 0; i < 3; i++) {
      const z = document.createElement('div');
      z.className = 'sleep-z';
      z.textContent = 'z';
      z.style.animationDelay = (i * 0.5) + 's';
      pet.appendChild(z);
    }
    // Remove after 5 seconds
    setTimeout(() => {
      pet.querySelectorAll('.sleep-z').forEach(el => el.remove());
    }, 5000);
  }

  return { init, setChatterChance, tick };
})();
