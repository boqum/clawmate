/**
 * ClawMate renderer initialization
 *
 * Architecture:
 *   AI (brain) <-> AI Bridge (WebSocket) <-> AI Controller (renderer)
 *                                                       |
 *                                          StateMachine / PetEngine / Speech
 *
 * When AI connected: AI decides all behaviors/speech/emotions
 * When AI disconnected: Autonomous mode (FSM-based) plays alone
 */
(async function initClawMate() {
  const petContainer = document.getElementById('pet-container');

  // Create character canvas
  Character.createCanvas(petContainer);

  // Set default colors (Pet mode)
  Character.setColorMap({
    primary: '#ff4f40',
    secondary: '#ff775f',
    dark: '#8B4513',
    eye: '#ffffff',
    pupil: '#111111',
    claw: '#ff4f40',
  });

  // State change callback
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

    // Record motion history
    Memory.recordMotion(newState);

    // Report state changes to AI
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('state_change', {
        from: prevState, to: newState,
      });
    }
  });

  // Initialize movement engine
  PetEngine.init(petContainer);

  // Initialize mode manager
  await ModeManager.init();

  // Initialize memory (including evolution state)
  await Memory.init();

  // Initialize AI controller (AI connection management)
  AIController.init();

  // Initialize interactions
  Interactions.init();

  // Initialize time awareness (only proactive in autonomous mode)
  TimeAware.init();

  // Initialize metrics collector (optional -- app works fine without it)
  if (typeof Metrics !== 'undefined') {
    Metrics.init();
  }

  // Initialize browser watcher (nosy mode)
  if (typeof BrowserWatcher !== 'undefined') {
    BrowserWatcher.init();
  }

  // Start engine
  PetEngine.start();

  // Speech bubble position update loop
  setInterval(() => {
    Speech.updatePosition();
  }, 100);

  // Display AI connection status
  const connected = await window.clawmate.isAIConnected();
  if (connected) {
    Speech.show('Connected to AI. Awaiting instructions...');
  } else {
    Speech.show('Hi! I can play on my own just fine!');
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
