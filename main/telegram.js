/**
 * Telegram Bot Integration Module
 *
 * Bidirectional communication between Telegram messages and ClawMate.
 * - Parses incoming Telegram messages and forwards commands to AI Bridge
 * - Relays pet state/speech back to Telegram
 *
 * Bot token priority:
 *   1. Environment variable CLAWMATE_TELEGRAM_TOKEN
 *   2. Config file (Store)
 *   3. If neither exists, silently disabled (no error)
 *
 * Dependency: node-telegram-bot-api (npm install node-telegram-bot-api)
 */

const EventEmitter = require('events');
const { parseMessage } = require('./file-command-parser');
const { executeSmartFileOp } = require('./smart-file-ops');

// Dynamically load Telegram Bot API (silently ignored if not installed)
let TelegramBotAPI = null;
try {
  TelegramBotAPI = require('node-telegram-bot-api');
} catch {
  // node-telegram-bot-api not installed — Telegram features disabled
}

class TelegramBot extends EventEmitter {
  /**
   * @param {object} bridge - AIBridge instance
   * @param {object} options - Additional options
   *   - token: Bot token (takes priority over env variable)
   *   - allowedChatIds: List of allowed chat IDs (security)
   */
  constructor(bridge, options = {}) {
    super();
    this.bridge = bridge;
    this.bot = null;
    this.active = false;
    this.allowedChatIds = options.allowedChatIds || null;
    this.activeChatIds = new Set(); // Track active chat IDs

    // Track in-progress file operations
    this._fileOpInProgress = false;

    // Determine bot token
    const token = options.token
      || process.env.CLAWMATE_TELEGRAM_TOKEN
      || null;

    if (!token) {
      console.log('[Telegram] No bot token — Telegram features disabled');
      return;
    }

    if (!TelegramBotAPI) {
      console.log('[Telegram] node-telegram-bot-api not installed — Telegram features disabled');
      console.log('[Telegram] Install: npm install node-telegram-bot-api');
      return;
    }

    this._init(token);
  }

  /**
   * Initialize bot and register message listeners
   */
  _init(token) {
    try {
      this.bot = new TelegramBotAPI(token, { polling: true });
      this.active = true;
      console.log('[Telegram] Bot initialized — waiting for messages');

      // Message receive handler
      this.bot.on('message', (msg) => this._handleMessage(msg));

      // Error handler (disconnection, etc.)
      this.bot.on('polling_error', (err) => {
        // Silently retry unless fatal error like invalid token
        if (err.code === 'ETELEGRAM' && err.response?.statusCode === 401) {
          console.error('[Telegram] Invalid bot token — Telegram disabled');
          this.stop();
        }
      });

      // Receive pet events from AI Bridge and forward to Telegram
      this._setupBridgeListeners();
    } catch (err) {
      console.error('[Telegram] Bot initialization failed:', err.message);
      this.active = false;
    }
  }

  /**
   * Set up AI Bridge event listeners (pet -> Telegram)
   */
  _setupBridgeListeners() {
    if (!this.bridge) return;

    // Forward pet speech to Telegram
    this.bridge.on('speak', (payload) => {
      this._broadcastToChats(`[Claw] ${payload.text}`);
    });

    // Forward speech from AI decisions
    this.bridge.on('ai_decision', (payload) => {
      if (payload.speech) {
        this._broadcastToChats(`[Claw] ${payload.speech}`);
      }
    });
  }

