/**
 * 펫 행동 유한 상태 머신 (FSM)
 *
 * 상태 전이도:
 *   IDLE → WALKING → CLIMBING_UP → CEILING_WALK
 *   IDLE ← PLAYING ← CLIMBING_DOWN ← (천장/벽)
 *   IDLE → SLEEPING (23:00~06:00)
 *   인터럽트: 클릭→INTERACTING, 커서→SCARED/EXCITED
 */
const StateMachine = (() => {
  const STATES = {
    IDLE: 'idle',
    WALKING: 'walking',
    CLIMBING_UP: 'climbing_up',
    CLIMBING_DOWN: 'climbing_down',
    CEILING_WALK: 'ceiling_walk',
    SLEEPING: 'sleeping',
    CARRYING: 'carrying',
    PLAYING: 'playing',
    INTERACTING: 'interacting',
    SCARED: 'scared',
    EXCITED: 'excited',
    JUMPING: 'jumping',       // 포물선 점프 중 (물리 엔진이 제어)
    RAPPELLING: 'rappelling', // 실(thread)을 타고 하강 중
    FALLING: 'falling',       // 중력에 의한 자유 낙하 중
    CUSTOM: 'custom',         // 커스텀 이동 패턴 실행 중 (Movement Registry)
  };

  // 각 상태의 최소/최대 지속 시간(ms)
  const DURATIONS = {
    [STATES.IDLE]:          { min: 2000, max: 5000 },
    [STATES.WALKING]:       { min: 3000, max: 8000 },
    [STATES.CLIMBING_UP]:   { min: 2000, max: 4000 },
    [STATES.CLIMBING_DOWN]: { min: 1500, max: 3000 },
    [STATES.CEILING_WALK]:  { min: 2000, max: 5000 },
    [STATES.SLEEPING]:      { min: 10000, max: 30000 },
    [STATES.CARRYING]:      { min: 4000, max: 8000 },
    [STATES.PLAYING]:       { min: 3000, max: 6000 },
    [STATES.INTERACTING]:   { min: 1500, max: 3000 },
    [STATES.SCARED]:        { min: 1000, max: 2000 },
    [STATES.EXCITED]:       { min: 1500, max: 3000 },
    [STATES.JUMPING]:       { min: 500, max: 2000 },    // 점프 비행 시간
    [STATES.RAPPELLING]:    { min: 2000, max: 8000 },   // 레펠 하강 시간
    [STATES.FALLING]:       { min: 200, max: 1000 },    // 낙하 시간
    [STATES.CUSTOM]:        { min: 500, max: 30000 },   // 커스텀 이동 (패턴에 따라 가변)
  };

  let currentState = STATES.IDLE;
  let stateStartTime = Date.now();
  let stateDuration = 3000;
  let personality = null;
  let onStateChange = null;

  // 기본 전이 확률 (personality로 조정됨)
  const BASE_TRANSITIONS = {
    [STATES.IDLE]: [
      { state: STATES.WALKING, weight: 0.5 },
      { state: STATES.PLAYING, weight: 0.2 },
      { state: STATES.IDLE, weight: 0.3 },
    ],
    [STATES.WALKING]: [
      { state: STATES.IDLE, weight: 0.3 },
      { state: STATES.CLIMBING_UP, weight: 0.2 },
      { state: STATES.WALKING, weight: 0.25 },
      { state: STATES.PLAYING, weight: 0.2 },
      { state: STATES.JUMPING, weight: 0.05 },  // 가끔 점프 (낮은 확률)
    ],
    [STATES.CLIMBING_UP]: [
      { state: STATES.CEILING_WALK, weight: 0.5 },
      { state: STATES.CLIMBING_DOWN, weight: 0.5 },
    ],
    [STATES.CEILING_WALK]: [
      { state: STATES.CLIMBING_DOWN, weight: 0.4 },
      { state: STATES.CEILING_WALK, weight: 0.4 },
      { state: STATES.RAPPELLING, weight: 0.2 },  // 천장에서 레펠로 하강
    ],
    [STATES.CLIMBING_DOWN]: [
      { state: STATES.WALKING, weight: 0.5 },
      { state: STATES.IDLE, weight: 0.5 },
    ],
    [STATES.PLAYING]: [
      { state: STATES.IDLE, weight: 0.5 },
      { state: STATES.WALKING, weight: 0.5 },
    ],
    [STATES.INTERACTING]: [
      { state: STATES.IDLE, weight: 0.5 },
      { state: STATES.EXCITED, weight: 0.3 },
      { state: STATES.PLAYING, weight: 0.2 },
    ],
    [STATES.SCARED]: [
      { state: STATES.WALKING, weight: 0.7 },
      { state: STATES.IDLE, weight: 0.3 },
    ],
    [STATES.EXCITED]: [
      { state: STATES.PLAYING, weight: 0.4 },
      { state: STATES.IDLE, weight: 0.3 },
      { state: STATES.WALKING, weight: 0.3 },
    ],
    [STATES.SLEEPING]: [
      { state: STATES.IDLE, weight: 1.0 },
    ],
    [STATES.CARRYING]: [
      { state: STATES.IDLE, weight: 0.5 },
      { state: STATES.WALKING, weight: 0.5 },
    ],
    // 점프 후: 착지하면 idle 또는 walking으로
    [STATES.JUMPING]: [
      { state: STATES.IDLE, weight: 0.5 },
      { state: STATES.WALKING, weight: 0.5 },
    ],
    // 레펠 후: 낙하하거나 착지
    [STATES.RAPPELLING]: [
      { state: STATES.FALLING, weight: 0.3 },
      { state: STATES.IDLE, weight: 0.7 },
    ],
    // 낙하 후: 착지하면 idle
    [STATES.FALLING]: [
      { state: STATES.IDLE, weight: 1.0 },
    ],
    // 커스텀 이동 완료 후: idle 또는 walking
    [STATES.CUSTOM]: [
      { state: STATES.IDLE, weight: 0.6 },
      { state: STATES.WALKING, weight: 0.4 },
    ],
  };

  function setPersonality(p) {
    personality = p;
  }

  function setOnStateChange(cb) {
    onStateChange = cb;
  }

  function randomDuration(state) {
    const d = DURATIONS[state] || DURATIONS[STATES.IDLE];
    return d.min + Math.random() * (d.max - d.min);
  }

  function weightedRandom(transitions) {
    const total = transitions.reduce((sum, t) => sum + t.weight, 0);
    let r = Math.random() * total;
    for (const t of transitions) {
      r -= t.weight;
      if (r <= 0) return t.state;
    }
    return transitions[transitions.length - 1].state;
  }

  function transition(forceState) {
    const prevState = currentState;

    if (forceState) {
      currentState = forceState;
    } else {
      // 수면 시간 확인 (23:00~06:00)
      const hour = new Date().getHours();
      if (hour >= 23 || hour < 6) {
        if (currentState !== STATES.SLEEPING && Math.random() < 0.3) {
          currentState = STATES.SLEEPING;
          stateDuration = randomDuration(STATES.SLEEPING);
          stateStartTime = Date.now();
          if (onStateChange) onStateChange(prevState, currentState);
          return currentState;
        }
      }

      const transitions = BASE_TRANSITIONS[currentState] || BASE_TRANSITIONS[STATES.IDLE];
      currentState = weightedRandom(transitions);
    }

    stateDuration = randomDuration(currentState);
    stateStartTime = Date.now();
    if (onStateChange && prevState !== currentState) {
      onStateChange(prevState, currentState);
    }
    return currentState;
  }

  function update() {
    const elapsed = Date.now() - stateStartTime;
    if (elapsed >= stateDuration) {
      transition();
    }
    return currentState;
  }

  function forceState(state) {
    transition(state);
  }

  function getState() {
    return currentState;
  }

  function getElapsed() {
    return Date.now() - stateStartTime;
  }

  return {
    STATES, update, transition, forceState, getState, getElapsed,
    setPersonality, setOnStateChange, randomDuration,
  };
})();
