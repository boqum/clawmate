const fs = require('fs');
const path = require('path');
const { getDesktopPath } = require('./desktop-path');
const manifest = require('./manifest');

/**
 * Desktop file move system (with safety measures)
 *
 * Safety rules:
 * - Max 3 files moved per session
 * - Min 5 minute cooldown between moves
 * - Dangerous extensions excluded
 * - Files over 100MB excluded
 * - Position changes only within desktop folder
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
 * Get desktop file list (safe files only)
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
 * Rename file on desktop (simulates position change)
 * Actually only moves within desktop folder
 * newPosition is coordinates from renderer (for logging)
 */
async function moveFile(fileName, newPosition) {
  // Safety check
  if (sessionMoveCount >= MAX_FILES_PER_SESSION) {
    return { success: false, error: 'Session move limit (3) exceeded' };
  }

  const now = Date.now();
  if (now - lastMoveTime < COOLDOWN_MS && lastMoveTime > 0) {
    const remaining = Math.ceil((COOLDOWN_MS - (now - lastMoveTime)) / 1000);
    return { success: false, error: `Cooldown active (${remaining}s remaining)` };
  }

  const desktop = getDesktopPath();
  const filePath = path.join(desktop, fileName);

  // Check file exists
  try {
    await fs.promises.access(filePath);
  } catch {
    return { success: false, error: 'File not found' };
  }

  // Extension check
  const ext = path.extname(fileName).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) {
    return { success: false, error: 'Protected file type' };
  }

  // Size check
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File size exceeded (100MB)' };
    }
  } catch {
    return { success: false, error: 'Failed to read file info' };
  }

  // Record move (filesystem location stays the same since it's within desktop)
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
 * Undo single file move
 */
async function undoFileMove(moveId) {
  const entry = manifest.markRestored(moveId);
  if (!entry) {
    return { success: false, error: 'Move record not found' };
  }
  // Only update record since actual file location only changes within desktop
  return { success: true };
}

/**
 * Undo all file moves
 */
async function undoAllMoves() {
  const count = manifest.markAllRestored();
  return { success: true, restoredCount: count };
}

/**
 * Get file move history
 */
async function getFileManifest() {
  return manifest.getAll();
}

module.exports = { getDesktopFiles, moveFile, undoFileMove, undoAllMoves, getFileManifest };
