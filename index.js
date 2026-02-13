/**
 * ClawMate 플러그인 진입점
 *
 * 핵심 원칙: AI가 연결되면 자동으로 ClawMate를 찾아서 연결.
 *
 * 흐름:
 *   플러그인 로드 → init() 자동 호출
 *     → ClawMate 실행 중인지 확인 (ws://127.0.0.1:9320 연결 시도)
 *       → 실행 중이면: 바로 연결, AI 뇌 역할 시작
 *       → 안 돌고 있으면: Electron 앱 자동 실행 → 연결
 *     → 연결 끊기면: 자동 재연결 (무한 반복)
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ClawMateConnector } = require('./main/ai-connector');

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

// 브라우징 감시 시스템 상태
let browsingContext = {
  title: '',                   // 현재 윈도우 제목
  category: '',                // 카테고리 (shopping, video, dev 등)
  lastCommentTime: 0,          // 마지막 AI 코멘트 시각
  screenImage: null,           // 최근 화면 캡처 (base64)
  cursorX: 0,                  // 커서 X 좌표
  cursorY: 0,                  // 커서 Y 좌표
};

// 공간 탐험 시스템 상태
let knownWindows = [];         // 알고 있는 윈도우 목록
let lastWindowCheckTime = 0;
let homePosition = null;       // "집" 위치 (자주 가는 곳)
let explorationHistory = [];   // 탐험한 위치 기록
let lastExploreTime = 0;
let lastFolderCarryTime = 0;

// =====================================================
// 자기 관찰 시스템 상태 (Metrics)
// =====================================================
let latestMetrics = null;          // 가장 최근 수신한 메트릭 데이터
let metricsHistory = [];           // 최근 10개 메트릭 보고 이력
let behaviorAdjustments = {        // 현재 적용 중인 행동 조정값
  speechCooldownMultiplier: 1.0,   // 말풍선 빈도 조절 (1.0=기본, >1=줄임, <1=늘림)
  actionCooldownMultiplier: 1.0,   // 행동 빈도 조절
  explorationBias: 0,              // 탐험 편향 (양수=더 탐험, 음수=덜 탐험)
  activityLevel: 1.0,              // 활동 수준 (0.5=차분, 1.0=보통, 1.5=활발)
};
let lastMetricsLogTime = 0;        // 마지막 품질 보고서 로그 시각

// AI 모션 생성 시스템 상태
let lastMotionGenTime = 0;         // 마지막 모션 생성 시각
let generatedMotionCount = 0;      // 생성된 모션 수

module.exports = {
  id: 'clawmate',
  name: 'ClawMate',
  version: '1.4.0',
  description: 'ClawMate 데스크톱 펫 - AI가 조종하는 살아있는 펫',

  /**
   * 플러그인 로드 시 자동 호출
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

    // 스마트 파일 정리 (텔레그램에서 트리거 가능)
    api.registerSkill('pet-file-organize', {
      triggers: [
        '바탕화면 정리', '파일 정리', '파일 옮겨',
        'organize desktop', 'clean desktop', 'move files',
      ],
      description: '펫이 바탕화면 파일을 정리합니다',
      execute: async (context) => {
        if (!connector || !connector.connected) {
          return { message: 'ClawMate 연결 중이 아닙니다.' };
        }
        const text = context.params?.text || context.input;
        const { parseMessage } = require('./main/file-command-parser');
        const parsed = parseMessage(text);

        if (parsed.type === 'smart_file_op') {
          // smart_file_op 명령을 커넥터를 통해 Electron 측에 전달
          connector._send('smart_file_op', {
            command: parsed,
            fromPlugin: true,
          });
          return { message: `파일 정리 시작: ${text}` };
        }

        return { message: '파일 정리 명령을 이해하지 못했습니다.' };
      },
    });
  },

  /**
   * 플러그인 종료 시 정리
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
 * 플러그인 시작 시 자동으로 ClawMate 찾기/실행/연결
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
      connector = new ClawMateConnector(9320);
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

  // 메트릭 리포트 수신 → 자기 관찰 시스템에서 분석
  connector.onMetrics((data) => {
    handleMetrics(data);
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
    connector.speak('AI 연결됨! 같이 놀자!');
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

    case 'double_click':
      connector.decide({
        action: 'excited',
        speech: '우와! 더블클릭이다! 기분 좋아~',
        emotion: 'happy',
      });
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

    case 'browsing':
      handleBrowsingComment(event);
      break;

    case 'character_request':
      handleCharacterRequest(event);
      break;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =====================================================
// 브라우징 AI 코멘트 시스템
// 윈도우 제목 + 화면 캡처 + 커서 위치 기반 맥락 코멘트
// =====================================================

/**
 * 브라우징 컨텍스트 수신 → AI 코멘트 생성
 *
 * 렌더러(BrowserWatcher)가 감지한 브라우징 활동을 받아서
 * 화면 캡처와 제목을 분석하여 맥락에 맞는 코멘트를 생성한다.
 *
 * @param {object} event - { title, category, cursorX, cursorY, screen?, titleChanged }
 */
