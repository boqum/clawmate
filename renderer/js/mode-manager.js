/**
 * Pet ↔ Incarnation 모드 전환 관리
 */
const ModeManager = (() => {
  let currentMode = 'pet';

  async function init() {
    currentMode = await window.clawmate.getMode() || 'pet';
    applyMode(currentMode);

    window.clawmate.onModeChanged((mode) => {
      currentMode = mode;
      applyMode(mode);
    });
  }

  function applyMode(mode) {
    const pet = document.getElementById('pet-container');
    const personalities = window._personalities;
    if (!personalities) return;

    const p = personalities[mode];
    if (!p) return;

    // 캐릭터 색상 업데이트
    const colors = mode === 'pet'
      ? { primary: '#ff4f40', secondary: '#ff775f', dark: '#3a0a0d', eye: '#ffffff', pupil: '#111111', claw: '#ff4f40' }
      : { primary: '#ff4f40', secondary: '#ff775f', dark: '#3a0a0d', eye: '#00BFA5', pupil: '#004D40', claw: '#ff4f40' };
    Character.setColorMap(colors);

    // 속도 조정
    PetEngine.setSpeedMultiplier(p.speedMultiplier);

    // CSS 클래스
    pet.classList.remove('mode-pet', 'mode-incarnation');
    pet.classList.add(`mode-${mode}`);

    // 말풍선 스타일
    Speech.setMode(mode);

    // 성격 적용
    StateMachine.setPersonality(p);
  }

  async function toggle() {
    const newMode = currentMode === 'pet' ? 'incarnation' : 'pet';
    await window.clawmate.setMode(newMode);
    currentMode = newMode;
    applyMode(newMode);
    spawnTransitionEffect(newMode);
    Speech.show(newMode === 'pet'
      ? 'Clawby 모드로 변신!'
      : 'OpenClaw... 각성했다.');
  }

  function spawnTransitionEffect(mode) {
    const pos = PetEngine.getPosition();
    const color = mode === 'pet' ? '#ff4f40' : '#00BFA5';
    const world = document.getElementById('world');

    // 파티클 버스트
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'mode-transition-particle';
      p.style.backgroundColor = color;
      p.style.left = (pos.x + 32) + 'px';
      p.style.top = (pos.y + 32) + 'px';
      const angle = (Math.PI * 2 * i) / 12;
      const dist = 30 + Math.random() * 40;
      p.style.setProperty('--px', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--py', Math.sin(angle) * dist + 'px');
      world.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  function getMode() {
    return currentMode;
  }

  return { init, toggle, getMode, applyMode };
})();
