/**
 * 시스템 시작 시 ClawMate 자동 실행 등록
 *
 * Windows: 레지스트리 Run 키
 * macOS: LaunchAgent plist
 *
 * OpenClaw이 나중에 켜져도, ClawMate는 이미 돌고 있어서 바로 연결됨.
 * ClawMate가 먼저 혼자 자율 모드로 돌다가 → OpenClaw 연결되면 AI 모드 전환.
 */
const { app } = require('electron');
const path = require('path');
const os = require('os');

function isAutoStartEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function enableAutoStart() {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,  // 창 없이 백그라운드 시작
    path: process.execPath,
    args: [path.resolve(__dirname, '..')],
  });
  return true;
}

function disableAutoStart() {
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
