/**
 * AI <-> ClawMate Bridge
 *
 * AI agent serves as ClawMate's brain.
 * - AI -> ClawMate: Action commands, speech bubbles, emotions, movement
 * - ClawMate -> AI: User events (click, drag, cursor, file changes)
 *
 * Communication: WebSocket (local ws://localhost:9320)
 * Protocol: JSON messages
 *
 * When AI is not connected -> falls back to autonomous mode (existing FSM)
 */
const WebSocket = require('ws');
const EventEmitter = require('events');

class AIBridge extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.client = null;           // Connected AI agent
    this.connected = false;
    this.port = 9320;
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;
    this.petState = {
      mode: 'pet',
      position: { x: 0, y: 0, edge: 'bottom' },
      state: 'idle',
      emotion: 'neutral',
      evolutionStage: 0,
      memory: {},
    };
  }

  /**
   * Start WebSocket server -- AI agent connects here
   */
  start() {
    this.wss = new WebSocket.Server({ port: this.port, host: '127.0.0.1' });

    this.wss.on('connection', (ws) => {
      console.log('[AI Bridge] AI connected');
      this.client = ws;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');

      // Send current state to AI
      this.send('sync', this.petState);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleCommand(msg);
        } catch (err) {
          console.error('[AI Bridge] Message parsing failed:', err);
        }
      });

      ws.on('close', () => {
        console.log('[AI Bridge] AI disconnected');
        this.client = null;
        this.connected = false;
        this.emit('disconnected');
      });

      ws.on('error', (err) => {
        console.error('[AI Bridge] WebSocket error:', err.message);
      });

      // Heartbeat
      this.heartbeatInterval = setInterval(() => {
        if (this.connected) {
          this.send('heartbeat', { timestamp: Date.now() });
        }
      }, 30000);
    });

    this.wss.on('error', (err) => {
      console.error('[AI Bridge] Server error:', err.message);
    });

    console.log(`[AI Bridge] Listening on ws://127.0.0.1:${this.port}`);
  }

  /**
   * Handle commands from AI
   */
  _handleCommand(msg) {
    const { type, payload } = msg;

    switch (type) {
      // === Behavior Control ===
      case 'action':
        // AI directly commands pet behavior
        // payload: { state: 'walking'|'excited'|..., duration?: ms }
        this.emit('action', payload);
        break;

      case 'move':
        // Move to specific position
        // payload: { x, y, speed? }
        this.emit('move', payload);
        break;

      case 'emote':
        // Express emotion
        // payload: { emotion: 'happy'|'curious'|'sleepy'|... }
        this.emit('emote', payload);
        break;

      // === Speech ===
      case 'speak':
        // AI speaks to user through the pet
        // payload: { text: string, style?: 'normal'|'thought'|'shout' }
        this.emit('speak', payload);
        break;

      case 'think':
        // Thought bubble (... form)
        // payload: { text: string }
        this.emit('think', payload);
        break;

      // === File Operations ===
      case 'carry_file':
        // Command to pick up specific file
        // payload: { fileName: string, targetX?: number }
        this.emit('carry_file', payload);
        break;

      case 'drop_file':
        this.emit('drop_file', payload);
        break;

      case 'smart_file_op':
        // Smart file operation (triggered by Telegram or AI)
        // payload: { phase: 'pick_up'|'drop'|'complete', fileName?, targetName?, ... }
        this.emit('smart_file_op', payload);
        break;

      // === Appearance Changes ===
      case 'evolve':
        // Evolution trigger
        // payload: { stage: number }
        this.emit('evolve', payload);
        break;

      case 'set_mode':
        // Mode switching
        // payload: { mode: 'pet'|'incarnation' }
        this.emit('set_mode', payload);
        break;

      case 'accessorize':
        // Add temporary accessory
        // payload: { type: string, duration?: ms }
        this.emit('accessorize', payload);
        break;

      // === Spatial Movement Commands ===
      case 'jump_to':
        // Jump to specific position
        // payload: { x, y }
        this.emit('jump_to', payload);
        break;

      case 'rappel':
        // Rappel (descend from ceiling/wall on thread)
        // payload: {}
        this.emit('rappel', payload);
        break;

      case 'release_thread':
        // Release rappel thread (fall)
        // payload: {}
        this.emit('release_thread', payload);
        break;

      case 'move_to_center':
        // Move to screen center
        // payload: {}
        this.emit('move_to_center', payload);
        break;

      case 'walk_on_window':
        // Move onto specific window title bar
        // payload: { windowId, x, y }
        this.emit('walk_on_window', payload);
        break;

      case 'query_windows':
        // Window position info request -> handled by main process
        this.emit('query_windows', payload);
        break;

      // === Custom Movement Patterns ===
      case 'register_movement':
        // AI registers custom movement pattern
        // payload: { name: string, definition: { type: 'waypoints'|'formula'|'sequence', ... } }
        this.emit('register_movement', payload);
        break;

      case 'custom_move':
        // Execute registered custom movement pattern
        // payload: { name: string, params?: object }
        this.emit('custom_move', payload);
        break;

      case 'stop_custom_move':
        // Force stop current custom movement
        // payload: {}
        this.emit('stop_custom_move', payload);
        break;

      case 'list_movements':
        // Request registered movement pattern list -> response sent via renderer's reportToAI
        // payload: {}
        this.emit('list_movements', payload);
        break;

      // === Character Customization ===
      case 'set_character':
        // Apply AI-generated character data
        // payload: { colorMap?: {...}, frames?: {...} }
        this.emit('set_character', payload);
        break;

      case 'reset_character':
        // Reset to default character
        this.emit('reset_character', payload);
        break;

      case 'set_persona':
        // Bot persona switching (Incarnation mode)
        // payload: { name, personality, speakingStyle, color?, ... }
        this.emit('set_persona', payload);
        break;

      // === Context Queries ===
      case 'query_state':
        // Request current pet state
        this.send('state_response', this.petState);
        break;

      case 'query_screen':
        // Request screen info
        this.emit('query_screen', payload);
        break;

      // === AI Decision Result ===
      case 'ai_decision':
        // AI's comprehensive decision
        // payload: { action, speech?, emotion?, reasoning? }
        this.emit('ai_decision', payload);
        break;

      default:
        console.log(`[AI Bridge] Unknown command: ${type}`);
    }
  }

  /**
   * Send event to AI
   */
  send(type, payload) {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) return false;
    try {
      this.client.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
      return true;
    } catch {
      return false;
    }
  }

  // === User Event Reports (ClawMate -> AI) ===

  reportUserClick(position) {
    this.send('user_event', {
      event: 'click',
      position,
      petState: this.petState.state,
    });
  }

  reportUserDrag(from, to) {
    this.send('user_event', {
      event: 'drag',
      from, to,
    });
  }

  reportCursorNear(distance, cursorPos) {
    this.send('user_event', {
      event: 'cursor_near',
      distance, cursorPos,
    });
  }

  reportDesktopChange(files) {
    this.send('user_event', {
      event: 'desktop_changed',
      files,
    });
  }

  reportTimeChange(hour, period) {
    this.send('user_event', {
      event: 'time_change',
      hour, period,
    });
  }

  reportMilestone(milestone, data) {
    this.send('user_event', {
      event: 'milestone',
      milestone, data,
    });
  }

  reportIdleTime(seconds) {
    this.send('user_event', {
      event: 'user_idle',
      idleSeconds: seconds,
    });
  }

  reportScreenCapture(imageBase64, width, height) {
    this.send('screen_capture', {
      image: imageBase64,
      width,
      height,
      timestamp: Date.now(),
    });
  }

  /**
   * Send metrics data to AI
   * Forwards pet behavior quality metrics collected by renderer to AI
   */
  reportMetrics(summary) {
    this.send('metrics_report', {
      metrics: summary,
      timestamp: Date.now(),
    });
  }

  /**
   * Report proactive trigger event to AI
   * Sent when ProactiveMonitor detects user activity patterns
   */
  reportProactiveEvent(triggerType, context) {
    this.send('proactive_trigger', {
      trigger: triggerType,
      context,
      timestamp: Date.now(),
    });
  }

  // === State Updates ===

  updatePetState(updates) {
    Object.assign(this.petState, updates);
    this.send('pet_state_update', this.petState);
  }

  isConnected() {
    return this.connected;
  }

  stop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.client) this.client.close();
    if (this.wss) this.wss.close();
  }
}

module.exports = { AIBridge };
