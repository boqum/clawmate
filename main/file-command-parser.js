/**
 * File operation command parser
 *
 * Parses Korean/English natural language to extract file operation intent.
 * Detects file move, organize, etc. commands from Telegram messages.
 *
 * Supported patterns:
 *   - "바탕화면의 .md 파일을 tata 폴더에 넣어줘" (Korean: move .md files from desktop to tata folder)
 *   - "스크린샷 폴더에 .png 정리해" (Korean: organize .png into screenshots folder)
 *   - "바탕화면 정리해" (Korean: clean up desktop)
 *   - "move .txt files to docs folder"
 */

const os = require('os');
const path = require('path');

// Known source path aliases (Korean + English)
const SOURCE_ALIASES = {
  '바탕화면': () => _getDesktopPath(),
  '데스크탑': () => _getDesktopPath(),
  '데스크톱': () => _getDesktopPath(),
  'desktop': () => _getDesktopPath(),
  '다운로드': () => path.join(os.homedir(), 'Downloads'),
  '다운': () => path.join(os.homedir(), 'Downloads'),
  'downloads': () => path.join(os.homedir(), 'Downloads'),
  '문서': () => path.join(os.homedir(), 'Documents'),
  'documents': () => path.join(os.homedir(), 'Documents'),
};

// Action command keywords -> action mapping
const ACTION_KEYWORDS = {
  '점프': 'jumping',
  '점프해': 'jumping',
  '뛰어': 'jumping',
  'jump': 'jumping',
  '잠자': 'sleeping',
  '자': 'sleeping',
  '잠잘래': 'sleeping',
  'sleep': 'sleeping',
  '춤춰': 'excited',
  '춤': 'excited',
  'dance': 'excited',
  '걸어': 'walking',
  '걸어다녀': 'walking',
  'walk': 'walking',
  '올라가': 'climbing_up',
  '기어올라': 'climbing_up',
  'climb': 'climbing_up',
  '신나': 'excited',
  '신나게': 'excited',
  '놀아': 'playing',
  '놀자': 'playing',
  'play': 'playing',
  '무서워': 'scared',
  '깜짝': 'scared',
  '레펠': 'rappelling',
  '내려와': 'rappelling',
  'rappel': 'rappelling',
};

// File operation detection patterns
const FILE_OP_PATTERNS = [
  // Korean: "~의 .ext 파일을 ~폴더에 넣어줘/옮겨줘/이동해" (move .ext files from ~ to ~ folder)
  /(?:(.+?)(?:의|에서|에 있는)\s+)?([.\w*]+)\s*파일(?:을|들을)?\s+(.+?)(?:폴더)?(?:에|으로)\s*(?:넣어|옮겨|이동|정리|보내)/,
  // Korean: "~폴더에 .ext 정리해" (organize .ext into ~ folder)
  /(.+?)(?:폴더)?(?:에|으로)\s+([.\w*]+)\s*(?:파일\s*)?(?:정리|넣어|옮겨|이동)/,
  // Korean: "바탕화면 정리해" (clean up desktop)
  /(.+?)\s*(?:정리|청소|깔끔하게)\s*(?:해|해줘|하자|좀)/,
  // English: "move .ext files to folder"
  /move\s+([.\w*]+)\s+files?\s+(?:to|into)\s+(\S+)/i,
  // English: "clean up desktop"
  /clean\s*(?:up)?\s+(\S+)/i,
  // English: "organize desktop"
  /organize\s+(\S+)/i,
];

/**
 * Get desktop path (same logic as file-ops)
 */
function _getDesktopPath() {
  try {
    const { getDesktopPath } = require('./desktop-path');
    return getDesktopPath();
  } catch {
    return path.join(os.homedir(), 'Desktop');
  }
}

/**
 * Resolve source alias to actual path
 * @param {string} alias - Source alias (e.g., "desktop", "바탕화면")
 * @returns {string|null} Actual path or null
 */
function resolveSource(alias) {
  if (!alias) return null;
  const trimmed = alias.trim().toLowerCase();
  for (const [key, resolver] of Object.entries(SOURCE_ALIASES)) {
    if (trimmed === key || trimmed.includes(key)) {
      return resolver();
    }
  }
  return null;
}

