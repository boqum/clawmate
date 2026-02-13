/**
 * Register ClawMate auto-start on system boot
 *
 * Windows: Registry Run key
 * macOS: LaunchAgent plist
 * Linux: Create .desktop file in ~/.config/autostart/ directory
 * WSL: Create .bat file in Windows Startup folder
 *
 * Even if AI starts later, ClawMate is already running for immediate connection.
 * ClawMate runs in autonomous mode first -> switches to AI mode when AI connects.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { isLinux, isWSL } = require('./platform');

const LINUX_AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const LINUX_DESKTOP_FILE = path.join(LINUX_AUTOSTART_DIR, 'clawmate.desktop');

/**
 * WSL: Windows 시작프로그램 폴더 경로 + 배치파일명
 */
function getWSLStartupBatPath() {
  try {
    const winUserProfile = execSync('cmd.exe /c "echo %USERPROFILE%"', {
      encoding: 'utf-8',
    }).trim().replace(/\r/g, '');
    // Windows 경로를 Linux 경로로 변환하여 fs로 접근
    const linuxStartup = execSync(
      `wslpath "${winUserProfile}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"`,
      { encoding: 'utf-8' }
    ).trim();
    return path.join(linuxStartup, 'clawmate.bat');
  } catch {
    return null;
  }
}

/**
 * WSL: Windows Startup 폴더에 넣을 배치파일 내용
 */
function getWSLBatContent() {
  try {
    const appRoot = path.resolve(__dirname, '..');
    const winAppRoot = execSync(`wslpath -w "${appRoot}"`, {
      encoding: 'utf-8',
    }).trim();
    return `@echo off\r\nnpx.cmd electron ${winAppRoot}\r\n`;
  } catch {
    return null;
  }
}

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
  if (isWSL()) {
    const batPath = getWSLStartupBatPath();
    if (!batPath) return false;
    try {
      return fs.existsSync(batPath);
    } catch {
      return false;
    }
  }
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
  if (isWSL()) {
    try {
      const batPath = getWSLStartupBatPath();
      const batContent = getWSLBatContent();
      if (!batPath || !batContent) return false;
      fs.writeFileSync(batPath, batContent, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
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
    openAsHidden: true,
    path: process.execPath,
    args: [path.resolve(__dirname, '..')],
  });
  return true;
}

function disableAutoStart() {
  if (isWSL()) {
    try {
      const batPath = getWSLStartupBatPath();
      if (batPath && fs.existsSync(batPath)) {
        fs.unlinkSync(batPath);
      }
      return true;
    } catch {
      return false;
    }
  }
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
