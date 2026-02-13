const os = require('os');
const path = require('path');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const platform = os.platform();

let _isWSL = null;
function isWSL() {
  if (_isWSL !== null) return _isWSL;
  if (platform !== 'linux') {
    _isWSL = false;
    return false;
  }
  try {
    const procVersion = require('fs').readFileSync('/proc/version', 'utf-8');
    _isWSL = /microsoft/i.test(procVersion);
  } catch {
    _isWSL = false;
  }
  return _isWSL;
}

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
  if (platform === 'linux') {
    try {
      const result = execSync('xdg-user-dir DESKTOP', {
        encoding: 'utf-8',
      }).trim();
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

function isLinux() {
  return platform === 'linux';
}

/**
 * Get position/size info of open windows per OS
 * Return format: [{ id, title, x, y, width, height }]
 * Returns empty array on failure (safe fallback)
 */
async function getWindowPositions() {
  if (platform === 'win32') {
    return getWindowPositionsWindows();
  } else if (platform === 'darwin') {
    return getWindowPositionsMac();
  } else {
    return getWindowPositionsLinux();
  }
}

/**
 * Windows: Get visible window list + position/size via PowerShell
 * Calls Win32 API (GetWindowRect) via Add-Type
 */
async function getWindowPositionsWindows() {
  try {
    // Access Win32 API via inline C# compilation in PowerShell
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;
public class WinInfo {
  [DllImport("user32.dll")]
  static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static string GetWindows() {
    var results = new List<string>();
    foreach (var p in Process.GetProcesses()) {
      if (p.MainWindowHandle == IntPtr.Zero) continue;
      if (!IsWindowVisible(p.MainWindowHandle)) continue;
      if (string.IsNullOrEmpty(p.MainWindowTitle)) continue;
      RECT r;
      GetWindowRect(p.MainWindowHandle, out r);
      int w = r.Right - r.Left;
      int h = r.Bottom - r.Top;
      if (w < 50 || h < 50) continue;
      results.Add(p.MainWindowTitle + "|" + r.Left + "|" + r.Top + "|" + w + "|" + h);
    }
    return string.Join("\\n", results);
  }
}
"@
[WinInfo]::GetWindows()
`.trim();

    // Pass PowerShell script via stdin without temp files
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command -`,
      { input: psScript, timeout: 5000, encoding: 'utf-8' }
    );

    const result = (stdout || '').trim();
    if (!result) return [];

    return result.split('\n').filter(Boolean).map((line, i) => {
      const parts = line.split('|');
      if (parts.length < 5) return null;
      const [title, left, top, width, height] = parts;
      return {
        id: `win_${i}`,
        title: title.trim(),
        x: parseInt(left, 10) || 0,
        y: parseInt(top, 10) || 0,
        width: parseInt(width, 10) || 0,
        height: parseInt(height, 10) || 0,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * macOS: Get visible window positions/sizes via AppleScript
 */
async function getWindowPositionsMac() {
  try {
    // Collect window info of visible processes via AppleScript
    const script = `
tell application "System Events"
  set output to ""
  repeat with proc in (processes whose visible is true)
    try
      set procName to name of proc
      repeat with w in windows of proc
        try
          set {x, y} to position of w
          set {ww, hh} to size of w
          set output to output & procName & "|" & x & "|" & y & "|" & ww & "|" & hh & "\\n"
        end try
      end repeat
    end try
  end repeat
  return output
end tell
`.trim();

    const { stdout } = await execAsync(
      `osascript -e '${script.replace(/'/g, "'\\''")}'`,
      { timeout: 5000, encoding: 'utf-8' }
    );

    const result = (stdout || '').trim();
    if (!result) return [];

    return result.split('\n').filter(Boolean).map((line, i) => {
      const parts = line.split('|');
      if (parts.length < 5) return null;
      const [title, x, y, width, height] = parts;
      return {
        id: `win_${i}`,
        title: title.trim(),
        x: parseInt(x, 10) || 0,
        y: parseInt(y, 10) || 0,
        width: parseInt(width, 10) || 0,
        height: parseInt(height, 10) || 0,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Linux: Get window positions/sizes via wmctrl -l -G
 * Returns empty array if wmctrl is not installed
 */
async function getWindowPositionsLinux() {
  try {
    const { stdout } = await execAsync('wmctrl -l -G', {
      timeout: 5000,
      encoding: 'utf-8',
    });

    const result = (stdout || '').trim();
    if (!result) return [];

    // wmctrl -l -G output format:
    // 0x02000003  0 0    0    1920 1080 hostname Desktop
    // ID          desktop x  y  width height hostname title
    return result.split('\n').filter(Boolean).map((line, i) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) return null;
      const x = parseInt(parts[2], 10) || 0;
      const y = parseInt(parts[3], 10) || 0;
      const width = parseInt(parts[4], 10) || 0;
      const height = parseInt(parts[5], 10) || 0;
      // Everything after hostname is the title (may contain spaces)
      const title = parts.slice(7).join(' ');
      if (width < 50 || height < 50) return null;
      return { id: `win_${i}`, title, x, y, width, height };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Return title of currently focused (foreground) window
 * Detects browser tab titles so the pet can comment on them
 */
async function getActiveWindowTitle() {
  try {
    if (platform === 'win32') {
      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FGWin {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  public static string Get() {
    IntPtr h = GetForegroundWindow();
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    return sb.ToString();
  }
}
"@
[FGWin]::Get()
`.trim();
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command -`,
        { input: psScript, timeout: 3000, encoding: 'utf-8' }
      );
      return (stdout || '').trim();
    } else if (platform === 'darwin') {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get name of first window of (first process whose frontmost is true)'`,
        { timeout: 3000, encoding: 'utf-8' }
      );
      return (stdout || '').trim();
    } else {
      const { stdout } = await execAsync('xdotool getactivewindow getwindowname', {
        timeout: 3000, encoding: 'utf-8',
      });
      return (stdout || '').trim();
    }
  } catch {
    return '';
  }
}

module.exports = { getDesktopPath, getTrayIconExt, isWindows, isMac, isLinux, isWSL, platform, getWindowPositions, getActiveWindowTitle };