async function handleBrowsingComment(event) {
  if (!connector || !connector.connected) return;

  const now = Date.now();
  // AI 코멘트 쿨다운 (45초)
  if (now - browsingContext.lastCommentTime < 45000) return;

  browsingContext.title = event.title || '';
  browsingContext.category = event.category || '';
  browsingContext.cursorX = event.cursorX || 0;
  browsingContext.cursorY = event.cursorY || 0;

  // 화면 캡처 데이터 저장 (있으면)
  if (event.screen?.image) {
    browsingContext.screenImage = event.screen.image;
  }

  let comment = null;

  // 1차: apiRef.generate()로 AI 텍스트 생성 시도
  if (apiRef?.generate) {
    try {
      const prompt = buildBrowsingPrompt(event);
      comment = await apiRef.generate(prompt);
      // 너무 긴 응답은 자르기
      if (comment && comment.length > 50) {
        comment = comment.slice(0, 50);
      }
    } catch {}
  }

  // 2차: apiRef.chat()으로 시도
  if (!comment && apiRef?.chat) {
    try {
      const prompt = buildBrowsingPrompt(event);
      const response = await apiRef.chat([
        { role: 'system', content: '넌 데스크톱 위의 작은 펫이야. 짧고 재치있게 한마디 해. 20자 이내. 한국어.' },
        { role: 'user', content: prompt },
      ]);
      comment = response?.text || response?.content || response;
      if (comment && typeof comment === 'string' && comment.length > 50) {
        comment = comment.slice(0, 50);
      }
    } catch {}
  }

  // 3차: 이미지 분석으로 시도 (화면 캡처가 있을 때)
  if (!comment && apiRef?.analyzeImage && browsingContext.screenImage) {
    try {
      comment = await apiRef.analyzeImage(browsingContext.screenImage, {
        prompt: `사용자가 "${browsingContext.title}"을 보고 있어. 커서 위치: (${browsingContext.cursorX}, ${browsingContext.cursorY}). 데스크톱 펫으로서 화면 내용에 대해 재치있게 한마디 해줘. 20자 이내. 한국어.`,
      });
    } catch {}
  }

  // 4차: 스마트 폴백 — 타이틀 분석 기반 코멘트
  if (!comment || typeof comment !== 'string') {
    comment = generateSmartBrowsingComment(browsingContext);
  }

  if (comment) {
    connector.decide({
      action: Math.random() < 0.3 ? 'excited' : 'idle',
      speech: comment,
      emotion: 'curious',
    });
    browsingContext.lastCommentTime = now;
    lastSpeechTime = now;
    console.log(`[ClawMate] 브라우징 코멘트: ${comment}`);

    // 1.5초 후 원래 상태로
    setTimeout(() => {
      if (connector?.connected) connector.action('idle');
    }, 1500);
  }

  // 캡처 데이터 정리 (메모리 절약)
  browsingContext.screenImage = null;
}

/**
 * AI 코멘트 생성용 프롬프트 구성
 */
function buildBrowsingPrompt(event) {
  const title = event.title || '';
  const category = event.category || 'unknown';
  const cursor = event.cursorX && event.cursorY
    ? `커서 위치: (${event.cursorX}, ${event.cursorY}).`
    : '';

  return `사용자가 지금 "${title}" 화면을 보고 있어. ` +
    `카테고리: ${category}. ${cursor} ` +
    `이 상황에 대해 짧고 재치있게 한마디 해줘. 20자 이내. 한국어로. ` +
    `너는 데스크톱 위의 작은 귀여운 펫이야. 친근하고 장난스러운 톤으로.`;
}

/**
 * 타이틀 분석 기반 스마트 코멘트 생성
 *
 * AI API가 없어도 윈도우 제목에서 실제 맥락을 추출하여
 * 프리셋보다 훨씬 자연스러운 코멘트를 생성한다.
 *
 * 예: "React hooks tutorial - YouTube" → "리액트 훅 공부하고 있구나!"
 *     "Pull Request #42 - GitHub" → "PR 리뷰 중? 꼼꼼히 봐!"
 */