/**
 * Auto-categorize extension -> folder name mapping
 * Used in generic commands like "clean up desktop"
 */
const AUTO_CATEGORIES = {
  '.png': '이미지',
  '.jpg': '이미지',
  '.jpeg': '이미지',
  '.gif': '이미지',
  '.bmp': '이미지',
  '.webp': '이미지',
  '.svg': '이미지',
  '.pdf': '문서',
  '.doc': '문서',
  '.docx': '문서',
  '.xlsx': '문서',
  '.xls': '문서',
  '.pptx': '문서',
  '.ppt': '문서',
  '.txt': '문서',
  '.hwp': '문서',
  '.md': '문서',
  '.zip': '압축파일',
  '.rar': '압축파일',
  '.7z': '압축파일',
  '.tar': '압축파일',
  '.gz': '압축파일',
  '.mp3': '음악',
  '.wav': '음악',
  '.flac': '음악',
  '.aac': '음악',
  '.mp4': '동영상',
  '.avi': '동영상',
  '.mkv': '동영상',
  '.mov': '동영상',
  '.wmv': '동영상',
};

/**
 * Detect action commands from message
 * @param {string} text - User message
 * @returns {{ type: 'action', action: string }|null}
 */
function parseActionCommand(text) {
  if (!text) return null;
  const trimmed = text.trim().toLowerCase();

  for (const [keyword, action] of Object.entries(ACTION_KEYWORDS)) {
    if (trimmed === keyword || trimmed.includes(keyword)) {
      return { type: 'action', action };
    }
  }
  return null;
}

/**
 * Detect file operation commands from message
 * @param {string} text - User message
 * @returns {{ type: 'smart_file_op', source: string, filter: string, target: string, autoCategory: boolean }|null}
 */
function parseFileCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // Pattern 1: "바탕화면의 .md 파일을 tata 폴더에 넣어줘" (Korean: move files)
  const pattern1 = /(?:(.+?)(?:의|에서|에 있는)\s+)?([.\w*]+)\s*파일(?:을|들을)?\s+(.+?)(?:\s*폴더)?(?:에|으로)\s*(?:넣어|옮겨|이동|정리|보내)/;
  let match = trimmed.match(pattern1);
  if (match) {
    const sourceName = match[1] || '바탕화면';
    const filter = match[2];
    const target = match[3].trim();
    const source = resolveSource(sourceName) || _getDesktopPath();

    return {
      type: 'smart_file_op',
      source,
      filter: filter.startsWith('.') ? filter : `.${filter}`,
      target,
      autoCategory: false,
    };
  }

  // Pattern 2: "스크린샷 폴더에 .png 정리해" (Korean: organize into folder)
  const pattern2 = /(.+?)(?:\s*폴더)?(?:에|으로)\s+([.\w*]+)\s*(?:파일\s*)?(?:정리|넣어|옮겨|이동)/;
  match = trimmed.match(pattern2);
  if (match) {
    const target = match[1].trim();
    const filter = match[2];

    return {
      type: 'smart_file_op',
      source: _getDesktopPath(),
      filter: filter.startsWith('.') ? filter : `.${filter}`,
      target,
      autoCategory: false,
    };
  }

  // Pattern 3: "바탕화면 정리해" (Korean: auto-categorize cleanup)
  const pattern3 = /(.+?)\s*(?:정리|청소|깔끔하게)\s*(?:해|해줘|하자|좀)?$/;
  match = trimmed.match(pattern3);
  if (match) {
    const sourceName = match[1].trim();
    const source = resolveSource(sourceName);
    if (source) {
      return {
        type: 'smart_file_op',
        source,
        filter: '*',
        target: 'auto',
        autoCategory: true,
      };
    }
  }

  // Pattern 4 (English): "move .txt files to docs"
  const pattern4 = /move\s+([.\w*]+)\s+files?\s+(?:to|into)\s+(\S+)/i;
  match = trimmed.match(pattern4);
  if (match) {
    const filter = match[1];
    const target = match[2];

    return {
      type: 'smart_file_op',
      source: _getDesktopPath(),
      filter: filter.startsWith('.') ? filter : `.${filter}`,
      target,
      autoCategory: false,
    };
  }

  // Pattern 5 (English): "clean up desktop" / "organize desktop"
  const pattern5 = /(?:clean\s*(?:up)?|organize)\s+(\S+)/i;
  match = trimmed.match(pattern5);
  if (match) {
    const sourceName = match[1].trim();
    const source = resolveSource(sourceName);
    if (source) {
      return {
        type: 'smart_file_op',
        source,
        filter: '*',
        target: 'auto',
        autoCategory: true,
      };
    }
  }

  return null;
}

