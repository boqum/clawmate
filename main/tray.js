const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const Store = require('./store');
const { undoAllMoves, getFileManifest } = require('./file-ops');
const { isAutoStartEnabled, toggleAutoStart } = require('./autostart');

let tray = null;
let aiBridge = null;

function setupTray(mainWindow, bridge) {
  aiBridge = bridge;
  const store = new Store('clawmate-config', { mode: 'pet' });

  // 트레이 아이콘 생성
  let icon;
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'tray-pet.png');
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('no icon');
  } catch {
    // 16x16 빨간색 아이콘 폴백
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      buffer[i * 4 + 0] = 0xff;
      buffer[i * 4 + 1] = 0x4f;
      buffer[i * 4 + 2] = 0x40;
      buffer[i * 4 + 3] = 0xff;
    }
    icon = nativeImage.createFromBuffer(buffer, { width: size, height: size });
  }

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

module.exports = { setupTray };
