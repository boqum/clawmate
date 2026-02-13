/**
 * Register ClawMate auto-start on system boot
 *
 * Windows: Registry Run key
 * macOS: LaunchAgent plist
 * Linux: Create .desktop file in ~/.config/autostart/ directory
 *
 * Even if AI starts later, ClawMate is already running for immediate connection.
 * ClawMate runs in autonomous mode first -> switches to AI mode when AI connects.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isLinux } = require('./platform');

const LINUX_AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const LINUX_DESKTOP_FILE = path.join(LINUX_AUTOSTART_DIR, 'clawmate.desktop');

function getDesktopFileContent() {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ClawMate',
    'Comment=ClawMate Desktop Pet',
    `Exec=${process.execPath} ${path.resolve(__dirname, '..')}`,
    'X-GNOME-Autostart-enabled=true',
    'Hidden=false',
    'NoDisplay=false',
  ].join('\n') + '\n';
}

function isAutoStartEnabled() {
  if (isLinux()) {
    try {
      return fs.existsSync(LINUX_DESKTOP_FILE);
    } catch {
      return false;
    }
  }
  return app.getLoginItemSettings().openAtLogin;
}

function enableAutoStart() {
  if (isLinux()) {
    try {
      fs.mkdirSync(LINUX_AUTOSTART_DIR, { recursive: true });
      fs.writeFileSync(LINUX_DESKTOP_FILE, getDesktopFileContent(), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,  // Start in background without window
    path: process.execPath,
    args: [path.resolve(__dirname, '..')],
  });
  return true;
}

function disableAutoStart() {
  if (isLinux()) {
    try {
      if (fs.existsSync(LINUX_DESKTOP_FILE)) {
        fs.unlinkSync(LINUX_DESKTOP_FILE);
      }
      return true;
    } catch {
      return false;
    }
  }
  app.setLoginItemSettings({
    openAtLogin: false,
  });
  return true;
}

function toggleAutoStart() {
  if (isAutoStartEnabled()) {
    return disableAutoStart();
  }
  return enableAutoStart();
}

module.exports = { isAutoStartEnabled, enableAutoStart, disableAutoStart, toggleAutoStart };
