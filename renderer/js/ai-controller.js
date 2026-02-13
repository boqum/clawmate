/**
 * AI Behavior Controller
 *
 * When AI is connected -> AI decides all behaviors
 * When AI disconnects -> Falls back to autonomous mode (existing FSM)
 *
 * AI decides:
 * - When and what to say
 * - Where to move
 * - What emotions to express
 * - Whether to pick up files
 * - How to react to user actions
 */
const AIController = (() => {
  let connected = false;
  let autonomousMode = true;  // Autonomous mode when AI is not connected
  let pendingDecision = null;
  let lastAIAction = 0;

  // Communicates via IPC through preload based on AI connection status
  // (AIBridge in main process manages WebSocket)

  function init() {
    // Execute when AI commands arrive from the main process
    if (window.clawmate.onAICommand) {
      window.clawmate.onAICommand((command) => {
        handleAICommand(command);
      });
    }

    if (window.clawmate.onAIConnected) {
      window.clawmate.onAIConnected(() => {
        connected = true;
        autonomousMode = false;
        Speech.show('AI connected... consciousness awakens.');
        StateMachine.forceState('excited');
      });
    }

    if (window.clawmate.onAIDisconnected) {
      window.clawmate.onAIDisconnected(() => {
        connected = false;
        autonomousMode = true;
        Speech.show('...left alone. Gotta keep myself entertained!');
      });
    }
  }

  /**
   * Execute commands received from AI
   */
  function handleAICommand(command) {
    const { type, payload } = command;
    lastAIAction = Date.now();

    switch (type) {
      case 'speak':
        Speech.show(payload.text);
        break;

      case 'think':
        Speech.show(`...${payload.text}...`);
        break;

      case 'action':
        StateMachine.forceState(payload.state);
        if (payload.duration) {
          setTimeout(() => {
            if (!autonomousMode) {
              StateMachine.forceState('idle');
            }
          }, payload.duration);
        }
        break;

      case 'move':
        PetEngine.setPosition(payload.x, payload.y);
        if (payload.speed) PetEngine.setSpeedMultiplier(payload.speed);
        break;

      case 'emote':
        applyEmotion(payload.emotion);
        break;

      case 'carry_file':
        StateMachine.forceState('carrying');
        Speech.show(`Grabbed ${payload.fileName}!`);
        break;

      case 'drop_file':
        StateMachine.forceState('idle');
        Speech.show('Dropped it!');
        break;

      case 'set_mode':
        ModeManager.applyMode(payload.mode);
        break;

      case 'evolve':
        // AI directly decides evolution
        if (typeof Memory !== 'undefined') {
          Speech.show(window._messages?.evolution?.[`stage_${payload.stage}`] || 'I\'m changing...!');
        }
        break;

      case 'accessorize':
        // Temporary accessory
        break;

      case 'ai_decision':
        // Comprehensive decision -- execute multiple actions in sequence
        executeDecision(payload);
        break;

      // === Spatial movement commands ===

      case 'jump_to':
        // Jump to a specific position
        // payload: { x, y }
        PetEngine.jumpTo(payload.x, payload.y);
        break;

      case 'rappel':
        // Start rappelling (descend on a thread from ceiling/wall)
        PetEngine.startRappel();
        break;

      case 'release_thread':
        // Release rappel thread (free fall)
        PetEngine.releaseThread();
        break;

      case 'move_to_center':
        // Move to screen center (using physics-based methods)
        PetEngine.moveToCenter();
        break;

      case 'walk_on_window':
        // Move onto a specific window's title bar
        // payload: { windowId, x, y }
        PetEngine.jumpTo(payload.x, payload.y);
        break;

      // === Custom movement patterns ===

      case 'register_movement':
        // Register movement pattern definition sent by AI as JSON
        // payload: { name, definition }
        // definition: { type, params } -- parameters per type
        _registerAIMovement(payload.name, payload.definition);
        break;

      case 'custom_move':
        // Execute a registered custom movement pattern
        // payload: { name, params? }
        if (!PetEngine.executeCustomMovement(payload.name, payload.params || {})) {
          // Notify AI on execution failure
          if (window.clawmate.reportToAI) {
            window.clawmate.reportToAI('custom_move_failed', {
              name: payload.name,
              available: PetEngine.getRegisteredMovements(),
            });
          }
        }
        break;

      case 'stop_custom_move':
        // Force stop current custom movement
        PetEngine.stopCustomMovement();
        break;

      case 'list_movements':
        // Request list of registered movement patterns
        if (window.clawmate.reportToAI) {
          window.clawmate.reportToAI('movement_list', {
            movements: PetEngine.getRegisteredMovements(),
          });
        }
        break;

      // === Character customization ===
      case 'set_character':
        // Apply new character data generated by AI
        Character.setCharacterData(payload);
        if (payload.speech) {
          Speech.show(payload.speech);
        } else {
          Speech.show('Transformation complete!');
        }
        StateMachine.forceState('excited');
        setTimeout(() => {
          if (StateMachine.getState() === 'excited') StateMachine.forceState('idle');
        }, 2000);
        break;

      case 'reset_character':
        // Restore to original character
        Character.resetCharacter();
        Speech.show('Back to my original form!');
        StateMachine.forceState('excited');
        break;

      // === Persona switching (Incarnation mode) ===
      case 'set_persona':
        // Apply bot persona data
        if (typeof ModeManager !== 'undefined') {
          ModeManager.setPersona(payload);
          const name = payload.name || 'Claw';
          Speech.show(`${name}'s persona has awakened.`);
          StateMachine.forceState('excited');
        }
        break;

      // === Smart file operation animations ===
      case 'smart_file_op':
        handleSmartFileOp(payload);
        break;
    }
  }

  /**
   * Handle smart file operation animations
   *
   * Sequentially execute pet animations for each phase
   * of file move operations triggered by Telegram or AI.
   *
   * phase:
   *   - start: Operation begins, show total file count
   *   - pick_up: Pick up file (carrying state + speech bubble)
   *   - drop: Drop file (walking state + speech bubble)
   *   - complete: Done (excited state + result speech bubble)
   *   - error: Error (scared state + error speech bubble)
   */
  function handleSmartFileOp(payload) {
    switch (payload.phase) {
      case 'start':
        StateMachine.forceState('excited');
        Speech.show(`Starting to organize ${payload.totalFiles} files!`);
        break;

      case 'pick_up':
        // Move pet to file location (random position on screen)
        _smartFileJumpToSource(payload.index);
        // Pick up animation
        setTimeout(() => {
          StateMachine.forceState('carrying');
          Speech.show(`Grabbed ${payload.fileName}!`);
        }, 400);
        break;

      case 'drop':
        // Move to target folder location
        _smartFileJumpToTarget(payload.index);
        // Drop animation
        setTimeout(() => {
          StateMachine.forceState('walking');
          Speech.show(`Here! (${payload.targetName})`);
        }, 400);
        break;

      case 'complete':
        StateMachine.forceState('excited');
        if (payload.movedCount > 0) {
          Speech.show(`Moved ${payload.movedCount} files!`);
        } else {
          Speech.show('No files to move!');
        }
        break;

      case 'error':
        StateMachine.forceState('scared');
        Speech.show('Oops, something went wrong...');
        break;
    }
  }

  /**
   * Jump to file pickup location
   * Move to different positions in the left area of the screen based on file index
   */
  function _smartFileJumpToSource(index) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    // Distribute vertical positions within the left 1/3 of the screen based on file index
    const targetX = screenW * 0.1 + (index % 3) * 50;
    const targetY = screenH * 0.3 + ((index * 80) % (screenH * 0.5));
    PetEngine.jumpTo(targetX, targetY);
  }

  /**
   * Jump to file drop location
   * Move to the right area of the screen
   */
  function _smartFileJumpToTarget(index) {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    // Right 1/3 area of the screen
    const targetX = screenW * 0.7 + (index % 3) * 50;
    const targetY = screenH * 0.4 + ((index * 60) % (screenH * 0.4));
    PetEngine.jumpTo(targetX, targetY);
  }

  /**
   * Dynamically register movement patterns defined by AI as JSON
   * Uses predefined behavior type combinations instead of Function constructor for safe execution
   *
   * definition format:
   * {
   *   type: 'waypoints' | 'formula' | 'sequence',
   *   waypoints?: [{x, y, pause?}],          // waypoints type
   *   formula?: { xExpr, yExpr },             // formula type (sin, cos based)
   *   sequence?: ['zigzag', 'shake', ...],    // sequence type (execute existing patterns sequentially)
   *   duration?: number,
   *   speed?: number,
   * }
   */
  function _registerAIMovement(name, definition) {
    if (!name || !definition || !definition.type) {
      console.warn('[AIController] Movement pattern registration failed: name and definition.type required');
      return;
    }

    let handler;

    switch (definition.type) {
      // Waypoints type: move through specified coordinates in order
      case 'waypoints':
        handler = {
          init(params) {
            return {
              waypoints: definition.waypoints || [],
              currentIdx: 0,
              speed: definition.speed || 2,
              pauseTime: 0,
              pausing: false,
            };
          },
          update(dt, state, ctx) {
            if (state.currentIdx >= state.waypoints.length) return;

            const wp = state.waypoints[state.currentIdx];

            // Pausing at waypoint
            if (state.pausing) {
              state.pauseTime -= dt;
              if (state.pauseTime <= 0) {
                state.pausing = false;
                state.currentIdx++;
              }
              return;
            }

            const dx = wp.x - ctx.x;
            const dy = wp.y - ctx.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 5) {
              // Waypoint reached
              if (wp.pause && wp.pause > 0) {
                state.pausing = true;
                state.pauseTime = wp.pause;
              } else {
                state.currentIdx++;
              }
              return;
            }

            const step = state.speed * (dt / 16);
            const ratio = Math.min(1, step / dist);
            ctx.setPos(ctx.x + dx * ratio, ctx.y + dy * ratio);
            ctx.setFlip(dx < 0);
          },
          isComplete(state) {
            return state.currentIdx >= (state.waypoints || []).length;
          },
          cleanup() {},
        };
        break;

      // Formula type: mathematical trajectory based on sin/cos
      case 'formula':
        handler = {
          init(params) {
            return {
              duration: definition.duration || 3000,
              elapsed: 0,
              originX: params.x,
              originY: params.y,
              xAmp: definition.formula?.xAmp || 50,
              yAmp: definition.formula?.yAmp || 30,
              xFreq: definition.formula?.xFreq || 1,
              yFreq: definition.formula?.yFreq || 1,
              xPhase: definition.formula?.xPhase || 0,
              yPhase: definition.formula?.yPhase || 0,
            };
          },
          update(dt, state, ctx) {
            state.elapsed += dt;
            const t = (state.elapsed / state.duration) * Math.PI * 2;
            const nx = state.originX + Math.sin(t * state.xFreq + state.xPhase) * state.xAmp;
            const ny = state.originY + Math.sin(t * state.yFreq + state.yPhase) * state.yAmp;
            ctx.setPos(nx, ny);
            ctx.setFlip(Math.cos(t * state.xFreq + state.xPhase) < 0);
          },
          isComplete(state) {
            return state.elapsed >= state.duration;
          },
          cleanup() {},
        };
        break;

      // Sequence type: execute existing registered patterns sequentially
      case 'sequence':
        handler = {
          init(params) {
            return {
              sequence: definition.sequence || [],
              currentIdx: 0,
              subStarted: false,
            };
          },
          update(dt, state, ctx) {
            if (state.currentIdx >= state.sequence.length) return;

            if (!state.subStarted) {
              const subName = state.sequence[state.currentIdx];
              // Track state only without directly executing sub-patterns
              PetEngine.executeCustomMovement(subName, {
                x: ctx.x, y: ctx.y,
                screenW: ctx.screenW, screenH: ctx.screenH,
              });
              state.subStarted = true;
            }
          },
          isComplete(state) {
            return state.currentIdx >= (state.sequence || []).length;
          },
          cleanup() {},
        };
        break;

      default:
        console.warn(`[AIController] Unknown movement pattern type: ${definition.type}`);
        return;
    }

    PetEngine.registerMovement(name, handler);
    console.log(`[AIController] AI movement pattern registered: ${name} (${definition.type})`);
  }

  /**
   * Execute AI comprehensive decision
   * A complex decision made by AI after analyzing the situation
   *
   * Example:
   * {
   *   action: 'walking',
   *   speech: 'The desktop looks a bit messy today...',
   *   emotion: 'curious',
   *   reasoning: 'Detected 15+ files on desktop'
   * }
   */
  function executeDecision(decision) {
    if (decision.emotion) {
      applyEmotion(decision.emotion);
    }

    if (decision.action) {
      StateMachine.forceState(decision.action);
    }

    if (decision.speech) {
      setTimeout(() => Speech.show(decision.speech), 300);
    }

    if (decision.moveTo) {
      // Use different physics-based movement depending on method
      if (decision.moveTo.method === 'jump') {
        PetEngine.jumpTo(decision.moveTo.x, decision.moveTo.y);
      } else if (decision.moveTo.method === 'rappel') {
        PetEngine.startRappel();
      } else if (decision.moveTo.method === 'center') {
        PetEngine.moveToCenter();
      } else {
        PetEngine.setPosition(decision.moveTo.x, decision.moveTo.y);
      }
    }
  }

  /**
   * Emotion -> behavior mapping
   */
  function applyEmotion(emotion) {
    const emotionMap = {
      happy: 'excited',
      curious: 'walking',
      sleepy: 'sleeping',
      scared: 'scared',
      playful: 'playing',
      proud: 'excited',
      neutral: 'idle',
      focused: 'idle',
      affectionate: 'interacting',
    };

    const state = emotionMap[emotion] || 'idle';
    StateMachine.forceState(state);
  }

  // === User events -> Report to AI ===

  function reportClick(position) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('click', { position });
    }
  }

  function reportDrag(from, to) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('drag', { from, to });
    }
  }

  function reportCursorNear(distance) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('cursor_near', { distance });
    }
  }

  function reportDesktopChange(files) {
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('desktop_changed', { files });
    }
  }

  function isConnected() {
    return connected;
  }

  function isAutonomous() {
    return autonomousMode;
  }

  return {
    init, handleAICommand, isConnected, isAutonomous,
    reportClick, reportDrag, reportCursorNear, reportDesktopChange,
    executeDecision,
  };
})();
