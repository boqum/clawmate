const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clawmate', {
  // 클릭 통과 제어
  setClickThrough: (ignore) => ipcRenderer.send('set-click-through', ignore),

  // 파일 작업
  getDesktopFiles: () => ipcRenderer.invoke('get-desktop-files'),
  moveFile: (fileName, newPosition) => ipcRenderer.invoke('move-file', fileName, newPosition),
  undoFileMove: (moveId) => ipcRenderer.invoke('undo-file-move', moveId),
  undoAllMoves: () => ipcRenderer.invoke('undo-all-moves'),
  getFileManifest: () => ipcRenderer.invoke('get-file-manifest'),

  // 모드 전환
  getMode: () => ipcRenderer.invoke('get-mode'),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),

  // 설정
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),

  // 메모리 (사용자 상호작용 기억)
  getMemory: () => ipcRenderer.invoke('get-memory'),
  saveMemory: (data) => ipcRenderer.invoke('save-memory', data),

  // 창 정보
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),

  // 열린 윈도우 위치/크기 조회
  getWindowPositions: () => ipcRenderer.invoke('get-window-positions'),

  // 화면 캡처
  screen: {
    capture: () => ipcRenderer.invoke('capture-screen'),
  },

  // 이벤트 수신
  onModeChanged: (callback) => {
    ipcRenderer.on('mode-changed', (_, mode) => callback(mode));
  },
  onConfigChanged: (callback) => {
    ipcRenderer.on('config-changed', (_, config) => callback(config));
  },

  // === AI 통신 ===

  // AI 명령 수신 (AI → 펫)
  onAICommand: (callback) => {
    ipcRenderer.on('ai-command', (_, command) => callback(command));
  },

  // AI 연결/해제 이벤트
  onAIConnected: (callback) => {
    ipcRenderer.on('ai-connected', () => callback());
  },
  onAIDisconnected: (callback) => {
    ipcRenderer.on('ai-disconnected', () => callback());
  },

  // 사용자 이벤트를 AI에 전달 (펫 → AI)
  reportToAI: (event, data) => ipcRenderer.send('report-to-ai', event, data),

  // AI 연결 상태 확인
  isAIConnected: () => ipcRenderer.invoke('is-ai-connected'),

  // 메트릭 보고 (렌더러 → main → AI)
  reportMetrics: (summary) => ipcRenderer.send('report-metrics', summary),

  // 활성 윈도우 제목 조회 (브라우저 감시)
  getActiveWindowTitle: () => ipcRenderer.invoke('get-active-window-title'),

  // 커서 위치 조회 (화면 좌표)
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),

  // === 스마트 파일 조작 ===
  parseFileCommand: (text) => ipcRenderer.invoke('parse-file-command', text),
  listFilteredFiles: (sourceDir, filter) => ipcRenderer.invoke('list-filtered-files', sourceDir, filter),
  smartFileOp: (command) => ipcRenderer.invoke('smart-file-op', command),
  undoSmartMove: (moveId) => ipcRenderer.invoke('undo-smart-move', moveId),
  undoAllSmartMoves: () => ipcRenderer.invoke('undo-all-smart-moves'),
});