  /**
   * Handle incoming Telegram message
   */
  async _handleMessage(msg) {
    if (!this.active) return;
    if (!msg.text) return;

    const chatId = msg.chat.id;

    // Security: only process allowed chat IDs
    if (this.allowedChatIds && !this.allowedChatIds.includes(chatId)) {
      return;
    }

    // Track active chat IDs (for broadcasting)
    this.activeChatIds.add(chatId);

    const text = msg.text.trim();
    console.log(`[Telegram] Received (${chatId}): ${text}`);

    // Handle special commands
    if (text === '/start') {
      await this.bot.sendMessage(chatId,
        'ClawMate connected! \n\n' +
        'Available commands:\n' +
        '- Any message: Talk to the pet\n' +
        '- Action keywords: jump, sleep, dance, walk...\n' +
        '- File organization: "Move .md files on desktop to docs folder"\n' +
        '- Character change: "Change to blue cat"\n' +
        '- /reset: Reset to default character\n' +
        '- /status: Check pet status\n' +
        '- /undo: Undo last file move'
      );
      return;
    }

    if (text === '/status') {
      await this._sendStatus(chatId);
      return;
    }

    if (text === '/undo') {
      await this._undoLastMove(chatId);
      return;
    }

    if (text === '/reset') {
      this._sendToBridge('reset_character', {});
      await this.bot.sendMessage(chatId, 'Reset to default character!');
      return;
    }

    // Parse and process message
    const parsed = parseMessage(text);
    await this._executeCommand(chatId, parsed);
  }

