const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Detect desktop path per OS
 * Windows: Accurate path detection via PowerShell (handles OneDrive, etc.)
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
      // Fallback on PowerShell failure
    }

    // Environment variable based fallback
    const userProfile = process.env.USERPROFILE || os.homedir();
    return path.join(userProfile, 'Desktop');
  }

  // macOS / Linux
  return path.join(os.homedir(), 'Desktop');
}

module.exports = { getDesktopPath };
