/**
 * Smart File Operation System
 *
 * Moves files via Telegram or AI commands in a "pet carries them" fashion.
 * Pet jumps to file location -> picks up -> moves to target folder -> drops off,
 * performing animation and actual filesystem move simultaneously.
 *
 * Safety measures:
 *   - Excludes dangerous extensions like .exe/.dll/.sys
 *   - Excludes files over 100MB
 *   - Records all moves in manifest (undo supported)
 *   - Files already moved during interruption are recorded in manifest for restoration
 */

const fs = require('fs');
const path = require('path');
const { getDesktopPath } = require('./desktop-path');
const manifest = require('./manifest');
const { AUTO_CATEGORIES } = require('./file-command-parser');

// Safety constants
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const EXCLUDED_EXTS = new Set([
  '.exe', '.dll', '.sys', '.lnk', '.ini', '.bat', '.cmd',
  '.ps1', '.msi', '.scr', '.com', '.pif', '.vbs', '.wsf',
]);

// Delay between file moves (ms) - gives time for pet animation
const PER_FILE_DELAY = 2500;

/**
 * Validate whether file can be moved
 * @param {string} filePath - Full file path
 * @returns {{ safe: boolean, reason?: string }}
 */
function validateFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (EXCLUDED_EXTS.has(ext)) {
    return { safe: false, reason: `Protected file type (${ext})` };
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return { safe: false, reason: `File size exceeded (${Math.round(stat.size / 1024 / 1024)}MB > 100MB)` };
    }
    if (!stat.isFile()) {
      return { safe: false, reason: 'Not a file' };
    }
  } catch {
    return { safe: false, reason: 'File inaccessible' };
  }

  return { safe: true };
}

/**
 * List files matching filter criteria in source directory
 * @param {string} sourceDir - Source directory path
 * @param {string} filter - Extension filter (e.g., ".md", "*")
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

      // Apply extension filter
      if (filter !== '*' && ext !== filter.toLowerCase()) continue;

      // Safety validation
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
 * Auto-categorize mode: sort files into folders by extension
 * @param {string} sourceDir - Source directory
 * @returns {Map<string, Array>} Category name -> file list
 */
function categorizeFiles(sourceDir) {
  const files = listFilteredFiles(sourceDir, '*');
  const categories = new Map();

  for (const file of files) {
    const category = AUTO_CATEGORIES[file.ext] || 'Other';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category).push(file);
  }

  return categories;
}

/**
 * Create target folder (if it doesn't exist)
 * @param {string} sourceDir - Source directory (parent of target folder)
 * @param {string} targetName - Target folder name
 * @returns {string} Full path of target folder
 */
function ensureTargetDir(sourceDir, targetName) {
  const targetDir = path.join(sourceDir, targetName);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

/**
 * Execute single file move + record in manifest
 * @param {string} filePath - Original file path
 * @param {string} targetDir - Target directory
 * @returns {{ success: boolean, newPath?: string, error?: string, moveId?: string }}
 */
function moveFileToTarget(filePath, targetDir) {
  const fileName = path.basename(filePath);
  let newPath = path.join(targetDir, fileName);

  // Number files if same name exists
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

    // Record in manifest (undo support)
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
 * Undo smart file move (single)
 * @param {string} moveId - Manifest entry ID
 * @returns {{ success: boolean, error?: string }}
 */
function undoSmartMove(moveId) {
  const entries = manifest.getAll();
  const entry = entries.find(e => e.id === moveId && e.action === 'smart_move');
  if (!entry) {
    return { success: false, error: 'Move record not found' };
  }
  if (entry.restored) {
    return { success: false, error: 'Already restored' };
  }

  try {
    // Restore from new location to original location
    if (fs.existsSync(entry.newPath)) {
      // Prevent conflict if same name file exists at original location
      if (fs.existsSync(entry.originalPath)) {
        return { success: false, error: 'File with same name exists at original location' };
      }
      fs.renameSync(entry.newPath, entry.originalPath);
      manifest.markRestored(moveId);
      return { success: true };
    }
    return { success: false, error: 'Moved file not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Undo all smart file moves
 * @returns {{ success: boolean, restoredCount: number, errors: string[] }}
 */
function undoAllSmartMoves() {
  const entries = manifest.getAll();
  const smartMoves = entries.filter(e => e.action === 'smart_move' && !e.restored);
  let restoredCount = 0;
  const errors = [];

  // Restore in reverse order starting from most recent
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
 * Execute smart file operation (full flow)
 *
 * Sequentially moves files while controlling pet animation via callbacks.
 *
 * @param {object} command - Parsed file command
 *   - source: Source directory path
 *   - filter: Extension filter (e.g., ".md", "*")
 *   - target: Target folder name or "auto"
 *   - autoCategory: Whether to auto-categorize
 * @param {object} callbacks - Pet animation callbacks
 *   - onStart(totalFiles): When operation starts
 *   - onPickUp(fileName, index): When picking up file
 *   - onDrop(fileName, targetName, index): When dropping file
 *   - onComplete(result): When operation completes
 *   - onError(error): When error occurs
 * @returns {Promise<{ success: boolean, movedCount: number, errors: string[], moveIds: string[] }>}
 */
async function executeSmartFileOp(command, callbacks = {}) {
  const { source, filter, target, autoCategory } = command;

  try {
    // Auto-categorize mode
    if (autoCategory) {
      return await _executeAutoCategory(source, callbacks);
    }

    // Move to specific target folder
    return await _executeTargetMove(source, filter, target, callbacks);
  } catch (err) {
    if (callbacks.onError) callbacks.onError(err.message);
    return { success: false, movedCount: 0, errors: [err.message], moveIds: [] };
  }
}

/**
 * Execute auto-categorization
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
    // Skip "Other" category if few files
    if (category === 'Other' && files.length <= 2) continue;

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
 * Execute move to specific target folder
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
