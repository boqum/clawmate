const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clawmate', {
  // Click-through control
  setClickThrough: (ignore) => ipcRenderer.send('set-click-through', ignore),

  // File operations
  getDesktopFiles: () => ipcRenderer.invoke('get-desktop-files'),
  moveFile: (fileName, newPosition) => ipcRenderer.invoke('move-file', fileName, newPosition),
  undoFileMove: (moveId) => ipcRenderer.invoke('undo-file-move', moveId),
  undoAllMoves: () => ipcRenderer.invoke('undo-all-moves'),
  getFileManifest: () => ipcRenderer.invoke('get-file-manifest'),

  // Mode switching
  getMode: () => ipcRenderer.invoke('get-mode'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),

  // Settings
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

  // Memory (user interaction history)
  getMemory: () => ipcRenderer.invoke('get-memory'),
  saveMemory: (data) => ipcRenderer.invoke('save-memory', data),

  // Window info
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),

  // Open window position/size query
  getWindowPositions: () => ipcRenderer.invoke('get-window-positions'),

  // Screen capture
  screen: {
    capture: () => ipcRenderer.invoke('capture-screen'),
  },

  // Event listeners
  onModeChanged: (callback) => {
    ipcRenderer.on('mode-changed', (_, mode) => callback(mode));
  },
  onConfigChanged: (callback) => {
    ipcRenderer.on('config-changed', (_, config) => callback(config));
  },

  // === AI Communication ===

  // Receive AI commands (AI -> Pet)
  onAICommand: (callback) => {
    ipcRenderer.on('ai-command', (_, command) => callback(command));
  },

  // AI connect/disconnect events
  onAIConnected: (callback) => {
    ipcRenderer.on('ai-connected', () => callback());
  },
  onAIDisconnected: (callback) => {
    ipcRenderer.on('ai-disconnected', () => callback());
  },

  // Forward user events to AI (Pet -> AI)
  reportToAI: (event, data) => ipcRenderer.send('report-to-ai', event, data),

  // Check AI connection status
  isAIConnected: () => ipcRenderer.invoke('is-ai-connected'),

  // Metrics reporting (renderer -> main -> AI)
  reportMetrics: (summary) => ipcRenderer.send('report-metrics', summary),

  // Get active window title (browser watching)
  getActiveWindowTitle: () => ipcRenderer.invoke('get-active-window-title'),

  // Get cursor position (screen coordinates)
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),

  // === Smart file operations ===
  parseFileCommand: (text) => ipcRenderer.invoke('parse-file-command', text),
  listFilteredFiles: (sourceDir, filter) => ipcRenderer.invoke('list-filtered-files', sourceDir, filter),
  smartFileOp: (command) => ipcRenderer.invoke('smart-file-op', command),
  undoSmartMove: (moveId) => ipcRenderer.invoke('undo-smart-move', moveId),
  undoAllSmartMoves: () => ipcRenderer.invoke('undo-all-smart-moves'),
});
