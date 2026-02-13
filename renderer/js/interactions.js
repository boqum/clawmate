/**
 * Mouse/click/drag interaction system
 *
 * When AI connected: Events forwarded to AI -> AI decides reactions
 * When AI disconnected: Autonomous reactions (random FSM)
 */
const Interactions = (() => {
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStartPos = null;
  let clickCount = 0;
  let clickTimer = null;
  let lastCursorCheck = 0;
  const CURSOR_CHECK_INTERVAL = 500;

  function init() {
    const pet = document.getElementById('pet-container');
    if (!pet) return;

    pet.addEventListener('mouseenter', () => {
      window.clawmate.setClickThrough(false);
    });

    pet.addEventListener('mouseleave', () => {
      if (!isDragging) {
        window.clawmate.setClickThrough(true);
      }
    });

    pet.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousemove', onGlobalMouseMove);
  }

  function onMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const pos = PetEngine.getPosition();
    dragOffsetX = e.clientX - pos.x;
    dragOffsetY = e.clientY - pos.y;
    dragStartPos = { x: pos.x, y: pos.y };
    isDragging = true;

    const pet = document.getElementById('pet-container');
    pet.classList.add('dragging');
    PetEngine.stop();

    clickCount++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (clickCount >= 3) {
        onTripleClick();
      } else if (clickCount === 2) {
        onDoubleClick();
      } else if (clickCount === 1) {
        onSingleClick();
      }
      clickCount = 0;
    }, 400);
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    PetEngine.setPosition(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;

    const pet = document.getElementById('pet-container');
    pet.classList.remove('dragging');

    const endPos = PetEngine.getPosition();

    // Calculate distance to screen edges
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const charSize = PetEngine.CHAR_SIZE;
    const distBottom = screenH - charSize - endPos.y;
    const distTop = endPos.y;
    const distLeft = endPos.x;
    const distRight = screenW - charSize - endPos.x;
    const minEdgeDist = Math.min(distBottom, distTop, distLeft, distRight);

    // If far enough from edges (near screen center) -> free fall
    // Edge proximity threshold: 15% of the shorter screen dimension
    const edgeThreshold = Math.min(screenW, screenH) * 0.15;

    if (minEdgeDist > edgeThreshold) {
      // Near screen center: gravity fall to the floor
      PetEngine.startFalling();
    } else {
      // Near edge: snap to the nearest edge as before
      PetEngine.snapToNearestEdge();
      StateMachine.forceState('idle');
    }

    PetEngine.start();
    window.clawmate.setClickThrough(true);

    // Report drag event to AI + record reaction
    if (dragStartPos) {
      const draggedAction = StateMachine.getState();
      Memory.recordReaction(draggedAction, 'drag');
      AIController.reportDrag(dragStartPos, endPos);
    }
  }

  function onSingleClick() {
    const pos = PetEngine.getPosition();
    const currentAction = StateMachine.getState();

    // Report click event to AI
    AIController.reportClick(pos);

    // Record user reaction -- click during current action = positive reaction
    Memory.recordReaction(currentAction, 'click');

    // When AI connected: AI decides reaction (do nothing, wait for AI response)
    // When AI disconnected: autonomous reaction
    if (AIController.isAutonomous()) {
      StateMachine.forceState('interacting');
      Speech.show(Speech.getReactionMessage());
    }

    Memory.recordClick();
    spawnHeartEffect();
  }

  function onDoubleClick() {
    const pos = PetEngine.getPosition();
    const currentAction = StateMachine.getState();

    // Record user reaction
    Memory.recordReaction(currentAction, 'double_click');

    // Report double-click to AI
    if (window.clawmate.reportToAI) {
      window.clawmate.reportToAI('double_click', { position: pos });
    }

    // Autonomous mode: double-click = special reaction (jump + excitement)
    if (AIController.isAutonomous()) {
      StateMachine.forceState('excited');
      PetEngine.jumpTo(
        pos.x + (Math.random() - 0.5) * 200,
        Math.max(100, pos.y - 150)
      );
      Speech.show('Wow! A double-click!');
    }

    Memory.recordClick();
    Memory.recordClick(); // double-click = 2 clicks
    spawnHeartEffect();
    spawnStarEffect();
  }

  function onTripleClick() {
    const currentAction = StateMachine.getState();
    Memory.recordReaction(currentAction, 'triple_click');

    if (typeof ModeManager !== 'undefined') {
      ModeManager.toggle();
    }
  }

  function onGlobalMouseMove(e) {
    if (isDragging) return;
    const now = Date.now();
    if (now - lastCursorCheck < CURSOR_CHECK_INTERVAL) return;
    lastCursorCheck = now;

    const pos = PetEngine.getPosition();
    const dist = Math.hypot(e.clientX - (pos.x + 32), e.clientY - (pos.y + 32));

    if (dist < 100) {
      // Record user reaction -- cursor approach = showing interest
      const curAction = StateMachine.getState();
      Memory.recordReaction(curAction, 'cursor_near');

      // Report cursor proximity to AI
      AIController.reportCursorNear(dist);

      // When AI disconnected: autonomous reaction
      if (AIController.isAutonomous()) {
        const state = StateMachine.getState();
        if (state === 'idle' || state === 'walking') {
          if (Math.random() < 0.5) {
            StateMachine.forceState('scared');
            PetEngine.setDirection(e.clientX > pos.x + 32 ? -1 : 1);
          } else {
            StateMachine.forceState('excited');
            Speech.show(Speech.getGreetingMessage());
          }
        }
      }
    }
  }

  function spawnHeartEffect() {
    const pos = PetEngine.getPosition();
    const heart = document.createElement('div');
    heart.className = 'heart-effect';
    heart.textContent = '\u2764\uFE0F';
    heart.style.left = (pos.x + 20 + Math.random() * 24) + 'px';
    heart.style.top = (pos.y - 10) + 'px';
    document.getElementById('world').appendChild(heart);
    setTimeout(() => heart.remove(), 1000);
  }

  function spawnStarEffect() {
    const pos = PetEngine.getPosition();
    for (let i = 0; i < 4; i++) {
      const star = document.createElement('div');
      star.className = 'star-effect';
      star.style.left = (pos.x + Math.random() * 64) + 'px';
      star.style.top = (pos.y + Math.random() * 64) + 'px';
      document.getElementById('world').appendChild(star);
      setTimeout(() => star.remove(), 600);
    }
  }

  return { init, spawnHeartEffect, spawnStarEffect };
})();
