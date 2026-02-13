const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * 파일 이동 이력 관리 (Undo 지원)
 * 모든 파일 이동을 기록하고, 복원 가능하게 관리
 */
const MANIFEST_FILE = () => path.join(app.getPath('userData'), 'file-manifest.json');

function loadManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_FILE(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveManifest(manifest) {
  fs.mkdirSync(path.dirname(MANIFEST_FILE()), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE(), JSON.stringify(manifest, null, 2));
}

function addEntry(entry) {
  const manifest = loadManifest();
  manifest.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    restored: false,
    ...entry,
  });
  saveManifest(manifest);
  return manifest[manifest.length - 1];
}

function markRestored(moveId) {
  const manifest = loadManifest();
  const entry = manifest.find(m => m.id === moveId);
  if (entry) {
    entry.restored = true;
    entry.restoredAt = new Date().toISOString();
    saveManifest(manifest);
  }
  return entry;
}

function markAllRestored() {
  const manifest = loadManifest();
  let count = 0;
  manifest.forEach(entry => {
    if (!entry.restored) {
      entry.restored = true;
      entry.restoredAt = new Date().toISOString();
      count++;
    }
  });
  saveManifest(manifest);
  return count;
}

function getPendingRestores() {
  return loadManifest().filter(m => !m.restored);
}

function getAll() {
  return loadManifest();
}

module.exports = { addEntry, markRestored, markAllRestored, getPendingRestores, getAll };
