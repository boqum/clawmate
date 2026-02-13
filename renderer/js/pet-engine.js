/**
 * 핵심 이동/애니메이션 엔진
 * requestAnimationFrame 기반 이동 루프 — 화면 4면 가장자리 이동
 */
const PetEngine = (() => {
  const BASE_SPEED = 1.5;
  const CLIMB_SPEED = 1.0;
  const CHAR_SIZE = 64;
  const ANIM_INTERVAL = 250; // ms per frame

  let x = 0, y = 0;
  let edge = 'bottom';      // bottom, left, right, top
  let direction = 1;         // 1=right/down, -1=left/up
  let flipX = false;
  let screenW = window.innerWidth;
  let screenH = window.innerHeight;
  let running = false;
  let animFrame = 0;
  let lastAnimTime = 0;
  let speedMultiplier = 1.0;
  let petContainer = null;

  function init(container) {
    petContainer = container;
    // 화면 하단 중앙에서 시작
    screenW = window.innerWidth;
    screenH = window.innerHeight;
    x = (screenW - CHAR_SIZE) / 2;
    y = screenH - CHAR_SIZE;
    edge = 'bottom';
    direction = 1;
    updatePosition();

    window.addEventListener('resize', () => {
      screenW = window.innerWidth;
      screenH = window.innerHeight;
      clampPosition();
      updatePosition();
    });
  }

  function setSpeedMultiplier(mult) {
    speedMultiplier = mult;
  }

  function clampPosition() {
    x = Math.max(0, Math.min(x, screenW - CHAR_SIZE));
    y = Math.max(0, Math.min(y, screenH - CHAR_SIZE));
  }

  function updatePosition() {
    if (!petContainer) return;
    petContainer.style.left = x + 'px';
    petContainer.style.top = y + 'px';

    // 가장자리별 회전/반전 — 다리(캐릭터 하단)가 항상 해당 가장자리를 향하도록
    let transform = '';
    if (edge === 'left') {
      // 왼쪽 벽: 다리가 왼쪽(화면 가장자리)을 향하도록 반시계 회전
      transform += 'rotate(-90deg) ';
      if (flipX) transform += 'scaleX(-1) ';
    } else if (edge === 'right') {
      // 오른쪽 벽: 다리가 오른쪽(화면 가장자리)을 향하도록 시계 회전
      transform += 'rotate(90deg) ';
      if (flipX) transform += 'scaleX(-1) ';
    } else if (edge === 'top') {
      // 천장: 다리가 위(천장)를 향하도록 상하 반전
      transform += 'scaleY(-1) ';
      if (flipX) transform += 'scaleX(-1) ';
    } else {
      // 바닥: 기본 자세 (다리가 아래를 향함)
      if (flipX) transform += 'scaleX(-1) ';
    }
    petContainer.style.transform = transform.trim() || 'none';
  }

  function moveForState(state) {
    const speed = BASE_SPEED * speedMultiplier;
    const climbSpeed = CLIMB_SPEED * speedMultiplier;

    switch (state) {
      case 'walking':
        if (edge === 'bottom' || edge === 'top') {
          x += speed * direction;
          flipX = direction < 0;
          // 벽에 닿으면 방향 전환
          if (x <= 0) { x = 0; direction = 1; }
          if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
        }
        break;

      case 'ceiling_walk':
        if (edge === 'top') {
          x += speed * direction;
          flipX = direction < 0;
          if (x <= 0) { x = 0; direction = 1; }
          if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
        }
        break;

      case 'climbing_up':
        if (edge === 'bottom') {
          // 바닥에서 벽으로
          if (direction > 0) {
            x = screenW - CHAR_SIZE;
            edge = 'right';
          } else {
            x = 0;
            edge = 'left';
          }
        }
        y -= climbSpeed;
        if (y <= 0) {
          y = 0;
          edge = 'top';
        }
        break;

      case 'climbing_down':
        y += climbSpeed;
        if (y >= screenH - CHAR_SIZE) {
          y = screenH - CHAR_SIZE;
          edge = 'bottom';
        }
        break;

      case 'scared':
        // 빠르게 도망
        x += speed * 2.5 * direction;
        flipX = direction < 0;
        if (x <= 0) { x = 0; direction = 1; }
        if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
        break;

      case 'carrying':
        x += speed * 0.7 * direction;
        flipX = direction < 0;
        if (x <= 0) { x = 0; direction = 1; }
        if (x >= screenW - CHAR_SIZE) { x = screenW - CHAR_SIZE; direction = -1; }
        break;

      case 'excited':
        // 작은 점프 효과
        const elapsed = StateMachine.getElapsed();
        const jumpOffset = Math.sin(elapsed / 150) * 8;
        y = (screenH - CHAR_SIZE) + jumpOffset;
        break;

      case 'idle':
      case 'sleeping':
      case 'interacting':
      case 'playing':
        // 정지 또는 미세한 흔들림
        break;
    }

    clampPosition();
    updatePosition();
  }

  function updateAnimation(state, timestamp) {
    if (timestamp - lastAnimTime > ANIM_INTERVAL) {
      animFrame++;
      lastAnimTime = timestamp;
    }
    const frameCount = Character.getFrameCount(state);
    const currentFrame = animFrame % frameCount;
    Character.renderFrame(state, currentFrame, flipX);
  }

  function getPosition() {
    return { x, y, edge, direction, flipX };
  }

  function setPosition(nx, ny) {
    x = nx;
    y = ny;
    clampPosition();
    updatePosition();
  }

  function setEdge(newEdge) {
    edge = newEdge;
  }

  function setDirection(dir) {
    direction = dir;
    flipX = dir < 0;
  }

  // 가장 가까운 가장자리로 이동 (드래그 후)
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
    updatePosition();
  }

  let frameId = null;

  function start() {
    if (running) return;
    running = true;
    lastAnimTime = performance.now();

    function loop(timestamp) {
      if (!running) return;
      const state = StateMachine.update();
      moveForState(state);
      updateAnimation(state, timestamp);
      frameId = requestAnimationFrame(loop);
    }
    frameId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
  }

  return {
    init, start, stop, getPosition, setPosition, setEdge, setDirection,
    snapToNearestEdge, setSpeedMultiplier, moveForState, CHAR_SIZE,
  };
})();
