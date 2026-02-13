/**
 * Pet <-> Incarnation mode switching manager
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

    // Incarnation mode: reflect active persona if available
    const persona = (mode === 'incarnation' && window._persona)
      ? window._persona.getActivePersona()
      : null;

    // Update character colors
    let colors;
    if (mode === 'pet') {
      colors = { primary: '#ff4f40', secondary: '#ff775f', dark: '#8B4513', eye: '#ffffff', pupil: '#111111', claw: '#ff4f40' };
    } else if (persona?.color) {
      // Persona custom colors
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

    // Speed adjustment (persona takes priority)
    PetEngine.setSpeedMultiplier(persona?.speedMultiplier ?? p.speedMultiplier);

    // CSS classes
    pet.classList.remove('mode-pet', 'mode-incarnation');
    pet.classList.add(`mode-${mode}`);

    // Speech bubble style
    Speech.setMode(mode);

    // Apply personality (merge with persona if available)
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
   * Change persona (when switching bots in Incarnation mode)
   */
  function setPersona(personaData) {
    if (window._persona) {
      window._persona.setActivePersona(personaData);
      // Apply immediately if currently in Incarnation mode
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
      ? 'Transformed into Clawby mode!'
      : 'Claw... has awakened.');
  }

  function spawnTransitionEffect(mode) {
    const pos = PetEngine.getPosition();
    const color = mode === 'pet' ? '#ff4f40' : '#00BFA5';
    const world = document.getElementById('world');

    // Particle burst
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
