/**
 * Mode-specific personality parameters
 * Pet mode: high playfulness, fast speed
 * Incarnation mode: calm, normal speed
 */
const PERSONALITIES = {
  pet: {
    name: 'Clawby',
    title: 'Playful companion',
    playfulness: 0.8,
    shyness: 0.3,
    boldness: 0.7,
    speedMultiplier: 1.5,
    idleChatterChance: 0.15,    // 15% chance to mutter while idle
    fileInterestChance: 0.1,    // 10% chance to show interest in files
    sleepResistance: 0.2,       // Sleep resistance (low = falls asleep easily)
  },
  incarnation: {
    name: 'Claw',
    title: 'Embodied intelligence',
    playfulness: 0.3,
    shyness: 0.1,
    boldness: 0.9,
    speedMultiplier: 1.0,
    idleChatterChance: 0.08,
    fileInterestChance: 0.05,
    sleepResistance: 0.6,
  },
};

/**
 * Dynamic persona (reflects the bot's personality in Incarnation mode)
 *
 * When the user has multiple bots, the persona of the currently focused chat bot is applied.
 * Can be dynamically updated via the set_persona command.
 */
let activePersona = null;

function setActivePersona(persona) {
  activePersona = {
    name: persona.name || 'Claw',
    title: persona.title || 'Embodied intelligence',
    personality: persona.personality || '',   // "calm and logical", "lively and humorous"
    speakingStyle: persona.speakingStyle || '', // "formal", "casual", "aloof"
    color: persona.color || null,             // { primary, secondary, eye } custom colors
    playfulness: persona.playfulness ?? 0.3,
    shyness: persona.shyness ?? 0.1,
    boldness: persona.boldness ?? 0.9,
    speedMultiplier: persona.speedMultiplier ?? 1.0,
    idleChatterChance: persona.idleChatterChance ?? 0.08,
    greetings: persona.greetings || [],       // Custom greeting list
    catchphrases: persona.catchphrases || [], // Characteristic catchphrases
  };
  return activePersona;
}

function getActivePersona() {
  return activePersona;
}

function clearActivePersona() {
  activePersona = null;
}

/**
 * Evolution stage appearance parameters
 * All evolution is positive/cute in direction only
 * - Never transforms into scary/creepy appearances
 * - Colors become brighter and more vivid
 * - Details are added while maintaining a round, soft feel
 */
const EVOLUTION_STAGES = {
  // Stage 0: Default — newborn appearance
  0: {
    name: 'Baby Claw',
    clicksRequired: 0,
    daysRequired: 0,
    colorMod: { brightness: 1.0, saturation: 1.0 },
    sizeScale: 1.0,
    accessories: [],
    description: 'Small and cute default appearance',
  },
  // Stage 1: Starting to bond
  1: {
    name: 'Little Claw',
    clicksRequired: 20,
    daysRequired: 1,
    colorMod: { brightness: 1.05, saturation: 1.05 },
    sizeScale: 1.0,
    accessories: ['blush'],   // Blushing cheeks
    description: 'Cute look with slightly rosy cheeks',
  },
  // Stage 2: Close friends
  2: {
    name: 'Bouncy Claw',
    clicksRequired: 50,
    daysRequired: 3,
    colorMod: { brightness: 1.1, saturation: 1.1 },
    sizeScale: 1.05,
    accessories: ['blush', 'sparkle_eyes'],  // Sparkly eyes
    description: 'Sparkling eyes, slightly bigger',
  },
  // Stage 3: Best friends
  3: {
    name: 'Shining Claw',
    clicksRequired: 150,
    daysRequired: 7,
    colorMod: { brightness: 1.15, saturation: 1.15 },
    sizeScale: 1.08,
    accessories: ['blush', 'sparkle_eyes', 'crown'],  // Small crown
    description: 'Shining look with a little crown',
  },
  // Stage 4: Soulmates
  4: {
    name: 'Rainbow Claw',
    clicksRequired: 300,
    daysRequired: 14,
    colorMod: { brightness: 1.2, saturation: 1.2 },
    sizeScale: 1.1,
    accessories: ['blush', 'sparkle_eyes', 'crown', 'aura'],  // Aura
    description: 'Shining form wrapped in a warm aura',
  },
  // Stage 5: Final — legendary partner
  5: {
    name: 'Legendary Claw',
    clicksRequired: 500,
    daysRequired: 30,
    colorMod: { brightness: 1.25, saturation: 1.3 },
    sizeScale: 1.12,
    accessories: ['blush', 'sparkle_eyes', 'golden_crown', 'rainbow_aura', 'wings'],
    description: 'Legendary form with small wings and a golden crown',
  },
};

if (typeof window !== 'undefined') {
  window._personalities = PERSONALITIES;
  window._evolutionStages = EVOLUTION_STAGES;
  window._persona = { setActivePersona, getActivePersona, clearActivePersona };
} else if (typeof module !== 'undefined') {
  module.exports = { PERSONALITIES, EVOLUTION_STAGES, setActivePersona, getActivePersona, clearActivePersona };
}
