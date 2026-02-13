/**
 * Core movement/physics engine (renewed)
 * requestAnimationFrame based -- step movement + jump + rappel + gravity fall
 *
 * Movement modes:
 *   crawling   -- step-by-step crawling on surfaces
 *   jumping    -- parabolic trajectory jump
 *   falling    -- gravity-based free fall
 *   rappelling -- pendulum swing descent on a thread
 */
const PetEngine = (() => {
  // --- Physics constants ---
  const GRAVITY = 0.3;        // Gravity acceleration (px/frame^2)
  const STEP_SIZE = 4;        // Step size (px)
  const JUMP_VX = 3;          // Jump horizontal initial velocity
  const JUMP_VY = -7;         // Jump vertical initial velocity (upward)
  const BOUNCE_FACTOR = 0.3;  // Landing bounce factor
  const CHAR_SIZE = 64;       // Character size (px)
  const ANIM_INTERVAL = 150;  // Animation frame transition interval (ms) -- smooth transition
  const THREAD_SPEED = 0.8;   // Rappel descent speed (px/frame)

  // --- Position and velocity ---
  let x = 0, y = 0;
  let vx = 0, vy = 0;         // Current velocity vector

  // --- Surface/direction ---
  let edge = 'bottom';        // Currently attached edge (bottom, left, right, top, surface)
  let direction = 1;           // Movement direction: 1=right/down, -1=left/up
  let flipX = false;           // Character horizontal flip
  let prevFlipX = false;       // Previous frame flipX (for transition detection)
  let flipTransition = 0;      // flipX transition progress (0~1, 1 = complete)
  const FLIP_DURATION = 120;   // flipX transition duration (ms)
  let flipStartTime = 0;       // flipX transition start time
  let screenW, screenH;

  // --- Engine state ---
  let running = false;
  let petContainer = null;
  let speedMultiplier = 1.0;
  let animFrame = 0;
  let lastAnimTime = 0;
  let animFrameChanged = false;  // Animation frame change flag (synced with movement)

  // --- Movement mode ---
  let movementMode = 'crawling';  // crawling | jumping | falling | rappelling
  let onSurface = true;           // Whether on a surface

  // --- Step system (animation frame sync) ---

  // --- Rappel (thread) system ---
  // Pendulum swing descent from attachment point
  let thread = null;  // { attachX, attachY, length, angle, swingVel } | null

  // --- Window surface list ---
  // Register external window title bars etc. as additional surfaces
  let windowSurfaces = [];  // [{ id, x, y, width, height }]

  // --- Reference to current surface when landed ---
  let currentSurface = null;

  /**
   * Initialization: set up container and place at bottom-center of screen
   */
  function init(container) {
    petContainer = container;
    screenW = window.innerWidth;
    screenH = window.innerHeight;

    // Start at bottom-center of screen
    x = (screenW - CHAR_SIZE) / 2;
    y = screenH - CHAR_SIZE;
    edge = 'bottom';
    direction = 1;
    movementMode = 'crawling';
    onSurface = true;
    currentSurface = null;
    updateVisual();

    // Handle window resize
    window.addEventListener('resize', () => {
      screenW = window.innerWidth;
      screenH = window.innerHeight;
      clampPosition();
      updateVisual();
    });
  }

  /**
   * Set speed multiplier (adjusts speed based on personality/evolution stage)
   */
  function setSpeedMultiplier(mult) {
    speedMultiplier = mult;
  }

  /**
   * Clamp position within screen bounds
   */
  function clampPosition() {
    x = Math.max(0, Math.min(x, screenW - CHAR_SIZE));
    y = Math.max(0, Math.min(y, screenH - CHAR_SIZE));
  }

  // ===================================
  //  Visual update
  // ===================================

  /**
   * Update container position and rotation/flip
   * Apply transform so character faces correct direction per edge
   *
   * EDGE_OFFSET: Compensates for empty pixels (4px) at sprite border
   * so legs render flush against wall/floor/ceiling
   */
  const EDGE_OFFSET = 4;

  function updateVisual() {
    if (!petContainer) return;

    // --- Smooth flipX transition handling ---
    if (flipX !== prevFlipX) {
      // Start transition when direction changed
      flipStartTime = Date.now();
      flipTransition = 0;
      prevFlipX = flipX;
    }
    if (flipTransition < 1) {
      const elapsed = Date.now() - flipStartTime;
      flipTransition = Math.min(1, elapsed / FLIP_DURATION);
    }

    // Apply CSS transition during flip
    if (flipTransition < 1) {
      petContainer.style.transition = `transform ${FLIP_DURATION}ms ease-in-out`;
    } else {
      petContainer.style.transition = 'none';
    }

    let renderX = x;
    let renderY = y;

    // Apply offset only when attached to surface (not needed in mid-air)
    if (onSurface && movementMode === 'crawling') {
      switch (edge) {
        case 'bottom':
        case 'surface':
          renderY += EDGE_OFFSET;  // Floor: press legs down
          break;
        case 'top':
          renderY -= EDGE_OFFSET;  // Ceiling: press legs up
          break;
        case 'left':
          renderX -= EDGE_OFFSET;  // Left wall: press legs left
          break;
        case 'right':
          renderX += EDGE_OFFSET;  // Right wall: press legs right
          break;
      }
    }

    petContainer.style.left = renderX + 'px';
    petContainer.style.top = renderY + 'px';

    let transform = '';

    if (movementMode === 'rappelling' || movementMode === 'jumping' || movementMode === 'falling') {
      // Mid-air: default floor-based pose (no rotation)
      if (flipX) transform = 'scaleX(-1)';
    } else if (edge === 'left') {
      // Left wall: rotate counter-clockwise so legs face left edge
      transform = 'rotate(-90deg)';
      if (flipX) transform += ' scaleX(-1)';
    } else if (edge === 'right') {
      // Right wall: rotate clockwise so legs face right edge
      transform = 'rotate(90deg)';
      if (flipX) transform += ' scaleX(-1)';
    } else if (edge === 'top') {
      // Ceiling: flip vertically so legs face upward
      transform = 'scaleY(-1)';
      if (flipX) transform += ' scaleX(-1)';
    } else {
      // Floor/surface: default pose
      if (flipX) transform = 'scaleX(-1)';
    }

    petContainer.style.transform = transform || 'none';

    // Update rappel thread visualization
    updateThreadVisual();
  }

  /**
   * Visualize rappel thread as SVG line
   * Hide when no thread; when active, connect attachment point to character top
   */
  function updateThreadVisual() {
    const line = document.getElementById('thread-line');
    if (!line) return;

    if (!thread) {
      // Hide when no thread
      line.setAttribute('x1', '0');
      line.setAttribute('y1', '0');
      line.setAttribute('x2', '0');
      line.setAttribute('y2', '0');
      line.style.display = 'none';
      return;
    }

    // Draw thread from attachment point to character top-center
    line.style.display = 'block';
    line.setAttribute('x1', thread.attachX);
    line.setAttribute('y1', thread.attachY);
    line.setAttribute('x2', x + CHAR_SIZE / 2);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#888');
    line.setAttribute('stroke-width', '1');
  }

  // ===================================
  //  Step-based movement (choppy walking)
  // ===================================

  /**
   * Step movement: move one step only when animation frame transitions
   * Leg motion (frame change) and actual position movement are 1:1 synced
   * so the body only moves when legs move, creating natural walking
   *
   * @param {number} stepScale - Step size multiplier (0.6 = slow with load, 1.0 = default)
   */
  function stepMove(stepScale) {
    // Do not move if animation frame has not changed
    if (!animFrameChanged) return;

    // Advance one step
    const stepDist = STEP_SIZE * stepScale * speedMultiplier;

    if (edge === 'bottom' || edge === 'top' || edge === 'surface') {
      // Horizontal movement (floor, ceiling, window surface)
      x += stepDist * direction;
      flipX = direction < 0;
    } else if (edge === 'left') {
      // Left wall: y-axis movement (direction=1 goes down, -1 goes up)
      y += stepDist * direction;
    } else if (edge === 'right') {
      // Right wall: y-axis movement
      y += stepDist * direction;
    }
  }

  // ===================================
  //  Window surface detection
  // ===================================

  /**
   * Find window surface below a given position
   * Landable when character is within horizontal range and near surface top
   *
   * @param {number} px - Character x coordinate
   * @param {number} py - Character bottom y coordinate (y + CHAR_SIZE)
   * @returns {object|null} Landable surface or null
   */
  function findSurfaceBelow(px, py) {
    let closest = null;
    let closestDist = Infinity;

    for (const s of windowSurfaces) {
      // Check horizontal range: whether character overlaps surface
      if (px + CHAR_SIZE > s.x && px < s.x + s.width) {
        // Check if near surface top (falling from above)
        if (py >= s.y && py <= s.y + 10) {
          const dist = Math.abs(py - s.y);
          if (dist < closestDist) {
            closestDist = dist;
            closest = s;
          }
        }
      }
    }
    return closest;
  }

  /**
   * Register window surface list from external source
   * (e.g., register title bars of other windows as walkable surfaces)
   *
   * @param {Array} surfaces - [{ id, x, y, width, height }]
   */
  function setSurfaces(surfaces) {
    windowSurfaces = surfaces || [];
  }

  // ===================================
  //  Physics state-based movement handling
  // ===================================

  /**
   * Main movement logic: perform physics calculations based on movementMode
   *
   * @param {string} state - Current StateMachine state (walking, idle, etc.)
   */
  function moveForState(state) {
    switch (movementMode) {

      // --- Parabolic jump ---
      case 'jumping':
        vy += GRAVITY;  // Apply gravity
        x += vx;
        y += vy;
        flipX = vx < 0;

        // Floor landing detection
        if (y >= screenH - CHAR_SIZE) {
          y = screenH - CHAR_SIZE;
          // Bounce effect: slight rebound
          if (Math.abs(vy) > 2) {
            vy = -vy * BOUNCE_FACTOR;
          } else {
            edge = 'bottom';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = null;
            vx = 0;
            vy = 0;
          }
        }

        // Window surface landing detection (only while falling downward)
        if (vy > 0 && movementMode === 'jumping') {
          const landSurface = findSurfaceBelow(x, y + CHAR_SIZE);
          if (landSurface) {
            y = landSurface.y - CHAR_SIZE;
            edge = 'surface';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = landSurface;
            vx = 0;
            vy = 0;
          }
        }

        // Wall/ceiling collision -> attach to that edge
        if (x <= 0 && movementMode === 'jumping') {
          x = 0;
          edge = 'left';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vx = 0;
          vy = 0;
          direction = 1; // Downward direction
        }
        if (x >= screenW - CHAR_SIZE && movementMode === 'jumping') {
          x = screenW - CHAR_SIZE;
          edge = 'right';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vx = 0;
          vy = 0;
          direction = 1;
        }
        if (y <= 0 && movementMode === 'jumping') {
          y = 0;
          edge = 'top';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vx = 0;
          vy = 0;
          direction = 1; // Rightward direction
        }
        break;

      // --- Free fall (gravity) ---
      case 'falling':
        vy += GRAVITY;
        y += vy;

        // Window surface landing detection
        if (vy > 0) {
          const fallSurface = findSurfaceBelow(x, y + CHAR_SIZE);
          if (fallSurface) {
            y = fallSurface.y - CHAR_SIZE;
            edge = 'surface';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = fallSurface;
            vy = 0;
          }
        }

        // Floor landing
        if (y >= screenH - CHAR_SIZE) {
          y = screenH - CHAR_SIZE;
          edge = 'bottom';
          movementMode = 'crawling';
          onSurface = true;
          currentSurface = null;
          vy = 0;
        }
        break;

      // --- Rappel: pendulum swing descent on thread ---
      case 'rappelling':
        if (thread) {
          // Increase thread length -> descend
          thread.length += THREAD_SPEED * speedMultiplier;

          // Pendulum swing physics
          thread.swingVel += Math.sin(thread.angle) * 0.01;
          thread.swingVel *= 0.98; // Damping

          thread.angle += thread.swingVel;

          // Calculate pendulum position from attachment point
          x = thread.attachX + Math.sin(thread.angle) * thread.length - CHAR_SIZE / 2;
          y = thread.attachY + Math.cos(thread.angle) * thread.length;

          // Bounce off left/right screen edges
          if (x <= 0) {
            x = 0;
            thread.swingVel = Math.abs(thread.swingVel) * 0.5;
          }
          if (x >= screenW - CHAR_SIZE) {
            x = screenW - CHAR_SIZE;
            thread.swingVel = -Math.abs(thread.swingVel) * 0.5;
          }

          // Window surface landing detection
          const rappelSurface = findSurfaceBelow(x, y + CHAR_SIZE);
          if (rappelSurface) {
            y = rappelSurface.y - CHAR_SIZE;
            thread = null;
            edge = 'surface';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = rappelSurface;
          }

          // Reached floor
          if (y >= screenH - CHAR_SIZE) {
            y = screenH - CHAR_SIZE;
            thread = null;
            edge = 'bottom';
            movementMode = 'crawling';
            onSurface = true;
            currentSurface = null;
          }
        }
        break;

      // --- Surface crawling (step-based) ---
      case 'crawling':
      default:
        switch (state) {
          case 'walking':
          case 'ceiling_walk':
            stepMove(1.0);

            // Boundary handling for horizontal movement
            if (edge === 'bottom' || edge === 'top') {
              if (x <= 0) { x = 0; direction = 1; }
              if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
            }

            // Fall off edge when moving on window surface
            if (edge === 'surface' && currentSurface) {
              if (x <= currentSurface.x - CHAR_SIZE / 2 ||
                  x >= currentSurface.x + currentSurface.width - CHAR_SIZE / 2) {
                // Fell off surface edge -> falling mode
                movementMode = 'falling';
                onSurface = false;
                currentSurface = null;
                vy = 0;
                StateMachine.forceState('falling');
              }
            }
            break;

          case 'climbing_up':
            if (edge === 'bottom' || edge === 'surface') {
              // Transition from floor/surface to wall
              if (direction > 0) {
                x = screenW - CHAR_SIZE;
                edge = 'right';
              } else {
                x = 0;
                edge = 'left';
              }
              currentSurface = null;
              direction = -1; // Upward direction on wall
            }

            // Climbing up wall: y decreases
            if (edge === 'left' || edge === 'right') {
              stepMove(0.7);
              // stepMove applies direction(-1) so y decreases
            }

            // Reached ceiling
            if (y <= 0) {
              y = 0;
              edge = 'top';
              direction = 1; // Move rightward on ceiling
            }
            break;

          case 'climbing_down':
            // Climbing down wall: y increases
            if (edge === 'left' || edge === 'right') {
              // Set direction to 1 (down) for stepMove
              const prevDir = direction;
              direction = 1;
              stepMove(0.7);
              direction = prevDir;
            } else if (edge === 'top') {
              // Start descending from ceiling to wall
              if (x < screenW / 2) {
                x = 0;
                edge = 'left';
              } else {
                x = screenW - CHAR_SIZE;
                edge = 'right';
              }
              direction = 1; // Downward direction
            }

            // Reached floor
            if (y >= screenH - CHAR_SIZE) {
              y = screenH - CHAR_SIZE;
              edge = 'bottom';
              direction = Math.random() < 0.5 ? 1 : -1; // Random direction
            }
            break;

          case 'scared':
            // Flee: skip steps, fast continuous movement
            if (edge === 'bottom' || edge === 'top' || edge === 'surface') {
              x += STEP_SIZE * 2.5 * direction * speedMultiplier;
              flipX = direction < 0;
              if (x <= 0) { x = 0; direction = 1; }
              if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
            }
            break;

          case 'carrying':
            // Slow movement while carrying
            stepMove(0.6);
            if (edge === 'bottom' || edge === 'top' || edge === 'surface') {
              if (x <= 0) { x = 0; direction = 1; }
              if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
            }
            break;

          case 'excited':
            // Small jump effect (bouncing in place)
            if (typeof StateMachine !== 'undefined') {
              const elapsed = StateMachine.getElapsed();
              const jumpOffset = Math.sin(elapsed / 150) * 8;
              if (edge === 'bottom') {
                y = (screenH - CHAR_SIZE) + jumpOffset;
              } else if (edge === 'surface' && currentSurface) {
                y = (currentSurface.y - CHAR_SIZE) + jumpOffset;
              }
            }
            break;

          // Jumping state (physics state transitioned from StateMachine)
          case 'jumping':
            // Initiate if movementMode is not yet jumping
            if (movementMode === 'crawling') {
              _initiateRandomJump();
            }
            break;

          // Rappelling state
          case 'rappelling':
            if (movementMode === 'crawling') {
              startRappel();
            }
            break;

          // Falling state
          case 'falling':
            if (movementMode === 'crawling') {
              movementMode = 'falling';
              onSurface = false;
              vy = 0;
            }
            break;

          // Custom movement pattern in progress
          case 'custom':
            if (activeCustomMovement) {
              updateCustomMovement(now - (updateCustomMovement._lastTime || now));
              updateCustomMovement._lastTime = now;
            }
            break;

          case 'idle':
          case 'sleeping':
          case 'interacting':
          case 'playing':
            // Stationary or subtle sway (no movement)
            break;
        }
        break;
    }

    clampPosition();
    updateVisual();
  }

  /**
   * Random jump when StateMachine transitions to jumping state
   * Leap toward screen center or random position from current location
   */
  function _initiateRandomJump() {
    // Random target point near screen center
    const targetX = screenW * 0.2 + Math.random() * screenW * 0.6;
    const targetY = screenH * 0.3 + Math.random() * screenH * 0.4;
    jumpTo(targetX, targetY);
  }

  // ===================================
  //  Jump commands
  // ===================================

  /**
   * Start parabolic jump toward target point
   * Calculate initial velocity (vx, vy) to create parabolic trajectory
   *
   * @param {number} targetX - Target x coordinate
   * @param {number} targetY - Target y coordinate
   */
  function jumpTo(targetX, targetY) {
    if (movementMode !== 'crawling') return;

    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.hypot(dx, dy);

    // Estimate flight time (distance-based)
    const time = Math.max(20, dist / (JUMP_VX * 2 + 2));

    // Calculate parabolic initial velocity
    vx = dx / time;
    vy = (dy / time) - (GRAVITY * time) / 2;

    // Clamp vx, vy range (prevent excessive speed)
    const maxV = 8;
    vx = Math.max(-maxV, Math.min(maxV, vx));
    vy = Math.max(-12, Math.min(maxV, vy));

    movementMode = 'jumping';
    onSurface = false;
    currentSurface = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('jumping');
    }
  }

  // ===================================
  //  Rappel (Thread) system
  // ===================================

  /**
   * Start rappel: descend by lowering thread from ceiling or wall
   * Set attachment point at current position and begin pendulum swing
   */
  function startRappel() {
    // Rappel only possible from ceiling, left wall, or right wall
    if (edge !== 'top' && edge !== 'left' && edge !== 'right') return;

    let attachX, attachY;

    if (edge === 'top') {
      // Rappel from ceiling: attach directly above current position
      attachX = x + CHAR_SIZE / 2;
      attachY = 0;
    } else if (edge === 'left') {
      // Rappel from left wall: attach at current y position on wall
      attachX = 0;
      attachY = y;
    } else {
      // Rappel from right wall
      attachX = screenW;
      attachY = y;
    }

    thread = {
      attachX: attachX,
      attachY: attachY,
      length: CHAR_SIZE,                        // Initial thread length
      angle: 0,                                  // Pendulum angle (radians)
      swingVel: (Math.random() - 0.5) * 0.05,   // Initial swing velocity
    };

    movementMode = 'rappelling';
    onSurface = false;
    currentSurface = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('rappelling');
    }
  }

  /**
   * Release rappel: let go of thread to transition to free fall
   */
  function releaseThread() {
    if (!thread) return;
    thread = null;
    vy = 0;
    movementMode = 'falling';
    onSurface = false;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('falling');
    }
  }

  /**
   * Move to screen center
   * Descend via rappel from ceiling, otherwise jump
   */
  function moveToCenter() {
    const cx = (screenW - CHAR_SIZE) / 2;
    const cy = (screenH - CHAR_SIZE) / 2;

    if (edge === 'top') {
      // From ceiling, descend via rappel
      startRappel();
    } else {
      // From floor/wall, jump to center
      jumpTo(cx, cy);
    }
  }

  // ===================================
  //  Animation frame update
  // ===================================

  /**
   * Render animation frame matching current state
   * Reuse existing frameset when in mid-air
   *
   * @param {string} state     - StateMachine state
   * @param {number} timestamp - requestAnimationFrame timestamp
   */
  function updateAnimation(state, timestamp) {
    if (timestamp - lastAnimTime > ANIM_INTERVAL) {
      animFrame++;
      lastAnimTime = timestamp;
      animFrameChanged = true;  // Notify movement system of frame transition
    }

    // Map to appropriate frameset based on movement mode
    let effectiveState = state;
    if (movementMode === 'jumping') effectiveState = 'jumping';
    if (movementMode === 'falling') effectiveState = 'falling';
    if (movementMode === 'rappelling') effectiveState = 'rappelling';

    const frameCount = Character.getFrameCount(effectiveState);
    const currentFrame = animFrame % frameCount;
    Character.renderFrame(effectiveState, currentFrame, flipX);
  }

  // ===================================
  //  Position/state accessors
  // ===================================

  /**
   * Return current position and state info
   * @returns {{ x, y, edge, direction, flipX, movementMode, onSurface, thread }}
   */
  function getPosition() {
    return {
      x, y, edge, direction, flipX,
      movementMode, onSurface,
      thread: thread ? true : false,
    };
  }

  /**
   * Set position directly (for drag, etc.)
   */
  function setPosition(nx, ny) {
    x = nx;
    y = ny;
    clampPosition();
    updateVisual();
  }

  function setEdge(newEdge) {
    edge = newEdge;
  }

  function setDirection(dir) {
    direction = dir;
    flipX = dir < 0;
  }

  /**
   * Snap to nearest edge instantly (after drag)
   * Reset all physics state and attach to surface
   */
  function snapToNearestEdge() {
    const distBottom = screenH - CHAR_SIZE - y;
    const distTop = y;
    const distLeft = x;
    const distRight = screenW - CHAR_SIZE - x;
    const minDist = Math.min(distBottom, distTop, distLeft, distRight);

    if (minDist === distBottom) {
      y = screenH - CHAR_SIZE;
      edge = 'bottom';
    } else if (minDist === distTop) {
      y = 0;
      edge = 'top';
    } else if (minDist === distLeft) {
      x = 0;
      edge = 'left';
    } else {
      x = screenW - CHAR_SIZE;
      edge = 'right';
    }

    // Full physics state reset
    movementMode = 'crawling';
    onSurface = true;
    currentSurface = null;
    vx = 0;
    vy = 0;
    thread = null;

    updateVisual();
  }

  /**
   * Start free fall (when released near screen center)
   * Fall to floor or nearest surface by gravity
   */
  function startFalling() {
    movementMode = 'falling';
    onSurface = false;
    currentSurface = null;
    vx = 0;
    vy = 0;
    thread = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('falling');
    }
  }

  /**
   * Return rappel thread info
   * @returns {object|null}
   */
  function getThread() {
    return thread;
  }

  // ===================================
  //  Custom movement pattern registry
  // ===================================

  // Registered custom movement pattern store
  // Each handler: { init(params), update(deltaTime), isComplete(), cleanup() }
  let customMovements = {};
  let activeCustomMovement = null;  // Currently active custom movement { name, handler, state }

  /**
   * Register custom movement pattern
   * @param {string} name - Pattern name (e.g., 'zigzag', 'patrol')
   * @param {object} handler - { init, update, isComplete, cleanup }
   */
  function registerMovement(name, handler) {
    if (!handler || typeof handler.update !== 'function') {
      console.error(`[PetEngine] Failed to register movement pattern '${name}': update function required`);
      return false;
    }
    // Fill in default methods
    handler.init = handler.init || (() => {});
    handler.isComplete = handler.isComplete || (() => false);
    handler.cleanup = handler.cleanup || (() => {});
    customMovements[name] = handler;
    console.log(`[PetEngine] Custom movement pattern registered: ${name}`);
    return true;
  }

  /**
   * Remove registered custom movement pattern
   * @param {string} name - Pattern name
   */
  function unregisterMovement(name) {
    if (activeCustomMovement && activeCustomMovement.name === name) {
      stopCustomMovement();
    }
    delete customMovements[name];
  }

  /**
   * Execute custom movement pattern
   * @param {string} name - Registered pattern name
   * @param {object} params - Pattern initialization parameters
   * @returns {boolean} Whether execution succeeded
   */
  function executeCustomMovement(name, params = {}) {
    const handler = customMovements[name];
    if (!handler) {
      console.warn(`[PetEngine] Unregistered movement pattern: ${name}`);
      return false;
    }

    // Clean up existing custom movement if any
    if (activeCustomMovement) {
      activeCustomMovement.handler.cleanup();
    }

    // Pass current position/screen info on pattern initialization
    const context = {
      x, y, screenW, screenH,
      charSize: CHAR_SIZE,
      direction, edge, flipX,
    };

    const state = handler.init(Object.assign({}, params, context)) || {};
    activeCustomMovement = { name, handler, state };

    // Transition to CUSTOM state
    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('custom');
    }

    console.log(`[PetEngine] Executing custom movement: ${name}`);
    return true;
  }

  /**
   * Update custom movement every frame
   * @param {number} deltaTime - Elapsed time between frames (ms)
   */
  function updateCustomMovement(deltaTime) {
    if (!activeCustomMovement) return;

    const { handler, state } = activeCustomMovement;
    const context = {
      x, y, screenW, screenH,
      charSize: CHAR_SIZE,
      direction, edge, flipX,
      setPos: (nx, ny) => { x = nx; y = ny; },
      setFlip: (f) => { flipX = f; },
      setDir: (d) => { direction = d; },
    };

    handler.update(deltaTime, state, context);

    // Handler may have set position via setPos
    clampPosition();

    // Check completion
    if (handler.isComplete(state)) {
      stopCustomMovement();
    }
  }

  /**
   * Force stop current custom movement -> return to IDLE
   */
  function stopCustomMovement() {
    if (!activeCustomMovement) return;
    activeCustomMovement.handler.cleanup(activeCustomMovement.state);
    activeCustomMovement = null;

    if (typeof StateMachine !== 'undefined') {
      StateMachine.forceState('idle');
    }
  }

  /**
   * Return list of registered custom movement patterns
   */
  function getRegisteredMovements() {
    return Object.keys(customMovements);
  }

  // --- Pre-registered movement patterns ---

  // Zigzag: alternating diagonal movement
  registerMovement('zigzag', {
    init(params) {
      return {
        amplitude: params.amplitude || 40,     // Horizontal amplitude (px)
        speed: params.speed || 2,              // Forward speed
        segmentLength: params.segmentLength || 60, // Segment length
        traveled: 0,
        totalDistance: params.distance || 300,  // Total travel distance
        zigDir: 1,                             // Zigzag direction
        startX: params.x,
        startY: params.y,
      };
    },
    update(dt, state, ctx) {
      const step = state.speed * (dt / 16);
      state.traveled += step;

      // Horizontal advance
      const moveX = step * (ctx.direction || 1);
      // Vertical zigzag
      const segProgress = (state.traveled % state.segmentLength) / state.segmentLength;
      if (segProgress < 0.05) state.zigDir *= -1;
      const moveY = state.zigDir * step * 0.7;

      ctx.setPos(ctx.x + moveX, ctx.y + moveY);
      ctx.setFlip(moveX < 0);
    },
    isComplete(state) {
      return state.traveled >= state.totalDistance;
    },
    cleanup() {},
  });

  // Patrol: round-trip between two points
  registerMovement('patrol', {
    init(params) {
      return {
        pointA: { x: params.pointAX || 100, y: params.pointAY || params.y },
        pointB: { x: params.pointBX || params.screenW - 164, y: params.pointBY || params.y },
        speed: params.speed || 1.5,
        laps: params.laps || 3,                // Number of round trips
        currentLap: 0,
        targetIdx: 0,                          // 0=A, 1=B
      };
    },
    update(dt, state, ctx) {
      const target = state.targetIdx === 0 ? state.pointA : state.pointB;
      const dx = target.x - ctx.x;
      const dy = target.y - ctx.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 5) {
        // Reached target -> reverse direction
        state.targetIdx = 1 - state.targetIdx;
        if (state.targetIdx === 0) state.currentLap++;
        return;
      }

      const step = state.speed * (dt / 16);
      const ratio = step / dist;
      ctx.setPos(ctx.x + dx * ratio, ctx.y + dy * ratio);
      ctx.setFlip(dx < 0);
    },
    isComplete(state) {
      return state.currentLap >= state.laps;
    },
    cleanup() {},
  });

  // Circular rotation: revolve around center point
  registerMovement('circle', {
    init(params) {
      return {
        centerX: params.centerX || params.x,
        centerY: params.centerY || params.y - 50,
        radius: params.radius || 50,
        speed: params.speed || 0.03,           // Angular velocity (rad/frame)
        angle: 0,
        totalAngle: params.revolutions ? params.revolutions * Math.PI * 2 : Math.PI * 4,
        traveled: 0,
      };
    },
    update(dt, state, ctx) {
      const step = state.speed * (dt / 16);
      state.angle += step;
      state.traveled += Math.abs(step);

      const nx = state.centerX + Math.cos(state.angle) * state.radius;
      const ny = state.centerY + Math.sin(state.angle) * state.radius;
      ctx.setPos(nx, ny);
      ctx.setFlip(Math.sin(state.angle) < 0);
    },
    isComplete(state) {
      return state.traveled >= state.totalAngle;
    },
    cleanup() {},
  });

  // Shake: fast horizontal vibration
  registerMovement('shake', {
    init(params) {
      return {
        intensity: params.intensity || 4,      // Shake intensity (px)
        duration: params.duration || 800,       // Duration (ms)
        elapsed: 0,
        originX: params.x,
        originY: params.y,
        phase: 0,
      };
    },
    update(dt, state, ctx) {
      state.elapsed += dt;
      state.phase += dt * 0.05;

      // Damped sinusoidal vibration
      const decay = 1 - (state.elapsed / state.duration);
      const offsetX = Math.sin(state.phase) * state.intensity * decay;
      ctx.setPos(state.originX + offsetX, state.originY);
    },
    isComplete(state) {
      return state.elapsed >= state.duration;
    },
    cleanup() {},
  });

  // Dance: sequential combo of moves (jump + spin + shake)
  registerMovement('dance', {
    init(params) {
      return {
        duration: params.duration || 3000,
        elapsed: 0,
        originX: params.x,
        originY: params.y,
        phase: 0,
      };
    },
    update(dt, state, ctx) {
      state.elapsed += dt;
      state.phase += dt * 0.004;

      const t = state.elapsed / state.duration;

      // Different moves per phase
      if (t < 0.25) {
        // Phase 1: left-right swing
        const swingX = Math.sin(state.phase * 8) * 20;
        ctx.setPos(state.originX + swingX, state.originY);
        ctx.setFlip(swingX < 0);
      } else if (t < 0.5) {
        // Phase 2: up-down bounce
        const bounceY = Math.abs(Math.sin(state.phase * 6)) * -30;
        ctx.setPos(state.originX, state.originY + bounceY);
      } else if (t < 0.75) {
        // Phase 3: small circle
        const angle = state.phase * 10;
        ctx.setPos(
          state.originX + Math.cos(angle) * 15,
          state.originY + Math.sin(angle) * 15
        );
        ctx.setFlip(Math.cos(angle) < 0);
      } else {
        // Phase 4: fast horizontal shake (finish)
        const shake = Math.sin(state.phase * 20) * 6 * (1 - t);
        ctx.setPos(state.originX + shake, state.originY);
      }
    },
    isComplete(state) {
      return state.elapsed >= state.duration;
    },
    cleanup() {},
  });

  // ===================================
  //  Main loop
  // ===================================

  let frameId = null;

  /**
   * Start engine: begin requestAnimationFrame loop
   */
  let lastLoopTimestamp = 0;  // Previous loop timestamp (for deltaTime calculation)

  function start() {
    if (running) return;
    running = true;
    lastAnimTime = performance.now();
    lastLoopTimestamp = performance.now();

    function loop(timestamp) {
      if (!running) return;

      // Calculate deltaTime for custom movement
      const deltaTime = timestamp - lastLoopTimestamp;
      lastLoopTimestamp = timestamp;

      const state = StateMachine.update();

      // Update animation first -> set animFrameChanged flag
      updateAnimation(state, timestamp);

      // Run dedicated update if custom movement is active
      if (activeCustomMovement && state === 'custom') {
        updateCustomMovement(deltaTime);
        clampPosition();
        updateVisual();
      } else {
        moveForState(state);
      }

      // Reset frame transition flag (wait until next frame)
      animFrameChanged = false;
      frameId = requestAnimationFrame(loop);
    }
    frameId = requestAnimationFrame(loop);
  }

  /**
   * Stop engine
   */
  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
  }

  // --- Public API ---
  return {
    init, start, stop,
    getPosition, setPosition, setEdge, setDirection,
    snapToNearestEdge, setSpeedMultiplier,
    moveForState, updateAnimation,
    // Physics-based movement
    jumpTo, startRappel, releaseThread, moveToCenter,
    setSurfaces, getThread, startFalling,
    // Custom movement pattern system
    registerMovement, unregisterMovement,
    executeCustomMovement, stopCustomMovement,
    getRegisteredMovements,
    CHAR_SIZE,
  };
})();
