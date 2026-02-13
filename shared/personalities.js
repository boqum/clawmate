/**
 * 모드별 성격 파라미터
 * Pet 모드: 장난기 높음, 빠른 속도
 * Incarnation 모드: 침착, 보통 속도
 */
const PERSONALITIES = {
  pet: {
    name: 'Clawby',
    title: '귀여운 동반자',
    playfulness: 0.8,
    shyness: 0.3,
    boldness: 0.7,
    speedMultiplier: 1.5,
    idleChatterChance: 0.15,    // 15% 확률로 idle 중 혼잣말
    fileInterestChance: 0.1,    // 10% 확률로 파일에 관심
    sleepResistance: 0.2,       // 수면 저항 (낮음=잘 잠)
  },
  incarnation: {
    name: 'Claw',
    title: '육체를 얻은 존재',
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
 * 동적 인격체 (Incarnation 모드에서 봇의 인격을 반영)
 *
 * 사용자가 여러 봇을 쓸 때, 현재 포커싱된 채팅의 봇 인격체가 반영됨.
 * set_persona 명령으로 동적 업데이트 가능.
 */
let activePersona = null;

function setActivePersona(persona) {
  activePersona = {
    name: persona.name || 'Claw',
    title: persona.title || '육체를 얻은 존재',
    personality: persona.personality || '',   // "침착하고 논리적인", "활발하고 유머러스한"
    speakingStyle: persona.speakingStyle || '', // "존댓말", "반말", "도도한"
    color: persona.color || null,             // { primary, secondary, eye } 커스텀 색상
    playfulness: persona.playfulness ?? 0.3,
    shyness: persona.shyness ?? 0.1,
    boldness: persona.boldness ?? 0.9,
    speedMultiplier: persona.speedMultiplier ?? 1.0,
    idleChatterChance: persona.idleChatterChance ?? 0.08,
    greetings: persona.greetings || [],       // 커스텀 인사말 목록
    catchphrases: persona.catchphrases || [], // 특징적 말버릇
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
 * 진화 단계별 외형 변화 파라미터
 * 모든 진화는 긍정적/귀여운 방향으로만 진행
 * - 무서운/끔찍한 모습으로 변하지 않음
 * - 색상은 점점 밝고 화사해짐
 * - 디테일이 추가되지만 전체적으로 둥글고 부드러운 느낌 유지
 */
const EVOLUTION_STAGES = {
  // Stage 0: 기본 — 갓 태어난 모습
  0: {
    name: '아기 Claw',
    clicksRequired: 0,
    daysRequired: 0,
    colorMod: { brightness: 1.0, saturation: 1.0 },
    sizeScale: 1.0,
    accessories: [],
    description: '작고 귀여운 기본 모습',
  },
  // Stage 1: 친해지기 시작
  1: {
    name: '꼬마 Claw',
    clicksRequired: 20,
    daysRequired: 1,
    colorMod: { brightness: 1.05, saturation: 1.05 },
    sizeScale: 1.0,
    accessories: ['blush'],   // 볼 터치 (부끄럼)
    description: '볼이 살짝 발그레한 귀여운 모습',
  },
  // Stage 2: 친한 사이
  2: {
    name: '덩실 Claw',
    clicksRequired: 50,
    daysRequired: 3,
    colorMod: { brightness: 1.1, saturation: 1.1 },
    sizeScale: 1.05,
    accessories: ['blush', 'sparkle_eyes'],  // 반짝 눈
    description: '눈이 반짝반짝, 살짝 커진 모습',
  },
  // Stage 3: 절친
  3: {
    name: '빛나는 Claw',
    clicksRequired: 150,
    daysRequired: 7,
    colorMod: { brightness: 1.15, saturation: 1.15 },
    sizeScale: 1.08,
    accessories: ['blush', 'sparkle_eyes', 'crown'],  // 작은 왕관
    description: '작은 왕관을 쓴 빛나는 모습',
  },
  // Stage 4: 소울메이트
  4: {
    name: '무지개 Claw',
    clicksRequired: 300,
    daysRequired: 14,
    colorMod: { brightness: 1.2, saturation: 1.2 },
    sizeScale: 1.1,
    accessories: ['blush', 'sparkle_eyes', 'crown', 'aura'],  // 오라
    description: '따뜻한 오라에 둘러싸인 빛나는 모습',
  },
  // Stage 5: 최종 — 전설의 파트너
  5: {
    name: '전설의 Claw',
    clicksRequired: 500,
    daysRequired: 30,
    colorMod: { brightness: 1.25, saturation: 1.3 },
    sizeScale: 1.12,
    accessories: ['blush', 'sparkle_eyes', 'golden_crown', 'rainbow_aura', 'wings'],
    description: '작은 날개와 황금 왕관의 전설적 모습',
  },
};

if (typeof window !== 'undefined') {
  window._personalities = PERSONALITIES;
  window._evolutionStages = EVOLUTION_STAGES;
  window._persona = { setActivePersona, getActivePersona, clearActivePersona };
} else if (typeof module !== 'undefined') {
  module.exports = { PERSONALITIES, EVOLUTION_STAGES, setActivePersona, getActivePersona, clearActivePersona };
}
