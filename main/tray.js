const { Tray, Menu, nativeImage, app, shell, dialog, clipboard } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const Store = require('./store');
const { undoAllMoves, getFileManifest } = require('./file-ops');
const { isAutoStartEnabled, toggleAutoStart } = require('./autostart');

let tray = null;
let aiBridge = null;

/**
 * Generate 16x16 Claw pixel art icon
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
 * Character preset list
 * When selected from tray, sent to renderer via set_character command
 */
const CHARACTER_PRESETS = {
  default: {
    name: 'Default Claw (Red)',
    colorMap: { primary: '#ff4f40', secondary: '#ff775f', dark: '#8B4513', eye: '#ffffff', pupil: '#111111', claw: '#ff4f40' },
  },
  blue: {
    name: 'Blue Claw',
    colorMap: { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', eye: '#ffffff', pupil: '#111111', claw: '#4488ff' },
  },
  green: {
    name: 'Green Claw',
    colorMap: { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', eye: '#ffffff', pupil: '#111111', claw: '#44cc44' },
  },
  purple: {
    name: 'Purple Claw',
    colorMap: { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', eye: '#ffffff', pupil: '#111111', claw: '#8844cc' },
  },
  gold: {
    name: 'Gold Claw',
    colorMap: { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', eye: '#ffffff', pupil: '#111111', claw: '#ffcc00' },
  },
  pink: {
    name: 'Pink Claw',
    colorMap: { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', eye: '#ffffff', pupil: '#111111', claw: '#ff69b4' },
  },
  cat: {
    name: 'Cat',
    colorMap: { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', eye: '#88ff88', pupil: '#111111', claw: '#ff9944' },
  },
  robot: {
    name: 'Robot',
    colorMap: { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', eye: '#66aaff', pupil: '#0044aa', claw: '#66aaff' },
  },
  ghost: {
    name: 'Ghost',
    colorMap: { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', eye: '#ff6666', pupil: '#cc0000', claw: '#ccccff' },
  },
  dragon: {
    name: 'Dragon',
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
  tray.setToolTip('ClawMate - AI Cyber Body');

  function buildMenu() {
    const mode = store.get('mode') || 'pet';
    const fileInteraction = store.get('fileInteraction') !== false;
    const aiConnected = aiBridge ? aiBridge.isConnected() : false;
    const autoStart = isAutoStartEnabled();
    const currentChar = store.get('character') || 'default';
    const hasTelegramToken = !!(store.get('telegramToken'));

    // Character submenu
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
                speech: `Transforming into ${preset.name}!`,
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
        label: aiConnected ? 'AI: Connected' : 'AI: Autonomous Mode',
        enabled: false,
      },
      { type: 'separator' },

      // === Mode Selection ===
      {
        label: 'Mode',
        submenu: [
          {
            label: 'Pet Mode (Clawby)',
            sublabel: 'Raise a cute pet',
            type: 'radio',
            checked: mode === 'pet',
            click: () => {
              store.set('mode', 'pet');
              if (mainWindow) mainWindow.webContents.send('mode-changed', 'pet');
              buildAndSet();
            },
          },
          {
            label: 'Incarnation Mode (Claw)',
            sublabel: 'AI gains a cyber body',
            type: 'radio',
            checked: mode === 'incarnation',
            click: () => {
              store.set('mode', 'incarnation');
              if (mainWindow) mainWindow.webContents.send('mode-changed', 'incarnation');
              buildAndSet();
            },
          },
          {
            label: 'Both (Pet + Incarnation)',
            sublabel: 'Raise pet and reflect AI persona',
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

      // === Character Selection ===
      {
        label: 'Character',
        submenu: characterSubmenu,
      },

      { type: 'separator' },

      // === Settings ===
      {
        label: 'File Interaction',
        type: 'checkbox',
        checked: fileInteraction,
        click: (item) => {
          store.set('fileInteraction', item.checked);
          if (mainWindow) mainWindow.webContents.send('config-changed', store.getAll());
        },
      },
      {
        label: 'Launch at Startup',
        type: 'checkbox',
        checked: autoStart,
        click: () => {
          toggleAutoStart();
          buildAndSet();
        },
      },

      { type: 'separator' },

      // === Telegram Bot ===
      {
        label: 'Telegram Bot',
        submenu: [
          {
            label: hasTelegramToken ? 'Bot Token: Configured' : 'Bot Token: Not Set',
            enabled: false,
          },
          {
            label: 'Set Bot Token...',
            click: async () => {
              const result = await dialog.showMessageBox({
                type: 'question',
                buttons: ['Paste from Clipboard', 'Manual Entry', 'Cancel'],
                title: 'ClawMate Telegram Bot',
                message: 'Set up Telegram bot token.',
                detail: 'Enter the bot token received from @BotFather.\nSelect "Paste from Clipboard" to paste current clipboard content.',
              });

              let token = null;
              if (result.response === 0) {
                // Paste from clipboard
                token = clipboard.readText().trim();
              } else if (result.response === 1) {
                // No prompt available, guide to use clipboard
                const promptResult = await dialog.showMessageBox({
                  type: 'info',
                  buttons: ['OK'],
                  title: 'Telegram Bot Token',
                  message: 'Copy the bot token to clipboard, then select "Set Bot Token" again.',
                  detail: 'In Telegram: @BotFather -> /newbot -> Copy token',
                });
                return;
              } else {
                return;
              }

              if (token && token.includes(':')) {
                store.set('telegramToken', token);
                process.env.CLAWMATE_TELEGRAM_TOKEN = token;
                buildAndSet();

                // Pet notification
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('ai-command', {
                    type: 'speak',
                    payload: { text: 'Telegram bot token configured!' },
                  });
                }
              } else {
                await dialog.showMessageBox({
                  type: 'error',
                  buttons: ['OK'],
                  title: 'Invalid Token',
                  message: 'Not a valid Telegram bot token.',
                  detail: 'Correct format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
                });
              }
            },
          },
          {
            label: 'Remove Bot Token',
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
        label: 'Check for Updates',
        click: async () => {
          await checkForUpdateManual(mainWindow);
        },
      },
      {
        label: 'Undo File Moves',
        click: async () => {
          const manifest = await getFileManifest();
          const pending = manifest.filter(m => !m.restored);
          if (pending.length === 0) return;
          await undoAllMoves();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        },
      },
    ]);
  }

  function buildAndSet() {
    tray.setContextMenu(buildMenu());
  }

  // Update menu when AI connection state changes
  if (aiBridge) {
    aiBridge.on('connected', () => buildAndSet());
    aiBridge.on('disconnected', () => buildAndSet());
  }

  buildAndSet();
  return tray;
}

/**
 * Manual update check
 */
async function checkForUpdateManual(mainWindow) {
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.error('[Update] electron-updater failed:', err.message);
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
            payload: { text: `New version v${latest} available! (current: v${current})` },
          });
        }
        shell.openExternal('https://www.npmjs.com/package/clawmate');
      } else {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-command', {
            type: 'speak',
            payload: { text: `v${current} — already up to date!` },
          });
        }
      }
    } catch (err) {
      console.error('[Update] npm version check failed:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-command', {
          type: 'speak',
          payload: { text: 'Update check failed...' },
        });
      }
    }
  }
}

module.exports = { setupTray };
