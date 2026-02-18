const { Tray, Menu, nativeImage, app, shell, dialog, clipboard } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const Store = require('./store');
const { undoAllMoves, getFileManifest } = require('./file-ops');
const { isAutoStartEnabled, toggleAutoStart } = require('./autostart');

let tray = null;
let aiBridge = null;

// (icon generated programmatically in createClawIcon)

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

/**
 * Generate 32x32 claw-marks tray icon
 * Three diagonal scratch marks in ClawMate brand red
 */
function createClawIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4, 0);

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const off = (y * size + x) * 4;
    const srcA = a / 255;
    const dstA = buf[off + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    buf[off] = Math.round((r * srcA + buf[off] * dstA * (1 - srcA)) / outA);
    buf[off + 1] = Math.round((g * srcA + buf[off + 1] * dstA * (1 - srcA)) / outA);
    buf[off + 2] = Math.round((b * srcA + buf[off + 2] * dstA * (1 - srcA)) / outA);
    buf[off + 3] = Math.round(outA * 255);
  }

  // Draw a tapered anti-aliased scratch line
  function drawScratch(x0, y0, x1, y1, maxW) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = -dy / len, ny = dx / len;
    const steps = Math.ceil(len * 3);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;

      // Taper: thin at ends, wide in middle
      const w = maxW * (0.3 + 0.7 * Math.pow(Math.sin(t * Math.PI), 0.6));

      // Color: dark red at base → bright red at tip
      const r = Math.round(180 + 75 * t);
      const g = Math.round(30 + 49 * t);
      const b = Math.round(20 + 44 * t);

      for (let d = -Math.ceil(w + 1); d <= Math.ceil(w + 1); d++) {
        const dist = Math.abs(d);
        if (dist > w + 0.5) continue;
        const px = Math.round(cx + nx * d);
        const py = Math.round(cy + ny * d);
        const alpha = dist > w - 0.5
          ? Math.round(Math.max(0, (w + 0.5 - dist) * 255))
          : 255;
        setPixel(px, py, r, g, b, alpha);
      }
    }
  }

  // Three claw scratches: bottom-left → top-right
  drawScratch(4, 28, 10, 3, 2.5);
  drawScratch(13, 28, 19, 3, 2.8);
  drawScratch(22, 28, 28, 3, 2.5);

  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function setupTray(mainWindow, bridge, getProactiveMonitor, aiConfig = null) {
  aiBridge = bridge;
  const store = new Store('clawmate-config', {
    mode: 'pet',
    character: 'default',
    telegramToken: '',
    proactiveEnabled: true,
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
    const proactiveEnabled = store.get('proactiveEnabled') !== false;

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
        label: 'Proactive Mode',
        sublabel: 'Pet reacts to your activity',
        type: 'checkbox',
        checked: proactiveEnabled,
        click: (item) => {
          store.set('proactiveEnabled', item.checked);
          const monitor = getProactiveMonitor ? getProactiveMonitor() : null;
          if (monitor) {
            if (item.checked) {
              if (!monitor.enabled) monitor.start(mainWindow, aiBridge);
            } else {
              monitor.stop();
            }
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-command', {
              type: 'speak',
              payload: { text: item.checked ? 'Proactive mode ON! I\'ll watch what you do~' : 'Proactive mode off. I\'ll mind my own business.' },
            });
          }
        },
      },
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

      // === AI Brain ===
      ...(aiConfig ? [{
        label: '🧠 AI Brain',
        submenu: [
          {
            label: aiConfig.isActive() ? '✓ Active' : (aiConfig.isConfigured() ? '✗ Paused (budget)' : '✗ No API Key'),
            enabled: false,
          },
          {
            label: 'Set API Key...',
            click: async () => {
              const result = await dialog.showMessageBox({
                type: 'question',
                buttons: ['Paste from Clipboard', 'Cancel'],
                title: 'ClawMate AI Brain',
                message: 'Anthropic API Key 설정',
                detail: 'API 키를 클립보드에 복사한 후 "Paste from Clipboard"를 클릭하세요.\nhttps://console.anthropic.com/settings/keys',
              });
              if (result.response === 0) {
                const key = clipboard.readText().trim();
                if (key && key.startsWith('sk-')) {
                  aiConfig.setApiKey(key);
                  buildAndSet();
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ai-command', {
                      type: 'speak',
                      payload: { text: 'AI Brain 활성화! 이제 혼자서도 생각할 수 있어~' },
                    });
                  }
                } else {
                  await dialog.showMessageBox({
                    type: 'error',
                    buttons: ['OK'],
                    title: 'Invalid API Key',
                    message: 'Anthropic API 키가 아닙니다.',
                    detail: '"sk-ant-..." 형식이어야 합니다.',
                  });
                }
              }
            },
          },
          {
            label: 'Remove API Key',
            enabled: aiConfig.isConfigured(),
            click: () => {
              aiConfig.setApiKey('');
              buildAndSet();
            },
          },
          { type: 'separator' },
          {
            label: 'Model',
            submenu: [
              { label: 'Auto (Recommended)', type: 'radio', checked: (aiConfig.get('model') || 'auto') === 'auto', click: () => { aiConfig.set('model', 'auto'); buildAndSet(); } },
              { label: 'Haiku (Fast/Cheap)', type: 'radio', checked: aiConfig.get('model') === 'haiku', click: () => { aiConfig.set('model', 'haiku'); buildAndSet(); } },
              { label: 'Sonnet (Smart)', type: 'radio', checked: aiConfig.get('model') === 'sonnet', click: () => { aiConfig.set('model', 'sonnet'); buildAndSet(); } },
            ],
          },
          { type: 'separator' },
          {
            label: `Today: $${(aiConfig.get('todayCost') || 0).toFixed(3)} / $${(aiConfig.get('dailyBudget') || 0.50).toFixed(2)}`,
            enabled: false,
          },
          {
            label: `Month: $${(aiConfig.get('monthCost') || 0).toFixed(3)} / $${(aiConfig.get('monthlyBudget') || 5.00).toFixed(2)}`,
            enabled: false,
          },
          { type: 'separator' },
          {
            label: 'Telegram AI Chat',
            type: 'checkbox',
            checked: aiConfig.get('telegramAI') !== false,
            click: (item) => { aiConfig.set('telegramAI', item.checked); },
          },
        ],
      }] : []),

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
