/**
 * User interaction memory + evolution system
 *
 * - Tracks click count, days, milestones
 * - Evolution stage management: always evolves in positive/cute directions only
 * - Never transforms into scary/creepy appearances
 */
const Memory = (() => {
  let data = {
    totalClicks: 0,
    totalDays: 0,
    firstRunDate: null,
    lastVisitDate: null,
    milestones: [],
    evolutionStage: 0,
    interactionStreak: 0,    // Consecutive visit days

    // --- Motion history ---
    motionHistory: [],       // Recent 100 state transition records [{state, timestamp, duration}]
    motionStats: {},         // Accumulated time per state {idle: 12345, walking: 6789, ...}

    // --- User reaction storage ---
    reactionLog: [],         // Recent 50 user reactions [{action, reaction, timestamp}]
    favoriteActions: {},     // Positive reaction count per action {excited: 5, walking: 2, ...}
    dislikedActions: {},     // Negative reaction count per action (ignored/abandoned)
  };

  let lastMotionState = null;
  let lastMotionTime = 0;
  const MAX_MOTION_HISTORY = 100;
  const MAX_REACTION_LOG = 50;

  let evolutionStages = null;

  async function init() {
    try {
      const saved = await window.clawmate.getMemory();
      if (saved) data = { ...data, ...saved };
    } catch {}

    evolutionStages = window._evolutionStages;

    // First run
    if (!data.firstRunDate) {
      data.firstRunDate = new Date().toISOString();
      await save();
    }

    // Calculate days
    updateDayCount();

    // Check milestones
    checkMilestones();

    // Check evolution
    checkEvolution();

    // Apply evolution visual effects
    applyEvolutionVisuals();
  }

  function updateDayCount() {
    const firstRun = new Date(data.firstRunDate);
    const now = new Date();
    data.totalDays = Math.floor((now - firstRun) / (1000 * 60 * 60 * 24));

    // Check consecutive visits
    const lastVisit = data.lastVisitDate ? new Date(data.lastVisitDate) : null;
    const today = now.toDateString();
    if (lastVisit && lastVisit.toDateString() !== today) {
      const dayDiff = Math.floor((now - lastVisit) / (1000 * 60 * 60 * 24));
      if (dayDiff === 1) {
        data.interactionStreak++;
      } else if (dayDiff > 1) {
        data.interactionStreak = 1;
      }
    }
    data.lastVisitDate = now.toISOString();
  }

  function recordClick() {
    data.totalClicks++;
    checkMilestones();
    checkEvolution();
    save();
  }

  function checkMilestones() {
    const milestoneChecks = [
      { key: 'first_click', condition: () => data.totalClicks >= 1 },
      { key: 'clicks_10', condition: () => data.totalClicks >= 10 },
      { key: 'clicks_50', condition: () => data.totalClicks >= 50 },
      { key: 'clicks_100', condition: () => data.totalClicks >= 100 },
      { key: 'clicks_500', condition: () => data.totalClicks >= 500 },
      { key: 'days_1', condition: () => data.totalDays >= 1 },
      { key: 'days_7', condition: () => data.totalDays >= 7 },
      { key: 'days_30', condition: () => data.totalDays >= 30 },
      { key: 'days_100', condition: () => data.totalDays >= 100 },
    ];

    for (const check of milestoneChecks) {
      if (!data.milestones.includes(check.key) && check.condition()) {
        data.milestones.push(check.key);
        const msg = Speech.getMilestoneMessage(check.key);
        if (msg) {
          // Display milestone message after a slight delay
          setTimeout(() => {
            Speech.show(msg);
            Interactions.spawnStarEffect();
          }, 1000);
        }
      }
    }
  }

  /**
   * Check evolution stage
   * Only goes up (no devolution)
   * Condition: both click count and days together must be met
   */
  function checkEvolution() {
    if (!evolutionStages) return;

    let newStage = data.evolutionStage;

    for (let stage = 5; stage >= 0; stage--) {
      const req = evolutionStages[stage];
      if (!req) continue;
      if (data.totalClicks >= req.clicksRequired && data.totalDays >= req.daysRequired) {
        newStage = stage;
        break;
      }
    }

    if (newStage > data.evolutionStage) {
      const prevStage = data.evolutionStage;
      data.evolutionStage = newStage;
      onEvolution(prevStage, newStage);
      save();
    }
  }

  /**
   * Evolution event handler
   * - Bright flash effect (soft light)
   * - Sparkle particles
   * - Congratulatory message
   */
  function onEvolution(prevStage, newStage) {
    const msgs = window._messages;
    const stageInfo = evolutionStages[newStage];

    // Bright flash (soft, non-scary effect)
    const flash = document.createElement('div');
    flash.className = 'evolve-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 600);

    // Evolution sparkle particles (bright colors only)
    const pos = PetEngine.getPosition();
    const sparkleColors = ['#FFD700', '#FF69B4', '#87CEEB', '#98FB98', '#DDA0DD'];
    for (let i = 0; i < 16; i++) {
      const sparkle = document.createElement('div');
      sparkle.className = 'evolve-sparkle';
      sparkle.style.backgroundColor = sparkleColors[i % sparkleColors.length];
      sparkle.style.left = (pos.x + 32 + (Math.random() - 0.5) * 80) + 'px';
      sparkle.style.top = (pos.y + 32 + (Math.random() - 0.5) * 80) + 'px';
      document.getElementById('world').appendChild(sparkle);
      setTimeout(() => sparkle.remove(), 800);
    }

    // Evolution ring effect (warm colors)
    const ring = document.createElement('div');
    ring.className = 'evolve-ring';
    ring.style.width = '64px';
    ring.style.height = '64px';
    ring.style.left = pos.x + 'px';
    ring.style.top = pos.y + 'px';
    ring.style.borderColor = '#FFD700';
    document.getElementById('world').appendChild(ring);
    setTimeout(() => ring.remove(), 1000);

    // Congratulatory message
    if (msgs && msgs.evolution) {
      const evolveMsg = msgs.evolution[`stage_${newStage}`];
      if (evolveMsg) {
        setTimeout(() => Speech.show(evolveMsg), 800);
      }
    }

    // Update visual effects
    applyEvolutionVisuals();
  }

  /**
   * Apply visual changes based on evolution stage
   * Always positive: gets brighter, sparkly, and cute accessories added
   */
  function applyEvolutionVisuals() {
    if (!evolutionStages) return;
    const stage = evolutionStages[data.evolutionStage];
    if (!stage) return;

    const pet = document.getElementById('pet-container');
    if (!pet) return;

    // Size scale
    pet.style.transform = pet.style.transform || '';

    // Brightness/saturation -- gets brighter and more vibrant with evolution
    const { brightness, saturation } = stage.colorMod;
    const canvas = pet.querySelector('canvas');
    if (canvas) {
      canvas.style.filter = `brightness(${brightness}) saturate(${saturation})`;
    }

    // Remove accessories then reapply
    pet.querySelectorAll('.accessory').forEach(a => a.remove());

    for (const acc of stage.accessories) {
      addAccessory(pet, acc);
    }
  }

  /**
   * Add cute accessories
   * All accessories are bright and cute elements only
   */
  function addAccessory(container, type) {
    const acc = document.createElement('div');
    acc.className = 'accessory';
    acc.style.position = 'absolute';
    acc.style.pointerEvents = 'none';
    acc.style.zIndex = '1001';

    switch (type) {
      case 'blush':
        // Pink circles on both cheeks
        acc.style.width = '8px';
        acc.style.height = '6px';
        acc.style.borderRadius = '50%';
        acc.style.background = 'rgba(255, 150, 150, 0.6)';
        acc.style.left = '12px';
        acc.style.top = '38px';
        container.appendChild(acc);
        // Right cheek
        const blush2 = acc.cloneNode();
        blush2.style.left = '44px';
        container.appendChild(blush2);
        return;

      case 'sparkle_eyes':
        // Eye sparkles (small white dots)
        acc.style.width = '3px';
        acc.style.height = '3px';
        acc.style.borderRadius = '50%';
        acc.style.background = '#ffffff';
        acc.style.left = '24px';
        acc.style.top = '28px';
        acc.style.boxShadow = '0 0 2px #fff';
        container.appendChild(acc);
        const sparkle2 = acc.cloneNode();
        sparkle2.style.left = '40px';
        container.appendChild(sparkle2);
        return;

      case 'crown':
        acc.textContent = '\u{1F451}';
        acc.style.fontSize = '12px';
        acc.style.left = '22px';
        acc.style.top = '-8px';
        break;

      case 'golden_crown':
        acc.textContent = '\u{1F451}';
        acc.style.fontSize = '14px';
        acc.style.left = '20px';
        acc.style.top = '-10px';
        acc.style.filter = 'drop-shadow(0 0 3px gold)';
        break;

      case 'aura':
        acc.style.width = '80px';
        acc.style.height = '80px';
        acc.style.borderRadius = '50%';
        acc.style.left = '-8px';
        acc.style.top = '-8px';
        acc.style.background = 'radial-gradient(circle, rgba(255,215,0,0.15) 0%, transparent 70%)';
        acc.style.animation = 'pulse-aura 2s ease-in-out infinite';
        break;

      case 'rainbow_aura':
        acc.style.width = '90px';
        acc.style.height = '90px';
        acc.style.borderRadius = '50%';
        acc.style.left = '-13px';
        acc.style.top = '-13px';
        acc.style.background = 'conic-gradient(from 0deg, rgba(255,0,0,0.1), rgba(255,165,0,0.1), rgba(255,255,0,0.1), rgba(0,128,0,0.1), rgba(0,0,255,0.1), rgba(128,0,128,0.1), rgba(255,0,0,0.1))';
        acc.style.animation = 'spin-slow 8s linear infinite';
        break;

      case 'wings':
        // Small angel wings (left)
        acc.textContent = '\u{1FABD}';
        acc.style.fontSize = '10px';
        acc.style.left = '-6px';
        acc.style.top = '20px';
        acc.style.opacity = '0.7';
        container.appendChild(acc);
        // Right wing
        const wing2 = acc.cloneNode(true);
        wing2.style.left = '58px';
        wing2.style.transform = 'scaleX(-1)';
        container.appendChild(wing2);
        return;
    }

    container.appendChild(acc);
  }

  // --- Motion history recording ---

  /**
   * Record state transition
   * Called when state changes in StateMachine
   */
  function recordMotion(newState) {
    const now = Date.now();

    // Calculate previous state duration -> accumulate statistics
    if (lastMotionState && lastMotionTime > 0) {
      const duration = now - lastMotionTime;
      if (!data.motionStats[lastMotionState]) data.motionStats[lastMotionState] = 0;
      data.motionStats[lastMotionState] += duration;
    }

    // Add to history
    data.motionHistory.push({
      state: newState,
      timestamp: now,
      from: lastMotionState || 'init',
    });

    // Remove old entries when exceeding max size
    if (data.motionHistory.length > MAX_MOTION_HISTORY) {
      data.motionHistory = data.motionHistory.slice(-MAX_MOTION_HISTORY);
    }

    lastMotionState = newState;
    lastMotionTime = now;

    // Auto-save every 10 transitions
    if (data.motionHistory.length % 10 === 0) save();
  }

  /**
   * Record user reaction
   * When user shows reactions like click/drag during a specific action
   *
   * @param {string} action - Action the pet was performing
   * @param {string} reaction - 'click' | 'drag' | 'cursor_near' | 'triple_click' | 'double_click'
   */
  function recordReaction(action, reaction) {
    const now = Date.now();

    // Add to reaction log
    data.reactionLog.push({ action, reaction, timestamp: now });
    if (data.reactionLog.length > MAX_REACTION_LOG) {
      data.reactionLog = data.reactionLog.slice(-MAX_REACTION_LOG);
    }

    // Click/double-click classified as positive reactions
    if (reaction === 'click' || reaction === 'double_click' || reaction === 'cursor_near') {
      if (!data.favoriteActions[action]) data.favoriteActions[action] = 0;
      data.favoriteActions[action]++;
    }
    // Drag (grab and move) is a slightly negative reaction
    if (reaction === 'drag') {
      if (!data.dislikedActions[action]) data.dislikedActions[action] = 0;
      data.dislikedActions[action]++;
    }

    save();
  }

  /**
   * Return top N user-preferred actions
   * Referenced by AI when deciding actions
   */
  function getFavoriteActions(topN = 5) {
    const entries = Object.entries(data.favoriteActions || {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, topN).map(([action, count]) => ({ action, count }));
  }

  /**
   * Return recent motion history
   */
  function getMotionHistory(limit = 20) {
    return (data.motionHistory || []).slice(-limit);
  }

  /**
   * Return accumulated time per state
   */
  function getMotionStats() {
    return { ...(data.motionStats || {}) };
  }

  async function save() {
    try {
      await window.clawmate.saveMemory(data);
    } catch {}
  }

  function getData() {
    return { ...data };
  }

  function getEvolutionStage() {
    return data.evolutionStage;
  }

  return {
    init, recordClick, getData, getEvolutionStage, save,
    recordMotion, recordReaction, getFavoriteActions,
    getMotionHistory, getMotionStats,
  };
})();
