/**
 * 시스템 시작 시 ClawMate 자동 실행 등록
 *
 * Windows: 레지스트리 Run 키
 * macOS: LaunchAgent plist
 * Linux: ~/.config/autostart/ 디렉토리에 .desktop 파일 생성
 *
 * OpenClaw이 나중에 켜져도, ClawMate는 이미 돌고 있어서 바로 연결됨.
 * ClawMate가 먼저 혼자 자율 모드로 돌다가 → OpenClaw 연결되면 AI 모드 전환.
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
    'Comment=OpenClaw Desktop Pet',
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
    openAsHidden: true,  // 창 없이 백그라운드 시작
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
