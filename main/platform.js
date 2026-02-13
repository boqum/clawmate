const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const platform = os.platform();

function getDesktopPath() {
  if (platform === 'win32') {
    try {
      const result = execSync(
        'powershell -Command "[Environment]::GetFolderPath(\'Desktop\')"',
        { encoding: 'utf-8' }
      ).trim();
      if (result) return result;
    } catch {}
    return path.join(os.homedir(), 'Desktop');
  }
  return path.join(os.homedir(), 'Desktop');
}

function getTrayIconExt() {
  return platform === 'win32' ? '.ico' : '.png';
}

function isWindows() {
  return platform === 'win32';
}

function isMac() {
  return platform === 'darwin';
}

module.exports = { getDesktopPath, getTrayIconExt, isWindows, isMac, platform };
