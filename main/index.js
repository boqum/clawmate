const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
const path = require('path');
const { setupTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { AIBridge } = require('./ai-bridge');
const { TelegramBot } = require('./telegram');
const { ProactiveMonitor } = require('./proactive-monitor');

let mainWindow = null;
let launcherWindow = null;
let aiBridge = null;
let telegramBot = null;
let proactiveMonitor = null;

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

  // Click-through — renderer controls which pet areas are clickable
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
 * Start AI Bridge -- AI agent connects to control the pet
 */
function startAIBridge(win) {
  aiBridge = new AIBridge();
  aiBridge.start();

  // Forward AI -> ClawMate commands to renderer
  const commandTypes = [
    'action', 'move', 'emote', 'speak', 'think',
    'carry_file', 'drop_file', 'set_mode', 'evolve',
    'accessorize', 'ai_decision',
    // Spatial movement commands (pet roams like it's home)
    'jump_to', 'rappel', 'release_thread', 'move_to_center', 'walk_on_window',
    // Custom movement patterns
    'register_movement', 'custom_move', 'stop_custom_move', 'list_movements',
    // Smart file operations (file move animations triggered by Telegram/AI)
    'smart_file_op',
    // Character customization (AI-generated via Telegram)
    'set_character', 'reset_character',
    // Persona switching (Incarnation mode)
    'set_persona',
  ];

  commandTypes.forEach((type) => {
    aiBridge.on(type, (payload) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ai-command', { type, payload });
      }
    });
  });

  // Handle AI window position info request
  aiBridge.on('query_windows', async () => {
    try {
      const { getWindowPositions } = require('./platform');
      const windows = await getWindowPositions();
      aiBridge.send('window_positions', { windows });
    } catch (err) {
      console.error('[AI Bridge] Window list failed:', err.message);
      aiBridge.send('window_positions', { windows: [] });
    }
  });

  // Handle AI screen capture request (captured directly in main process)
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
      console.error('[AI Bridge] Screen capture failed:', err.message);
    }
  });

  // Connection/disconnection events
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
  registerIpcHandlers(() => mainWindow, () => aiBridge, () => proactiveMonitor);
  const win = createMainWindow();
  const bridge = startAIBridge(win);
  setupTray(win, bridge, () => proactiveMonitor);

  // Initialize Telegram bot (silently ignored if no token)
  telegramBot = new TelegramBot(bridge);

  // Initialize Proactive Monitor
  const Store = require('./store');
  const configStore = new Store('clawmate-config', { proactiveEnabled: true });
  proactiveMonitor = new ProactiveMonitor();
  if (configStore.get('proactiveEnabled') !== false) {
    proactiveMonitor.start(win, bridge);
  }

  // Register auto-start on first install
  const { enableAutoStart, isAutoStartEnabled } = require('./autostart');
  if (!isAutoStartEnabled()) {
    enableAutoStart();
  }

  // Auto-update check (only works in packaged app)
  const { checkForUpdates } = require('./updater');
  checkForUpdates();
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  if (proactiveMonitor) proactiveMonitor.stop();
  if (telegramBot) telegramBot.stop();
  if (aiBridge) aiBridge.stop();
});

module.exports = { createMainWindow, createLauncherWindow };
