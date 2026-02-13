const { app, BrowserWindow, screen } = require('electron');
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
  ];

  commandTypes.forEach((type) => {
    aiBridge.on(type, (payload) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ai-command', { type, payload });
      }
    });
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
});

app.on('window-all-closed', () => {
  // 트레이에서 계속 실행
});

app.on('before-quit', () => {
  if (aiBridge) aiBridge.stop();
});

module.exports = { createMainWindow, createLauncherWindow };
