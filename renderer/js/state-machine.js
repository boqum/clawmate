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
      { state: STATES.CLIMBING_UP, weight: 0.25 },
      { state: STATES.WALKING, weight: 0.25 },
      { state: STATES.PLAYING, weight: 0.2 },
    ],
    [STATES.CLIMBING_UP]: [
      { state: STATES.CEILING_WALK, weight: 0.5 },
      { state: STATES.CLIMBING_DOWN, weight: 0.5 },
    ],
    [STATES.CEILING_WALK]: [
      { state: STATES.CLIMBING_DOWN, weight: 0.6 },
      { state: STATES.CEILING_WALK, weight: 0.4 },
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
