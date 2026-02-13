/**
 * Real-time pet behavior quality meter (Self-Observation System)
 *
 * Collects various metrics on the renderer side so ClawMate can
 * observe and measure its own behavior quality, then sends them to the main process.
 *
 * Collected metrics:
 *   - frameRate: Actual FPS (requestAnimationFrame based)
 *   - stateTransitions: State transition count/patterns (last 60 seconds)
 *   - movementSmoothness: Movement smoothness (variance of consecutive position changes)
 *   - wallContactAccuracy: Wall contact accuracy (edge offset effect)
 *   - interactionResponseTime: Click -> response time
 *   - animationFrameConsistency: Frame transition consistency
 *   - idleRatio: Idle time ratio of total time
 *   - explorationCoverage: Screen exploration coverage (visited area ratio)
 *   - speechFrequency: Speech bubble frequency
 *   - userEngagement: User interaction frequency
 *
 * Performance notes:
 *   - Does not directly interfere with requestAnimationFrame loop
 *   - Lightweight sampling approach (periodic polling, not per-frame collection)
 *   - Summary sent every 30 seconds
 */
const Metrics = (() => {
  // --- Configuration constants ---
  const REPORT_INTERVAL = 30000;       // Metric report interval (30s)
  const SAMPLE_INTERVAL = 200;         // Position sampling interval (200ms)
  const FPS_SAMPLE_INTERVAL = 1000;    // FPS measurement interval (1s)
  const GRID_SIZE = 8;                 // Exploration coverage grid (8x8 = 64 cells)
  const TRANSITION_WINDOW = 60000;     // State transition record retention time (60s)

  // --- Internal state ---
  let initialized = false;
  let reportTimer = null;
  let sampleTimer = null;
  let fpsRafId = null;

  // FPS measurement
  let fpsFrameCount = 0;
  let fpsLastTime = 0;
  let currentFps = 60;
  let fpsHistory = [];                 // FPS records for the last 30 seconds

  // State transition tracking
  let stateTransitions = [];           // [{ from, to, timestamp }]
  let stateTimeAccum = {};             // { 'idle': totalMs, 'walking': totalMs, ... }
  let lastStateChangeTime = 0;
  let lastObservedState = null;

  // Movement smoothness measurement
  let positionSamples = [];            // [{ x, y, timestamp }]

  // Wall contact accuracy
  let wallContactSamples = 0;         // Samples during wall contact
  let wallContactAccurateSamples = 0; // Accurate contact samples

  // Interaction response time
  let lastClickTime = 0;              // Last click timestamp
  let interactionResponseTimes = [];  // [ms] Response time records

  // Frame transition consistency
  let animFrameTimestamps = [];       // Animation frame transition timestamps

  // Exploration coverage (8x8 grid)
  let visitedGrid = new Set();        // Visited grid cells (string keys)
  let screenW = 0;
  let screenH = 0;

  // Speech bubble frequency
  let speechCount = 0;

  // User interaction frequency
  let userClickCount = 0;

  // Report period start time
  let periodStartTime = 0;

  // ===================================
  //  Initialization
  // ===================================

  /**
   * Initialize metrics system
   * Observes externally without interfering with existing engine/FSM
   */
  function init() {
    if (initialized) return;
    initialized = true;

    screenW = window.innerWidth;
    screenH = window.innerHeight;
    periodStartTime = Date.now();
    lastStateChangeTime = Date.now();

    window.addEventListener('resize', () => {
      screenW = window.innerWidth;
      screenH = window.innerHeight;
    });

    // FPS measurement loop (separate rAF -- no interference with existing engine loop)
    _startFpsMeasurement();

    // Periodic position/state sampling (200ms interval)
    sampleTimer = setInterval(_sampleState, SAMPLE_INTERVAL);

    // Summary report every 30 seconds
    reportTimer = setInterval(_reportSummary, REPORT_INTERVAL);

    // Monitor StateMachine state changes (non-destructive wrapping of existing callback chain)
    _hookStateChanges();

    // Monitor user click events
    _hookUserInteractions();

    // Monitor speech bubble events
    _hookSpeechEvents();

    console.log('[Metrics] Self-observation system initialized');
  }

  // ===================================
  //  FPS Measurement
  // ===================================

  /**
   * Measure actual framerate with a separate rAF loop
   * Operates independently from PetEngine's rAF loop
   */
  function _startFpsMeasurement() {
    fpsFrameCount = 0;
    fpsLastTime = performance.now();

    function fpsLoop(timestamp) {
      fpsFrameCount++;

      // Calculate FPS every second
      const elapsed = timestamp - fpsLastTime;
      if (elapsed >= FPS_SAMPLE_INTERVAL) {
        currentFps = Math.round((fpsFrameCount / elapsed) * 1000 * 10) / 10;
        fpsHistory.push(currentFps);

        // Keep last 30 entries (30 seconds)
        if (fpsHistory.length > 30) fpsHistory.shift();

        fpsFrameCount = 0;
        fpsLastTime = timestamp;
      }

      fpsRafId = requestAnimationFrame(fpsLoop);
    }

    fpsRafId = requestAnimationFrame(fpsLoop);
  }

  // ===================================
  //  Periodic State Sampling
  // ===================================

  /**
   * Sample pet position/state every 200ms
   * Reads data from PetEngine and StateMachine in read-only mode
   */
  function _sampleState() {
    const now = Date.now();

    // Position sampling (for movement smoothness calculation)
    if (typeof PetEngine !== 'undefined') {
      const pos = PetEngine.getPosition();
      positionSamples.push({ x: pos.x, y: pos.y, timestamp: now });

      // Keep only last 30 seconds worth (150 entries)
      if (positionSamples.length > 150) positionSamples.shift();

      // Exploration coverage: record current position on grid
      if (screenW > 0 && screenH > 0) {
        const gridX = Math.floor((pos.x / screenW) * GRID_SIZE);
        const gridY = Math.floor((pos.y / screenH) * GRID_SIZE);
        const clampedX = Math.max(0, Math.min(GRID_SIZE - 1, gridX));
        const clampedY = Math.max(0, Math.min(GRID_SIZE - 1, gridY));
        visitedGrid.add(`${clampedX},${clampedY}`);
      }

      // Wall contact accuracy sampling
      if (pos.onSurface && pos.movementMode === 'crawling') {
        wallContactSamples++;
        // Check if accurately flush against edge (based on CHAR_SIZE = 64)
        const charSize = PetEngine.CHAR_SIZE || 64;
        let isAccurate = false;

        switch (pos.edge) {
          case 'bottom':
            isAccurate = pos.y >= (screenH - charSize - 6); // EDGE_OFFSET(4) + 2 tolerance
            break;
          case 'top':
            isAccurate = pos.y <= 6;
            break;
          case 'left':
            isAccurate = pos.x <= 6;
            break;
          case 'right':
            isAccurate = pos.x >= (screenW - charSize - 6);
            break;
          case 'surface':
            isAccurate = true; // On surface is always accurate
            break;
        }
        if (isAccurate) wallContactAccurateSamples++;
      }
    }

    // Update accumulated time per state
    if (typeof StateMachine !== 'undefined') {
      const state = StateMachine.getState();
      if (state !== lastObservedState) {
        // Accumulate time for previous state
        if (lastObservedState) {
          const duration = now - lastStateChangeTime;
          stateTimeAccum[lastObservedState] = (stateTimeAccum[lastObservedState] || 0) + duration;
        }
        lastObservedState = state;
        lastStateChangeTime = now;
      }
    }
  }

  // ===================================
  //  Event Hooks (non-destructive)
  // ===================================

  /**
   * Monitor StateMachine state transitions
   * Wraps existing onStateChange callback to also collect metrics
   */
  function _hookStateChanges() {
    if (typeof StateMachine === 'undefined') return;

    // Preserve existing callback
    const originalCallback = StateMachine._metricsOriginalCallback;

    StateMachine.setOnStateChange((prevState, newState) => {
      // Metrics collection: record state transition
      const now = Date.now();
      stateTransitions.push({ from: prevState, to: newState, timestamp: now });

      // Remove records older than TRANSITION_WINDOW
      while (stateTransitions.length > 0 &&
             stateTransitions[0].timestamp < now - TRANSITION_WINDOW) {
        stateTransitions.shift();
      }

      // Accumulate previous state time
      if (prevState) {
        const duration = now - lastStateChangeTime;
        stateTimeAccum[prevState] = (stateTimeAccum[prevState] || 0) + duration;
      }
      lastObservedState = newState;
      lastStateChangeTime = now;

      // Execute existing app.js callback chain
      // (Since app.js calls setOnStateChange first,
      //  Metrics.init() called afterward overwrites the existing callback.
      //  Therefore we reproduce the app.js callback logic here.)
      _invokeOriginalStateChangeHandler(prevState, newState);
    });
  }

  /**
   * Reproduce the original state change callback logic set in app.js
   * Since Metrics overwrites setOnStateChange, the original behavior must be preserved.
   */
  function _invokeOriginalStateChangeHandler(prevState, newState) {
    // Sleep 'z' particles
    if (newState === 'sleeping') {
      const pet = document.getElementById('pet-container');
      if (pet) {
        for (let i = 0; i < 3; i++) {
          const z = document.createElement('div');
          z.className = 'sleep-z';
          z.textContent = 'z';
          pet.appendChild(z);
        }
      }
    }
    if (prevState === 'sleeping') {
      document.querySelectorAll('.sleep-z').forEach(el => el.remove());
    }
    if (newState === 'excited') {
      if (typeof Interactions !== 'undefined') {
        Interactions.spawnStarEffect();
      }
    }

    // Report state change to AI
    if (window.clawmate && window.clawmate.reportToAI) {
      window.clawmate.reportToAI('state_change', {
        from: prevState, to: newState,
      });
    }
  }

  /**
   * Monitor user interactions (click events)
   * Measure response time from click to state change
   */
  function _hookUserInteractions() {
    const petContainer = document.getElementById('pet-container');
    if (!petContainer) return;

    petContainer.addEventListener('mousedown', () => {
      lastClickTime = Date.now();
      userClickCount++;
    });

    // Record response time when state change occurs after click
    // (Check when new entry is added to stateTransitions)
    const origPush = Array.prototype.push;
    const responseTimes = interactionResponseTimes;
    const clickTimeRef = { get: () => lastClickTime };

    // Instead of MutationObserver, handled inside _hookStateChanges
    // Calculate time from click at the moment of state transition
    setInterval(() => {
      if (lastClickTime > 0 && stateTransitions.length > 0) {
        const lastTransition = stateTransitions[stateTransitions.length - 1];
        if (lastTransition.timestamp > lastClickTime) {
          const responseTime = lastTransition.timestamp - lastClickTime;
          // Only responses within 3 seconds are valid (beyond that is an unrelated transition)
          if (responseTime < 3000) {
            interactionResponseTimes.push(responseTime);
            if (interactionResponseTimes.length > 50) {
              interactionResponseTimes.shift();
            }
          }
          lastClickTime = 0; // Measurement complete, reset
        }
      }
    }, 500);
  }

  /**
   * Monitor speech bubble events
   * Detect Speech module's show() calls and count them
   */
  function _hookSpeechEvents() {
    if (typeof Speech === 'undefined') return;

    // Wrap Speech.show to count invocations
    const originalShow = Speech.show;
    if (typeof originalShow === 'function') {
      Speech.show = function(...args) {
        speechCount++;
        return originalShow.apply(this, args);
      };
    }
  }

  // ===================================
  //  Metric Calculations
  // ===================================

  /**
   * Calculate movement smoothness
   * Smaller variance of consecutive position changes = smoother
   *
   * @returns {number} 0~1 (1 is smoothest)
   */
  function _calcMovementSmoothness() {
    if (positionSamples.length < 3) return 1.0;

    // Calculate variance of consecutive movement vector magnitude changes
    const deltas = [];
    for (let i = 1; i < positionSamples.length; i++) {
      const dx = positionSamples[i].x - positionSamples[i - 1].x;
      const dy = positionSamples[i].y - positionSamples[i - 1].y;
      deltas.push(Math.sqrt(dx * dx + dy * dy));
    }

    if (deltas.length < 2) return 1.0;

    // Variance of differences between consecutive deltas (change in acceleration)
    const accelChanges = [];
    for (let i = 1; i < deltas.length; i++) {
      accelChanges.push(Math.abs(deltas[i] - deltas[i - 1]));
    }

    const avgAccelChange = accelChanges.reduce((a, b) => a + b, 0) / accelChanges.length;

    // Convert variance to 0~1 score (larger avgAccelChange = less smooth)
    // Abrupt change of 10px+ = 0, 0 = 1
    const smoothness = Math.max(0, Math.min(1, 1 - (avgAccelChange / 10)));
    return Math.round(smoothness * 100) / 100;
  }

  /**
   * Calculate frame transition consistency
   * Consistency of animation frame intervals (FPS stability)
   *
   * @returns {number} 0~1 (1 is most consistent)
   */
  function _calcFrameConsistency() {
    if (fpsHistory.length < 2) return 1.0;

    const avg = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
    if (avg === 0) return 0;

    // FPS standard deviation / mean (coefficient of variation)
    const variance = fpsHistory.reduce((sum, fps) => sum + Math.pow(fps - avg, 2), 0) / fpsHistory.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / avg; // Coefficient of variation

    // cv of 0 = perfect consistency, 0.5+ = very unstable
    const consistency = Math.max(0, Math.min(1, 1 - cv * 2));
    return Math.round(consistency * 100) / 100;
  }

  /**
   * Aggregate state transition counts
   * Transition count per state within the last 60 seconds
   *
   * @returns {object} { idle: n, walking: n, ... }
   */
  function _calcStateTransitionCounts() {
    const counts = {};
    const now = Date.now();
    for (const t of stateTransitions) {
      if (now - t.timestamp <= TRANSITION_WINDOW) {
        counts[t.to] = (counts[t.to] || 0) + 1;
      }
    }
    return counts;
  }

  /**
   * Calculate idle ratio
   * Ratio of time spent in idle state within the report period
   *
   * @returns {number} 0~1
   */
  function _calcIdleRatio() {
    const totalTime = Date.now() - periodStartTime;
    if (totalTime <= 0) return 0;

    const idleTime = stateTimeAccum['idle'] || 0;
    const ratio = idleTime / totalTime;
    return Math.round(Math.min(1, ratio) * 100) / 100;
  }

  /**
   * Calculate exploration coverage
   * Ratio of visited cells in the 8x8 grid
   *
   * @returns {number} 0~1
   */
  function _calcExplorationCoverage() {
    const totalCells = GRID_SIZE * GRID_SIZE;
    const coverage = visitedGrid.size / totalCells;
    return Math.round(coverage * 100) / 100;
  }

  /**
   * Calculate wall contact accuracy
   *
   * @returns {number} 0~1
   */
  function _calcWallContactAccuracy() {
    if (wallContactSamples === 0) return 1.0;
    const accuracy = wallContactAccurateSamples / wallContactSamples;
    return Math.round(accuracy * 100) / 100;
  }

  /**
   * Calculate average interaction response time
   *
   * @returns {number} ms (0 if no response records)
   */
  function _calcAvgInteractionResponse() {
    if (interactionResponseTimes.length === 0) return 0;
    const avg = interactionResponseTimes.reduce((a, b) => a + b, 0) / interactionResponseTimes.length;
    return Math.round(avg);
  }

  // ===================================
  //  Snapshot and Summary
  // ===================================

  /**
   * Return current metric snapshot (real-time)
   * @returns {object}
   */
  function getSnapshot() {
    return {
      timestamp: Date.now(),
      fps: currentFps,
      stateTransitions: _calcStateTransitionCounts(),
      movementSmoothness: _calcMovementSmoothness(),
      wallContactAccuracy: _calcWallContactAccuracy(),
      interactionResponseMs: _calcAvgInteractionResponse(),
      animationFrameConsistency: _calcFrameConsistency(),
      idleRatio: _calcIdleRatio(),
      explorationCoverage: _calcExplorationCoverage(),
      speechCount: speechCount,
      userClicks: userClickCount,
    };
  }

  /**
   * Generate 30-second period summary + reset counters
   * @returns {object} Metric summary data
   */
  function getSummary() {
    const now = Date.now();
    const period = now - periodStartTime;

    // Also accumulate time for the last observed state
    if (lastObservedState) {
      const duration = now - lastStateChangeTime;
      stateTimeAccum[lastObservedState] = (stateTimeAccum[lastObservedState] || 0) + duration;
      lastStateChangeTime = now;
    }

    // Calculate average FPS
    const avgFps = fpsHistory.length > 0
      ? Math.round((fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length) * 10) / 10
      : 60;

    const summary = {
      timestamp: now,
      fps: avgFps,
      stateTransitions: _calcStateTransitionCounts(),
      movementSmoothness: _calcMovementSmoothness(),
      wallContactAccuracy: _calcWallContactAccuracy(),
      interactionResponseMs: _calcAvgInteractionResponse(),
      animationFrameConsistency: _calcFrameConsistency(),
      idleRatio: _calcIdleRatio(),
      explorationCoverage: _calcExplorationCoverage(),
      speechCount: speechCount,
      userClicks: userClickCount,
      period: period,
    };

    // Reset period counters (keep accumulated data, only reset period counters)
    periodStartTime = now;
    speechCount = 0;
    userClickCount = 0;
    stateTimeAccum = {};
    fpsHistory = [];
    interactionResponseTimes = [];
    // visitedGrid is not reset (accumulated exploration record)
    // positionSamples automatically removes old entries

    return summary;
  }

  // ===================================
  //  Reporting
  // ===================================

  /**
   * Send metric summary to main process every 30 seconds
   */
  function _reportSummary() {
    const summary = getSummary();

    // Send to main process (via preload bridge)
    if (window.clawmate && typeof window.clawmate.reportMetrics === 'function') {
      window.clawmate.reportMetrics(summary);
    }

    // Brief console output (for debugging)
    console.log(
      `[Metrics] FPS:${summary.fps} | ` +
      `smooth:${summary.movementSmoothness} | ` +
      `idle:${(summary.idleRatio * 100).toFixed(0)}% | ` +
      `explore:${(summary.explorationCoverage * 100).toFixed(0)}% | ` +
      `clicks:${summary.userClicks} | ` +
      `speech:${summary.speechCount}`
    );
  }

  /**
   * Reset exploration coverage grid
   * Used when starting a new exploration session externally
   */
  function resetExplorationGrid() {
    visitedGrid.clear();
  }

  /**
   * System cleanup
   */
  function destroy() {
    if (reportTimer) clearInterval(reportTimer);
    if (sampleTimer) clearInterval(sampleTimer);
    if (fpsRafId) cancelAnimationFrame(fpsRafId);
    initialized = false;
    console.log('[Metrics] Self-observation system terminated');
  }

  // --- Public API ---
  return {
    init,
    getSnapshot,
    getSummary,
    resetExplorationGrid,
    destroy,
  };
})();
