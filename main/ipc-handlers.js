const { ipcMain, screen, desktopCapturer } = require('electron');
const { getDesktopFiles, moveFile, undoFileMove, undoAllMoves, getFileManifest } = require('./file-ops');
const { executeSmartFileOp, undoSmartMove, undoAllSmartMoves, listFilteredFiles } = require('./smart-file-ops');
const { parseMessage } = require('./file-command-parser');
const Store = require('./store');

const store = new Store('clawmate-config', {
  mode: 'pet',
  fileInteraction: true,
  soundEnabled: false,
});

const memoryStore = new Store('clawmate-memory', {
  totalClicks: 0,
  totalDays: 0,
  firstRunDate: null,
  milestones: [],
});

function registerIpcHandlers(getMainWindow, getAIBridge) {
  // Click-through control
  ipcMain.on('set-click-through', (event, ignore) => {
    const win = getMainWindow();
    if (win) {
      win.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // File operations
  ipcMain.handle('get-desktop-files', async () => getDesktopFiles());
  ipcMain.handle('move-file', async (_, fileName, newPos) => moveFile(fileName, newPos));
  ipcMain.handle('undo-file-move', async (_, moveId) => undoFileMove(moveId));
  ipcMain.handle('undo-all-moves', async () => undoAllMoves());
  ipcMain.handle('get-file-manifest', async () => getFileManifest());

  // Mode
  ipcMain.handle('get-mode', () => store.get('mode'));
  ipcMain.handle('set-mode', (_, mode) => {
    store.set('mode', mode);
    const win = getMainWindow();
    if (win) win.webContents.send('mode-changed', mode);
    return mode;
  });

  // Config
  ipcMain.handle('get-config', () => store.getAll());
  ipcMain.handle('set-config', (_, key, value) => {
    store.set(key, value);
    const win = getMainWindow();
    if (win) win.webContents.send('config-changed', store.getAll());
    return true;
  });

  // Memory
  ipcMain.handle('get-memory', () => memoryStore.getAll());
  ipcMain.handle('save-memory', (_, data) => {
    Object.entries(data).forEach(([key, value]) => memoryStore.set(key, value));
    return true;
  });

  // Screen size
  ipcMain.handle('get-screen-size', () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { width, height };
  });

  // Screen capture
  ipcMain.handle('capture-screen', async () => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.min(width, 1920), height: Math.min(height, 1080) }
      });

      if (sources.length > 0) {
        // Convert NativeImage to base64 JPEG (size optimized)
        const thumbnail = sources[0].thumbnail;
        const jpegBuffer = thumbnail.toJPEG(60);
        return {
          success: true,
          image: jpegBuffer.toString('base64'),
          width: thumbnail.getSize().width,
          height: thumbnail.getSize().height,
          timestamp: Date.now()
        };
      }
      return { success: false, error: 'No screen source found' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // === AI Communication ===

  // Forward user events to AI Bridge (renderer -> main -> AI)
  ipcMain.on('report-to-ai', (_, event, data) => {
    const bridge = getAIBridge();
    if (bridge && bridge.isConnected()) {
      switch (event) {
        case 'click':
          bridge.reportUserClick(data.position);
          break;
        case 'drag':
          bridge.reportUserDrag(data.from, data.to);
          break;
        case 'cursor_near':
          bridge.reportCursorNear(data.distance, data.cursorPos);
          break;
        case 'double_click':
          bridge.send('user_event', { event: 'double_click', ...data });
          break;
        case 'desktop_changed':
          bridge.reportDesktopChange(data.files);
          break;
        case 'time_change':
          bridge.reportTimeChange(data.hour, data.period);
          break;
        case 'milestone':
          bridge.reportMilestone(data.milestone, data);
          break;
        case 'user_idle':
          bridge.reportIdleTime(data.idleSeconds);
          break;
        case 'browsing':
          // Browsing context (title + cursor position + screen capture) -> AI comment generation
          bridge.send('user_event', { event: 'browsing', ...data });
          break;
        default:
          // Forward unknown events to AI as well (extensibility)
          bridge.send('user_event', { event, ...data });
          break;
      }
    }
  });

  // Check AI connection status
  ipcMain.handle('is-ai-connected', () => {
    const bridge = getAIBridge();
    return bridge ? bridge.isConnected() : false;
  });

  // Metrics reporting (renderer -> main -> AI)
  ipcMain.on('report-metrics', (_, summary) => {
    const bridge = getAIBridge();
    if (bridge && bridge.isConnected()) {
      bridge.reportMetrics(summary);
    }
  });

  // Get open window positions/sizes
  ipcMain.handle('get-window-positions', async () => {
    const { getWindowPositions } = require('./platform');
    return await getWindowPositions();
  });

  // Get active window title (for browser monitoring)
  ipcMain.handle('get-active-window-title', async () => {
    const { getActiveWindowTitle } = require('./platform');
    return await getActiveWindowTitle();
  });

  // Get cursor position (screen coordinates)
  ipcMain.handle('get-cursor-position', () => {
    const point = screen.getCursorScreenPoint();
    return { x: point.x, y: point.y };
  });

  // === Smart File Operation IPC ===

  // Parse file command (also available from renderer)
  ipcMain.handle('parse-file-command', (_, text) => {
    return parseMessage(text);
  });

  // Get filtered file list
  ipcMain.handle('list-filtered-files', async (_, sourceDir, filter) => {
    return listFilteredFiles(sourceDir, filter);
  });

  // Execute smart file operation
  // Used when executed directly from renderer (not via Telegram)
  ipcMain.handle('smart-file-op', async (_, command) => {
    const win = getMainWindow();
    const callbacks = {
      onStart: (totalFiles) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ai-command', {
            type: 'smart_file_op',
            payload: { phase: 'start', totalFiles },
          });
        }
      },
      onPickUp: (fileName, index) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ai-command', {
            type: 'smart_file_op',
            payload: { phase: 'pick_up', fileName, index },
          });
        }
      },
      onDrop: (fileName, targetName, index) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ai-command', {
            type: 'smart_file_op',
            payload: { phase: 'drop', fileName, targetName, index },
          });
        }
      },
      onComplete: (result) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ai-command', {
            type: 'smart_file_op',
            payload: { phase: 'complete', ...result },
          });
        }
      },
      onError: (error) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ai-command', {
            type: 'smart_file_op',
            payload: { phase: 'error', error },
          });
        }
      },
    };

    return await executeSmartFileOp(command, callbacks);
  });

  // Undo smart move (single)
  ipcMain.handle('undo-smart-move', async (_, moveId) => {
    return undoSmartMove(moveId);
  });

  // Undo all smart moves
  ipcMain.handle('undo-all-smart-moves', async () => {
    return undoAllSmartMoves();
  });
}

module.exports = { registerIpcHandlers };
