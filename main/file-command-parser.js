/**
 * 파일 조작 명령 파서
 *
 * 한국어/영어 자연어를 파싱하여 파일 조작 의도를 추출한다.
 * 텔레그램 메시지에서 파일 이동, 정리 등의 명령을 감지.
 *
 * 지원 패턴:
 *   - "바탕화면의 .md 파일을 tata 폴더에 넣어줘"
 *   - "스크린샷 폴더에 .png 정리해"
 *   - "바탕화면 정리해"
 *   - "move .txt files to docs folder"
 */

const os = require('os');
const path = require('path');

// 알려진 소스 경로 별칭 (한국어 + 영어)
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

// 행동 명령 키워드 → 액션 매핑
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

// 파일 조작 감지 키워드
const FILE_OP_PATTERNS = [
  // "~의 .ext 파일을 ~폴더에 넣어줘/옮겨줘/이동해"
  /(?:(.+?)(?:의|에서|에 있는)\s+)?([.\w*]+)\s*파일(?:을|들을)?\s+(.+?)(?:폴더)?(?:에|으로)\s*(?:넣어|옮겨|이동|정리|보내)/,
  // "~폴더에 .ext 정리해"
  /(.+?)(?:폴더)?(?:에|으로)\s+([.\w*]+)\s*(?:파일\s*)?(?:정리|넣어|옮겨|이동)/,
  // "바탕화면 정리해"
  /(.+?)\s*(?:정리|청소|깔끔하게)\s*(?:해|해줘|하자|좀)/,
  // 영어: "move .ext files to folder"
  /move\s+([.\w*]+)\s+files?\s+(?:to|into)\s+(\S+)/i,
  // 영어: "clean up desktop"
  /clean\s*(?:up)?\s+(\S+)/i,
  // 영어: "organize desktop"
  /organize\s+(\S+)/i,
];

/**
 * 데스크톱 경로 가져오기 (file-ops와 동일 로직)
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
 * 소스 별칭을 실제 경로로 변환
 * @param {string} alias - 소스 별칭 (예: "바탕화면")
 * @returns {string|null} 실제 경로 또는 null
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
 * 자동 분류 확장자 → 폴더명 매핑
 * "바탕화면 정리해" 같은 범용 명령에서 사용
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
 * 메시지에서 행동 명령을 감지
 * @param {string} text - 사용자 메시지
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
 * 메시지에서 파일 조작 명령을 감지
 * @param {string} text - 사용자 메시지
 * @returns {{ type: 'smart_file_op', source: string, filter: string, target: string, autoCategory: boolean }|null}
 */
function parseFileCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // 패턴 1: "바탕화면의 .md 파일을 tata 폴더에 넣어줘"
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

  // 패턴 2: "스크린샷 폴더에 .png 정리해"
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

  // 패턴 3: "바탕화면 정리해" (자동 분류)
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

  // 패턴 4 (영어): "move .txt files to docs"
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

  // 패턴 5 (영어): "clean up desktop" / "organize desktop"
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
 * 캐릭터 변경 명령 감지
 * @param {string} text - 사용자 메시지
 * @returns {{ type: 'character_change', concept: string }|null}
 */
function parseCharacterCommand(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // 한국어 캐릭터 변경 패턴
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

  // 영어 캐릭터 변경 패턴
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
 * 메시지 종합 파싱: 캐릭터 변경 > 파일 조작 > 행동 명령 > 일반 대화 순으로 판별
 * @param {string} text - 사용자 메시지
 * @returns {{ type: string, ... }}
 */
function parseMessage(text) {
  // 0순위: 캐릭터 변경 명령
  const charCmd = parseCharacterCommand(text);
  if (charCmd) return charCmd;

  // 1순위: 파일 조작 명령
  const fileCmd = parseFileCommand(text);
  if (fileCmd) return fileCmd;

  // 2순위: 행동 명령
  const actionCmd = parseActionCommand(text);
  if (actionCmd) return actionCmd;

  // 3순위: 일반 대화 (speak)
  return { type: 'speak', text };
}

module.exports = {
  parseMessage,
  parseFileCommand,
  parseActionCommand,
  parseCharacterCommand,
  resolveSource,
  AUTO_CATEGORIES,
};