  /**
   * Execute parsed command
   */
  async _executeCommand(chatId, command) {
    switch (command.type) {
      case 'speak':
        // Normal conversation -> display in pet speech bubble
        this._sendToBridge('speak', { text: command.text, style: 'normal' });
        this._sendToBridge('ai_decision', {
          speech: command.text,
          emotion: 'happy',
        });
        break;

      case 'action':
        // Action command -> change pet behavior
        this._sendToBridge('action', { state: command.action });
        await this.bot.sendMessage(chatId, `Pet is performing "${command.action}"!`);
        break;

      case 'smart_file_op':
        // File operation command
        await this._executeFileOp(chatId, command);
        break;

      case 'character_change':
        // Character change command -> AI generation request
        await this._handleCharacterChange(chatId, command.concept);
        break;

      case 'mode_change':
        // Mode change command
        this._sendToBridge('set_mode', { mode: command.mode });
        const modeNames = { pet: 'Pet (Clawby)', incarnation: 'Incarnation (Claw)', both: 'Both' };
        await this.bot.sendMessage(chatId, `Mode changed: ${modeNames[command.mode] || command.mode}`);
        break;

      case 'preset_character': {
        // Character preset selection
        const presets = {
          default: { name: 'Default Claw', colorMap: { primary: '#ff4f40', secondary: '#ff775f', dark: '#8B4513', eye: '#ffffff', pupil: '#111111', claw: '#ff4f40' } },
          blue: { name: 'Blue Claw', colorMap: { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', eye: '#ffffff', pupil: '#111111', claw: '#4488ff' } },
          green: { name: 'Green Claw', colorMap: { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', eye: '#ffffff', pupil: '#111111', claw: '#44cc44' } },
          purple: { name: 'Purple Claw', colorMap: { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', eye: '#ffffff', pupil: '#111111', claw: '#8844cc' } },
          gold: { name: 'Gold Claw', colorMap: { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', eye: '#ffffff', pupil: '#111111', claw: '#ffcc00' } },
          pink: { name: 'Pink Claw', colorMap: { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', eye: '#ffffff', pupil: '#111111', claw: '#ff69b4' } },
          cat: { name: 'Cat', colorMap: { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', eye: '#88ff88', pupil: '#111111', claw: '#ff9944' } },
          robot: { name: 'Robot', colorMap: { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', eye: '#66aaff', pupil: '#0044aa', claw: '#66aaff' } },
          ghost: { name: 'Ghost', colorMap: { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', eye: '#ff6666', pupil: '#cc0000', claw: '#ccccff' } },
          dragon: { name: 'Dragon', colorMap: { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', eye: '#ffaa00', pupil: '#111111', claw: '#ffaa00' } },
        };
        const preset = presets[command.preset];
        if (preset) {
          if (command.preset === 'default') {
            this._sendToBridge('reset_character', {});
          } else {
            this._sendToBridge('set_character', { colorMap: preset.colorMap, speech: `Transforming into ${preset.name}!` });
          }
          await this.bot.sendMessage(chatId, `Character changed: ${preset.name}`);
        }
        break;
      }
    }
  }

  /**
   * Handle character change request
   *
   * Passes concept text to AI to generate
   * color + frame data and apply to pet.
   *
   * Falls back to extracting colors from concept if AI is unavailable.
   */
  async _handleCharacterChange(chatId, concept) {
    await this.bot.sendMessage(chatId, `Creating "${concept}" character...`);

    // Request character generation from AI via AI Bridge
    this._sendToBridge('ai_decision', {
      speech: `Preparing to transform into ${concept}...`,
      emotion: 'curious',
      action: 'excited',
    });

    // Forward character change request via user_event (AI generates it)
    if (this.bridge) {
      this.bridge.send('user_event', {
        event: 'character_request',
        concept,
        chatId,
      });
    }

    // Fallback: keyword-based color conversion if no AI response within 3 seconds
    this._characterFallbackTimer = setTimeout(() => {
      const colorMap = this._extractColorsFromConcept(concept);
      if (colorMap) {
        this._sendToBridge('set_character', {
          colorMap,
          speech: `Transformed into ${concept}!`,
        });
        this.bot.sendMessage(chatId, `Changed to "${concept}" character! (color-based)`);
      }
    }, 3000);

    // Cancel this timer when AI generates the character
    this._pendingCharacterChatId = chatId;
  }

  /**
   * Called when AI completes character generation
   * Cancels fallback timer and notifies Telegram
   */
  onCharacterGenerated(concept) {
    if (this._characterFallbackTimer) {
      clearTimeout(this._characterFallbackTimer);
      this._characterFallbackTimer = null;
    }
    if (this._pendingCharacterChatId) {
      this.bot?.sendMessage(this._pendingCharacterChatId,
        `"${concept}" character created! Custom character generated by AI!`);
      this._pendingCharacterChatId = null;
    }
  }

  /**
   * Extract colors from concept text (fallback when AI unavailable)
   * Determines color palette via keyword matching
   */
  _extractColorsFromConcept(concept) {
    const c = concept.toLowerCase();

    // Color keyword -> palette mapping
    const colorKeywords = {
      // Blue family
      '파란': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
      '파랑': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
      'blue': { primary: '#4488ff', secondary: '#6699ff', dark: '#223388', claw: '#4488ff' },
      // Green family
      '초록': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
      '녹색': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
      'green': { primary: '#44cc44', secondary: '#66dd66', dark: '#226622', claw: '#44cc44' },
      // Purple family
      '보라': { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', claw: '#8844cc' },
      'purple': { primary: '#8844cc', secondary: '#aa66dd', dark: '#442266', claw: '#8844cc' },
      // Yellow family
      '노란': { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', claw: '#ffcc00' },
      '금색': { primary: '#ffd700', secondary: '#ffe44d', dark: '#8B7500', claw: '#ffd700' },
      'yellow': { primary: '#ffcc00', secondary: '#ffdd44', dark: '#886600', claw: '#ffcc00' },
      'gold': { primary: '#ffd700', secondary: '#ffe44d', dark: '#8B7500', claw: '#ffd700' },
      // Pink family
      '분홍': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
      '핑크': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
      'pink': { primary: '#ff69b4', secondary: '#ff8cc4', dark: '#8B3060', claw: '#ff69b4' },
      // White family
      '하얀': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
      '흰': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
      'white': { primary: '#eeeeee', secondary: '#ffffff', dark: '#999999', claw: '#dddddd' },
      // Black family
      '검정': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
      '까만': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
      'black': { primary: '#333333', secondary: '#555555', dark: '#111111', claw: '#444444' },
      // Orange family
      '주황': { primary: '#ff8800', secondary: '#ffaa33', dark: '#884400', claw: '#ff8800' },
      'orange': { primary: '#ff8800', secondary: '#ffaa33', dark: '#884400', claw: '#ff8800' },
      // Teal/Mint family
      '민트': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
      '틸': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
      'teal': { primary: '#00BFA5', secondary: '#33D4BC', dark: '#006655', claw: '#00BFA5' },
    };

    for (const [keyword, palette] of Object.entries(colorKeywords)) {
      if (c.includes(keyword)) {
        return {
          ...palette,
          eye: '#ffffff',
          pupil: '#111111',
        };
      }
    }

    // Creature keywords -> characteristic colors
    const creatureColors = {
      '고양이': { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', claw: '#ff9944' },
      'cat': { primary: '#ff9944', secondary: '#ffbb66', dark: '#663300', claw: '#ff9944' },
      '강아지': { primary: '#cc8844', secondary: '#ddaa66', dark: '#664422', claw: '#cc8844' },
      'dog': { primary: '#cc8844', secondary: '#ddaa66', dark: '#664422', claw: '#cc8844' },
      '로봇': { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', claw: '#66aaff' },
      'robot': { primary: '#888888', secondary: '#aaaaaa', dark: '#444444', claw: '#66aaff' },
      '슬라임': { primary: '#44dd44', secondary: '#88ff88', dark: '#228822', claw: '#44dd44' },
      'slime': { primary: '#44dd44', secondary: '#88ff88', dark: '#228822', claw: '#44dd44' },
      '유령': { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', claw: '#ccccff' },
      'ghost': { primary: '#ccccff', secondary: '#eeeeff', dark: '#6666aa', claw: '#ccccff' },
      '드래곤': { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', claw: '#ffaa00' },
      'dragon': { primary: '#cc2222', secondary: '#ff4444', dark: '#661111', claw: '#ffaa00' },
      '펭귄': { primary: '#222222', secondary: '#ffffff', dark: '#111111', claw: '#ff8800' },
      'penguin': { primary: '#222222', secondary: '#ffffff', dark: '#111111', claw: '#ff8800' },
      '토끼': { primary: '#ffcccc', secondary: '#ffeeee', dark: '#ff8888', claw: '#ffcccc' },
      'rabbit': { primary: '#ffcccc', secondary: '#ffeeee', dark: '#ff8888', claw: '#ffcccc' },
      '악마': { primary: '#660066', secondary: '#880088', dark: '#330033', claw: '#ff0000' },
      'demon': { primary: '#660066', secondary: '#880088', dark: '#330033', claw: '#ff0000' },
      '천사': { primary: '#ffffff', secondary: '#ffffcc', dark: '#ddddaa', claw: '#ffdd00' },
      'angel': { primary: '#ffffff', secondary: '#ffffcc', dark: '#ddddaa', claw: '#ffdd00' },
    };

    for (const [keyword, palette] of Object.entries(creatureColors)) {
      if (c.includes(keyword)) {
        return {
          ...palette,
          eye: '#ffffff',
          pupil: '#111111',
        };
      }
    }

    // Random color if no match
    const hue = Math.floor(Math.random() * 360);
    return {
      primary: `hsl(${hue}, 70%, 55%)`,
      secondary: `hsl(${hue}, 70%, 70%)`,
      dark: `hsl(${hue}, 60%, 25%)`,
      eye: '#ffffff',
      pupil: '#111111',
      claw: `hsl(${hue}, 70%, 55%)`,
    };
  }

  /**
   * Execute smart file operation + pet animation + Telegram feedback
   */
  async _executeFileOp(chatId, command) {
    if (this._fileOpInProgress) {
      await this.bot.sendMessage(chatId, 'A file operation is already in progress! Please wait.');
      return;
    }

    this._fileOpInProgress = true;

    const callbacks = {
      onStart: (totalFiles) => {
        this.bot.sendMessage(chatId, `Found ${totalFiles} files! Starting to carry them~`);
        this._sendToBridge('ai_decision', {
          action: 'excited',
          speech: `Starting to organize ${totalFiles} files!`,
          emotion: 'happy',
        });
      },

      onPickUp: (fileName, index) => {
        // Pet picks up file animation
        this._sendToBridge('smart_file_op', {
          phase: 'pick_up',
          fileName,
          index,
        });
        this._sendToBridge('ai_decision', {
          action: 'carrying',
          speech: `Picked up ${fileName}!`,
          emotion: 'focused',
        });
      },

      onDrop: (fileName, targetName, index) => {
        // Pet drops file animation
        this._sendToBridge('smart_file_op', {
          phase: 'drop',
          fileName,
          targetName,
          index,
        });
        this._sendToBridge('ai_decision', {
          action: 'walking',
          speech: `Placed ${fileName} in ${targetName}!`,
          emotion: 'happy',
        });
      },

      onComplete: (result) => {
        this._fileOpInProgress = false;

        let message;
        if (result.movedCount === 0) {
          message = 'No files to move!';
        } else {
          message = `Moved ${result.movedCount} files!`;
          if (result.errors.length > 0) {
            message += `\n(${result.errors.length} failed)`;
          }
        }

        this.bot.sendMessage(chatId, message);
        this._sendToBridge('ai_decision', {
          action: 'excited',
          speech: message,
          emotion: 'proud',
        });

        // smart_file_op completion event
        this._sendToBridge('smart_file_op', {
          phase: 'complete',
          movedCount: result.movedCount,
          errors: result.errors,
        });
      },

      onError: (error) => {
        this._fileOpInProgress = false;
        this.bot.sendMessage(chatId, `Error during file operation: ${error}`);
        this._sendToBridge('ai_decision', {
          action: 'scared',
          speech: 'Oops, something went wrong...',
          emotion: 'scared',
        });
      },
    };

    await executeSmartFileOp(command, callbacks);
  }

  /**
   * Query pet status and send to Telegram
   */
  async _sendStatus(chatId) {
    if (!this.bridge) {
      await this.bot.sendMessage(chatId, 'Not connected to AI Bridge.');
      return;
    }

    const state = this.bridge.petState;
    const statusText =
      `State: ${state.state}\n` +
      `Position: (${state.position.x}, ${state.position.y})\n` +
      `Mode: ${state.mode}\n` +
      `Emotion: ${state.emotion}\n` +
      `Evolution: Stage ${state.evolutionStage}\n` +
      `AI Connected: ${this.bridge.isConnected() ? 'Yes' : 'No'}`;

    await this.bot.sendMessage(chatId, statusText);
  }

  /**
   * Undo last file move
   */
  async _undoLastMove(chatId) {
    try {
      const { undoAllSmartMoves } = require('./smart-file-ops');
      const result = undoAllSmartMoves();

      if (result.restoredCount === 0) {
        await this.bot.sendMessage(chatId, 'No file moves to undo.');
      } else {
        let message = `Restored ${result.restoredCount} files to original locations!`;
        if (result.errors.length > 0) {
          message += `\n(${result.errors.length} restore failures)`;
        }
        await this.bot.sendMessage(chatId, message);
        this._sendToBridge('ai_decision', {
          action: 'walking',
          speech: 'Restored files to their original locations!',
          emotion: 'happy',
        });
      }
    } catch (err) {
      await this.bot.sendMessage(chatId, `Undo failed: ${err.message}`);
    }
  }

  /**
   * Forward command to AI Bridge
   */
  _sendToBridge(type, payload) {
    if (!this.bridge) return;

    // Directly invoke bridge's _handleCommand (emit internal event)
    // Mark as command from Telegram
    payload._fromTelegram = true;
    this.bridge.emit(type, payload);
  }

  /**
   * Broadcast message to all active chats
   */
  _broadcastToChats(text) {
    if (!this.bot || !this.active) return;

    for (const chatId of this.activeChatIds) {
      this.bot.sendMessage(chatId, text).catch(() => {
        // Remove chat ID on send failure
        this.activeChatIds.delete(chatId);
      });
    }
  }

  /**
   * Send message to specific chat
   */
  async sendMessage(chatId, text) {
    if (!this.bot || !this.active) return;
    try {
      await this.bot.sendMessage(chatId, text);
    } catch (err) {
      console.error('[Telegram] Message send failed:', err.message);
    }
  }

  /**
   * Stop bot
   */
  stop() {
    if (this.bot && this.active) {
      this.bot.stopPolling();
      this.active = false;
      console.log('[Telegram] Bot stopped');
    }
  }

  /**
   * Check if bot is active
   */
  isActive() {
    return this.active;
  }
}

module.exports = { TelegramBot };
