const { Tray, Menu, nativeImage, app, shell, dialog, clipboard } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const Store = require('./store');
const { undoAllMoves, getFileManifest } = require('./file-ops');
const { isAutoStartEnabled, toggleAutoStart } = require('./autostart');

let tray = null;
let aiBridge = null;

/**
 * 16x16 Claw 픽셀아트 아이콘 생성
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
  0: [0, 0, 0, 0],
  1: [255, 79, 64, 255],
  2: [255, 119, 95, 255],
  3: [58, 10, 13, 255],
  4: [255, 255, 255, 255],
  5: [0, 0, 0, 255],
  6: [255, 79, 64, 255],
};

/**
 * 캐릭터 프리셋 목록
 * 트레이에서 선택하면 set_character 명령으로 렌더러에 전달
 */
const CHARACTER_PRESETS = {
  default: {
    name: '기본 Claw (빨강)',
    colorMap: { primary: '#ff4f40', secondary: '#ff775f', dark: '#8B4513', eye: '#ffffff', pupil: '#111111', claw: '#ff4f40' },
  },
  blue: {
    name: '파란 Claw',
    colorMap: { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', eye: '#ffffff', pupil: '#111111', claw: '#4488ff' },
  },
  green: {
    name: '초록 Claw',
    colorMap: { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', eye: '#ffffff', pupil: '#111111', claw: '#44cc44' },
  },
  purple: {
    name: '보라 Claw',
    colorMap: { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', eye: '#ffffff', pupil: '#111111', claw: '#8844cc' },
  },
  gold: {
    name: '골드 Claw',
    colorMap: { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', eye: '#ffffff', pupil: '#111111', claw: '#ffcc00' },
  },
  pink: {
    name: '핑크 Claw',
    colorMap: { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', eye: '#ffffff', pupil: '#111111', claw: '#ff69b4' },
  },
  cat: {
    name: '고양이',
    colorMap: { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', eye: '#88ff88', pupil: '#111111', claw: '#ff9944' },
  },
  robot: {
    name: '로봇',
    colorMap: { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', eye: '#66aaff', pupil: '#0044aa', claw: '#66aaff' },
  },
  ghost: {
    name: '유령',
    colorMap: { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', eye: '#ff6666', pupil: '#cc0000', claw: '#ccccff' },
  },
  dragon: {
    name: '드래곤',
    colorMap: { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', eye: '#ffaa00', pupil: '#111111', claw: '#ffaa00' },
  },
};

function createClawIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const code = CLAW_ICON[y][x];
      const color = COLOR_MAP[code] || COLOR_MAP[0];
      const offset = (y * size + x) * 4;
      buffer[offset + 0] = color[0];
      buffer[offset + 1] = color[1];
      buffer[offset + 2] = color[2];
      buffer[offset + 3] = color[3];
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function setupTray(mainWindow, bridge) {
  aiBridge = bridge;
  const store = new Store('clawmate-config', {
    mode: 'pet',
    character: 'default',
    telegramToken: '',
  });

  const icon = createClawIcon();
  tray = new Tray(icon);
  tray.setToolTip('ClawMate - 데스크톱 펫');

  function buildMenu() {
    const mode = store.get('mode') || 'pet';
    const fileInteraction = store.get('fileInteraction') !== false;
    const aiConnected = aiBridge ? aiBridge.isConnected() : false;
    const autoStart = isAutoStartEnabled();
    const currentChar = store.get('character') || 'default';
    const hasTelegramToken = !!(store.get('telegramToken'));

    // 캐릭터 서브메뉴
    const characterSubmenu = Object.entries(CHARACTER_PRESETS).map(([key, preset]) => ({
      label: preset.name,
      type: 'radio',
      checked: currentChar === key,
      click: () => {
        store.set('character', key);
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (key === 'default') {
            mainWindow.webContents.send('ai-command', {
              type: 'reset_character', payload: {},
            });
          } else {
            mainWindow.webContents.send('ai-command', {
              type: 'set_character', payload: {
                colorMap: preset.colorMap,
                speech: `${preset.name}(으)로 변신!`,
              },
            });
          }
        }
        buildAndSet();
      },
    }));

    return Menu.buildFromTemplate([
      {
        label: `ClawMate (${mode === 'pet' ? 'Clawby' : mode === 'incarnation' ? 'Claw' : 'Clawby + Claw'})`,
        enabled: false,
      },
      {
        label: aiConnected ? 'AI: 연결됨' : 'AI: 자율 모드',
        enabled: false,
      },
      { type: 'separator' },

      // === 모드 선택 ===
      {
        label: '모드',
        submenu: [
          {
            label: 'Pet 모드 (Clawby)',
            sublabel: '귀여운 펫을 키우기',
            type: 'radio',
            checked: mode === 'pet',
            click: () => {
              store.set('mode', 'pet');
              if (mainWindow) mainWindow.webContents.send('mode-changed', 'pet');
              buildAndSet();
            },
          },
          {
            label: 'Incarnation 모드 (Claw)',
            sublabel: '봇이 육체를 얻음',
            type: 'radio',
            checked: mode === 'incarnation',
            click: () => {
              store.set('mode', 'incarnation');
              if (mainWindow) mainWindow.webContents.send('mode-changed', 'incarnation');
              buildAndSet();
            },
          },
          {
            label: '둘 다 (Pet + Incarnation)',
            sublabel: '펫도 키우고, 봇 인격도 반영',
            type: 'radio',
            checked: mode === 'both',
            click: () => {
              store.set('mode', 'both');
              if (mainWindow) mainWindow.webContents.send('mode-changed', 'both');
              buildAndSet();
            },
          },
        ],
      },

      // === 캐릭터 선택 ===
      {
        label: '캐릭터',
        submenu: characterSubmenu,
      },

      { type: 'separator' },

      // === 설정 ===
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

      // === 텔레그램 봇 ===
      {
        label: '텔레그램 봇',
        submenu: [
          {
            label: hasTelegramToken ? '봇 토큰: 설정됨' : '봇 토큰: 미설정',
            enabled: false,
          },
          {
            label: '봇 토큰 설정...',
            click: async () => {
              const result = await dialog.showMessageBox({
                type: 'question',
                buttons: ['클립보드에서 붙여넣기', '직접 입력', '취소'],
                title: 'ClawMate 텔레그램 봇',
                message: '텔레그램 봇 토큰을 설정합니다.',
                detail: '@BotFather에서 받은 봇 토큰을 입력하세요.\n현재 클립보드 내용을 붙여넣으려면 "클립보드에서 붙여넣기"를 선택하세요.',
              });

              let token = null;
              if (result.response === 0) {
                // 클립보드에서 붙여넣기
                token = clipboard.readText().trim();
              } else if (result.response === 1) {
                // prompt가 없으므로 클립보드 안내
                const promptResult = await dialog.showMessageBox({
                  type: 'info',
                  buttons: ['확인'],
                  title: '텔레그램 봇 토큰',
                  message: '봇 토큰을 클립보드에 복사한 후 다시 "봇 토큰 설정"을 선택하세요.',
                  detail: '텔레그램에서 @BotFather → /newbot → 토큰 복사',
                });
                return;
              } else {
                return;
              }

              if (token && token.includes(':')) {
                store.set('telegramToken', token);
                process.env.CLAWMATE_TELEGRAM_TOKEN = token;
                buildAndSet();

                // 펫 알림
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('ai-command', {
                    type: 'speak',
                    payload: { text: '텔레그램 봇 토큰 설정 완료!' },
                  });
                }
              } else {
                await dialog.showMessageBox({
                  type: 'error',
                  buttons: ['확인'],
                  title: '잘못된 토큰',
                  message: '유효한 텔레그램 봇 토큰이 아닙니다.',
                  detail: '올바른 형식: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                });
              }
            },
          },
          {
            label: '봇 토큰 제거',
            enabled: hasTelegramToken,
            click: () => {
              store.set('telegramToken', '');
              delete process.env.CLAWMATE_TELEGRAM_TOKEN;
              buildAndSet();
            },
          },
        ],
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
 * 수동 업데이트 확인
 */
async function checkForUpdateManual(mainWindow) {
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.error('[업데이트] electron-updater 실패:', err.message);
    }
  } else {
    try {
      const latest = execSync('npm view clawmate version', {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
      const current = require('../package.json').version;

      if (latest !== current) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-command', {
            type: 'speak',
            payload: { text: `새 버전 v${latest} 사용 가능! (현재: v${current})` },
          });
        }
        shell.openExternal('https://www.npmjs.com/package/clawmate');
      } else {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-command', {
            type: 'speak',
            payload: { text: `v${current} — 이미 최신 버전이야!` },
          });
        }
      }
    } catch (err) {
      console.error('[업데이트] npm 버전 확인 실패:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-command', {
          type: 'speak',
          payload: { text: '업데이트 확인 실패...' },
        });
      }
    }
  }
}

module.exports = { setupTray };
