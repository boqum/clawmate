const fs = require('fs');
const path = require('path');
const { getDesktopPath } = require('./desktop-path');
const manifest = require('./manifest');

/**
 * 바탕화면 파일 이동 시스템 (안전장치 포함)
 *
 * 안전 규칙:
 * - 세션당 최대 3개 파일만 이동
 * - 이동 간 최소 5분 쿨다운
 * - 위험한 확장자 제외
 * - 100MB 이상 파일 제외
 * - 바탕화면 폴더 내에서만 위치 변경
 */

const MAX_FILES_PER_SESSION = 3;
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const EXCLUDED_EXTS = new Set([
  '.exe', '.dll', '.sys', '.lnk', '.ini', '.bat', '.cmd',
  '.ps1', '.msi', '.scr', '.com', '.pif',
]);

let sessionMoveCount = 0;
let lastMoveTime = 0;

/**
 * 바탕화면 파일 목록 가져오기 (안전한 파일만)
 */
async function getDesktopFiles() {
  const desktop = getDesktopPath();
  try {
    const entries = await fs.promises.readdir(desktop, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (EXCLUDED_EXTS.has(ext)) continue;
      if (entry.name.startsWith('.')) continue;

      try {
        const stat = await fs.promises.stat(path.join(desktop, entry.name));
        if (stat.size > MAX_FILE_SIZE) continue;
        files.push({
          name: entry.name,
          size: stat.size,
          ext: ext,
        });
      } catch {
        continue;
      }
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * 바탕화면 내에서 파일 이름 변경(위치 변경 시뮬레이션)
 * 실제로는 바탕화면 폴더 안에서만 이동 가능
 * newPosition은 렌더러에서 전달한 좌표 (로그용)
 */
async function moveFile(fileName, newPosition) {
  // 안전장치 체크
  if (sessionMoveCount >= MAX_FILES_PER_SESSION) {
    return { success: false, error: '세션당 이동 한도(3개) 초과' };
  }

  const now = Date.now();
  if (now - lastMoveTime < COOLDOWN_MS && lastMoveTime > 0) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - lastMoveTime)) / 1000);
    return { success: false, error: `쿨다운 중 (${remaining}초 남음)` };
  }

  const desktop = getDesktopPath();
  const filePath = path.join(desktop, fileName);

  // 파일 존재 확인
  try {
    await fs.promises.access(filePath);
  } catch {
    return { success: false, error: '파일을 찾을 수 없음' };
  }

  // 확장자 체크
  const ext = path.extname(fileName).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) {
    return { success: false, error: '보호된 파일 유형' };
  }

  // 크기 체크
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { success: false, error: '파일 크기 초과 (100MB)' };
    }
  } catch {
    return { success: false, error: '파일 정보 읽기 실패' };
  }

  // 이동 기록 (바탕화면 내부 이동이므로 실제 파일시스템 위치는 동일)
  const entry = manifest.addEntry({
    fileName,
    originalPath: filePath,
    position: newPosition,
    action: 'move',
  });

  sessionMoveCount++;
  lastMoveTime = now;

  return { success: true, moveId: entry.id };
}

/**
 * 단일 파일 이동 되돌리기
 */
async function undoFileMove(moveId) {
  const entry = manifest.markRestored(moveId);
  if (!entry) {
    return { success: false, error: '이동 기록을 찾을 수 없음' };
  }
  // 실제 파일 위치는 바탕화면 내에서만 변경되므로 기록만 업데이트
  return { success: true };
}

/**
 * 모든 파일 이동 되돌리기
 */
async function undoAllMoves() {
  const count = manifest.markAllRestored();
  return { success: true, restoredCount: count };
}

/**
 * 파일 이동 이력 가져오기
 */
async function getFileManifest() {
  return manifest.getAll();
}

module.exports = { getDesktopFiles, moveFile, undoFileMove, undoAllMoves, getFileManifest };
