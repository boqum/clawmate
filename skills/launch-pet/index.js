#!/usr/bin/env node
/**
 * "Launch pet" handler logic
 *
 * 1. Detect OS (including WSL)
 * 2. Check if ClawMate is installed
 * 3. If not installed -> install
 * 4. Launch Electron app (WSL -> Windows native)
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * WSL 환경인지 감지 (/proc/version에 "microsoft" 포함 여부)
 */
let _isWSL = null;
function isWSL() {
  if (_isWSL !== null) return _isWSL;
  if (os.platform() !== 'linux') {
    _isWSL = false;
    return false;
  }
  try {
    const procVersion = fs.readFileSync('/proc/version', 'utf-8');
    _isWSL = /microsoft/i.test(procVersion);
  } catch {
    _isWSL = false;
  }
  return _isWSL;
}

/**
 * WSL Linux 경로를 Windows 경로로 변환
 */
function toWindowsPath(linuxPath) {
  return execSync(`wslpath -w "${linuxPath}"`, { encoding: 'utf-8' }).trim();
}

/**
 * WSL 환경에서 Windows 네이티브 Electron으로 실행
 */
function launchWSL(appRoot, log) {
  const winAppRoot = toWindowsPath(appRoot);
  log(`WSL detected. Windows path: ${winAppRoot}`);

  // Windows 측 node_modules 존재 확인 (Linux node_modules와 별도)
  const nodeModulesPath = path.join(appRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    log('Installing dependencies via Windows npm...');
    try {
      execSync(`cmd.exe /c "cd /d ${winAppRoot} && npm.cmd install --omit=dev"`, {
        stdio: 'inherit',
        timeout: 120000,
      });
      log('Dependencies installed!');
    } catch (err) {
      return {
        success: false,
        message: `Dependency installation failed: ${err.message}`,
      };
    }
  }

  // Windows 네이티브 Electron 실행
  const child = spawn('cmd.exe', ['/c', `npx.cmd electron ${winAppRoot}`], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  return null; // 성공 시 null 반환, 호출자가 성공 메시지 생성
}

async function launch(context) {
  const log = context?.log || console.log;
  const platform = os.platform();
  const appRoot = path.resolve(__dirname, '..', '..');

  // WSL 환경: Windows 네이티브 실행
  if (isWSL()) {
    try {
      const result = launchWSL(appRoot, log);
      if (result) return result; // 에러 반환된 경우

      const mode = context?.params?.mode || 'pet';
      const modeName = mode === 'pet' ? 'Clawby' : 'Claw';
      return {
        success: true,
        message: `ClawMate (${modeName}) has appeared on your Windows desktop! 🦞`,
      };
    } catch (err) {
      return {
        success: false,
        message: `WSL launch failed: ${err.message}`,
      };
    }
  }

  // 비WSL: 기존 로직
  const nodeModulesPath = path.join(appRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    log('Installing dependencies...');
    try {
      const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
      execSync(`${npmCmd} install`, {
        cwd: appRoot,
        stdio: 'inherit',
        timeout: 120000,
      });
      log('Dependencies installed!');
    } catch (err) {
      return {
        success: false,
        message: `Dependency installation failed: ${err.message}`,
      };
    }
  }

  // Launch Electron app
  try {
    const electronBin = platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(electronBin, ['electron', appRoot], {
      detached: true,
      stdio: 'ignore',
      cwd: appRoot,
      env: { ...process.env },
    });
    child.unref();

    const mode = context?.params?.mode || 'pet';
    const modeName = mode === 'pet' ? 'Clawby' : 'Claw';

    return {
      success: true,
      message: `ClawMate (${modeName}) has appeared on your desktop! 🦞`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Launch failed: ${err.message}`,
    };
  }
}

// CLI entry point
if (require.main === module) {
  launch().then((result) => {
    console.log(result.message);
    if (!result.success) process.exit(1);
  });
}

module.exports = { execute: launch };
