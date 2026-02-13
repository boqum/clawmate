const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
const path = require('path');
const { setupTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { AIBridge } = require('./ai-bridge');

let mainWindow = null;
let launcherWindow = null;
let aiBridge = null;

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 클릭 통과 — 펫 영역만 클릭 가능하도록 렌더러에서 제어
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 360,
    height: 480,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  launcherWindow.loadFile(path.join(__dirname, '..', 'renderer', 'launcher.html'));
  launcherWindow.center();

  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });

  return launcherWindow;
}

/**
 * AI Bridge 시작 — OpenClaw 에이전트가 접속하면 펫을 조종
 */
function startAIBridge(win) {
  aiBridge = new AIBridge();
  aiBridge.start();

  // OpenClaw → ClawMate 명령을 렌더러에 전달
  const commandTypes = [
    'action', 'move', 'emote', 'speak', 'think',
    'carry_file', 'drop_file', 'set_mode', 'evolve',
    'accessorize', 'ai_decision',
    // 공간 이동 명령 (OpenClaw이 집처럼 돌아다니기)
    'jump_to', 'rappel', 'release_thread', 'move_to_center', 'walk_on_window',
  ];

  commandTypes.forEach((type) => {
    aiBridge.on(type, (payload) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ai-command', { type, payload });
      }
    });
  });

  // OpenClaw 윈도우 위치 정보 요청 처리
  aiBridge.on('query_windows', async () => {
    try {
      const { getWindowPositions } = require('./platform');
      const windows = await getWindowPositions();
      aiBridge.send('window_positions', { windows });
    } catch (err) {
      console.error('[AI Bridge] 윈도우 목록 실패:', err.message);
      aiBridge.send('window_positions', { windows: [] });
    }
  });

  // OpenClaw 화면 캡처 요청 처리 (main process에서 직접 캡처)
  aiBridge.on('query_screen', async () => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.min(width, 1280), height: Math.min(height, 720) }
      });

      if (sources.length > 0) {
        const thumbnail = sources[0].thumbnail;
        const jpegBuffer = thumbnail.toJPEG(50);
        aiBridge.reportScreenCapture(
          jpegBuffer.toString('base64'),
          thumbnail.getSize().width,
          thumbnail.getSize().height
        );
      }
    } catch (err) {
      console.error('[AI Bridge] 화면 캡처 실패:', err.message);
    }
  });

  // 연결/해제 이벤트
  aiBridge.on('connected', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('ai-connected');
    }
  });

  aiBridge.on('disconnected', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('ai-disconnected');
    }
  });

  return aiBridge;
}

app.whenReady().then(() => {
  registerIpcHandlers(() => mainWindow, () => aiBridge);
  const win = createMainWindow();
  const bridge = startAIBridge(win);
  setupTray(win, bridge);

  // 최초 설치 시 자동 시작 등록
  const { enableAutoStart, isAutoStartEnabled } = require('./autostart');
  if (!isAutoStartEnabled()) {
    enableAutoStart();
  }

  // 자동 업데이트 확인 (빌드된 앱에서만 동작)
  const { checkForUpdates } = require('./updater');
  checkForUpdates();
});

app.on('window-all-closed', () => {
  // 트레이에서 계속 실행
});

app.on('before-quit', () => {
  if (aiBridge) aiBridge.stop();
});

module.exports = { createMainWindow, createLauncherWindow };
