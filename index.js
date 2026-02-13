/**
 * ClawMate — OpenClaw 플러그인 진입점
 *
 * 핵심 원칙: OpenClaw이 켜지면 자동으로 ClawMate를 찾아서 연결.
 *
 * 흐름:
 *   OpenClaw 시작 → 플러그인 로드 → init() 자동 호출
 *     → ClawMate 실행 중인지 확인 (ws://127.0.0.1:9320 연결 시도)
 *       → 실행 중이면: 바로 연결, AI 뇌 역할 시작
 *       → 안 돌고 있으면: Electron 앱 자동 실행 → 연결
 *     → 연결 끊기면: 자동 재연결 (무한 반복)
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { OpenClawConnector } = require('./main/ai-connector');

let connector = null;
let electronProcess = null;
let apiRef = null;

// =====================================================
// Think Loop 상태 관리
// =====================================================
let thinkTimer = null;
let lastSpeechTime = 0;
let lastActionTime = 0;
let lastDesktopCheckTime = 0;
let lastScreenCheckTime = 0;
let lastGreetingDate = null;  // 하루에 한번만 인사

// 공간 탐험 시스템 상태
let knownWindows = [];         // 알고 있는 윈도우 목록
let lastWindowCheckTime = 0;
let homePosition = null;       // "집" 위치 (자주 가는 곳)
let explorationHistory = [];   // 탐험한 위치 기록
let lastExploreTime = 0;
let lastFolderCarryTime = 0;

module.exports = {
  id: 'clawmate',
  name: 'ClawMate',
  version: '1.2.0',
  description: 'OpenClaw 데스크톱 펫 - AI가 조종하는 살아있는 Claw',

  /**
   * OpenClaw이 플러그인을 로드할 때 자동 호출
   * → ClawMate 자동 실행 + 자동 연결
   */
  async init(api) {
    apiRef = api;
    console.log('[ClawMate] 플러그인 초기화 — 자동 연결 시작');
    autoConnect();

    // npm 패키지 버전 체크 (최초 1회 + 24시간 간격)
    checkNpmUpdate();
    setInterval(checkNpmUpdate, 24 * 60 * 60 * 1000);
  },

  register(api) {
    apiRef = api;

    // 펫 실행 (이미 돌고 있으면 상태 알려줌)
    api.registerSkill('launch-pet', {
      triggers: [
        '펫 깔아줘', '펫 실행', '펫 설치', '펫 켜줘', '펫 띄워줘',
        'clawmate', 'clawmate 깔아줘', 'clawmate 설치', 'clawmate 켜줘',
        '클로메이트', '클로메이트 깔아줘', '데스크톱 펫',
        'install pet', 'install clawmate', 'launch pet',
      ],
      description: '데스크톱 펫(ClawMate)을 실행하고 AI로 연결합니다',
      execute: async () => {
        if (connector && connector.connected) {
          connector.speak('이미 여기 있어!');
          connector.action('excited');
          return { message: 'ClawMate 이미 실행 중 + AI 연결됨!' };
        }
        await ensureRunningAndConnected();
        return { message: 'ClawMate 실행 + AI 연결 완료!' };
      },
    });

    // 펫에게 말하기
    api.registerSkill('pet-speak', {
      triggers: ['펫한테 말해', '펫에게 전달', 'tell pet'],
      description: '펫을 통해 사용자에게 메시지를 전달합니다',
      execute: async (context) => {
        if (!connector || !connector.connected) {
          return { message: 'ClawMate 연결 중이 아닙니다. 잠시 후 다시 시도...' };
        }
        const text = context.params?.text || context.input;
        connector.speak(text);
        return { message: `펫이 말합니다: "${text}"` };
      },
    });

    // 펫 행동 제어
    api.registerSkill('pet-action', {
      triggers: ['펫 행동', 'pet action'],
      description: '펫의 행동을 직접 제어합니다',
      execute: async (context) => {
        if (!connector || !connector.connected) return { message: '연결 대기 중...' };
        const action = context.params?.action || 'excited';
        connector.action(action);
        return { message: `펫 행동: ${action}` };
      },
    });

    // AI 종합 의사결정
    api.registerSkill('pet-decide', {
      triggers: [],
      description: 'AI가 펫의 종합적 행동을 결정합니다',
      execute: async (context) => {
        if (!connector || !connector.connected) return;
        connector.decide(context.params);
      },
    });
  },

  /**
   * OpenClaw 종료 시 정리
   */
  async destroy() {
    console.log('[ClawMate] 플러그인 정리');
    stopThinkLoop();
    if (connector) {
      connector.disconnect();
      connector = null;
    }
    // Electron 앱은 종료하지 않음 — 펫은 자율 모드로 계속 살아있음
  },
};