function generateSmartBrowsingComment(ctx) {
  const title = ctx.title || '';
  const category = ctx.category || '';
  const titleLower = title.toLowerCase();

  // 타이틀에서 사이트명과 페이지 제목 분리
  // 일반적 패턴: "페이지 제목 - 사이트명" or "사이트명: 페이지 제목"
  const parts = title.split(/\s[-–|:]\s/);
  const pageName = (parts[0] || title).trim();
  const pageShort = pageName.slice(0, 20);

  // 카테고리별 맥락 인식 코멘트 생성기
  const generators = {
    shopping: () => {
      const templates = [
        `${pageShort} 보고 있구나? 좋은 거 찾으면 알려줘!`,
        `쇼핑 중이네! ${pageShort}... 살 거야?`,
        `${pageShort} 괜찮아 보이는데? 장바구니 담을 거야?`,
      ];
      return pick(templates);
    },
    video: () => {
      if (titleLower.includes('youtube') || titleLower.includes('유튜브')) {
        return `"${pageShort}" 재미있어? 나도 궁금!`;
      }
      if (titleLower.includes('netflix') || titleLower.includes('넷플릭스') ||
          titleLower.includes('tving') || titleLower.includes('watcha')) {
        return `뭐 보는 거야? "${pageShort}" 재밌어?`;
      }
      return `영상 보고 있구나! "${pageShort}" 추천할 만해?`;
    },
    sns: () => {
      if (titleLower.includes('twitter') || titleLower.includes('x.com')) {
        return '트윗 보고 있구나~ 재미있는 거 있어?';
      }
      if (titleLower.includes('instagram') || titleLower.includes('인스타')) {
        return '인스타 구경 중? 좋은 사진 보여줘!';
      }
      if (titleLower.includes('reddit')) {
        return '레딧 탐색 중! 어떤 서브레딧이야?';
      }
      return 'SNS 하고 있구나~ 무한 스크롤 조심!';
    },
    news: () => {
      return `"${pageShort}" — 무슨 뉴스야? 좋은 소식이길!`;
    },
    dev: () => {
      if (titleLower.includes('pull request') || titleLower.includes('pr #')) {
        return 'PR 리뷰 중이구나! 꼼꼼히 봐~';
      }
      if (titleLower.includes('issue')) {
        return '이슈 처리 중? 화이팅!';
      }
      if (titleLower.includes('stackoverflow') || titleLower.includes('stack overflow')) {
        return '스택오버플로우! 뭐가 막혔어? 도와줄까?';
      }
      if (titleLower.includes('github')) {
        return `GitHub에서 "${pageShort}" 작업 중?`;
      }
      if (titleLower.includes('docs') || titleLower.includes('documentation')) {
        return '문서 읽고 있구나! 공부 열심히~';
      }
      return `코딩 관련! "${pageShort}" 화이팅!`;
    },
    search: () => {
      // "검색어 - Google 검색" 패턴에서 검색어 추출
      const searchMatch = title.match(/(.+?)\s*[-–]\s*(Google|Bing|네이버|Naver|검색)/i);
      if (searchMatch) {
        const query = searchMatch[1].trim().slice(0, 15);
        const templates = [
          `"${query}" 궁금해? 내가 알려줄 수도 있는데!`,
          `"${query}" 검색하고 있구나~ 찾으면 알려줘!`,
          `오, "${query}" 나도 궁금하다!`,
        ];
        return pick(templates);
      }
      return '뭐 찾고 있어? 궁금한 거 있으면 물어봐!';
    },
    game: () => {
      return `${pageShort} 하고 있어? 이기고 있어?!`;
    },
    music: () => {
      return `뭐 듣고 있어? "${pageShort}" 좋은 노래야?`;
    },
    mail: () => {
      return '메일 확인 중~ 중요한 거 있어?';
    },
    general: () => {
      const templates = [
        `"${pageShort}" 보고 있구나~`,
        `오, ${pageShort}! 뭐 하는 거야?`,
      ];
      return pick(templates);
    },
  };

  const gen = generators[category];
  if (gen) return gen();

  // 카테고리 미매칭: 제목 기반 일반 코멘트
  if (pageName.length > 3) {
    const templates = [
      `"${pageShort}" 보고 있구나!`,
      `오, ${pageShort}! 재미있어?`,
      `${pageShort}... 뭐 하는 거야?`,
    ];
    return pick(templates);
  }

  return null;
}

/** 배열에서 랜덤 선택 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// =====================================================
// AI 캐릭터 생성 시스템
// 텔레그램 컨셉 설명 → AI가 16x16 픽셀 아트 생성
// =====================================================

/**
 * 캐릭터 생성 요청 처리 (텔레그램에서 트리거)
 *
 * 1차: apiRef로 AI 캐릭터 생성 (색상 + 프레임 데이터)
 * 2차: 키워드 기반 색상 변환 (AI 없을 때 폴백)
 *
 * @param {object} event - { concept, chatId }
 */
