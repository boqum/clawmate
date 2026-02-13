/**
 * 사용자 상호작용 기억 + 진화 시스템
 *
 * - 클릭 횟수, 일수, 마일스톤 추적
 * - 진화 단계 관리: 항상 긍정적/귀여운 방향으로만 진화
 * - 무서운/끔찍한 모습으로는 절대 변하지 않음
 */
const Memory = (() => {
  let data = {
    totalClicks: 0,
    totalDays: 0,
    firstRunDate: null,
    lastVisitDate: null,
    milestones: [],
    evolutionStage: 0,
    interactionStreak: 0,    // 연속 방문 일수

    // --- 모션 히스토리 ---
    motionHistory: [],       // 최근 100개 상태 전환 기록 [{state, timestamp, duration}]
    motionStats: {},         // 상태별 누적 시간 {idle: 12345, walking: 6789, ...}

    // --- 유저 반응 저장 ---
    reactionLog: [],         // 최근 50개 유저 반응 [{action, reaction, timestamp}]
    favoriteActions: {},     // 행동별 긍정 반응 횟수 {excited: 5, walking: 2, ...}
    dislikedActions: {},     // 행동별 부정 반응 횟수 (무시/이탈)
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

    // 첫 실행
    if (!data.firstRunDate) {
      data.firstRunDate = new Date().toISOString();
      await save();
    }

    // 일수 계산
    updateDayCount();

    // 마일스톤 체크
    checkMilestones();

    // 진화 체크
    checkEvolution();

    // 진화 시각 효과 적용
    applyEvolutionVisuals();
  }

  function updateDayCount() {
    const firstRun = new Date(data.firstRunDate);
    const now = new Date();
    data.totalDays = Math.floor((now - firstRun) / (1000 * 60 * 60 * 24));

    // 연속 방문 체크
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
          // 약간의 딜레이 후 마일스톤 메시지 표시
          setTimeout(() => {
            Speech.show(msg);
            Interactions.spawnStarEffect();
          }, 1000);
        }
      }
    }
  }

  /**
   * 진화 단계 체크
   * 항상 올라가기만 함 (퇴화 없음)
   * 조건: 클릭 횟수 + 함께한 일수 모두 충족
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
   * 진화 발생 시 이벤트
   * - 밝은 플래시 효과 (부드러운 빛)
   * - 반짝이 파티클
   * - 축하 메시지
   */
  function onEvolution(prevStage, newStage) {
    const msgs = window._messages;
    const stageInfo = evolutionStages[newStage];

    // 밝은 플래시 (무섭지 않은 부드러운 효과)
    const flash = document.createElement('div');
    flash.className = 'evolve-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 600);

    // 진화 반짝임 파티클 (밝은 색상만)
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

    // 진화 링 이펙트 (따뜻한 색)
    const ring = document.createElement('div');
    ring.className = 'evolve-ring';
    ring.style.width = '64px';
    ring.style.height = '64px';
    ring.style.left = pos.x + 'px';
    ring.style.top = pos.y + 'px';
    ring.style.borderColor = '#FFD700';
    document.getElementById('world').appendChild(ring);
    setTimeout(() => ring.remove(), 1000);

    // 축하 메시지
    if (msgs && msgs.evolution) {
      const evolveMsg = msgs.evolution[`stage_${newStage}`];
      if (evolveMsg) {
        setTimeout(() => Speech.show(evolveMsg), 800);
      }
    }

    // 시각 효과 업데이트
    applyEvolutionVisuals();
  }

  /**
   * 진화 단계에 따른 시각적 변화 적용
   * 항상 긍정적: 밝아지고, 반짝이고, 귀여운 악세사리 추가
   */
  function applyEvolutionVisuals() {
    if (!evolutionStages) return;
    const stage = evolutionStages[data.evolutionStage];
    if (!stage) return;

    const pet = document.getElementById('pet-container');
    if (!pet) return;

    // 크기 스케일
    pet.style.transform = pet.style.transform || '';

    // 밝기/채도 — 진화할수록 밝고 화사해짐
    const { brightness, saturation } = stage.colorMod;
    const canvas = pet.querySelector('canvas');
    if (canvas) {
      canvas.style.filter = `brightness(${brightness}) saturate(${saturation})`;
    }

    // 악세사리 제거 후 재적용
    pet.querySelectorAll('.accessory').forEach(a => a.remove());

    for (const acc of stage.accessories) {
      addAccessory(pet, acc);
    }
  }

  /**
   * 귀여운 악세사리 추가
   * 모든 악세사리는 밝고 귀여운 요소만
   */
  function addAccessory(container, type) {
    const acc = document.createElement('div');
    acc.className = 'accessory';
    acc.style.position = 'absolute';
    acc.style.pointerEvents = 'none';
    acc.style.zIndex = '1001';

    switch (type) {
      case 'blush':
        // 양 볼에 핑크 동그라미
        acc.style.width = '8px';
        acc.style.height = '6px';
        acc.style.borderRadius = '50%';
        acc.style.background = 'rgba(255, 150, 150, 0.6)';
        acc.style.left = '12px';
        acc.style.top = '38px';
        container.appendChild(acc);
        // 오른쪽 볼
        const blush2 = acc.cloneNode();
        blush2.style.left = '44px';
        container.appendChild(blush2);
        return;

      case 'sparkle_eyes':
        // 눈에 반짝임 (흰색 작은 점)
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
        // 작은 천사 날개 (왼쪽)
        acc.textContent = '\u{1FABD}';
        acc.style.fontSize = '10px';
        acc.style.left = '-6px';
        acc.style.top = '20px';
        acc.style.opacity = '0.7';
        container.appendChild(acc);
        // 오른쪽 날개
        const wing2 = acc.cloneNode(true);
        wing2.style.left = '58px';
        wing2.style.transform = 'scaleX(-1)';
        container.appendChild(wing2);
        return;
    }

    container.appendChild(acc);
  }

  // --- 모션 히스토리 기록 ---

  /**
   * 상태 전환 기록
   * StateMachine에서 상태 변경 시 호출
   */
  function recordMotion(newState) {
    const now = Date.now();

    // 이전 상태의 지속 시간 계산 → 통계 누적
    if (lastMotionState && lastMotionTime > 0) {
      const duration = now - lastMotionTime;
      if (!data.motionStats[lastMotionState]) data.motionStats[lastMotionState] = 0;
      data.motionStats[lastMotionState] += duration;
    }

    // 히스토리에 추가
    data.motionHistory.push({
      state: newState,
      timestamp: now,
      from: lastMotionState || 'init',
    });

    // 최대 크기 초과 시 오래된 것 제거
    if (data.motionHistory.length > MAX_MOTION_HISTORY) {
      data.motionHistory = data.motionHistory.slice(-MAX_MOTION_HISTORY);
    }

    lastMotionState = newState;
    lastMotionTime = now;

    // 10회 전환마다 자동 저장
    if (data.motionHistory.length % 10 === 0) save();
  }

  /**
   * 유저 반응 기록
   * 특정 행동 중 사용자가 클릭/드래그 등의 반응을 보인 경우
   *
   * @param {string} action - 펫이 하고 있던 행동
   * @param {string} reaction - 'click' | 'drag' | 'cursor_near' | 'triple_click' | 'double_click'
   */
  function recordReaction(action, reaction) {
    const now = Date.now();

    // 반응 로그 추가
    data.reactionLog.push({ action, reaction, timestamp: now });
    if (data.reactionLog.length > MAX_REACTION_LOG) {
      data.reactionLog = data.reactionLog.slice(-MAX_REACTION_LOG);
    }

    // 클릭/더블클릭은 긍정 반응으로 분류
    if (reaction === 'click' || reaction === 'double_click' || reaction === 'cursor_near') {
      if (!data.favoriteActions[action]) data.favoriteActions[action] = 0;
      data.favoriteActions[action]++;
    }
    // 드래그(잡아서 옮김)는 약간 부정 반응
    if (reaction === 'drag') {
      if (!data.dislikedActions[action]) data.dislikedActions[action] = 0;
      data.dislikedActions[action]++;
    }

    save();
  }

  /**
   * 사용자 선호 행동 Top N 반환
   * AI가 행동 결정 시 참고
   */
  function getFavoriteActions(topN = 5) {
    const entries = Object.entries(data.favoriteActions || {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, topN).map(([action, count]) => ({ action, count }));
  }

  /**
   * 최근 모션 히스토리 반환
   */
  function getMotionHistory(limit = 20) {
    return (data.motionHistory || []).slice(-limit);
  }

  /**
   * 상태별 누적 시간 반환
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
