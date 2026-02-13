const os = require('os');
const path = require('path');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

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
 * OS별 열린 윈도우의 위치/크기 정보를 가져옴
 * 반환 형식: [{ id, title, x, y, width, height }]
 * 실패 시 빈 배열 반환 (안전한 폴백)
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
 * Windows: PowerShell로 보이는 윈도우 목록 + 위치/크기 조회
 * Add-Type으로 Win32 API(GetWindowRect) 호출
 */
async function getWindowPositionsWindows() {
  try {
    // PowerShell에서 C# 인라인 컴파일로 Win32 API 접근
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

    // PowerShell 스크립트를 임시 파일 없이 stdin으로 전달
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
 * macOS: AppleScript로 보이는 윈도우 위치/크기 조회
 */
async function getWindowPositionsMac() {
  try {
    // AppleScript로 보이는 프로세스의 윈도우 정보 수집
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
 * Linux: wmctrl -l -G 로 윈도우 위치/크기 조회
 * wmctrl 미설치 시 빈 배열 반환
 */
async function getWindowPositionsLinux() {
  try {
    const { stdout } = await execAsync('wmctrl -l -G', {
      timeout: 5000,
      encoding: 'utf-8',
    });

    const result = (stdout || '').trim();
    if (!result) return [];

    // wmctrl -l -G 출력 형식:
    // 0x02000003  0 0    0    1920 1080 hostname 데스크톱
    // ID          desktop x  y  width height hostname title
    return result.split('\n').filter(Boolean).map((line, i) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) return null;
      const x = parseInt(parts[2], 10) || 0;
      const y = parseInt(parts[3], 10) || 0;
      const width = parseInt(parts[4], 10) || 0;
      const height = parseInt(parts[5], 10) || 0;
      // hostname 이후가 타이틀 (공백 포함 가능)
      const title = parts.slice(7).join(' ');
      if (width < 50 || height < 50) return null;
      return { id: `win_${i}`, title, x, y, width, height };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 현재 포커스된 (최상위) 윈도우의 제목 반환
 * 브라우저 탭 제목을 감지하여 펫이 참견할 수 있게 함
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

module.exports = { getDesktopPath, getTrayIconExt, isWindows, isMac, isLinux, platform, getWindowPositions, getActiveWindowTitle };
