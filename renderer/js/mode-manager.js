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

    // Incarnation 모드: 활성 인격체가 있으면 반영
    const persona = (mode === 'incarnation' && window._persona)
      ? window._persona.getActivePersona()
      : null;

    // 캐릭터 색상 업데이트
    let colors;
    if (mode === 'pet') {
      colors = { primary: '#ff4f40', secondary: '#ff775f', dark: '#8B4513', eye: '#ffffff', pupil: '#111111', claw: '#ff4f40' };
    } else if (persona?.color) {
      // 인격체 커스텀 색상
      colors = {
        primary: persona.color.primary || '#ff4f40',
        secondary: persona.color.secondary || '#ff775f',
        dark: persona.color.dark || '#8B4513',
        eye: persona.color.eye || '#00BFA5',
        pupil: persona.color.pupil || '#004D40',
        claw: persona.color.claw || '#ff4f40',
      };
    } else {
      colors = { primary: '#ff4f40', secondary: '#ff775f', dark: '#8B4513', eye: '#00BFA5', pupil: '#004D40', claw: '#ff4f40' };
    }
    Character.setColorMap(colors);

    // 속도 조정 (인격체 우선)
    PetEngine.setSpeedMultiplier(persona?.speedMultiplier ?? p.speedMultiplier);

    // CSS 클래스
    pet.classList.remove('mode-pet', 'mode-incarnation');
    pet.classList.add(`mode-${mode}`);

    // 말풍선 스타일
    Speech.setMode(mode);

    // 성격 적용 (인격체가 있으면 병합)
    if (persona) {
      StateMachine.setPersonality({
        ...p,
        playfulness: persona.playfulness ?? p.playfulness,
        shyness: persona.shyness ?? p.shyness,
        boldness: persona.boldness ?? p.boldness,
      });
    } else {
      StateMachine.setPersonality(p);
    }
  }

  /**
   * 인격체 변경 (Incarnation 모드에서 봇 전환 시)
   */
  function setPersona(personaData) {
    if (window._persona) {
      window._persona.setActivePersona(personaData);
      // 현재 Incarnation 모드면 즉시 반영
      if (currentMode === 'incarnation') {
        applyMode('incarnation');
      }
    }
  }

  function getPersona() {
    return window._persona ? window._persona.getActivePersona() : null;
  }

  async function toggle() {
    const newMode = currentMode === 'pet' ? 'incarnation' : 'pet';
    await window.clawmate.setMode(newMode);
    currentMode = newMode;
    applyMode(newMode);
    spawnTransitionEffect(newMode);
    Speech.show(newMode === 'pet'
      ? 'Clawby 모드로 변신!'
      : 'Claw... 각성했다.');
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

  return { init, toggle, getMode, applyMode, setPersona, getPersona };
})();
