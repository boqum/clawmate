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

  // 화면 캡처
  ipcMain.handle('capture-screen', async () => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.min(width, 1920), height: Math.min(height, 1080) }
      });

      if (sources.length > 0) {
        // NativeImage를 base64 JPEG로 변환 (크기 최적화)
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
        case 'browsing':
          // 브라우징 컨텍스트 (제목 + 커서 위치 + 화면 캡처) → AI 코멘트 생성
          bridge.send('user_event', { event: 'browsing', ...data });
          break;
        default:
          // 알 수 없는 이벤트도 AI에 전달 (확장성)
          bridge.send('user_event', { event, ...data });
          break;
      }
    }
  });

  // AI 연결 상태 확인
  ipcMain.handle('is-ai-connected', () => {
    const bridge = getAIBridge();
    return bridge ? bridge.isConnected() : false;
  });

  // 메트릭 보고 (렌더러 → main → OpenClaw)
  ipcMain.on('report-metrics', (_, summary) => {
    const bridge = getAIBridge();
    if (bridge && bridge.isConnected()) {
      bridge.reportMetrics(summary);
    }
  });

  // 열린 윈도우 위치/크기 조회
  ipcMain.handle('get-window-positions', async () => {
    const { getWindowPositions } = require('./platform');
    return await getWindowPositions();
  });

  // 활성 윈도우 제목 조회 (브라우저 감시용)
  ipcMain.handle('get-active-window-title', async () => {
    const { getActiveWindowTitle } = require('./platform');
    return await getActiveWindowTitle();
  });

  // 커서 위치 조회 (화면 좌표)
  ipcMain.handle('get-cursor-position', () => {
    const point = screen.getCursorScreenPoint();
    return { x: point.x, y: point.y };
  });

  // === 스마트 파일 조작 IPC ===

  // 파일 명령 파싱 (렌더러에서도 사용 가능)
  ipcMain.handle('parse-file-command', (_, text) => {
    return parseMessage(text);
  });

  // 필터된 파일 목록 조회
  ipcMain.handle('list-filtered-files', async (_, sourceDir, filter) => {
    return listFilteredFiles(sourceDir, filter);
  });

  // 스마트 파일 조작 실행
  // 렌더러에서 직접 실행할 때 사용 (텔레그램 경유가 아닌 경우)
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

  // 스마트 이동 되돌리기 (단일)
  ipcMain.handle('undo-smart-move', async (_, moveId) => {
    return undoSmartMove(moveId);
  });

  // 스마트 이동 전체 되돌리기
  ipcMain.handle('undo-all-smart-moves', async () => {
    return undoAllSmartMoves();
  });
}

module.exports = { registerIpcHandlers };
