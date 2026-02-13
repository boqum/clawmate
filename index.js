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

module.exports = {
  id: 'clawmate',
  name: 'ClawMate',
  version: '1.0.0',
  description: 'OpenClaw 데스크톱 펫 - AI가 조종하는 살아있는 Claw',

  /**
   * OpenClaw이 플러그인을 로드할 때 자동 호출
   * → ClawMate 자동 실행 + 자동 연결
   */
  async init(api) {
    apiRef = api;
    console.log('[ClawMate] 플러그인 초기화 — 자동 연결 시작');
    autoConnect();
  },

  register(api) {
    apiRef = api;

    // 펫 실행 (이미 돌고 있으면 상태 알려줌)
    api.registerSkill('launch-pet', {
      triggers: ['펫 깔아줘', '펫 실행', 'clawmate', '데스크톱 펫', 'install pet', 'launch pet'],
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

  connector.on('disconnected', () => {
    console.log('[ClawMate] 연결 끊김 — 재연결 시도');
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