// =====================================================
// 자동 연결 시스템
// =====================================================

/**
 * OpenClaw 시작 시 자동으로 ClawMate 찾기/실행/연결
 * 무한 재시도 — ClawMate가 살아있는 한 항상 연결 유지
 */
async function autoConnect() {
  // 1단계: 이미 돌고 있는 ClawMate에 연결 시도
  const connected = await tryConnect();
  if (connected) {
    console.log('[ClawMate] 기존 ClawMate에 연결 성공');
    onConnected();
    return;
  }

  // 2단계: ClawMate가 없으면 자동 실행
  console.log('[ClawMate] ClawMate 미감지 — 자동 실행');
  launchElectronApp();

  // 3단계: 실행될 때까지 대기 후 연결
  await waitAndConnect();
}

/**
 * WebSocket 연결 시도 (1회)
 */
function tryConnect() {
  return new Promise((resolve) => {
    if (!connector) {
      connector = new OpenClawConnector(9320);
      setupConnectorEvents();
    }

    if (connector.connected) {
      resolve(true);
      return;
    }

    connector.connect()
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });
}

/**
 * ClawMate 실행 대기 → 연결 (최대 30초)
 */
async function waitAndConnect() {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ok = await tryConnect();
    if (ok) {
      console.log('[ClawMate] 연결 성공');
      onConnected();
      return;
    }
  }
  console.log('[ClawMate] 30초 내 연결 실패 — 백그라운드 재시도 시작');
  startBackgroundReconnect();
}

/**
 * 백그라운드 재연결 루프
 * 끊기면 10초마다 재시도
 */
let reconnectTimer = null;

function startBackgroundReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    if (connector && connector.connected) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      return;
    }
    const ok = await tryConnect();
    if (ok) {
      console.log('[ClawMate] 백그라운드 재연결 성공');
      onConnected();
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }, 10000);
}

/**
 * 커넥터 이벤트 설정 (최초 1회)
 */
let eventsSetup = false;
function setupConnectorEvents() {
  if (eventsSetup) return;
  eventsSetup = true;

  connector.onUserEvent(async (event) => {
    await handleUserEvent(event);
  });

  // 윈도우 위치 정보 수신 → 탐험 시스템에서 활용
  connector.on('window_positions', (data) => {
    knownWindows = data.windows || [];
  });

  connector.on('disconnected', () => {
    console.log('[ClawMate] 연결 끊김 — Think Loop 중단, 재연결 시도');
    stopThinkLoop();
    startBackgroundReconnect();
  });

  connector.on('connected', () => {
    onConnected();
  });
}

/**
 * 연결 성공 시
 */
function onConnected() {
  if (connector && connector.connected) {
    connector.speak('OpenClaw 연결됨! 같이 놀자!');
    connector.action('excited');

    // "집" 위치 설정 — 화면 하단 왼쪽을 기본 홈으로
    homePosition = { x: 100, y: 1000, edge: 'bottom' };

    // 초기 윈도우 목록 조회
    connector.queryWindows();

    startThinkLoop();
  }
}

