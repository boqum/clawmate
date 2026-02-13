/**
 * 마우스/클릭/드래그 상호작용 시스템
 *
 * AI 연결 시: 이벤트를 OpenClaw에 전달 → AI가 반응 결정
 * AI 미연결 시: 자율 반응 (랜덤 FSM)
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
    PetEngine.snapToNearestEdge();
    StateMachine.forceState('idle');
    PetEngine.start();

    window.clawmate.setClickThrough(true);

    // AI에 드래그 이벤트 리포트
    if (dragStartPos) {
      AIController.reportDrag(dragStartPos, endPos);
    }
  }

  function onSingleClick() {
    const pos = PetEngine.getPosition();

    // AI에 클릭 이벤트 리포트
    AIController.reportClick(pos);

    // AI 연결 시: AI가 반응 결정 (아무것도 안 함, AI 응답 대기)
    // AI 미연결 시: 자율 반응
    if (AIController.isAutonomous()) {
      StateMachine.forceState('interacting');
      Speech.show(Speech.getReactionMessage());
    }

    Memory.recordClick();
    spawnHeartEffect();
  }

  function onTripleClick() {
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
      // AI에 커서 접근 리포트
      AIController.reportCursorNear(dist);

      // AI 미연결 시: 자율 반응
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
