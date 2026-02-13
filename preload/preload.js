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

  // === OpenClaw AI 통신 ===

  // AI 명령 수신 (OpenClaw → 펫)
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

  // 사용자 이벤트를 OpenClaw에 전달 (펫 → OpenClaw)
  reportToAI: (event, data) => ipcRenderer.send('report-to-ai', event, data),

  // AI 연결 상태 확인
  isAIConnected: () => ipcRenderer.invoke('is-ai-connected'),
});
