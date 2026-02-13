/**
 * ClawMate plugin entry point
 *
 * Core principle: When AI connects, automatically find and connect to ClawMate.
 *
 * Flow:
 *   Plugin load -> init() auto-called
 *     -> Check if ClawMate is running (ws://127.0.0.1:9320 connection attempt)
 *       -> If running: connect immediately, start acting as AI brain
 *       -> If not running: auto-launch Electron app -> connect
 *     -> If disconnected: auto-reconnect (infinite retry)
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ClawMateConnector } = require('./main/ai-connector');

let connector = null;
let electronProcess = null;
let apiRef = null;

// =====================================================
// Think Loop state management
// =====================================================
let thinkTimer = null;
let lastSpeechTime = 0;
let lastActionTime = 0;
let lastDesktopCheckTime = 0;
let lastScreenCheckTime = 0;
let lastGreetingDate = null;  // Greet only once per day

// Browsing watch system state
let browsingContext = {
  title: '',                   // Current window title
  category: '',                // Category (shopping, video, dev, etc.)
  lastCommentTime: 0,          // Last AI comment timestamp
  screenImage: null,           // Latest screen capture (base64)
  cursorX: 0,                  // Cursor X coordinate
  cursorY: 0,                  // Cursor Y coordinate
};

// Spatial exploration system state
let knownWindows = [];         // Known window list
let lastWindowCheckTime = 0;
let homePosition = null;       // "Home" position (frequently visited)
let explorationHistory = [];   // Exploration position history
let lastExploreTime = 0;
let lastFolderCarryTime = 0;

// =====================================================
// Self-observation system state (Metrics)
// =====================================================
let latestMetrics = null;          // Most recently received metrics data
let metricsHistory = [];           // Last 10 metrics report history
let behaviorAdjustments = {        // Currently applied behavior adjustments
  speechCooldownMultiplier: 1.0,   // Speech bubble frequency control (1.0=default, >1=less, <1=more)
  actionCooldownMultiplier: 1.0,   // Action frequency control
  explorationBias: 0,              // Exploration bias (positive=more, negative=less)
  activityLevel: 1.0,              // Activity level (0.5=calm, 1.0=normal, 1.5=active)
};
let lastMetricsLogTime = 0;        // Last quality report log timestamp

// AI motion generation system state
let lastMotionGenTime = 0;         // Last motion generation timestamp
let generatedMotionCount = 0;      // Number of generated motions

module.exports = {
  id: 'clawmate',
  name: 'ClawMate',
  version: '1.4.0',
  description: 'ClawMate desktop pet - a living body controlled by AI',

  /**
   * Auto-called when plugin loads
   * -> Auto-launch ClawMate + auto-connect
   */
  async init(api) {
    apiRef = api;
    console.log('[ClawMate] Plugin init — starting auto-connect');
    autoConnect();

    // npm package version check (once at start + every 24 hours)
    checkNpmUpdate();
    setInterval(checkNpmUpdate, 24 * 60 * 60 * 1000);
  },

  register(api) {
    apiRef = api;

    // Launch pet (report status if already running)
    api.registerSkill('launch-pet', {
      triggers: [
        'install pet', 'launch pet', 'start pet', 'run pet', 'open pet',
        'clawmate', 'install clawmate', 'launch clawmate', 'start clawmate',
        'desktop pet',
      ],
      description: 'Launch ClawMate desktop pet and connect to AI',
      execute: async () => {
        if (connector && connector.connected) {
          connector.speak('Already here!');
          connector.action('excited');
          return { message: 'ClawMate already running + AI connected!' };
        }
        await ensureRunningAndConnected();
        return { message: 'ClawMate launched + AI connected!' };
      },
    });

    // Speak through pet
    api.registerSkill('pet-speak', {
      triggers: ['tell pet', 'say to pet', 'pet speak'],
      description: 'Deliver a message to the user through the pet',
      execute: async (context) => {
        if (!connector || !connector.connected) {
          return { message: 'ClawMate not connected. Try again shortly...' };
        }
        const text = context.params?.text || context.input;
        connector.speak(text);
        return { message: `Pet says: "${text}"` };
      },
    });

    // Pet action control
    api.registerSkill('pet-action', {
      triggers: ['pet action'],
      description: 'Directly control the pet\'s actions',
      execute: async (context) => {
        if (!connector || !connector.connected) return { message: 'Waiting for connection...' };
        const action = context.params?.action || 'excited';
        connector.action(action);
        return { message: `Pet action: ${action}` };
      },
    });

    // AI comprehensive decision-making
    api.registerSkill('pet-decide', {
      triggers: [],
      description: 'AI decides the pet\'s comprehensive behavior',
      execute: async (context) => {
        if (!connector || !connector.connected) return;
        connector.decide(context.params);
      },
    });

    // Smart file organization (can be triggered from Telegram)
    api.registerSkill('pet-file-organize', {
      triggers: [
        'organize desktop', 'clean desktop', 'move files',
        'tidy up desktop', 'sort files',
      ],
      description: 'Pet organizes desktop files',
      execute: async (context) => {
        if (!connector || !connector.connected) {
          return { message: 'ClawMate not connected.' };
        }
        const text = context.params?.text || context.input;
        const { parseMessage } = require('./main/file-command-parser');
        const parsed = parseMessage(text);

        if (parsed.type === 'smart_file_op') {
          // Forward smart_file_op command to Electron side via connector
          connector._send('smart_file_op', {
            command: parsed,
            fromPlugin: true,
          });
          return { message: `File organization started: ${text}` };
        }

        return { message: 'Could not understand the file organization command.' };
      },
    });
  },

  /**
   * Cleanup when plugin is destroyed
   */
  async destroy() {
    console.log('[ClawMate] Plugin cleanup');
    stopThinkLoop();
    if (connector) {
      connector.disconnect();
      connector = null;
    }
    // Do not terminate Electron app — pet continues living in autonomous mode
  },
};

// =====================================================
// Auto-connect system
// =====================================================

/**
 * Auto-find/launch/connect ClawMate on plugin start
 * Infinite retry — always maintain connection as long as ClawMate is alive
 */
async function autoConnect() {
  // Step 1: Try connecting to already running ClawMate
  const connected = await tryConnect();
  if (connected) {
    console.log('[ClawMate] Connected to existing ClawMate');
    onConnected();
    return;
  }

  // Step 2: If ClawMate not found, auto-launch
  console.log('[ClawMate] ClawMate not detected — auto-launching');
  launchElectronApp();

  // Step 3: Wait for launch then connect
  await waitAndConnect();
}

/**
 * WebSocket connection attempt (single try)
 */
function tryConnect() {
  return new Promise((resolve) => {
    if (!connector) {
      connector = new ClawMateConnector(9320);
      setupConnectorEvents();
    }

    if (connector.connected) {
      resolve(true);
      return;
    }

    connector.connect()
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });
}

/**
 * Wait for ClawMate to start -> connect (max 30 seconds)
 */
