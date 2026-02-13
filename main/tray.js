const { Tray, Menu, nativeImage, app, shell } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const Store = require('./store');
const { undoAllMoves, getFileManifest } = require('./file-ops');
const { isAutoStartEnabled, toggleAutoStart } = require('./autostart');

let tray = null;
let aiBridge = null;

/**
 * 16x16 Claw 픽셀아트 아이콘 생성
 * 캐릭터 idle 프레임을 축소한 형태
 *
 * 색상 코드:
 *   0 = 투명
 *   1 = #ff4f40 (빨강)
 *   2 = #ff775f (연빨강)
 *   3 = #3a0a0d (갈색 다리)
 *   4 = #ffffff (눈 흰자)
 *   5 = #000000 (눈동자)
 *   6 = #ff4f40 (집게)
 */
const CLAW_ICON = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,6,6,0,0,0,0,0,0,0,0,6,6,0,0],
  [0,6,0,0,6,0,0,0,0,0,0,6,0,0,6,0],
  [0,6,0,0,6,0,0,0,0,0,0,6,0,0,6,0],
  [0,0,6,6,0,0,0,0,0,0,0,0,6,6,0,0],
  [0,0,0,6,1,1,0,0,0,0,1,1,6,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,0,1,1,4,5,1,1,4,5,1,1,0,0,0],
  [0,0,0,1,1,4,5,1,1,4,5,1,1,0,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  [0,0,1,2,1,1,1,1,1,1,1,1,2,1,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0],
  [0,0,3,3,3,0,3,3,3,3,0,3,3,3,0,0],
  [0,3,3,3,0,0,0,3,3,0,0,0,3,3,3,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

const COLOR_MAP = {
  0: [0, 0, 0, 0],         // 투명
  1: [255, 79, 64, 255],    // primary 빨강
  2: [255, 119, 95, 255],   // secondary 연빨강
  3: [58, 10, 13, 255],     // dark 갈색
  4: [255, 255, 255, 255],  // eye 흰자
  5: [0, 0, 0, 255],        // pupil 눈동자
  6: [255, 79, 64, 255],    // claw 집게
};

/**
 * CLAW_ICON 16x16 배열 → nativeImage 변환
 */
function createClawIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const code = CLAW_ICON[y][x];
      const color = COLOR_MAP[code] || COLOR_MAP[0];
      const offset = (y * size + x) * 4;
      buffer[offset + 0] = color[0]; // R
      buffer[offset + 1] = color[1]; // G
      buffer[offset + 2] = color[2]; // B
      buffer[offset + 3] = color[3]; // A
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function setupTray(mainWindow, bridge) {
  aiBridge = bridge;
  const store = new Store('clawmate-config', { mode: 'pet' });

  // Claw 픽셀아트 트레이 아이콘 생성
  const icon = createClawIcon();

  tray = new Tray(icon);
  tray.setToolTip('ClawMate - 데스크톱 펫');

  function buildMenu() {
    const mode = store.get('mode') || 'pet';
    const fileInteraction = store.get('fileInteraction') !== false;
    const aiConnected = aiBridge ? aiBridge.isConnected() : false;
    const autoStart = isAutoStartEnabled();

    return Menu.buildFromTemplate([
      {
        label: `ClawMate (${mode === 'pet' ? 'Clawby' : 'OpenClaw'})`,
        enabled: false,
      },
      {
        label: aiConnected ? 'AI: 연결됨' : 'AI: 자율 모드 (대기 중)',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Pet 모드 (Clawby)',
        type: 'radio',
        checked: mode === 'pet',
        click: () => {
          store.set('mode', 'pet');
          if (mainWindow) mainWindow.webContents.send('mode-changed', 'pet');
          buildAndSet();
        },
      },
      {
        label: 'Incarnation 모드 (OpenClaw)',
        type: 'radio',
        checked: mode === 'incarnation',
        click: () => {
          store.set('mode', 'incarnation');
          if (mainWindow) mainWindow.webContents.send('mode-changed', 'incarnation');
          buildAndSet();
        },
      },
      { type: 'separator' },
      {
        label: '파일 상호작용',
        type: 'checkbox',
        checked: fileInteraction,
        click: (item) => {
          store.set('fileInteraction', item.checked);
          if (mainWindow) mainWindow.webContents.send('config-changed', store.getAll());
        },
      },
      {
        label: '컴퓨터 시작 시 자동 실행',
        type: 'checkbox',
        checked: autoStart,
        click: () => {
          toggleAutoStart();
          buildAndSet();
        },
      },
      { type: 'separator' },
      {
        label: '업데이트 확인',
        click: async () => {
          await checkForUpdateManual(mainWindow);
        },
      },
      {
        label: '파일 이동 되돌리기',
        click: async () => {
          const manifest = await getFileManifest();
          const pending = manifest.filter(m => !m.restored);
          if (pending.length === 0) return;
          await undoAllMoves();
        },
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          app.quit();
        },
      },
    ]);
  }

  function buildAndSet() {
    tray.setContextMenu(buildMenu());
  }

  // AI 연결 상태 변경 시 메뉴 업데이트
  if (aiBridge) {
    aiBridge.on('connected', () => buildAndSet());
    aiBridge.on('disconnected', () => buildAndSet());
  }

  buildAndSet();
  return tray;
}

/**
 * 수동 업데이트 확인 (트레이 메뉴에서 클릭)
 * 빌드된 앱: electron-updater 사용
 * npm 설치: npm registry에서 최신 버전 비교
 */
async function checkForUpdateManual(mainWindow) {
  if (app.isPackaged) {
    // electron-updater 기반 업데이트
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.error('[업데이트] electron-updater 실패:', err.message);
    }
  } else {
    // npm 기반 업데이트 확인
    try {
      const latest = execSync('npm view clawmate version', {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
      const current = require('../package.json').version;

      if (latest !== current) {
        // 펫 말풍선으로 알림
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-command', {
            type: 'speak',
            payload: { text: `새 버전 v${latest} 사용 가능! (현재: v${current})` },
          });
        }
        console.log(`[업데이트] 새 버전 ${latest} 사용 가능 (현재: ${current})`);
        console.log('[업데이트] npm update -g clawmate');

        // npm 페이지 열기
        shell.openExternal('https://www.npmjs.com/package/clawmate');
      } else {
        // 이미 최신
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-command', {
            type: 'speak',
            payload: { text: `v${current} — 이미 최신 버전이야!` },
          });
        }
        console.log(`[업데이트] 현재 최신 버전 (v${current})`);
      }
    } catch (err) {
      console.error('[업데이트] npm 버전 확인 실패:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-command', {
          type: 'speak',
          payload: { text: '업데이트 확인 실패... 인터넷 연결 확인해봐!' },
        });
      }
    }
  }
}

module.exports = { setupTray };