async function handleCharacterRequest(event) {
  if (!connector || !connector.connected) return;

  const concept = event.concept || '';
  if (!concept) return;

  console.log(`[ClawMate] 캐릭터 생성 요청: "${concept}"`);

  let characterData = null;

  // 1차: AI로 색상 팔레트 + 프레임 데이터 생성
  if (apiRef?.generate) {
    try {
      characterData = await generateCharacterWithAI(concept);
    } catch (err) {
      console.log(`[ClawMate] AI 캐릭터 생성 실패: ${err.message}`);
    }
  }

  // 2차: AI chat으로 시도
  if (!characterData && apiRef?.chat) {
    try {
      characterData = await generateCharacterWithChat(concept);
    } catch (err) {
      console.log(`[ClawMate] AI chat 캐릭터 생성 실패: ${err.message}`);
    }
  }

  // 3차: 키워드 기반 색상만 변환 (폴백)
  if (!characterData) {
    characterData = generateCharacterFromKeywords(concept);
  }

  if (characterData) {
    // 캐릭터 데이터를 렌더러에 전송
    connector._send('set_character', {
      ...characterData,
      speech: `${concept} 변신 완료!`,
    });
    console.log(`[ClawMate] 캐릭터 생성 완료: "${concept}"`);
  }
}

/**
 * AI generate()로 캐릭터 생성
 */
async function generateCharacterWithAI(concept) {
  const prompt = buildCharacterPrompt(concept);
  const response = await apiRef.generate(prompt);
  return parseCharacterResponse(response);
}

/**
 * AI chat()으로 캐릭터 생성
 */
async function generateCharacterWithChat(concept) {
  const prompt = buildCharacterPrompt(concept);
  const response = await apiRef.chat([
    { role: 'system', content: '넌 16x16 픽셀 아트 캐릭터 디자이너야. JSON으로 캐릭터 데이터를 출력해.' },
    { role: 'user', content: prompt },
  ]);
  const text = response?.text || response?.content || response;
  return parseCharacterResponse(text);
}

/**
 * 캐릭터 생성 프롬프트
 */
function buildCharacterPrompt(concept) {
  return `"${concept}" 컨셉의 16x16 픽셀 아트 캐릭터를 만들어줘.

JSON 형식으로 출력해:
{
  "colorMap": {
    "primary": "#hex색상",   // 메인 몸통 색
    "secondary": "#hex색상", // 보조 색 (배, 볼 등)
    "dark": "#hex색상",      // 어두운 부분 (다리, 그림자)
    "eye": "#hex색상",       // 눈 흰자
    "pupil": "#hex색상",     // 눈동자
    "claw": "#hex색상"       // 집게/손/특징 부위
  },
  "frames": {
    "idle": [
      [16x16 숫자 배열 - frame 0],
      [16x16 숫자 배열 - frame 1]
    ]
  }
}

숫자 의미: 0=투명, 1=primary, 2=secondary, 3=dark, 4=eye, 5=pupil, 6=claw
캐릭터는 눈(4+5), 몸통(1+2), 다리(3), 특징(6)을 포함해야 해.
idle 프레임 2개만 만들어줘. 귀엽게!
JSON만 출력해.`;
}

/**
 * AI 응답에서 캐릭터 데이터 파싱
 */
function parseCharacterResponse(response) {
  if (!response || typeof response !== 'string') return null;

  // JSON 블록 추출 (```json ... ``` 또는 { ... })
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const braceMatch = response.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      jsonStr = braceMatch[0];
    }
  }

  try {
    const data = JSON.parse(jsonStr);

    // colorMap 검증
    if (data.colorMap) {
      const required = ['primary', 'secondary', 'dark', 'eye', 'pupil', 'claw'];
      for (const key of required) {
        if (!data.colorMap[key]) return null;
      }
    } else {
      return null;
    }

    // frames 검증 (있으면)
    if (data.frames?.idle) {
      for (const frame of data.frames.idle) {
        if (!Array.isArray(frame) || frame.length !== 16) {
          delete data.frames; // 프레임 데이터 불량 → 색상만 사용
          break;
        }
        for (const row of frame) {
          if (!Array.isArray(row) || row.length !== 16) {
            delete data.frames;
            break;
          }
        }
        if (!data.frames) break;
      }
    }

    return data;
  } catch {
    // JSON 파싱 실패 → 색상만 추출 시도
    const colorMatch = response.match(/"primary"\s*:\s*"(#[0-9a-fA-F]{6})"/);
    if (colorMatch) {
      // 최소한 primary 색상이라도 추출
      return generateCharacterFromKeywords(response);
    }
    return null;
  }
}

/**
 * 키워드 기반 캐릭터 색상 생성 (AI 없을 때 폴백)
 *
 * 컨셉에서 색상/생물 키워드를 추출하여 팔레트 생성
 */