// =====================================================
// Electron 앱 실행
// =====================================================

function launchElectronApp() {
  if (electronProcess) return;

  const platform = os.platform();
  const appDir = path.resolve(__dirname);

  // 설치된 Electron 바이너리 확인
  const electronPaths = [
    path.join(appDir, 'node_modules', '.bin', platform === 'win32' ? 'electron.cmd' : 'electron'),
    path.join(appDir, 'node_modules', 'electron', 'dist', platform === 'win32' ? 'electron.exe' : 'electron'),
  ];

  let electronBin = null;
  for (const p of electronPaths) {
    if (fs.existsSync(p)) { electronBin = p; break; }
  }

  if (electronBin) {
    electronProcess = spawn(electronBin, [appDir], {
      detached: true,
      stdio: 'ignore',
      cwd: appDir,
    });
  } else {
    // npx 폴백
    const npxCmd = platform === 'win32' ? 'npx.cmd' : 'npx';
    electronProcess = spawn(npxCmd, ['electron', appDir], {
      detached: true,
      stdio: 'ignore',
      cwd: appDir,
    });
  }

  electronProcess.unref();
  electronProcess.on('exit', () => {
    electronProcess = null;
    // 펫이 죽으면 재시작 시도 (크래시 방어)
    console.log('[ClawMate] Electron 종료 감지');
  });
}

// =====================================================
// AI 이벤트 핸들링
// =====================================================

