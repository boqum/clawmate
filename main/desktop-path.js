const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

/**
 * OS별 바탕화면 경로 탐지
 * Windows: PowerShell로 정확한 경로 탐지 (OneDrive 등 대응)
 * macOS: ~/Desktop
 */
function getDesktopPath() {
  const platform = os.platform();

  if (platform === 'win32') {
    try {
      const result = execSync(
        'powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"',
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (result && result.length > 0) return result;
    } catch {
      // PowerShell 실패 시 폴백
    }

    // 환경 변수 기반 폴백
    const userProfile = process.env.USERPROFILE || os.homedir();
    return path.join(userProfile, 'Desktop');
  }

  // macOS / Linux
  return path.join(os.homedir(), 'Desktop');
}

module.exports = { getDesktopPath };