/**
 * Detect character change commands
 * @param {string} text - User message
 * @returns {{ type: 'character_change', concept: string }|null}
 */
function parseCharacterCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // Korean character change patterns
  const krPatterns = [
    /(?:캐릭터|펫|모습|외형|외모)(?:를|을)?\s*(.+?)(?:로|으로)\s*(?:바꿔|변경|변신|만들어|바꿀래|바꾸고|바꿔줘|변경해|만들어줘)/,
    /(.+?)(?:로|으로)\s*(?:캐릭터|펫|모습|외형)\s*(?:바꿔|변경|변신|변경해|바꿔줘)/,
    /(.+?)\s*(?:캐릭터|펫)\s*(?:만들어|만들어줘|생성|생성해)/,
    /(.+?)(?:로|으로)\s*변신(?:해|해줘|시켜|시켜줘)?/,
  ];
  for (const pattern of krPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return { type: 'character_change', concept: match[1].trim() };
    }
  }

  // English character change patterns
  const enPatterns = [
    /(?:change|switch|transform)\s+(?:character|pet|look)\s+(?:to|into)\s+(.+)/i,
    /(?:make|create|generate)\s+(?:a\s+)?(.+?)\s+(?:character|pet)/i,
    /(?:become|turn into)\s+(?:a\s+)?(.+)/i,
  ];
  for (const pattern of enPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return { type: 'character_change', concept: match[1].trim() };
    }
  }

  return null;
}

/**
 * Comprehensive message parsing: character change > file operation > action command > general chat
 * @param {string} text - User message
 * @returns {{ type: string, ... }}
 */
/**
 * Detect mode/setting change commands
 * @param {string} text - User message
 * @returns {{ type: 'mode_change', mode: string }|{ type: 'setting', key, value }|null}
 */
function parseSettingCommand(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  // Mode change
  if (/(?:펫|pet)\s*모드/.test(t)) return { type: 'mode_change', mode: 'pet' };
  if (/(?:인카|인격|incarnation|claw)\s*모드/.test(t)) return { type: 'mode_change', mode: 'incarnation' };
  if (/둘\s*다\s*모드|both\s*mode/i.test(t)) return { type: 'mode_change', mode: 'both' };

  // Character preset selection (same as tray presets)
  const presetMap = {
    '파란|파랑|blue': 'blue', '초록|green': 'green', '보라|purple': 'purple',
    '골드|금색|gold': 'gold', '핑크|pink': 'pink',
    '고양이|cat': 'cat', '로봇|robot': 'robot', '유령|ghost': 'ghost', '드래곤|dragon': 'dragon',
    '기본|default|원래': 'default',
  };
  for (const [pattern, preset] of Object.entries(presetMap)) {
    const regex = new RegExp(`(?:${pattern})\\s*(?:캐릭터|색|색상|으로)?\\s*(?:바꿔|변경|골라|선택|해줘)?`);
    if (regex.test(t)) {
      return { type: 'preset_character', preset };
    }
  }

  return null;
}

function parseMessage(text) {
  // Priority 0: setting/mode change commands
  const settingCmd = parseSettingCommand(text);
  if (settingCmd) return settingCmd;

  // Priority 1: character change commands (AI generation)
  const charCmd = parseCharacterCommand(text);
  if (charCmd) return charCmd;

  // Priority 2: file operation commands
  const fileCmd = parseFileCommand(text);
  if (fileCmd) return fileCmd;

  // Priority 3: action commands
  const actionCmd = parseActionCommand(text);
  if (actionCmd) return actionCmd;

  // Priority 4: general chat (speak)
  return { type: 'speak', text };
}

module.exports = {
  parseMessage,
  parseFileCommand,
  parseActionCommand,
  parseCharacterCommand,
  parseSettingCommand,
  resolveSource,
  AUTO_CATEGORIES,
};
