/**
 * ClawMate 자동 업데이트 모듈
 *
 * electron-updater를 사용하여 GitHub Releases에서
 * 새 버전이 있으면 자동으로 다운로드하고, 앱 종료 시 설치한다.
 * 개발 모드(app.isPackaged === false)에서는 동작하지 않는다.
 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

function checkForUpdates() {
  // 빌드된 앱에서만 동작 (개발 모드 제외)
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[업데이트] 새 버전 확인 중...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[업데이트] 새 버전 발견:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[업데이트] 현재 최신 버전입니다.');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[업데이트] 다운로드 진행: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[업데이트] 다운로드 완료, 재시작 시 설치됨:', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('[업데이트] 오류:', err.message);
  });

  // 최초 업데이트 확인
  autoUpdater.checkForUpdatesAndNotify();

  // 6시간마다 업데이트 확인
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 6 * 60 * 60 * 1000);
}

module.exports = { checkForUpdates };