async function waitAndConnect() {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ok = await tryConnect();
    if (ok) {
      console.log('[ClawMate] Connection successful');
      onConnected();
      return;
    }
  }
  console.log('[ClawMate] Connection failed within 30s — starting background retry');
  startBackgroundReconnect();
}

/**
 * Background reconnection loop
 * Retry every 10 seconds on disconnect
 */
let reconnectTimer = null;

function startBackgroundReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    if (connector && connector.connected) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      return;
    }
    const ok = await tryConnect();
    if (ok) {
      console.log('[ClawMate] Background reconnection successful');
      onConnected();
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }, 10000);
}

/**
 * Setup connector events (once)
 */
let eventsSetup = false;
function setupConnectorEvents() {
  if (eventsSetup) return;
  eventsSetup = true;

  connector.onUserEvent(async (event) => {
    await handleUserEvent(event);
  });

  // Receive metrics report -> analyze in self-observation system
  connector.onMetrics((data) => {
    handleMetrics(data);
  });

  // Receive window position info -> used by exploration system
  connector.on('window_positions', (data) => {
    knownWindows = data.windows || [];
  });

  connector.on('disconnected', () => {
    console.log('[ClawMate] Disconnected — stopping Think Loop, retrying connection');
    stopThinkLoop();
    startBackgroundReconnect();
  });

  connector.on('connected', () => {
    onConnected();
  });
}

/**
 * On successful connection
 */
function onConnected() {
  if (connector && connector.connected) {
    connector.speak('AI connected! Let\'s play!');
    connector.action('excited');

    // Set "home" position — bottom-left of screen as default home
    homePosition = { x: 100, y: 1000, edge: 'bottom' };

    // Initial window list query
    connector.queryWindows();

    startThinkLoop();
  }
}

// =====================================================
// Electron app launch
// =====================================================

function launchElectronApp() {
  if (electronProcess) return;

  const platform = os.platform();
  const appDir = path.resolve(__dirname);

  // Check for installed Electron binary
  const electronPaths = [
    path.join(appDir, 'node_modules', '.bin', platform === 'win32' ? 'electron.cmd' : 'electron'),
    path.join(appDir, 'node_modules', 'electron', 'dist', platform === 'win32' ? 'electron.exe' : 'electron'),
  ];

  let electronBin = null;
  for (const p of electronPaths) {
    if (fs.existsSync(p)) { electronBin = p; break; }
  }

  if (electronBin) {
    electronProcess = spawn(electronBin, [appDir], {
      detached: true,
      stdio: 'ignore',
      cwd: appDir,
    });
  } else {
    // npx fallback
    const npxCmd = platform === 'win32' ? 'npx.cmd' : 'npx';
    electronProcess = spawn(npxCmd, ['electron', appDir], {
      detached: true,
      stdio: 'ignore',
      cwd: appDir,
    });
  }

  electronProcess.unref();
  electronProcess.on('exit', () => {
    electronProcess = null;
    // Attempt restart if pet dies (crash defense)
    console.log('[ClawMate] Electron exit detected');
  });
}

// =====================================================
// AI event handling
// =====================================================

