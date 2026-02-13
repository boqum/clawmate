/**
 * 시간대별 행동 변화 시스템
 * - 아침 인사, 점심 알림, 밤엔 잠자기
 * - 랜덤 혼잣말 (idle chatter)
 * - 팁 메시지 랜덤 출현
 */
const TimeAware = (() => {
  let lastGreetingHour = -1;
  let lastChatterTime = 0;
  let lastTipTime = 0;
  const CHATTER_COOLDOWN = 60000;     // 1분 최소 간격
  const TIP_COOLDOWN = 5 * 60000;     // 5분 최소 간격
  let chatterChance = 0.15;

  function init() {
    // 시작 시 인사
    showTimeGreeting();
    // 주기적 체크
    setInterval(tick, 30000); // 30초마다
  }

  function setChatterChance(chance) {
    chatterChance = chance;
  }

  function tick() {
    const hour = new Date().getHours();
    const now = Date.now();

    // 시간대 변경 감지 → 인사
    if (hour !== lastGreetingHour && [6, 12, 18, 23].includes(hour)) {
      showTimeGreeting();
      lastGreetingHour = hour;
    }

    // 수면 시간 체크 (23:00~06:00)
    if (hour >= 23 || hour < 6) {
      const state = StateMachine.getState();
      if (state !== 'sleeping' && state !== 'interacting') {
        if (Math.random() < 0.2) {
          StateMachine.forceState('sleeping');
          showSleepEffect();
        }
      }
    }

    // idle 상태일 때 혼잣말
    const state = StateMachine.getState();
    if (state === 'idle' && now - lastChatterTime > CHATTER_COOLDOWN) {
      if (Math.random() < chatterChance) {
        const msgs = window._messages;
        if (msgs && msgs.idle_chatter) {
          const msg = msgs.idle_chatter[Math.floor(Math.random() * msgs.idle_chatter.length)];
          Speech.show(msg);
          lastChatterTime = now;
        }
      }
    }

    // 팁 메시지 (더 드물게)
    if (now - lastTipTime > TIP_COOLDOWN && Math.random() < 0.05) {
      const tip = Speech.getTipMessage();
      if (tip) {
        Speech.show(tip);
        lastTipTime = now;
      }
    }
  }

  function showTimeGreeting() {
    const msg = Speech.getGreetingMessage();
    if (msg) Speech.show(msg);
    lastGreetingHour = new Date().getHours();
  }

  function showSleepEffect() {
    const pet = document.getElementById('pet-container');
    // Z-z-z 이펙트 추가
    for (let i = 0; i < 3; i++) {
      const z = document.createElement('div');
      z.className = 'sleep-z';
      z.textContent = 'z';
      z.style.animationDelay = (i * 0.5) + 's';
      pet.appendChild(z);
    }
    // 5초 후 제거
    setTimeout(() => {
      pet.querySelectorAll('.sleep-z').forEach(el => el.remove());
    }, 5000);
  }

  return { init, setChatterChance, tick };
})();
