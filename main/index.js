const { app, BrowserWindow, screen, desktopCapturer } = require('electron');
const path = require('path');
const { setupTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc-handlers');
const { AIBridge } = require('./ai-bridge');
const { TelegramBot } = require('./telegram');
const { ProactiveMonitor } = require('./proactive-monitor');
const { AIConfig } = require('./ai-config');
const { AIMemory } = require('./ai-memory');
const { AIBrain } = require('./ai-brain');
const { AIBrainTriggers } = require('./ai-brain-triggers');

let mainWindow = null;
let launcherWindow = null;
let aiBridge = null;
let telegramBot = null;
let proactiveMonitor = null;
let aiConfig = null;
let aiMemory = null;
let aiBrain = null;
let aiBrainTriggers = null;

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
  // AI Brain initialization
  aiConfig = new AIConfig();
  aiMemory = new AIMemory();
  aiBrain = new AIBrain(aiConfig, aiMemory);

  registerIpcHandlers(() => mainWindow, () => aiBridge, () => proactiveMonitor, aiConfig, aiBrain);
  const win = createMainWindow();
  const bridge = startAIBridge(win);

  // AI Brain Triggers (needs mainWindow)
  aiBrainTriggers = new AIBrainTriggers(aiBrain, aiMemory, win);

  // Connect screen capture to AI Brain
  aiBrain.setCaptureScreen(async () => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.min(width, 960), height: Math.min(height, 540) },
      });
      if (sources.length > 0) {
        const thumbnail = sources[0].thumbnail;
        const jpegBuffer = thumbnail.toJPEG(40);
        return {
          image: jpegBuffer.toString('base64'),
          width: thumbnail.getSize().width,
          height: thumbnail.getSize().height,
        };
      }
      return null;
    } catch { return null; }
  });

  // AI Brain events → renderer (same 'ai-command' channel as AIBridge)
  ['speak', 'think', 'action', 'emote', 'move'].forEach(type => {
    aiBrain.on(type, (payload) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ai-command', { type, payload });
      }
    });
  });

  // OpenClaw connection/disconnection → toggle Brain
  bridge.on('connected', () => { aiBrain.setOpenClawConnected(true); });
  bridge.on('disconnected', () => { aiBrain.setOpenClawConnected(false); });

  setupTray(win, bridge, () => proactiveMonitor, aiConfig);

  // Initialize Telegram bot with AI Brain
  telegramBot = new TelegramBot(bridge, { aiBrain });

  // Initialize Proactive Monitor with Brain Triggers
  const Store = require('./store');
  const configStore = new Store('clawmate-config', { proactiveEnabled: true });
  proactiveMonitor = new ProactiveMonitor();
  if (configStore.get('proactiveEnabled') !== false) {
    proactiveMonitor.start(win, bridge, aiBrainTriggers);
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
  if (aiMemory) aiMemory.destroy();
  if (aiBrain) aiBrain.destroy();
  if (aiBrainTriggers) aiBrainTriggers.destroy();
  if (proactiveMonitor) proactiveMonitor.stop();
  if (telegramBot) telegramBot.stop();
  if (aiBridge) aiBridge.stop();
});

module.exports = { createMainWindow, createLauncherWindow };
