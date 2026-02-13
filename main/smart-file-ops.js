/**
 * 스마트 파일 조작 시스템
 *
 * 텔레그램 또는 AI 명령으로 파일을 "펫이 직접 나르는" 방식으로 이동.
 * 펫이 파일 위치로 점프 → 집어들기 → 대상 폴더로 이동 → 내려놓기 순서로
 * 애니메이션과 실제 파일시스템 이동을 동시에 수행.
 *
 * 안전장치:
 *   - .exe/.dll/.sys 등 위험 확장자 제외
 *   - 100MB 이상 파일 제외
 *   - 모든 이동을 manifest에 기록 (undo 가능)
 *   - 진행 중 중단 시 이미 이동된 파일은 manifest에 기록되어 복원 가능
 */

const fs = require('fs');
const path = require('path');
const { getDesktopPath } = require('./desktop-path');
const manifest = require('./manifest');
const { AUTO_CATEGORIES } = require('./file-command-parser');

// 안전장치 상수
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const EXCLUDED_EXTS = new Set([
  '.exe', '.dll', '.sys', '.lnk', '.ini', '.bat', '.cmd',
  '.ps1', '.msi', '.scr', '.com', '.pif', '.vbs', '.wsf',
]);

// 파일 이동 간 딜레이 (ms) - 펫 애니메이션에 시간을 줌
const PER_FILE_DELAY = 2500;

/**
 * 파일이 이동 가능한지 검증
 * @param {string} filePath - 파일 전체 경로
 * @returns {{ safe: boolean, reason?: string }}
 */
function validateFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) {
    return { safe: false, reason: `보호된 파일 유형 (${ext})` };
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { safe: false, reason: `파일 크기 초과 (${Math.round(stat.size / 1024 / 1024)}MB > 100MB)` };
    }
    if (!stat.isFile()) {
      return { safe: false, reason: '파일이 아님' };
    }
  } catch {
    return { safe: false, reason: '파일 접근 불가' };
  }

  return { safe: true };
}

/**
 * 소스 디렉토리에서 필터 조건에 맞는 파일 목록 조회
 * @param {string} sourceDir - 소스 디렉토리 경로
 * @param {string} filter - 확장자 필터 (예: ".md", "*")
 * @returns {Array<{ name: string, path: string, ext: string, size: number }>}
 */