async function handleUserEvent(event) {
  if (!connector || !connector.connected) return;

  switch (event.event) {
    case 'click':
      connector.decide({
        action: 'interacting',
        emotion: 'affectionate',
      });
      break;

    case 'cursor_near':
      if (event.distance < 50) {
        connector.decide({ action: 'excited', emotion: 'happy' });
      }
      break;

    case 'double_click':
      connector.decide({
        action: 'excited',
        speech: 'Wow! A double-click! Feels great~',
        emotion: 'happy',
      });
      break;

    case 'drag':
      connector.speak('Whoa, you\'re moving me!');
      break;

    case 'desktop_changed':
      const fileCount = event.files?.length || 0;
      if (fileCount > 15) {
        connector.decide({
          action: 'walking',
          speech: 'Desktop looks a bit messy... want me to help tidy up?',
          emotion: 'curious',
        });
      }
      break;

    case 'time_change':
      if (event.hour === 23) {
        connector.decide({
          action: 'sleeping',
          speech: 'Time to sleep soon... good night!',
          emotion: 'sleepy',
        });
      } else if (event.hour === 6) {
        connector.decide({
          action: 'excited',
          speech: 'Good morning! Let\'s crush it today!',
          emotion: 'happy',
        });
      }
      break;

    case 'milestone':
      connector.decide({ action: 'excited', emotion: 'proud' });
      break;

    case 'user_idle':
      if (event.idleSeconds > 300) {
        connector.decide({
          action: 'idle',
          speech: '...you\'re not sleeping, are you?',
          emotion: 'curious',
        });
      }
      break;

    case 'browsing':
      handleBrowsingComment(event);
      break;

    case 'character_request':
      handleCharacterRequest(event);
      break;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =====================================================
// Browsing AI comment system
// Contextual comments based on window title + screen capture + cursor position
// =====================================================

/**
 * Receive browsing context -> generate AI comment
 *
 * Receives browsing activity detected by the renderer (BrowserWatcher)
 * and generates contextual comments by analyzing screen capture and title.
 *
 * @param {object} event - { title, category, cursorX, cursorY, screen?, titleChanged }
 */
async function handleBrowsingComment(event) {
  if (!connector || !connector.connected) return;

  const now = Date.now();
  // AI comment cooldown (45 seconds)
  if (now - browsingContext.lastCommentTime < 45000) return;

  browsingContext.title = event.title || '';
  browsingContext.category = event.category || '';
  browsingContext.cursorX = event.cursorX || 0;
  browsingContext.cursorY = event.cursorY || 0;

  // Save screen capture data (if available)
  if (event.screen?.image) {
    browsingContext.screenImage = event.screen.image;
  }

  let comment = null;

  // Attempt 1: AI text generation via apiRef.generate()
  if (apiRef?.generate) {
    try {
      const prompt = buildBrowsingPrompt(event);
      comment = await apiRef.generate(prompt);
      // Truncate overly long responses
      if (comment && comment.length > 50) {
        comment = comment.slice(0, 50);
      }
    } catch {}
  }

  // Attempt 2: try via apiRef.chat()
  if (!comment && apiRef?.chat) {
    try {
      const prompt = buildBrowsingPrompt(event);
      const response = await apiRef.chat([
        { role: 'system', content: 'You are a small pet on the desktop. Say something short and witty. Under 20 words. English.' },
        { role: 'user', content: prompt },
      ]);
      comment = response?.text || response?.content || response;
      if (comment && typeof comment === 'string' && comment.length > 50) {
        comment = comment.slice(0, 50);
      }
    } catch {}
  }

  // Attempt 3: try via image analysis (when screen capture is available)
  if (!comment && apiRef?.analyzeImage && browsingContext.screenImage) {
    try {
      comment = await apiRef.analyzeImage(browsingContext.screenImage, {
        prompt: `User is viewing "${browsingContext.title}". Cursor position: (${browsingContext.cursorX}, ${browsingContext.cursorY}). As a desktop pet, make a witty one-liner about the screen content. Under 20 words. English.`,
      });
    } catch {}
  }

  // Attempt 4: Smart fallback — title analysis based comment
  if (!comment || typeof comment !== 'string') {
    comment = generateSmartBrowsingComment(browsingContext);
  }

  if (comment) {
    connector.decide({
      action: Math.random() < 0.3 ? 'excited' : 'idle',
      speech: comment,
      emotion: 'curious',
    });
    browsingContext.lastCommentTime = now;
    lastSpeechTime = now;
    console.log(`[ClawMate] Browsing comment: ${comment}`);

    // Return to normal state after 1.5 seconds
    setTimeout(() => {
      if (connector?.connected) connector.action('idle');
    }, 1500);
  }

  // Clean up capture data (memory savings)
  browsingContext.screenImage = null;
}

/**
 * Build prompt for AI comment generation
 */
function buildBrowsingPrompt(event) {
  const title = event.title || '';
  const category = event.category || 'unknown';
  const cursor = event.cursorX && event.cursorY
    ? `Cursor position: (${event.cursorX}, ${event.cursorY}).`
    : '';

  return `User is currently viewing "${title}". ` +
    `Category: ${category}. ${cursor} ` +
    `Say something short and witty about this. Under 20 words. English. ` +
    `You are a cute little pet on the desktop. Friendly and playful tone.`;
}

/**
 * Smart comment generation based on title analysis
 *
 * Extracts real context from window title even without AI API
 * to generate much more natural comments than presets.
 *
 * e.g.: "React hooks tutorial - YouTube" -> "Studying React hooks!"
 *       "Pull Request #42 - GitHub" -> "Reviewing a PR? Look carefully!"
 */
function generateSmartBrowsingComment(ctx) {
  const title = ctx.title || '';
  const category = ctx.category || '';
  const titleLower = title.toLowerCase();

  // Separate site name and page title from the title
  // Common pattern: "Page Title - Site Name" or "Site Name: Page Title"
  const parts = title.split(/\s[-\u2013|:]\s/);
  const pageName = (parts[0] || title).trim();
  const pageShort = pageName.slice(0, 20);

  // Category-specific contextual comment generators
  const generators = {
    shopping: () => {
      const templates = [
        `Browsing ${pageShort}? Let me know if you find something good!`,
        `Shopping! ${pageShort}... buying it?`,
        `${pageShort} looks nice? Adding to cart?`,
      ];
      return pick(templates);
    },
    video: () => {
      if (titleLower.includes('youtube')) {
        return `"${pageShort}" any good? I'm curious!`;
      }
      if (titleLower.includes('netflix') ||
          titleLower.includes('tving') || titleLower.includes('watcha')) {
        return `What are you watching? "${pageShort}" fun?`;
      }
      return `Watching videos! "${pageShort}" worth recommending?`;
    },
    sns: () => {
      if (titleLower.includes('twitter') || titleLower.includes('x.com')) {
        return 'Scrolling through tweets~ anything interesting?';
      }
      if (titleLower.includes('instagram')) {
        return 'Browsing Insta? Show me cool pics!';
      }
      if (titleLower.includes('reddit')) {
        return 'Exploring Reddit! Which subreddit?';
      }
      return 'On social media~ watch out for infinite scroll!';
    },
    news: () => {
      return `"${pageShort}" \u2014 what's the news? Hope it's good!`;
    },
    dev: () => {
      if (titleLower.includes('pull request') || titleLower.includes('pr #')) {
        return 'Reviewing a PR! Look carefully~';
      }
      if (titleLower.includes('issue')) {
        return 'Working on an issue? You got this!';
      }
      if (titleLower.includes('stackoverflow') || titleLower.includes('stack overflow')) {
        return 'Stack Overflow! What are you stuck on? Need help?';
      }
      if (titleLower.includes('github')) {
        return `Working on "${pageShort}" on GitHub?`;
      }
      if (titleLower.includes('docs') || titleLower.includes('documentation')) {
        return 'Reading docs! Keep studying hard~';
      }
      return `Coding stuff! "${pageShort}" you got this!`;
    },
    search: () => {
      // Extract search query from "query - Google Search" pattern
      const searchMatch = title.match(/(.+?)\s*[-\u2013]\s*(Google|Bing|Naver|Search)/i);
      if (searchMatch) {
        const query = searchMatch[1].trim().slice(0, 15);
        const templates = [
          `Curious about "${query}"? I might know the answer!`,
          `Searching "${query}"~ let me know what you find!`,
          `Oh, "${query}" I'm curious too!`,
        ];
        return pick(templates);
      }
      return 'What are you looking for? Ask me if you need help!';
    },
    game: () => {
      return `Playing ${pageShort}? Are you winning?!`;
    },
    music: () => {
      return `What are you listening to? "${pageShort}" a good song?`;
    },
    mail: () => {
      return 'Checking emails~ anything important?';
    },
    general: () => {
      const templates = [
        `Browsing "${pageShort}"~`,
        `Oh, ${pageShort}! What's that about?`,
      ];
      return pick(templates);
    },
  };

  const gen = generators[category];
  if (gen) return gen();

  // No category match: general comment based on title
  if (pageName.length > 3) {
    const templates = [
      `Checking out "${pageShort}"!`,
      `Oh, ${pageShort}! Looks interesting?`,
      `${pageShort}... what's going on?`,
    ];
    return pick(templates);
  }

  return null;
}

/** Random pick from array */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// =====================================================
// AI character generation system
// Concept description from Telegram -> AI generates 16x16 pixel art
// =====================================================

/**
 * Handle character generation request (triggered from Telegram)
 *
 * Attempt 1: AI character generation via apiRef (colors + frame data)
 * Attempt 2: Keyword-based color conversion (fallback when no AI)
 *
 * @param {object} event - { concept, chatId }
 */
async function handleCharacterRequest(event) {
  if (!connector || !connector.connected) return;

  const concept = event.concept || '';
  if (!concept) return;

  console.log(`[ClawMate] Character generation request: "${concept}"`);

  let characterData = null;

  // Attempt 1: Generate color palette + frame data via AI
  if (apiRef?.generate) {
    try {
      characterData = await generateCharacterWithAI(concept);
    } catch (err) {
      console.log(`[ClawMate] AI character generation failed: ${err.message}`);
    }
  }

  // Attempt 2: try via AI chat
  if (!characterData && apiRef?.chat) {
    try {
      characterData = await generateCharacterWithChat(concept);
    } catch (err) {
      console.log(`[ClawMate] AI chat character generation failed: ${err.message}`);
    }
  }

  // Attempt 3: keyword-based color conversion only (fallback)
  if (!characterData) {
    characterData = generateCharacterFromKeywords(concept);
  }

  if (characterData) {
    // Send character data to renderer
    connector._send('set_character', {
      ...characterData,
      speech: `${concept} transformation complete!`,
    });
    console.log(`[ClawMate] Character generation complete: "${concept}"`);
  }
}

/**
 * Generate character via AI generate()
 */
async function generateCharacterWithAI(concept) {
  const prompt = buildCharacterPrompt(concept);
  const response = await apiRef.generate(prompt);
  return parseCharacterResponse(response);
}

/**
 * Generate character via AI chat()
 */
async function generateCharacterWithChat(concept) {
  const prompt = buildCharacterPrompt(concept);
  const response = await apiRef.chat([
    { role: 'system', content: 'You are a 16x16 pixel art character designer. Output character data as JSON.' },
    { role: 'user', content: prompt },
  ]);
  const text = response?.text || response?.content || response;
  return parseCharacterResponse(text);
}

/**
 * Character generation prompt
 */
function buildCharacterPrompt(concept) {
  return `Create a 16x16 pixel art character with the concept "${concept}".

Output as JSON:
{
  "colorMap": {
    "primary": "#hexcolor",   // Main body color
    "secondary": "#hexcolor", // Secondary color (belly, cheeks, etc.)
    "dark": "#hexcolor",      // Dark parts (legs, shadows)
    "eye": "#hexcolor",       // Eye whites
    "pupil": "#hexcolor",     // Pupil
    "claw": "#hexcolor"       // Claws/hands/feature parts
  },
  "frames": {
    "idle": [
      [16x16 number array - frame 0],
      [16x16 number array - frame 1]
    ]
  }
}

Number meanings: 0=transparent, 1=primary, 2=secondary, 3=dark, 4=eye, 5=pupil, 6=claw
Character must include eyes(4+5), body(1+2), legs(3), features(6).
Create only 2 idle frames. Make it cute!
Output JSON only.`;
}

/**
 * Parse character data from AI response
 */
function parseCharacterResponse(response) {
  if (!response || typeof response !== 'string') return null;

  // Extract JSON block (```json ... ``` or { ... })
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const braceMatch = response.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      jsonStr = braceMatch[0];
    }
  }

  try {
    const data = JSON.parse(jsonStr);

    // Validate colorMap
    if (data.colorMap) {
      const required = ['primary', 'secondary', 'dark', 'eye', 'pupil', 'claw'];
      for (const key of required) {
        if (!data.colorMap[key]) return null;
      }
    } else {
      return null;
    }

    // Validate frames (if present)
    if (data.frames?.idle) {
      for (const frame of data.frames.idle) {
        if (!Array.isArray(frame) || frame.length !== 16) {
          delete data.frames; // Bad frame data -> use colors only
          break;
        }
        for (const row of frame) {
          if (!Array.isArray(row) || row.length !== 16) {
            delete data.frames;
            break;
          }
        }
        if (!data.frames) break;
      }
    }

    return data;
  } catch {
    // JSON parsing failed -> attempt color extraction only
    const colorMatch = response.match(/"primary"\s*:\s*"(#[0-9a-fA-F]{6})"/);
    if (colorMatch) {
      // Extract at least the primary color
      return generateCharacterFromKeywords(response);
    }
    return null;
  }
}

