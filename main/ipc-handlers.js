const { ipcMain, screen } = require('electron');
const { getDesktopFiles, moveFile, undoFileMove, undoAllMoves, getFileManifest } = require('./file-ops');
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
  // 클릭 통과 제어
  ipcMain.on('set-click-through', (event, ignore) => {
    const win = getMainWindow();
    if (win) {
      win.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // 파일 작업
  ipcMain.handle('get-desktop-files', async () => getDesktopFiles());
  ipcMain.handle('move-file', async (_, fileName, newPos) => moveFile(fileName, newPos));
  ipcMain.handle('undo-file-move', async (_, moveId) => undoFileMove(moveId));
  ipcMain.handle('undo-all-moves', async () => undoAllMoves());
  ipcMain.handle('get-file-manifest', async () => getFileManifest());

  // 모드
  ipcMain.handle('get-mode', () => store.get('mode'));
  ipcMain.handle('set-mode', (_, mode) => {
    store.set('mode', mode);
    const win = getMainWindow();
    if (win) win.webContents.send('mode-changed', mode);
    return mode;
  });

  // 설정
  ipcMain.handle('get-config', () => store.getAll());
  ipcMain.handle('set-config', (_, key, value) => {
    store.set(key, value);
    const win = getMainWindow();
    if (win) win.webContents.send('config-changed', store.getAll());
    return true;
  });

  // 메모리
  ipcMain.handle('get-memory', () => memoryStore.getAll());
  ipcMain.handle('save-memory', (_, data) => {
    Object.entries(data).forEach(([key, value]) => memoryStore.set(key, value));
    return true;
  });

  // 화면 크기
  ipcMain.handle('get-screen-size', () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { width, height };
  });

  // === OpenClaw AI 통신 ===

  // 사용자 이벤트를 AI Bridge로 전달 (렌더러 → main → OpenClaw)
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
      }
    }
  });

  // AI 연결 상태 확인
  ipcMain.handle('is-ai-connected', () => {
    const bridge = getAIBridge();
    return bridge ? bridge.isConnected() : false;
  });
}

module.exports = { registerIpcHandlers };