function listFilteredFiles(sourceDir, filter) {
  try {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;

      const filePath = path.join(sourceDir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      // 확장자 필터 적용
      if (filter !== '*' && ext !== filter.toLowerCase()) continue;

      // 안전 검증
      const validation = validateFile(filePath);
      if (!validation.safe) continue;

      try {
        const stat = fs.statSync(filePath);
        files.push({
          name: entry.name,
          path: filePath,
          ext,
          size: stat.size,
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
 * 자동 분류 모드: 파일을 확장자별 폴더로 분류
 * @param {string} sourceDir - 소스 디렉토리
 * @returns {Map<string, Array>} 카테고리명 → 파일 목록
 */
function categorizeFiles(sourceDir) {
  const files = listFilteredFiles(sourceDir, '*');
  const categories = new Map();

  for (const file of files) {
    const category = AUTO_CATEGORIES[file.ext] || '기타';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category).push(file);
  }

  return categories;
}

/**
 * 대상 폴더 생성 (없으면)
 * @param {string} sourceDir - 소스 디렉토리 (대상 폴더의 부모)
 * @param {string} targetName - 대상 폴더 이름
 * @returns {string} 대상 폴더 전체 경로
 */
function ensureTargetDir(sourceDir, targetName) {
  const targetDir = path.join(sourceDir, targetName);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

/**
 * 단일 파일 이동 실행 + manifest 기록
 * @param {string} filePath - 원본 파일 경로
 * @param {string} targetDir - 대상 디렉토리
 * @returns {{ success: boolean, newPath?: string, error?: string, moveId?: string }}
 */
function moveFileToTarget(filePath, targetDir) {
  const fileName = path.basename(filePath);
  let newPath = path.join(targetDir, fileName);

  // 동일 이름 파일이 있으면 넘버링
  if (fs.existsSync(newPath)) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let counter = 1;
    while (fs.existsSync(newPath)) {
      newPath = path.join(targetDir, `${base} (${counter})${ext}`);
      counter++;
    }
  }

  try {
    fs.renameSync(filePath, newPath);

    // manifest에 기록 (undo 지원)
    const entry = manifest.addEntry({
      fileName,
      originalPath: filePath,
      newPath,
      targetDir,
      action: 'smart_move',
    });

    return { success: true, newPath, moveId: entry.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 스마트 파일 이동 되돌리기 (단일)
 * @param {string} moveId - manifest 엔트리 ID
 * @returns {{ success: boolean, error?: string }}
 */
function undoSmartMove(moveId) {
  const entries = manifest.getAll();
  const entry = entries.find(e => e.id === moveId && e.action === 'smart_move');
  if (!entry) {
    return { success: false, error: '이동 기록을 찾을 수 없음' };
  }
  if (entry.restored) {
    return { success: false, error: '이미 복원된 항목' };
  }

  try {
    // 새 위치에서 원래 위치로 되돌리기
    if (fs.existsSync(entry.newPath)) {
      // 원래 위치에 같은 이름 파일이 있으면 충돌 방지
      if (fs.existsSync(entry.originalPath)) {
        return { success: false, error: '원래 위치에 동일 이름 파일이 존재' };
      }
      fs.renameSync(entry.newPath, entry.originalPath);
      manifest.markRestored(moveId);
      return { success: true };
    }
    return { success: false, error: '이동된 파일을 찾을 수 없음' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 스마트 파일 이동 전체 되돌리기
 * @returns {{ success: boolean, restoredCount: number, errors: string[] }}
 */
function undoAllSmartMoves() {
  const entries = manifest.getAll();
  const smartMoves = entries.filter(e => e.action === 'smart_move' && !e.restored);
  let restoredCount = 0;
  const errors = [];

  // 최신 이동부터 역순으로 복원
  for (const entry of smartMoves.reverse()) {
    const result = undoSmartMove(entry.id);
    if (result.success) {
      restoredCount++;
    } else {
      errors.push(`${entry.fileName}: ${result.error}`);
    }
  }

  return { success: true, restoredCount, errors };
}

/**
 * 스마트 파일 조작 실행 (전체 흐름)
 *
 * 콜백 함수를 통해 펫 애니메이션을 제어하면서 파일을 순차적으로 이동.
 *
 * @param {object} command - 파싱된 파일 명령
 *   - source: 소스 디렉토리 경로
 *   - filter: 확장자 필터 (예: ".md", "*")
 *   - target: 대상 폴더 이름 또는 "auto"
 *   - autoCategory: 자동 분류 여부
 * @param {object} callbacks - 펫 애니메이션 콜백
 *   - onStart(totalFiles): 작업 시작 시
 *   - onPickUp(fileName, index): 파일 집어들 때
 *   - onDrop(fileName, targetName, index): 파일 내려놓을 때
 *   - onComplete(result): 작업 완료 시
 *   - onError(error): 오류 발생 시
 * @returns {Promise<{ success: boolean, movedCount: number, errors: string[], moveIds: string[] }>}
 */
async function executeSmartFileOp(command, callbacks = {}) {
  const { source, filter, target, autoCategory } = command;

  try {
    // 자동 분류 모드
    if (autoCategory) {
      return await _executeAutoCategory(source, callbacks);
    }

    // 특정 대상 폴더로 이동
    return await _executeTargetMove(source, filter, target, callbacks);
  } catch (err) {
    if (callbacks.onError) callbacks.onError(err.message);
    return { success: false, movedCount: 0, errors: [err.message], moveIds: [] };
  }
}

/**
 * 자동 분류 실행
 */
async function _executeAutoCategory(sourceDir, callbacks) {
  const categories = categorizeFiles(sourceDir);
  let totalFiles = 0;
  for (const files of categories.values()) {
    totalFiles += files.length;
  }

  if (totalFiles === 0) {
    if (callbacks.onComplete) {
      callbacks.onComplete({ success: true, movedCount: 0, errors: [], moveIds: [] });
    }
    return { success: true, movedCount: 0, errors: [], moveIds: [] };
  }

  if (callbacks.onStart) callbacks.onStart(totalFiles);

  let movedCount = 0;
  const errors = [];
  const moveIds = [];
  let fileIndex = 0;

  for (const [category, files] of categories) {
    // "기타" 카테고리에 파일이 적으면 건너뜀
    if (category === '기타' && files.length <= 2) continue;

    const targetDir = ensureTargetDir(sourceDir, category);

    for (const file of files) {
      if (callbacks.onPickUp) callbacks.onPickUp(file.name, fileIndex);
      await _sleep(PER_FILE_DELAY / 2);

      const result = moveFileToTarget(file.path, targetDir);
      if (result.success) {
        movedCount++;
        moveIds.push(result.moveId);
        if (callbacks.onDrop) callbacks.onDrop(file.name, category, fileIndex);
      } else {
        errors.push(`${file.name}: ${result.error}`);
      }

      fileIndex++;
      await _sleep(PER_FILE_DELAY / 2);
    }
  }

  const finalResult = { success: true, movedCount, errors, moveIds };
  if (callbacks.onComplete) callbacks.onComplete(finalResult);
  return finalResult;
}

/**
 * 특정 대상 폴더로 이동 실행
 */
async function _executeTargetMove(sourceDir, filter, targetName, callbacks) {
  const files = listFilteredFiles(sourceDir, filter);

  if (files.length === 0) {
    if (callbacks.onComplete) {
      callbacks.onComplete({ success: true, movedCount: 0, errors: [], moveIds: [] });
    }
    return { success: true, movedCount: 0, errors: [], moveIds: [] };
  }

  if (callbacks.onStart) callbacks.onStart(files.length);

  const targetDir = ensureTargetDir(sourceDir, targetName);
  let movedCount = 0;
  const errors = [];
  const moveIds = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (callbacks.onPickUp) callbacks.onPickUp(file.name, i);
    await _sleep(PER_FILE_DELAY / 2);

    const result = moveFileToTarget(file.path, targetDir);
    if (result.success) {
      movedCount++;
      moveIds.push(result.moveId);
      if (callbacks.onDrop) callbacks.onDrop(file.name, targetName, i);
    } else {
      errors.push(`${file.name}: ${result.error}`);
    }

    await _sleep(PER_FILE_DELAY / 2);
  }

  const finalResult = { success: true, movedCount, errors, moveIds };
  if (callbacks.onComplete) callbacks.onComplete(finalResult);
  return finalResult;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  executeSmartFileOp,
  listFilteredFiles,
  categorizeFiles,
  validateFile,
  moveFileToTarget,
  undoSmartMove,
  undoAllSmartMoves,
  ensureTargetDir,
};
