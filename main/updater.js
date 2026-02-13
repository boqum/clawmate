/**
 * ClawMate Auto-Update Module
 *
 * Uses electron-updater to automatically download new versions
 * from GitHub Releases and install on app quit.
 * Does not run in development mode (app.isPackaged === false).
 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

function checkForUpdates() {
  // Only runs in packaged app (excludes dev mode)
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Update] Checking for new version...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Update] New version found:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Update] Already up to date.');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Update] Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Update] Download complete, will install on restart:', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('[Update] Error:', err.message);
  });

  // Initial update check
  autoUpdater.checkForUpdatesAndNotify();

  // Check for updates every 6 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 6 * 60 * 60 * 1000);
}

module.exports = { checkForUpdates };