async function handleUserEvent(event) {
  if (!connector || !connector.connected) return;

  switch (event.event) {
    case 'click':
      connector.decide({
        action: 'interacting',
        emotion: 'affectionate',
      });
      break;

    case 'cursor_near':
      if (event.distance < 50) {
        connector.decide({ action: 'excited', emotion: 'happy' });
      }
      break;

    case 'drag':
      connector.speak('으앗, 나를 옮기다니!');
      break;

    case 'desktop_changed':
      const fileCount = event.files?.length || 0;
      if (fileCount > 15) {
        connector.decide({
          action: 'walking',
          speech: '바탕화면이 좀 복잡해 보이는데... 정리 도와줄까?',
          emotion: 'curious',
        });
      }
      break;

    case 'time_change':
      if (event.hour === 23) {
        connector.decide({
          action: 'sleeping',
          speech: '슬슬 잘 시간이야... 굿나잇!',
          emotion: 'sleepy',
        });
      } else if (event.hour === 6) {
        connector.decide({
          action: 'excited',
          speech: '좋은 아침! 오늘도 화이팅!',
          emotion: 'happy',
        });
      }
      break;

    case 'milestone':
      connector.decide({ action: 'excited', emotion: 'proud' });
      break;

    case 'user_idle':
      if (event.idleSeconds > 300) {
        connector.decide({
          action: 'idle',
          speech: '...자고 있는 건 아니지?',
          emotion: 'curious',
        });
      }
      break;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =====================================================
// AI Think Loop — 주기적 자율 사고 시스템
// =====================================================

// 시간대별 인사말
const TIME_GREETINGS = {
  morning: [
    '좋은 아침! 오늘 하루도 화이팅!',
    '일어났어? 커피 한 잔 어때?',
    '모닝~ 오늘 날씨 어떨까?',
  ],
  lunch: [
    '점심 시간이다! 뭐 먹을 거야?',
    '밥 먹었어? 건강이 최고야!',
    '슬슬 배고프지 않아?',
  ],
  evening: [
    '오늘 하루 수고했어!',
    '저녁이네~ 오늘 뭐 했어?',
    '하루가 벌써 이렇게 지나가다니...',
  ],
  night: [
    '이 시간까지 깨있는 거야? 곧 자야지~',
    '밤이 깊었어... 내일도 있잖아.',
    '나는 슬슬 졸리다... zzZ',
  ],
};

// 한가할 때 혼잣말 목록
const IDLE_CHATTER = [
  '음~ 뭐 하고 놀까...',
  '심심하다...',
  '나 여기 있는 거 알지?',
  '바탕화면 구경 중~',
  '오늘 기분이 좋다!',
  '후후, 잠깐 스트레칭~',
  '이리저리 돌아다녀볼까~',
  '혼자 놀기 프로...',
  '주인님 뭐 하고 있는 거야~?',
  '나한테 관심 좀 줘봐!',
  '데스크톱이 넓고 좋다~',
  '여기서 보이는 게 다 내 세상!',
  // 공간 탐험 관련 멘트
  '화면 위를 점프해볼까~!',
  '천장에서 내려가보자!',
  '이 창 위에 올라가봐야지~',
  '여기가 내 집이야~ 편하다!',
  '좀 돌아다녀볼까? 탐험 모드!',
];

// 랜덤 행동 목록
const RANDOM_ACTIONS = [
  { action: 'walking', weight: 30, minInterval: 5000 },
  { action: 'idle', weight: 25, minInterval: 3000 },
  { action: 'excited', weight: 10, minInterval: 15000 },
  { action: 'climbing', weight: 8, minInterval: 20000 },
  { action: 'looking_around', weight: 20, minInterval: 8000 },
  { action: 'sleeping', weight: 7, minInterval: 60000 },
  // 공간 이동 행동
  { action: 'jumping', weight: 5, minInterval: 30000 },
  { action: 'rappelling', weight: 3, minInterval: 45000 },
];

/**
 * Think Loop 시작
 * 3초 간격으로 AI가 자율적으로 사고하고 행동을 결정
 */
function startThinkLoop() {
  if (thinkTimer) return;
  console.log('[ClawMate] Think Loop 시작 — 3초 간격 자율 사고');

  // 초기 타임스탬프 설정 (시작 직후 스팸 방지)
  const now = Date.now();
  lastSpeechTime = now;
  lastActionTime = now;
  lastDesktopCheckTime = now;
  lastScreenCheckTime = now;

  thinkTimer = setInterval(async () => {
    try {
      await thinkCycle();
    } catch (err) {
      console.error('[ClawMate] Think Loop 오류:', err.message);
    }
  }, 3000);
}

/**
 * Think Loop 중단
 */
function stopThinkLoop() {
  if (thinkTimer) {
    clearInterval(thinkTimer);
    thinkTimer = null;
    console.log('[ClawMate] Think Loop 중단');
  }
}

/**
 * 단일 사고 사이클 — 매 3초마다 실행
 */
async function thinkCycle() {
  if (!connector || !connector.connected) return;

  const now = Date.now();
  const date = new Date();
  const hour = date.getHours();
  const todayStr = date.toISOString().slice(0, 10);

  // 펫 상태 조회 (캐시된 값 또는 실시간)
  const state = await connector.queryState(1500);

  // --- 1) 시간대별 인사 (하루에 한번씩, 시간대별) ---
  const greetingHandled = handleTimeGreeting(now, hour, todayStr);

  // --- 2) 야간 수면 모드 (23시~5시: 말/행동 빈도 대폭 감소) ---
  const isNightMode = hour >= 23 || hour < 5;

  // --- 3) 자율 발화 (30초 쿨타임 + 확률) ---
  if (!greetingHandled) {
    handleIdleSpeech(now, isNightMode);
  }

  // --- 4) 자율 행동 결정 (5초 쿨타임 + 확률) ---
  handleRandomAction(now, hour, isNightMode, state);

  // --- 5) 바탕화면 파일 체크 (5분 간격) ---
  handleDesktopCheck(now);

  // --- 6) 화면 관찰 (2분 간격, 10% 확률) ---
  handleScreenObservation(now);

  // --- 7) 공간 탐험 (20초 간격, 20% 확률) ---
  handleExploration(now, state);

  // --- 8) 윈도우 체크 (30초 간격) ---
  handleWindowCheck(now);

  // --- 9) 바탕화면 폴더 나르기 (3분 간격, 10% 확률) ---
  handleFolderCarry(now);
}

/**
 * 시간대별 인사 처리
 * 아침/점심/저녁/밤 각각 하루 한 번
 */
function handleTimeGreeting(now, hour, todayStr) {
  // 시간대 결정
  let period = null;
  if (hour >= 6 && hour < 9) period = 'morning';
  else if (hour >= 11 && hour < 13) period = 'lunch';
  else if (hour >= 17 && hour < 19) period = 'evening';
  else if (hour >= 22 && hour < 24) period = 'night';

  if (!period) return false;

  const greetingKey = `${todayStr}_${period}`;
  if (lastGreetingDate === greetingKey) return false;

  // 시간대 인사 전송
  lastGreetingDate = greetingKey;
  const greetings = TIME_GREETINGS[period];
  const text = greetings[Math.floor(Math.random() * greetings.length)];

  const emotionMap = {
    morning: 'happy',
    lunch: 'curious',
    evening: 'content',
    night: 'sleepy',
  };
  const actionMap = {
    morning: 'excited',
    lunch: 'walking',
    evening: 'idle',
    night: 'sleeping',
  };

  connector.decide({
    action: actionMap[period],
    speech: text,
    emotion: emotionMap[period],
  });
  lastSpeechTime = Date.now();
  console.log(`[ClawMate] 시간대 인사 (${period}): ${text}`);
  return true;
}

/**
 * 한가할 때 혼잣말
 * 최소 30초 쿨타임, 야간에는 확률 대폭 감소
 */
function handleIdleSpeech(now, isNightMode) {
  const speechCooldown = 30000; // 30초
  if (now - lastSpeechTime < speechCooldown) return;

  // 야간: 5% 확률 / 주간: 25% 확률
  const speechChance = isNightMode ? 0.05 : 0.25;
  if (Math.random() > speechChance) return;

  const text = IDLE_CHATTER[Math.floor(Math.random() * IDLE_CHATTER.length)];
  connector.speak(text);
  lastSpeechTime = now;
  console.log(`[ClawMate] 혼잣말: ${text}`);
}

/**
 * 자율 행동 결정
 * 최소 5초 쿨타임, 가중치 기반 랜덤 선택
 */
function handleRandomAction(now, hour, isNightMode, state) {
  const actionCooldown = 5000; // 5초
  if (now - lastActionTime < actionCooldown) return;

  // 야간: 10% 확률 / 주간: 40% 확률
  const actionChance = isNightMode ? 0.1 : 0.4;
  if (Math.random() > actionChance) return;

  // 야간에는 sleeping 가중치 대폭 상승
  const actions = RANDOM_ACTIONS.map(a => {
    let weight = a.weight;
    if (isNightMode) {
      if (a.action === 'sleeping') weight = 60;
      else if (a.action === 'excited' || a.action === 'climbing') weight = 2;
    }
    // 새벽/아침에는 looking_around 선호
    if (hour >= 6 && hour < 9 && a.action === 'looking_around') weight += 15;
    return { ...a, weight };
  });

  // 최근 동일 행동 반복 방지: 현재 상태와 같으면 가중치 감소
  const currentAction = state?.action || state?.state;
  if (currentAction) {
    const match = actions.find(a => a.action === currentAction);
    if (match) match.weight = Math.max(1, Math.floor(match.weight * 0.3));
  }

  const selected = weightedRandom(actions);
  if (!selected) return;

  // minInterval 체크
  if (now - lastActionTime < selected.minInterval) return;

  // 공간 이동 행동은 전용 API로 처리
  if (selected.action === 'jumping') {
    // 랜덤 위치로 점프 또는 화면 중앙으로
    if (Math.random() > 0.5) {
      connector.moveToCenter();
    } else {
      const randomX = Math.floor(Math.random() * 1200) + 100;
      const randomY = Math.floor(Math.random() * 800) + 100;
      connector.jumpTo(randomX, randomY);
    }
  } else if (selected.action === 'rappelling') {
    connector.rappel();
  } else {
    connector.action(selected.action);
  }
  lastActionTime = now;
}

/**
 * 바탕화면 파일 체크 (5분 간격)
 * 데스크톱 폴더를 읽어서 재밌는 코멘트
 */
function handleDesktopCheck(now) {
  const checkInterval = 5 * 60 * 1000; // 5분
  if (now - lastDesktopCheckTime < checkInterval) return;
  lastDesktopCheckTime = now;

  // 15% 확률로만 실행 (매번 할 필요 없음)
  if (Math.random() > 0.15) return;

  try {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(desktopPath)) return;

    const files = fs.readdirSync(desktopPath);
    if (files.length === 0) {
      connector.speak('바탕화면이 깨끗하네! 좋아!');
      lastSpeechTime = now;
      return;
    }

    // 파일 종류별 코멘트
    const images = files.filter(f => /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(f));
    const docs = files.filter(f => /\.(pdf|doc|docx|xlsx|pptx|txt|hwp)$/i.test(f));
    const zips = files.filter(f => /\.(zip|rar|7z|tar|gz)$/i.test(f));

    let comment = null;
    if (files.length > 20) {
      comment = `바탕화면에 파일이 ${files.length}개나 있어! 정리 좀 할까?`;
    } else if (images.length > 5) {
      comment = `사진이 많네~ ${images.length}개나! 앨범 정리 어때?`;
    } else if (zips.length > 3) {
      comment = `압축 파일이 좀 쌓였네... 풀어볼 거 있어?`;
    } else if (docs.length > 0) {
      comment = `문서 작업 중이구나~ 화이팅!`;
    } else if (files.length <= 3) {
      comment = '바탕화면이 깔끔해서 기분 좋다~';
    }

    if (comment) {
      connector.decide({
        action: 'looking_around',
        speech: comment,
        emotion: 'curious',
      });
      lastSpeechTime = now;
      console.log(`[ClawMate] 바탕화면 체크: ${comment}`);
    }
  } catch {
    // 데스크톱 접근 실패 — 무시
  }
}

/**
 * 화면 관찰 (2분 간격, 10% 확률)
 * 스크린샷을 캡처해서 OpenClaw AI가 화면 내용을 인식
 */
function handleScreenObservation(now) {
  const screenCheckInterval = 2 * 60 * 1000; // 2분
  if (now - lastScreenCheckTime < screenCheckInterval) return;

  // 10% 확률로만 실행 (리소스 절약)
  if (Math.random() > 0.1) return;

  lastScreenCheckTime = now;

  if (!connector || !connector.connected) return;

  connector.requestScreenCapture();
  console.log('[ClawMate] 화면 캡처 요청');
}

/**
 * 가중치 기반 랜덤 선택
 */
function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

// =====================================================
// 공간 탐험 시스템 — OpenClaw이 컴퓨터를 "집"처럼 돌아다님
// =====================================================

/**
 * 공간 탐험 처리 (20초 간격, 20% 확률)
 * 윈도우 위를 걸어다니고, 레펠로 내려가고, 집으로 돌아가는 등
 */
function handleExploration(now, state) {
  const exploreInterval = 20000; // 20초
  if (now - lastExploreTime < exploreInterval) return;

  // 20% 확률
  if (Math.random() > 0.2) return;
  lastExploreTime = now;

  // 가중치 기반 탐험 행동 선택
  const actions = [
    { type: 'jump_to_center', weight: 15, speech: '화면 중앙 탐험~!' },
    { type: 'rappel_down', weight: 10, speech: '실 타고 내려가볼까~' },
    { type: 'climb_wall', weight: 20 },
    { type: 'visit_window', weight: 25, speech: '이 창 위에 올라가볼까?' },
    { type: 'return_home', weight: 30, speech: '집에 가자~' },
  ];

  const selected = weightedRandom(actions);
  if (!selected) return;

  switch (selected.type) {
    case 'jump_to_center':
      connector.moveToCenter();
      if (selected.speech) connector.speak(selected.speech);
      break;

    case 'rappel_down':
      connector.rappel();
      if (selected.speech) setTimeout(() => connector.speak(selected.speech), 500);
      break;

    case 'climb_wall':
      connector.action('climbing_up');
      break;

    case 'visit_window':
      // 알려진 윈도우 중 랜덤으로 하나 선택 후 타이틀바 위로 점프
      if (knownWindows.length > 0) {
        const win = knownWindows[Math.floor(Math.random() * knownWindows.length)];
        connector.jumpTo(win.x + win.width / 2, win.y);
        if (selected.speech) connector.speak(selected.speech);
      }
      break;

    case 'return_home':
      if (homePosition) {
        connector.jumpTo(homePosition.x, homePosition.y);
      } else {
        connector.action('idle');
      }
      if (selected.speech) connector.speak(selected.speech);
      break;
  }

  // 탐험 기록 저장 (최근 20개)
  explorationHistory.push({ type: selected.type, time: now });
  if (explorationHistory.length > 20) {
    explorationHistory.shift();
  }
}

/**
 * 윈도우 위치 정보 주기적 갱신 (30초 간격)
 * OS에서 열린 윈도우 목록을 가져와 탐험에 활용
 */
function handleWindowCheck(now) {
  const windowCheckInterval = 30000; // 30초
  if (now - lastWindowCheckTime < windowCheckInterval) return;
  lastWindowCheckTime = now;
  connector.queryWindows();
}

/**
 * 바탕화면 폴더 나르기 (3분 간격, 10% 확률)
 * 바탕화면 폴더를 하나 집어서 잠시 들고 다니다가 내려놓음
 */
function handleFolderCarry(now) {
  const carryInterval = 3 * 60 * 1000; // 3분
  if (now - lastFolderCarryTime < carryInterval) return;

  // 10% 확률
  if (Math.random() > 0.1) return;
  lastFolderCarryTime = now;

  try {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(desktopPath)) return;

    const entries = fs.readdirSync(desktopPath, { withFileTypes: true });
    // 폴더만 필터 (숨김 폴더 제외, 안전한 것만)
    const folders = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    if (folders.length === 0) return;

    const folder = folders[Math.floor(Math.random() * folders.length)];
    connector.decide({
      action: 'carrying',
      speech: `${folder} 폴더 들고 다녀볼까~`,
      emotion: 'playful',
    });
    connector.carryFile(folder);

    // 5초 후 내려놓기
    setTimeout(() => {
      if (connector && connector.connected) {
        connector.dropFile();
        connector.speak('여기 놔둘게~');
      }
    }, 5000);
  } catch {
    // 바탕화면 폴더 접근 실패 — 무시
  }
}

// =====================================================
// npm 패키지 버전 체크 (npm install -g 사용자용)
// =====================================================

/**
 * npm registry에서 최신 버전을 확인하고,
 * 현재 버전과 다르면 콘솔 + 펫 말풍선으로 알림
 */
async function checkNpmUpdate() {
  try {
    const { execSync } = require('child_process');
    const latest = execSync('npm view clawmate version', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    const current = require('./package.json').version;

    if (latest !== current) {
      console.log(`[ClawMate] 새 버전 ${latest} 사용 가능 (현재: ${current})`);
      console.log('[ClawMate] 업데이트: npm update -g clawmate');
      if (connector && connector.connected) {
        connector.speak(`업데이트가 있어! v${latest}`);
      }
    }
  } catch {
    // npm registry 접근 실패 — 무시 (오프라인 등)
  }
}