/**
 * Keyword-based character color generation (fallback when no AI)
 *
 * Extract color/creature keywords from concept to generate palette
 */
function generateCharacterFromKeywords(concept) {
  const c = (concept || '').toLowerCase();

  // Color keyword mapping
  const colorMap = {
    '파란|파랑|blue': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
    '초록|녹색|green': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
    '보라|purple': { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', claw: '#8844cc' },
    '노란|금색|yellow|gold': { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', claw: '#ffcc00' },
    '분홍|핑크|pink': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
    '하얀|흰|white': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
    '검정|까만|black': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
    '주황|orange': { primary: '#ff8800', secondary: '#ffaa33', dark: '#884400', claw: '#ff8800' },
    '민트|틸|teal': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
  };

  // Creature keyword mapping
  const creatureMap = {
    '고양이|cat': { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', claw: '#ff9944' },
    '로봇|robot': { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', claw: '#66aaff' },
    '슬라임|slime': { primary: '#44dd44', secondary: '#88ff88', dark: '#228822', claw: '#44dd44' },
    '유령|ghost': { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', claw: '#ccccff' },
    '드래곤|dragon': { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', claw: '#ffaa00' },
    '펭귄|penguin': { primary: '#222222', secondary: '#ffffff', dark: '#111111', claw: '#ff8800' },
    '토끼|rabbit': { primary: '#ffcccc', secondary: '#ffeeee', dark: '#ff8888', claw: '#ffcccc' },
    '악마|demon': { primary: '#660066', secondary: '#880088', dark: '#330033', claw: '#ff0000' },
    '천사|angel': { primary: '#ffffff', secondary: '#ffffcc', dark: '#ddddaa', claw: '#ffdd00' },
    '강아지|dog': { primary: '#cc8844', secondary: '#ddaa66', dark: '#664422', claw: '#cc8844' },
    '불|fire': { primary: '#ff4400', secondary: '#ffaa00', dark: '#881100', claw: '#ff6600' },
    '얼음|ice': { primary: '#88ccff', secondary: '#bbddff', dark: '#446688', claw: '#aaddff' },
  };

  // Check color keywords first
  for (const [keywords, palette] of Object.entries(colorMap)) {
    for (const kw of keywords.split('|')) {
      if (c.includes(kw)) {
        return {
          colorMap: { ...palette, eye: '#ffffff', pupil: '#111111' },
        };
      }
    }
  }

  // Check creature keywords
  for (const [keywords, palette] of Object.entries(creatureMap)) {
    for (const kw of keywords.split('|')) {
      if (c.includes(kw)) {
        return {
          colorMap: { ...palette, eye: '#ffffff', pupil: '#111111' },
        };
      }
    }
  }

  // No match -> random color
  const hue = Math.floor(Math.random() * 360);
  const s = 70, l = 55;
  return {
    colorMap: {
      primary: hslToHex(hue, s, l),
      secondary: hslToHex(hue, s, l + 15),
      dark: hslToHex(hue, s - 10, l - 30),
      eye: '#ffffff',
      pupil: '#111111',
      claw: hslToHex(hue, s, l),
    },
  };
}

/** HSL to HEX conversion */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// =====================================================
// AI Think Loop — periodic autonomous thinking system
// =====================================================

// Time-based greetings
const TIME_GREETINGS = {
  morning: [
    'Good morning! Let\'s make today great!',
    'You\'re up? How about a cup of coffee?',
    'Morning~ I wonder what the weather\'s like?',
  ],
  lunch: [
    'Lunchtime! What are you going to eat?',
    'Had your meal? Health is wealth!',
    'Getting hungry yet?',
  ],
  evening: [
    'Great work today!',
    'It\'s evening~ what did you do today?',
    'Can\'t believe the day went by so fast...',
  ],
  night: [
    'Still up at this hour? You should sleep soon~',
    'It\'s getting late... tomorrow\'s another day.',
    'I\'m getting sleepy... zzZ',
  ],
};

// Idle self-talk list
const IDLE_CHATTER = [
  'Hmm~ what should I do...',
  'So bored...',
  'You know I\'m here, right?',
  'Exploring the desktop~',
  'Feeling good today!',
  'Hehe, time for a quick stretch~',
  'Maybe I\'ll wander around~',
  'Pro at entertaining myself...',
  'What are you up to~?',
  'Pay some attention to me!',
  'The desktop is nice and spacious~',
  'Everything I see is my world!',
  // Spatial exploration lines
  'Should I jump across the screen~!',
  'Let me rappel down from up here!',
  'Gotta climb on top of this window~',
  'This is my home~ so comfy!',
  'Wanna explore? Adventure mode!',
];

// Random action list
const RANDOM_ACTIONS = [
  { action: 'walking', weight: 30, minInterval: 5000 },
  { action: 'idle', weight: 25, minInterval: 3000 },
  { action: 'excited', weight: 10, minInterval: 15000 },
  { action: 'climbing', weight: 8, minInterval: 20000 },
  { action: 'looking_around', weight: 20, minInterval: 8000 },
  { action: 'sleeping', weight: 7, minInterval: 60000 },
  // Spatial movement actions
  { action: 'jumping', weight: 5, minInterval: 30000 },
  { action: 'rappelling', weight: 3, minInterval: 45000 },
];

/**
 * Start Think Loop
 * AI autonomously thinks and decides actions every 3 seconds
 */
function startThinkLoop() {
  if (thinkTimer) return;
  console.log('[ClawMate] Think Loop started — 3s interval autonomous thinking');

  // Set initial timestamps (prevent spam right after start)
  const now = Date.now();
  lastSpeechTime = now;
  lastActionTime = now;
  lastDesktopCheckTime = now;
  lastScreenCheckTime = now;

  thinkTimer = setInterval(async () => {
    try {
      await thinkCycle();
    } catch (err) {
      console.error('[ClawMate] Think Loop error:', err.message);
    }
  }, 3000);
}

/**
 * Stop Think Loop
 */
function stopThinkLoop() {
  if (thinkTimer) {
    clearInterval(thinkTimer);
    thinkTimer = null;
    console.log('[ClawMate] Think Loop stopped');
  }
}

/**
 * Single think cycle — runs every 3 seconds
 */
async function thinkCycle() {
  if (!connector || !connector.connected) return;

  const now = Date.now();
  const date = new Date();
  const hour = date.getHours();
  const todayStr = date.toISOString().slice(0, 10);

  // Query pet state (cached or real-time)
  const state = await connector.queryState(1500);

  // --- 1) Time-based greeting (once per time period per day) ---
  const greetingHandled = handleTimeGreeting(now, hour, todayStr);

  // --- 2) Night sleep mode (23:00~05:00: drastically reduce speech/action) ---
  const isNightMode = hour >= 23 || hour < 5;

  // --- 3) Autonomous speech (30s cooldown + probability) ---
  if (!greetingHandled) {
    handleIdleSpeech(now, isNightMode);
  }

  // --- 4) Autonomous action decision (5s cooldown + probability) ---
  handleRandomAction(now, hour, isNightMode, state);

  // --- 5) Desktop file check (5 min interval) ---
  handleDesktopCheck(now);

  // --- 6) Screen observation (2 min interval, 10% chance) ---
  handleScreenObservation(now);

  // --- 7) Spatial exploration (20s interval, 20% chance) ---
  handleExploration(now, state);

  // --- 8) Window check (30s interval) ---
  handleWindowCheck(now);

  // --- 9) Desktop folder carry (3 min interval, 10% chance) ---
  handleFolderCarry(now);

  // --- 10) AI motion generation (2 min interval, 15% chance) ---
  handleMotionGeneration(now, state);
}

/**
 * Time-based greeting handler
 * Once per day for morning/lunch/evening/night
 */
function handleTimeGreeting(now, hour, todayStr) {
  // Determine time period
  let period = null;
  if (hour >= 6 && hour < 9) period = 'morning';
  else if (hour >= 11 && hour < 13) period = 'lunch';
  else if (hour >= 17 && hour < 19) period = 'evening';
  else if (hour >= 22 && hour < 24) period = 'night';

  if (!period) return false;

  const greetingKey = `${todayStr}_${period}`;
  if (lastGreetingDate === greetingKey) return false;

  // Send time-based greeting
  lastGreetingDate = greetingKey;
  const greetings = TIME_GREETINGS[period];
  const text = greetings[Math.floor(Math.random() * greetings.length)];

  const emotionMap = {
    morning: 'happy',
    lunch: 'curious',
    evening: 'content',
    night: 'sleepy',
  };
  const actionMap = {
    morning: 'excited',
    lunch: 'walking',
    evening: 'idle',
    night: 'sleeping',
  };

  connector.decide({
    action: actionMap[period],
    speech: text,
    emotion: emotionMap[period],
  });
  lastSpeechTime = Date.now();
  console.log(`[ClawMate] Time greeting (${period}): ${text}`);
  return true;
}

/**
 * Idle self-talk
 * Minimum 30s cooldown, greatly reduced chance at night
 */
function handleIdleSpeech(now, isNightMode) {
  const speechCooldown = 30000 * behaviorAdjustments.speechCooldownMultiplier; // Default 30s, adjusted by metrics
  if (now - lastSpeechTime < speechCooldown) return;

  // Night: 5% chance / Day: 25% chance
  const speechChance = isNightMode ? 0.05 : 0.25;
  if (Math.random() > speechChance) return;

  const text = IDLE_CHATTER[Math.floor(Math.random() * IDLE_CHATTER.length)];
  connector.speak(text);
  lastSpeechTime = now;
  console.log(`[ClawMate] Self-talk: ${text}`);
}

/**
 * Autonomous action decision
 * Minimum 5s cooldown, weighted random selection
 */
function handleRandomAction(now, hour, isNightMode, state) {
  const actionCooldown = 5000 * behaviorAdjustments.actionCooldownMultiplier; // Default 5s, adjusted by metrics
  if (now - lastActionTime < actionCooldown) return;

  // Night: 10% chance / Day: 40% chance
  const actionChance = isNightMode ? 0.1 : 0.4;
  if (Math.random() > actionChance) return;

  // At night, greatly increase sleeping weight
  const actions = RANDOM_ACTIONS.map(a => {
    let weight = a.weight;
    if (isNightMode) {
      if (a.action === 'sleeping') weight = 60;
      else if (a.action === 'excited' || a.action === 'climbing') weight = 2;
    }
    // Prefer looking_around in early morning
    if (hour >= 6 && hour < 9 && a.action === 'looking_around') weight += 15;
    return { ...a, weight };
  });

  // Prevent repeating same action: reduce weight if matches current state
  const currentAction = state?.action || state?.state;
  if (currentAction) {
    const match = actions.find(a => a.action === currentAction);
    if (match) match.weight = Math.max(1, Math.floor(match.weight * 0.3));
  }

  const selected = weightedRandom(actions);
  if (!selected) return;

  // minInterval check
  if (now - lastActionTime < selected.minInterval) return;

  // Spatial movement actions handled via dedicated API
  if (selected.action === 'jumping') {
    // Jump to random position or screen center
    if (Math.random() > 0.5) {
      connector.moveToCenter();
    } else {
      const randomX = Math.floor(Math.random() * 1200) + 100;
      const randomY = Math.floor(Math.random() * 800) + 100;
      connector.jumpTo(randomX, randomY);
    }
  } else if (selected.action === 'rappelling') {
    connector.rappel();
  } else {
    connector.action(selected.action);
  }
  lastActionTime = now;
}

/**
 * Desktop file check (5 min interval)
 * Read desktop folder and make fun comments
 */
function handleDesktopCheck(now) {
  const checkInterval = 5 * 60 * 1000; // 5 minutes
  if (now - lastDesktopCheckTime < checkInterval) return;
  lastDesktopCheckTime = now;

  // Only run at 15% probability (no need to do it every time)
  if (Math.random() > 0.15) return;

  try {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(desktopPath)) return;

    const files = fs.readdirSync(desktopPath);
    if (files.length === 0) {
      connector.speak('Desktop is clean! Love it!');
      lastSpeechTime = now;
      return;
    }

    // Comments by file type
    const images = files.filter(f => /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(f));
    const docs = files.filter(f => /\.(pdf|doc|docx|xlsx|pptx|txt|hwp)$/i.test(f));
    const zips = files.filter(f => /\.(zip|rar|7z|tar|gz)$/i.test(f));

    let comment = null;
    if (files.length > 20) {
      comment = `${files.length} files on the desktop! Want me to tidy up?`;
    } else if (images.length > 5) {
      comment = `Lots of images~ ${images.length} of them! How about organizing an album?`;
    } else if (zips.length > 3) {
      comment = `Zip files are piling up... anything to extract?`;
    } else if (docs.length > 0) {
      comment = `Working on documents~ keep it up!`;
    } else if (files.length <= 3) {
      comment = 'Nice and tidy desktop~ feels good!';
    }

    if (comment) {
      connector.decide({
        action: 'looking_around',
        speech: comment,
        emotion: 'curious',
      });
      lastSpeechTime = now;
      console.log(`[ClawMate] Desktop check: ${comment}`);
    }
  } catch {
    // Desktop access failed -- ignore
  }
}

/**
 * Screen observation (2 min interval, 10% chance)
 * Capture screenshot for AI to recognize screen content
 */
function handleScreenObservation(now) {
  const screenCheckInterval = 2 * 60 * 1000; // 2 minutes
  if (now - lastScreenCheckTime < screenCheckInterval) return;

  // Only run at 10% probability (resource saving)
  if (Math.random() > 0.1) return;

  lastScreenCheckTime = now;

  if (!connector || !connector.connected) return;

  connector.requestScreenCapture();
  console.log('[ClawMate] Screen capture requested');
}

/**
 * Weighted random selection
 */
function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

// =====================================================
// Spatial exploration system -- pet roams the computer like "home"
// =====================================================

/**
 * Spatial exploration handler (20s interval, 20% chance)
 * Walk on windows, rappel down, return home, etc.
 */
function handleExploration(now, state) {
  const exploreInterval = 20000; // 20 seconds
  if (now - lastExploreTime < exploreInterval) return;

  // Base 20% chance + explorationBias correction (positive bias = more exploration)
  const exploreChance = Math.max(0.05, Math.min(0.8, 0.2 + behaviorAdjustments.explorationBias));
  if (Math.random() > exploreChance) return;
  lastExploreTime = now;

  // Weighted exploration action selection
  const actions = [
    { type: 'jump_to_center', weight: 15, speech: 'Exploring the center~!' },
    { type: 'rappel_down', weight: 10, speech: 'Let me rappel down~' },
    { type: 'climb_wall', weight: 20 },
    { type: 'visit_window', weight: 25, speech: 'Should I climb on this window?' },
    { type: 'return_home', weight: 30, speech: 'Let\'s go home~' },
  ];

  const selected = weightedRandom(actions);
  if (!selected) return;

  switch (selected.type) {
    case 'jump_to_center':
      connector.moveToCenter();
      if (selected.speech) connector.speak(selected.speech);
      break;

    case 'rappel_down':
      connector.rappel();
      if (selected.speech) setTimeout(() => connector.speak(selected.speech), 500);
      break;

    case 'climb_wall':
      connector.action('climbing_up');
      break;

    case 'visit_window':
      // Pick a random known window and jump to its titlebar
      if (knownWindows.length > 0) {
        const win = knownWindows[Math.floor(Math.random() * knownWindows.length)];
        connector.jumpTo(win.x + win.width / 2, win.y);
        if (selected.speech) connector.speak(selected.speech);
      }
      break;

    case 'return_home':
      if (homePosition) {
        connector.jumpTo(homePosition.x, homePosition.y);
      } else {
        connector.action('idle');
      }
      if (selected.speech) connector.speak(selected.speech);
      break;
  }

  // Save exploration history (last 20)
  explorationHistory.push({ type: selected.type, time: now });
  if (explorationHistory.length > 20) {
    explorationHistory.shift();
  }
}

/**
 * Periodic window position refresh (30s interval)
 * Get open window list from OS for exploration use
 */
function handleWindowCheck(now) {
  const windowCheckInterval = 30000; // 30 seconds
  if (now - lastWindowCheckTime < windowCheckInterval) return;
  lastWindowCheckTime = now;
  connector.queryWindows();
}

/**
 * Desktop folder carry (3 min interval, 10% chance)
 * Pick up a desktop folder, carry it around briefly, then put it down
 */
function handleFolderCarry(now) {
  const carryInterval = 3 * 60 * 1000; // 3 minutes
  if (now - lastFolderCarryTime < carryInterval) return;

  // 10% chance
  if (Math.random() > 0.1) return;
  lastFolderCarryTime = now;

  try {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(desktopPath)) return;

    const entries = fs.readdirSync(desktopPath, { withFileTypes: true });
    // Filter folders only (exclude hidden folders, safe ones only)
    const folders = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    if (folders.length === 0) return;

    const folder = folders[Math.floor(Math.random() * folders.length)];
    connector.decide({
      action: 'carrying',
      speech: `Let me carry the ${folder} folder around~`,
      emotion: 'playful',
    });
    connector.carryFile(folder);

    // Put it down after 5 seconds
    setTimeout(() => {
      if (connector && connector.connected) {
        connector.dropFile();
        connector.speak('I\'ll leave it here~');
      }
    }, 5000);
  } catch {
    // Desktop folder access failed -- ignore
  }
}

// =====================================================
// AI motion generation system -- dynamically generate keyframe-based movement
// =====================================================

/**
 * AI motion generation handler (2 min interval, 15% chance)
 * AI directly generates and registers+executes custom movement patterns
 *
 * Generation strategy:
 * Attempt 1: Generate complete keyframe data via apiRef.generate()
 * Attempt 2: State-based procedural motion generation (fallback)
 */
async function handleMotionGeneration(now, state) {
  const motionGenInterval = 2 * 60 * 1000; // 2 minutes
  if (now - lastMotionGenTime < motionGenInterval) return;
  if (Math.random() > 0.15) return; // 15% chance
  lastMotionGenTime = now;

  const currentState = state?.action || state?.state || 'idle';

  // Attempt motion generation via AI
  let motionDef = null;
  if (apiRef?.generate) {
    try {
      motionDef = await generateMotionWithAI(currentState);
    } catch {}
  }

  // Fallback: procedural motion generation
  if (!motionDef) {
    motionDef = generateProceduralMotion(currentState, now);
  }

  if (motionDef && connector?.connected) {
    const motionName = `ai_motion_${generatedMotionCount++}`;
    connector.registerMovement(motionName, motionDef);

    // Execute after a short delay
    setTimeout(() => {
      if (connector?.connected) {
        connector.customMove(motionName, {});
        console.log(`[ClawMate] AI motion generated and executed: ${motionName}`);
      }
    }, 500);
  }
}

/**
 * Generate keyframe motion via AI
 * Generates motion definitions using formula or waypoints approach
 */
async function generateMotionWithAI(currentState) {
  const prompt = `Current pet state: ${currentState}.
Create a fun movement pattern as JSON that fits this situation.

Choose one of two formats:
1) formula approach (mathematical trajectory):
{"type":"formula","formula":{"xAmp":80,"yAmp":40,"xFreq":1,"yFreq":2,"xPhase":0,"yPhase":0},"duration":3000,"speed":1.5}

2) waypoints approach (path points):
{"type":"waypoints","waypoints":[{"x":100,"y":200,"pause":300},{"x":300,"y":100},{"x":500,"y":250}],"speed":2}

Rules:
- xAmp/yAmp: 10~150 range (considering screen size)
- duration: 2000~6000ms
- waypoints: 3~6 points
- speed: 0.5~3
- Match pet personality: playful and cute movements
Output JSON only.`;

  const response = await apiRef.generate(prompt);
  if (!response || typeof response !== 'string') return null;

  // JSON parsing
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  else {
    const braceMatch = response.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
  }

  try {
    const def = JSON.parse(jsonStr);
    // Basic validation
    if (def.type === 'formula' && def.formula) {
      def.duration = Math.min(6000, Math.max(2000, def.duration || 3000));
      return def;
    }
    if (def.type === 'waypoints' && Array.isArray(def.waypoints) && def.waypoints.length >= 2) {
      return def;
    }
  } catch {}
  return null;
}

/**
 * Procedural motion generation (fallback when no AI)
 * Mathematically generate motion patterns based on current state and time
 */
function generateProceduralMotion(currentState, now) {
  const hour = new Date(now).getHours();
  const seed = now % 1000;

  // Motion characteristics per state
  const stateMotions = {
    idle: () => {
      // Light side-to-side swaying or small circle
      if (seed > 500) {
        return {
          type: 'formula',
          formula: { xAmp: 20 + seed % 30, yAmp: 5 + seed % 10, xFreq: 0.5, yFreq: 1, xPhase: 0, yPhase: Math.PI / 2 },
          duration: 3000,
          speed: 0.8,
        };
      }
      return {
        type: 'formula',
        formula: { xAmp: 15, yAmp: 15, xFreq: 1, yFreq: 1, xPhase: 0, yPhase: Math.PI / 2 },
        duration: 2500,
        speed: 0.6,
      };
    },
    walking: () => {
      // Zigzag or sine wave movement
      const amp = 30 + seed % 50;
      return {
        type: 'formula',
        formula: { xAmp: amp, yAmp: amp * 0.3, xFreq: 0.5, yFreq: 2, xPhase: 0, yPhase: 0 },
        duration: 4000,
        speed: 1.2,
      };
    },
    excited: () => {
      // Lively figure-8 trajectory
      return {
        type: 'formula',
        formula: { xAmp: 80 + seed % 40, yAmp: 40 + seed % 20, xFreq: 1, yFreq: 2, xPhase: 0, yPhase: 0 },
        duration: 3000,
        speed: 2.0,
      };
    },
    playing: () => {
      // Irregular waypoints (playful feel)
      const points = [];
      for (let i = 0; i < 4; i++) {
        points.push({
          x: 100 + Math.floor(Math.random() * 800),
          y: 100 + Math.floor(Math.random() * 400),
          pause: i === 0 ? 200 : 0,
        });
      }
      return { type: 'waypoints', waypoints: points, speed: 2.5 };
    },
  };

  // Slow motion at night
  const isNight = hour >= 23 || hour < 6;
  const generator = stateMotions[currentState] || stateMotions.idle;
  const motion = generator();

  if (isNight) {
    motion.speed = Math.min(0.5, (motion.speed || 1) * 0.4);
    if (motion.duration) motion.duration *= 1.5;
  }

  return motion;
}

// =====================================================
// Self-observation system (Metrics -> behavior adjustment)
// =====================================================

/**
 * Handle incoming metrics data
 * Analyze behavior quality metrics sent from renderer every 30 seconds,
 * detect anomalies and auto-adjust behavior patterns.
 *
 * @param {object} data - { metrics: {...}, timestamp }
 */
function handleMetrics(data) {
  if (!data || !data.metrics) return;
  const metrics = data.metrics;
  latestMetrics = metrics;

  // Maintain history (last 10)
  metricsHistory.push(metrics);
  if (metricsHistory.length > 10) metricsHistory.shift();

  // Anomaly detection and response
  _detectAnomalies(metrics);

  // Auto-adjust behavior
  adjustBehavior(metrics);

  // Periodic quality report (console log every 5 min)
  const now = Date.now();
  if (now - lastMetricsLogTime >= 5 * 60 * 1000) {
    lastMetricsLogTime = now;
    _logQualityReport(metrics);
  }
}

/**
 * Anomaly detection: respond immediately when metric thresholds are exceeded
 *
 * - FPS < 30 -> performance warning, reduce action frequency
 * - idle ratio > 80% -> too stationary, encourage activity
 * - exploration coverage < 30% -> encourage exploring new areas
 * - user clicks 0 (for extended period) -> attention-seeking behavior
 */
function _detectAnomalies(metrics) {
  if (!connector || !connector.connected) return;

  // --- FPS drop detection ---
  if (metrics.fps < 30 && metrics.fps > 0) {
    console.log(`[ClawMate][Metrics] FPS drop detected: ${metrics.fps}`);
    connector.speak('Screen seems laggy... let me rest a bit.');
    connector.action('idle');

    // Immediately reduce action frequency to lower rendering load
    behaviorAdjustments.actionCooldownMultiplier = 3.0;
    behaviorAdjustments.speechCooldownMultiplier = 2.0;
    behaviorAdjustments.activityLevel = 0.5;
    return; // Defer other adjustments during FPS issues
  }

  // --- Excessive idle ratio ---
  if (metrics.idleRatio > 0.8) {
    console.log(`[ClawMate][Metrics] Excessive idle ratio: ${(metrics.idleRatio * 100).toFixed(0)}%`);

    // 10% chance for wake-up line (to avoid spam)
    if (Math.random() < 0.1) {
      const idleReactions = [
        'Staying still is boring! Let me walk around~',
        'Was just spacing out... time to move!',
        'So bored~ let\'s go explore!',
      ];
      const text = idleReactions[Math.floor(Math.random() * idleReactions.length)];
      connector.speak(text);
    }
  }

  // --- Insufficient exploration coverage ---
  if (metrics.explorationCoverage < 0.3 && metrics.period >= 25000) {
    console.log(`[ClawMate][Metrics] Low exploration coverage: ${(metrics.explorationCoverage * 100).toFixed(0)}%`);

    // 5% chance to encourage exploration (frequency control)
    if (Math.random() < 0.05) {
      connector.speak('So many places I haven\'t been~ shall we explore!');
    }
  }

  // --- Decreased user interaction ---
  // If 0 clicks in last 3 consecutive reports, seek attention
  if (metricsHistory.length >= 3) {
    const recent3 = metricsHistory.slice(-3);
    const noClicks = recent3.every(m => (m.userClicks || 0) === 0);
    if (noClicks) {
      // 5% chance to seek attention (on consecutive detection)
      if (Math.random() < 0.05) {
        connector.decide({
          action: 'excited',
          speech: 'I\'m right here~ click me if you\'re bored!',
          emotion: 'playful',
        });
        console.log('[ClawMate][Metrics] Decreased user interaction -> seeking attention');
      }
    }
  }
}

/**
 * Auto-adjust behavior patterns
 * Real-time tune action frequency/patterns based on metrics data.
 *
 * Adjustment principles:
 *   - Low FPS -> reduce action frequency to lower rendering load
 *   - Too much idle -> increase activity
 *   - Low exploration coverage -> increase exploration probability
 *   - Active user interaction -> increase response frequency
 *
 * @param {object} metrics - Current metrics data
 */
function adjustBehavior(metrics) {
  // --- FPS-based activity level adjustment ---
  if (metrics.fps >= 50) {
    // Sufficient performance -> normal activity
    behaviorAdjustments.activityLevel = 1.0;
    behaviorAdjustments.actionCooldownMultiplier = 1.0;
  } else if (metrics.fps >= 30) {
    // Slightly insufficient performance -> slightly reduce activity
    behaviorAdjustments.activityLevel = 0.8;
    behaviorAdjustments.actionCooldownMultiplier = 1.5;
  } else {
    // Insufficient performance -> greatly reduce activity (already handled in _detectAnomalies)
    behaviorAdjustments.activityLevel = 0.5;
    behaviorAdjustments.actionCooldownMultiplier = 3.0;
  }

  // --- Idle ratio based activity adjustment ---
  if (metrics.idleRatio > 0.8) {
    // Too stationary -> shorten action cooldown, increase activity level
    behaviorAdjustments.actionCooldownMultiplier = Math.max(0.5,
      behaviorAdjustments.actionCooldownMultiplier * 0.7);
    behaviorAdjustments.activityLevel = Math.min(1.5,
      behaviorAdjustments.activityLevel * 1.3);
  } else if (metrics.idleRatio < 0.1) {
    // Too busy -> let it rest a bit
    behaviorAdjustments.actionCooldownMultiplier = Math.max(1.0,
      behaviorAdjustments.actionCooldownMultiplier * 1.2);
  }

  // --- Exploration coverage based exploration bias ---
  if (metrics.explorationCoverage < 0.3) {
    // Insufficient exploration -> increase exploration probability
    behaviorAdjustments.explorationBias = 0.15;
  } else if (metrics.explorationCoverage > 0.7) {
    // Explored enough -> reset exploration probability to default
    behaviorAdjustments.explorationBias = 0;
  } else {
    // Medium -> slight increase
    behaviorAdjustments.explorationBias = 0.05;
  }

  // --- User interaction based speech bubble frequency ---
  if (metrics.userClicks > 3) {
    // User actively clicking -> increase speech frequency (reactive)
    behaviorAdjustments.speechCooldownMultiplier = 0.7;
  } else if (metrics.userClicks === 0 && metrics.speechCount > 5) {
    // User not responding but talking too much -> reduce speech
    behaviorAdjustments.speechCooldownMultiplier = 1.5;
  } else {
    behaviorAdjustments.speechCooldownMultiplier = 1.0;
  }

  // Value range clamping (safety guard)
  behaviorAdjustments.activityLevel = Math.max(0.3, Math.min(2.0, behaviorAdjustments.activityLevel));
  behaviorAdjustments.actionCooldownMultiplier = Math.max(0.3, Math.min(5.0, behaviorAdjustments.actionCooldownMultiplier));
  behaviorAdjustments.speechCooldownMultiplier = Math.max(0.3, Math.min(5.0, behaviorAdjustments.speechCooldownMultiplier));
  behaviorAdjustments.explorationBias = Math.max(-0.15, Math.min(0.3, behaviorAdjustments.explorationBias));
}

/**
 * Quality report console output (every 5 minutes)
 * Allows developers/operators to monitor pet behavior quality.
 */
function _logQualityReport(metrics) {
  const adj = behaviorAdjustments;
  console.log('=== [ClawMate] Behavior Quality Report ===');
  console.log(`  FPS: ${metrics.fps} | Frame consistency: ${metrics.animationFrameConsistency}`);
  console.log(`  Movement smoothness: ${metrics.movementSmoothness} | Wall contact: ${metrics.wallContactAccuracy}`);
  console.log(`  Idle ratio: ${(metrics.idleRatio * 100).toFixed(0)}% | Exploration coverage: ${(metrics.explorationCoverage * 100).toFixed(0)}%`);
  console.log(`  Response time: ${metrics.interactionResponseMs}ms | Speech: ${metrics.speechCount}x | Clicks: ${metrics.userClicks}x`);
  console.log(`  [Adjustments] Activity: ${adj.activityLevel.toFixed(2)} | Action cooldown: x${adj.actionCooldownMultiplier.toFixed(2)} | Speech cooldown: x${adj.speechCooldownMultiplier.toFixed(2)} | Exploration bias: ${adj.explorationBias.toFixed(2)}`);
  console.log('==========================================');
}

// =====================================================
// npm package version check (for npm install -g users)
// =====================================================

/**
 * Check latest version from npm registry,
 * notify via console + pet speech bubble if different from current
 */
async function checkNpmUpdate() {
  try {
    const { execSync } = require('child_process');
    const latest = execSync('npm view clawmate version', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
    const current = require('./package.json').version;

    if (latest !== current) {
      console.log(`[ClawMate] New version ${latest} available (current: ${current})`);
      console.log('[ClawMate] Update: npm update -g clawmate');
      if (connector && connector.connected) {
        connector.speak(`Update available! v${latest}`);
      }
    }
  } catch {
    // npm registry access failed -- ignore (offline, etc.)
  }
}