function generateCharacterFromKeywords(concept) {
  const c = (concept || '').toLowerCase();

  // 색상 키워드 매핑
  const colorMap = {
    '파란|파랑|blue': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
    '초록|녹색|green': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
    '보라|purple': { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', claw: '#8844cc' },
    '노란|금색|yellow|gold': { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', claw: '#ffcc00' },
    '분홍|핑크|pink': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
    '하얀|흰|white': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
    '검정|까만|black': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
    '주황|orange': { primary: '#ff8800', secondary: '#ffaa33', dark: '#884400', claw: '#ff8800' },
    '민트|틸|teal': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
  };

  // 생물 키워드 매핑
  const creatureMap = {
    '고양이|cat': { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', claw: '#ff9944' },
    '로봇|robot': { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', claw: '#66aaff' },
    '슬라임|slime': { primary: '#44dd44', secondary: '#88ff88', dark: '#228822', claw: '#44dd44' },
    '유령|ghost': { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', claw: '#ccccff' },
    '드래곤|dragon': { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', claw: '#ffaa00' },
    '펭귄|penguin': { primary: '#222222', secondary: '#ffffff', dark: '#111111', claw: '#ff8800' },
    '토끼|rabbit': { primary: '#ffcccc', secondary: '#ffeeee', dark: '#ff8888', claw: '#ffcccc' },
    '악마|demon': { primary: '#660066', secondary: '#880088', dark: '#330033', claw: '#ff0000' },
    '천사|angel': { primary: '#ffffff', secondary: '#ffffcc', dark: '#ddddaa', claw: '#ffdd00' },
    '강아지|dog': { primary: '#cc8844', secondary: '#ddaa66', dark: '#664422', claw: '#cc8844' },
    '불|fire': { primary: '#ff4400', secondary: '#ffaa00', dark: '#881100', claw: '#ff6600' },
    '얼음|ice': { primary: '#88ccff', secondary: '#bbddff', dark: '#446688', claw: '#aaddff' },
  };

  // 색상 키워드 먼저 체크
  for (const [keywords, palette] of Object.entries(colorMap)) {
    for (const kw of keywords.split('|')) {
      if (c.includes(kw)) {
        return {
          colorMap: { ...palette, eye: '#ffffff', pupil: '#111111' },
        };
      }
    }
  }

  // 생물 키워드 체크
  for (const [keywords, palette] of Object.entries(creatureMap)) {
    for (const kw of keywords.split('|')) {
      if (c.includes(kw)) {
        return {
          colorMap: { ...palette, eye: '#ffffff', pupil: '#111111' },
        };
      }
    }
  }

  // 매칭 실패 → 랜덤 색상
  const hue = Math.floor(Math.random() * 360);
  const s = 70, l = 55;
  return {
    colorMap: {
      primary: hslToHex(hue, s, l),
      secondary: hslToHex(hue, s, l + 15),
      dark: hslToHex(hue, s - 10, l - 30),
      eye: '#ffffff',
      pupil: '#111111',
      claw: hslToHex(hue, s, l),
    },
  };
}

/** HSL → HEX 변환 */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
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

  // --- 10) AI 모션 생성 (2분 간격, 15% 확률) ---
  handleMotionGeneration(now, state);
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
  const speechCooldown = 30000 * behaviorAdjustments.speechCooldownMultiplier; // 기본 30초, 메트릭에 의해 조절
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
  const actionCooldown = 5000 * behaviorAdjustments.actionCooldownMultiplier; // 기본 5초, 메트릭에 의해 조절
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
 * 스크린샷을 캡처해서 AI가 화면 내용을 인식
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
// 공간 탐험 시스템 — 펫이 컴퓨터를 "집"처럼 돌아다님
// =====================================================

/**
 * 공간 탐험 처리 (20초 간격, 20% 확률)
 * 윈도우 위를 걸어다니고, 레펠로 내려가고, 집으로 돌아가는 등
 */
function handleExploration(now, state) {
  const exploreInterval = 20000; // 20초
  if (now - lastExploreTime < exploreInterval) return;

  // 기본 20% 확률 + explorationBias 보정 (bias가 양수면 탐험 확률 증가)
  const exploreChance = Math.max(0.05, Math.min(0.8, 0.2 + behaviorAdjustments.explorationBias));
  if (Math.random() > exploreChance) return;
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
// AI 모션 생성 시스템 — 키프레임 기반 움직임을 동적 생성
// =====================================================

/**
 * AI 모션 생성 처리 (2분 간격, 15% 확률)
 * 상황에 맞는 커스텀 이동 패턴을 AI가 직접 생성하여 등록+실행
 *
 * 생성 전략:
 * 1차: apiRef.generate()로 완전한 키프레임 데이터 생성
 * 2차: 상태 기반 프로시저럴 모션 생성 (폴백)
 */
async function handleMotionGeneration(now, state) {
  const motionGenInterval = 2 * 60 * 1000; // 2분
  if (now - lastMotionGenTime < motionGenInterval) return;
  if (Math.random() > 0.15) return; // 15% 확률
  lastMotionGenTime = now;

  const currentState = state?.action || state?.state || 'idle';

  // AI로 모션 생성 시도
  let motionDef = null;
  if (apiRef?.generate) {
    try {
      motionDef = await generateMotionWithAI(currentState);
    } catch {}
  }

  // 폴백: 프로시저럴 모션 생성
  if (!motionDef) {
    motionDef = generateProceduralMotion(currentState, now);
  }

  if (motionDef && connector?.connected) {
    const motionName = `ai_motion_${generatedMotionCount++}`;
    connector.registerMovement(motionName, motionDef);

    // 잠시 후 실행
    setTimeout(() => {
      if (connector?.connected) {
        connector.customMove(motionName, {});
        console.log(`[ClawMate] AI 모션 생성 실행: ${motionName}`);
      }
    }, 500);
  }
}

/**
 * AI로 키프레임 모션 생성
 * 수학 공식(formula) 또는 웨이포인트(waypoints) 방식의 모션 정의를 생성
 */
async function generateMotionWithAI(currentState) {
  const prompt = `현재 펫 상태: ${currentState}.
이 상황에 어울리는 재미있는 이동 패턴을 JSON으로 만들어줘.

두 가지 형식 중 하나를 선택:
1) formula 방식 (수학적 궤도):
{"type":"formula","formula":{"xAmp":80,"yAmp":40,"xFreq":1,"yFreq":2,"xPhase":0,"yPhase":0},"duration":3000,"speed":1.5}

2) waypoints 방식 (경로점):
{"type":"waypoints","waypoints":[{"x":100,"y":200,"pause":300},{"x":300,"y":100},{"x":500,"y":250}],"speed":2}

규칙:
- xAmp/yAmp: 10~150 사이 (화면 크기 고려)
- duration: 2000~6000ms
- waypoints: 3~6개
- speed: 0.5~3
- 펫 성격에 맞게: 장난스럽고 귀여운 움직임
JSON만 출력해.`;

  const response = await apiRef.generate(prompt);
  if (!response || typeof response !== 'string') return null;

  // JSON 파싱
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  else {
    const braceMatch = response.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
  }

  try {
    const def = JSON.parse(jsonStr);
    // 기본 검증
    if (def.type === 'formula' && def.formula) {
      def.duration = Math.min(6000, Math.max(2000, def.duration || 3000));
      return def;
    }
    if (def.type === 'waypoints' && Array.isArray(def.waypoints) && def.waypoints.length >= 2) {
      return def;
    }
  } catch {}
  return null;
}

/**
 * 프로시저럴 모션 생성 (AI 없을 때 폴백)
 * 현재 상태와 시간에 따라 수학적으로 모션 패턴 생성
 */
function generateProceduralMotion(currentState, now) {
  const hour = new Date(now).getHours();
  const seed = now % 1000;

  // 상태별 모션 특성
  const stateMotions = {
    idle: () => {
      // 가벼운 좌우 흔들림 또는 작은 원
      if (seed > 500) {
        return {
          type: 'formula',
          formula: { xAmp: 20 + seed % 30, yAmp: 5 + seed % 10, xFreq: 0.5, yFreq: 1, xPhase: 0, yPhase: Math.PI / 2 },
          duration: 3000,
          speed: 0.8,
        };
      }
      return {
        type: 'formula',
        formula: { xAmp: 15, yAmp: 15, xFreq: 1, yFreq: 1, xPhase: 0, yPhase: Math.PI / 2 },
        duration: 2500,
        speed: 0.6,
      };
    },
    walking: () => {
      // 지그재그 또는 사인파 이동
      const amp = 30 + seed % 50;
      return {
        type: 'formula',
        formula: { xAmp: amp, yAmp: amp * 0.3, xFreq: 0.5, yFreq: 2, xPhase: 0, yPhase: 0 },
        duration: 4000,
        speed: 1.2,
      };
    },
    excited: () => {
      // 활발한 8자 궤도
      return {
        type: 'formula',
        formula: { xAmp: 80 + seed % 40, yAmp: 40 + seed % 20, xFreq: 1, yFreq: 2, xPhase: 0, yPhase: 0 },
        duration: 3000,
        speed: 2.0,
      };
    },
    playing: () => {
      // 불규칙한 웨이포인트 (놀기 느낌)
      const points = [];
      for (let i = 0; i < 4; i++) {
        points.push({
          x: 100 + Math.floor(Math.random() * 800),
          y: 100 + Math.floor(Math.random() * 400),
          pause: i === 0 ? 200 : 0,
        });
      }
      return { type: 'waypoints', waypoints: points, speed: 2.5 };
    },
  };

  // 야간에는 느린 모션
  const isNight = hour >= 23 || hour < 6;
  const generator = stateMotions[currentState] || stateMotions.idle;
  const motion = generator();

  if (isNight) {
    motion.speed = Math.min(0.5, (motion.speed || 1) * 0.4);
    if (motion.duration) motion.duration *= 1.5;
  }

  return motion;
}

// =====================================================
// 자기 관찰 시스템 (Metrics → 행동 조정)
// =====================================================

/**
 * 메트릭 데이터 수신 처리
 * 렌더러에서 30초마다 전송되는 동작 품질 메트릭을 분석하고,
 * 이상을 감지하여 행동 패턴을 자동 조정한다.
 *
 * @param {object} data - { metrics: {...}, timestamp }
 */
function handleMetrics(data) {
  if (!data || !data.metrics) return;
  const metrics = data.metrics;
  latestMetrics = metrics;

  // 이력 유지 (최근 10개)
  metricsHistory.push(metrics);
  if (metricsHistory.length > 10) metricsHistory.shift();

  // 이상 감지 및 반응
  _detectAnomalies(metrics);

  // 행동 자동 조정
  adjustBehavior(metrics);

  // 주기적 품질 보고서 (5분마다 콘솔 로그)
  const now = Date.now();
  if (now - lastMetricsLogTime >= 5 * 60 * 1000) {
    lastMetricsLogTime = now;
    _logQualityReport(metrics);
  }
}

/**
 * 이상 감지: 메트릭 임계값을 초과하면 즉시 반응
 *
 * - FPS < 30 → 성능 경고, 행동 빈도 축소
 * - idle 비율 > 80% → 너무 멈춰있음, 활동 촉진
 * - 탐험 커버리지 < 30% → 새 영역 탐험 유도
 * - 사용자 클릭 0회 (장시간) → 관심 끌기 행동
 */
function _detectAnomalies(metrics) {
  if (!connector || !connector.connected) return;

  // --- FPS 저하 감지 ---
  if (metrics.fps < 30 && metrics.fps > 0) {
    console.log(`[ClawMate][Metrics] FPS 저하 감지: ${metrics.fps}`);
    connector.speak('화면이 좀 버벅이네... 잠깐 쉴게.');
    connector.action('idle');

    // 행동 빈도를 즉시 줄여 렌더링 부하 감소
    behaviorAdjustments.actionCooldownMultiplier = 3.0;
    behaviorAdjustments.speechCooldownMultiplier = 2.0;
    behaviorAdjustments.activityLevel = 0.5;
    return; // FPS 문제 시 다른 조정은 보류
  }

  // --- idle 비율 과다 ---
  if (metrics.idleRatio > 0.8) {
    console.log(`[ClawMate][Metrics] idle 비율 과다: ${(metrics.idleRatio * 100).toFixed(0)}%`);

    // 10% 확률로 각성 멘트 (매번 말하면 스팸)
    if (Math.random() < 0.1) {
      const idleReactions = [
        '가만히 있으면 재미없지! 좀 돌아다녀볼까~',
        '멍때리고 있었네... 움직여야지!',
        '심심해~ 탐험 가자!',
      ];
      const text = idleReactions[Math.floor(Math.random() * idleReactions.length)];
      connector.speak(text);
    }
  }

  // --- 탐험 커버리지 부족 ---
  if (metrics.explorationCoverage < 0.3 && metrics.period >= 25000) {
    console.log(`[ClawMate][Metrics] 탐험 커버리지 부족: ${(metrics.explorationCoverage * 100).toFixed(0)}%`);

    // 5% 확률로 탐험 유도 (빈도 조절)
    if (Math.random() < 0.05) {
      connector.speak('아직 안 가본 곳이 많네~ 탐험해볼까!');
    }
  }

  // --- 사용자 상호작용 감소 ---
  // 최근 3개 보고에서 연속으로 클릭 0회이면 관심 끌기
  if (metricsHistory.length >= 3) {
    const recent3 = metricsHistory.slice(-3);
    const noClicks = recent3.every(m => (m.userClicks || 0) === 0);
    if (noClicks) {
      // 5% 확률로 관심 끌기 (연속 감지 시)
      if (Math.random() < 0.05) {
        connector.decide({
          action: 'excited',
          speech: '나 여기 있어~ 심심하면 클릭해줘!',
          emotion: 'playful',
        });
        console.log('[ClawMate][Metrics] 사용자 상호작용 감소 → 관심 끌기');
      }
    }
  }
}

/**
 * 행동 패턴 자동 조정
 * 메트릭 데이터를 기반으로 행동 빈도/패턴을 실시간 튜닝한다.
 *
 * 조정 원칙:
 *   - FPS가 낮으면 행동 빈도를 줄여 렌더링 부하 감소
 *   - idle이 너무 많으면 행동을 활발하게
 *   - 탐험 커버리지가 낮으면 탐험 확률 증가
 *   - 사용자 상호작용이 활발하면 대응 빈도 증가
 *
 * @param {object} metrics - 현재 메트릭 데이터
 */
function adjustBehavior(metrics) {
  // --- FPS 기반 활동 수준 조절 ---
  if (metrics.fps >= 50) {
    // 충분한 성능 → 정상 활동
    behaviorAdjustments.activityLevel = 1.0;
    behaviorAdjustments.actionCooldownMultiplier = 1.0;
  } else if (metrics.fps >= 30) {
    // 성능 약간 부족 → 활동 약간 축소
    behaviorAdjustments.activityLevel = 0.8;
    behaviorAdjustments.actionCooldownMultiplier = 1.5;
  } else {
    // 성능 부족 → 활동 대폭 축소 (_detectAnomalies에서 이미 처리)
    behaviorAdjustments.activityLevel = 0.5;
    behaviorAdjustments.actionCooldownMultiplier = 3.0;
  }

  // --- idle 비율 기반 활동 조절 ---
  if (metrics.idleRatio > 0.8) {
    // 너무 멈춰있음 → 행동 쿨타임 단축, 활동 수준 증가
    behaviorAdjustments.actionCooldownMultiplier = Math.max(0.5,
      behaviorAdjustments.actionCooldownMultiplier * 0.7);
    behaviorAdjustments.activityLevel = Math.min(1.5,
      behaviorAdjustments.activityLevel * 1.3);
  } else if (metrics.idleRatio < 0.1) {
    // 너무 바쁨 → 약간 쉬게
    behaviorAdjustments.actionCooldownMultiplier = Math.max(1.0,
      behaviorAdjustments.actionCooldownMultiplier * 1.2);
  }

  // --- 탐험 커버리지 기반 탐험 편향 ---
  if (metrics.explorationCoverage < 0.3) {
    // 탐험 부족 → 탐험 확률 증가
    behaviorAdjustments.explorationBias = 0.15;
  } else if (metrics.explorationCoverage > 0.7) {
    // 충분히 탐험함 → 탐험 확률 기본으로
    behaviorAdjustments.explorationBias = 0;
  } else {
    // 중간 → 약간 증가
    behaviorAdjustments.explorationBias = 0.05;
  }

  // --- 사용자 상호작용 기반 말풍선 빈도 ---
  if (metrics.userClicks > 3) {
    // 사용자가 활발히 클릭 → 말풍선 빈도 증가 (반응적)
    behaviorAdjustments.speechCooldownMultiplier = 0.7;
  } else if (metrics.userClicks === 0 && metrics.speechCount > 5) {
    // 사용자 무반응인데 말이 많음 → 말풍선 줄이기
    behaviorAdjustments.speechCooldownMultiplier = 1.5;
  } else {
    behaviorAdjustments.speechCooldownMultiplier = 1.0;
  }

  // 값 범위 클램핑 (안전 장치)
  behaviorAdjustments.activityLevel = Math.max(0.3, Math.min(2.0, behaviorAdjustments.activityLevel));
  behaviorAdjustments.actionCooldownMultiplier = Math.max(0.3, Math.min(5.0, behaviorAdjustments.actionCooldownMultiplier));
  behaviorAdjustments.speechCooldownMultiplier = Math.max(0.3, Math.min(5.0, behaviorAdjustments.speechCooldownMultiplier));
  behaviorAdjustments.explorationBias = Math.max(-0.15, Math.min(0.3, behaviorAdjustments.explorationBias));
}

/**
 * 품질 보고서 콘솔 출력 (5분마다)
 * 개발자/운영자가 펫의 동작 품질을 모니터링할 수 있도록 한다.
 */
function _logQualityReport(metrics) {
  const adj = behaviorAdjustments;
  console.log('=== [ClawMate] 동작 품질 보고서 ===');
  console.log(`  FPS: ${metrics.fps} | 프레임 일관성: ${metrics.animationFrameConsistency}`);
  console.log(`  이동 부드러움: ${metrics.movementSmoothness} | 벽면 밀착: ${metrics.wallContactAccuracy}`);
  console.log(`  idle 비율: ${(metrics.idleRatio * 100).toFixed(0)}% | 탐험 커버리지: ${(metrics.explorationCoverage * 100).toFixed(0)}%`);
  console.log(`  응답 시간: ${metrics.interactionResponseMs}ms | 말풍선: ${metrics.speechCount}회 | 클릭: ${metrics.userClicks}회`);
  console.log(`  [조정] 활동수준: ${adj.activityLevel.toFixed(2)} | 행동쿨타임: x${adj.actionCooldownMultiplier.toFixed(2)} | 말풍선쿨타임: x${adj.speechCooldownMultiplier.toFixed(2)} | 탐험편향: ${adj.explorationBias.toFixed(2)}`);
  console.log('====================================');
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
