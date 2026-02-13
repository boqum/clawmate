/**
 * AI Agent-side Connector
 *
 * Client for AI to connect to ClawMate and control the pet.
 * Used in the ClawMate plugin (index.js).
 *
 * Usage:
 *   const connector = new ClawMateConnector();
 *   await connector.connect();
 *   connector.speak('Hello! What are you doing today?');
 *   connector.action('excited');
 *   connector.onUserEvent((event) => { ... AI decides reaction ... });
 */
const WebSocket = require('ws');
const EventEmitter = require('events');

class ClawMateConnector extends EventEmitter {
  constructor(port = 9320) {
    super();
    this.port = port;
    this.ws = null;
    this.connected = false;
    this.petState = null;
    this._reconnectTimer = null;
    this._autoReconnect = true;
    this._stateResolvers = [];
  }

  /**
   * Connect to ClawMate
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);

        this.ws.on('open', () => {
          this.connected = true;
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this._handleMessage(msg);
          } catch {}
        });

        this.ws.on('close', () => {
          this.connected = false;
          this.emit('disconnected');
          if (this._autoReconnect) {
            this._reconnectTimer = setTimeout(() => this.connect().catch(() => {}), 5000);
          }
        });

        this.ws.on('error', (err) => {
          if (!this.connected) reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  _handleMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'sync':
      case 'state_response':
      case 'pet_state_update':
        this.petState = payload;
        this.emit('state_update', payload);
        // Resolve queryState() Promise
        if (type === 'state_response' && this._stateResolvers.length > 0) {
          const resolver = this._stateResolvers.shift();
          resolver(payload);
        }
        break;

      case 'user_event':
        // User event -> AI decides reaction
        this.emit('user_event', payload);
        break;

      case 'screen_capture':
        // Screen capture response -> AI analyzes
        this.emit('screen_capture', payload);
        break;

      case 'window_positions':
        // Window position info response -> used by exploration system
        this.emit('window_positions', payload);
        break;

      case 'metrics_report':
        // Metrics data received -> AI analyzes
        this.emit('metrics_report', payload);
        break;

      case 'heartbeat':
        break;
    }
  }

  _send(type, payload) {
    if (!this.ws || !this.connected) return false;
    try {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      return false;
    }
  }

  // === AI -> ClawMate Command API ===

  /** Make the pet speak */
  speak(text, style = 'normal') {
    return this._send('speak', { text, style });
  }

  /** Make the pet think (shows ... in speech bubble) */
  think(text) {
    return this._send('think', { text });
  }

  /** Change pet behavior */
  action(state, duration) {
    return this._send('action', { state, duration });
  }

  /** Move to specific position */
  moveTo(x, y, speed) {
    return this._send('move', { x, y, speed });
  }

  /** Express emotion */
  emote(emotion) {
    return this._send('emote', { emotion });
  }

  /** Pick up file */
  carryFile(fileName, targetX) {
    return this._send('carry_file', { fileName, targetX });
  }

  /** Drop file */
  dropFile() {
    return this._send('drop_file', {});
  }

  /** Switch mode */
  setMode(mode) {
    return this._send('set_mode', { mode });
  }

  /** Trigger evolution */
  evolve(stage) {
    return this._send('evolve', { stage });
  }

  /**
   * Send comprehensive AI decision
   * Sends the AI's analyzed decision in a single message
   */
  decide(decision) {
    return this._send('ai_decision', decision);
  }

  // === Spatial Movement API (pet roams the computer like its "home") ===

  /** Jump to specific position */
  jumpTo(x, y) {
    return this._send('jump_to', { x, y });
  }

  /** Start rappelling (descend from ceiling/wall on thread) */
  rappel() {
    return this._send('rappel', {});
  }

  /** Release rappel thread (fall) */
  releaseThread() {
    return this._send('release_thread', {});
  }

  /** Move to screen center */
  moveToCenter() {
    return this._send('move_to_center', {});
  }

  /** Jump onto specific window */
  walkOnWindow(windowId, x, y) {
    return this._send('walk_on_window', { windowId, x, y });
  }

  /** Request list of open windows */
  queryWindows() {
    return this._send('query_windows', {});
  }

  // === Custom Movement Pattern API ===

  /**
   * Register custom movement pattern
   * Dynamically add new movement patterns to ClawMate
   *
   * @param {string} name - Pattern name (e.g., 'figure8', 'spiral')
   * @param {object} definition - Pattern definition
   *   type: 'waypoints' | 'formula' | 'sequence'
   *   waypoints?: [{x, y, pause?}]      -- Sequential waypoint movement
   *   formula?: { xAmp, yAmp, xFreq, yFreq, xPhase, yPhase }  -- Mathematical orbit
   *   sequence?: ['zigzag', 'shake']     -- Execute existing patterns sequentially
   *   duration?: number                  -- Duration (ms, for formula type)
   *   speed?: number                     -- Movement speed
   *
   * Usage:
   *   connector.registerMovement('figure8', {
   *     type: 'formula',
   *     formula: { xAmp: 80, yAmp: 40, xFreq: 1, yFreq: 2 },
   *     duration: 4000,
   *   });
   */
  registerMovement(name, definition) {
    return this._send('register_movement', { name, definition });
  }

  /**
   * Execute registered custom movement pattern
   *
   * @param {string} name - Pattern name to execute
   *   Built-in patterns: 'zigzag', 'patrol', 'circle', 'shake', 'dance'
   *   Or custom patterns registered via registerMovement()
   * @param {object} params - Execution parameters (varies by pattern)
   *
   * Usage:
   *   connector.customMove('zigzag', { distance: 200, amplitude: 30 });
   *   connector.customMove('patrol', { pointAX: 100, pointBX: 500, laps: 5 });
   *   connector.customMove('shake', { intensity: 6, duration: 1000 });
   */
  customMove(name, params = {}) {
    return this._send('custom_move', { name, params });
  }

  /** Force stop currently running custom movement */
  stopCustomMove() {
    return this._send('stop_custom_move', {});
  }

  /** Request list of registered movement patterns (response via user_event) */
  listMovements() {
    return this._send('list_movements', {});
  }

  /** Send smart file operation command */
  smartFileOp(payload) {
    return this._send('smart_file_op', payload);
  }

  /** Send character data (apply AI-generated character) */
  setCharacter(data) {
    return this._send('set_character', data);
  }

  /** Reset to default character */
  resetCharacter() {
    return this._send('reset_character', {});
  }

  /** Switch persona (reflect bot personality in Incarnation mode) */
  setPersona(data) {
    return this._send('set_persona', data);
  }

  /**
   * Request current pet state (returns Promise)
   * Resolves when state_response arrives from server, returns cached state on timeout
   */
  queryState(timeout = 2000) {
    return new Promise((resolve) => {
      const sent = this._send('query_state', {});
      if (!sent) {
        resolve(this.petState);
        return;
      }
      this._stateResolvers.push(resolve);
      setTimeout(() => {
        const idx = this._stateResolvers.indexOf(resolve);
        if (idx !== -1) {
          this._stateResolvers.splice(idx, 1);
          resolve(this.petState);
        }
      }, timeout);
    });
  }

  /** Request screen capture (ClawMate takes screenshot and responds) */
  requestScreenCapture() {
    return this._send('query_screen', {});
  }

  /** Register screen capture response listener */
  onScreenCapture(callback) {
    this.on('screen_capture', callback);
  }

  /** Register user event listener */
  onUserEvent(callback) {
    this.on('user_event', callback);
  }

  /** Register metrics report listener */
  onMetrics(callback) {
    this.on('metrics_report', callback);
  }

  disconnect() {
    this._autoReconnect = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

module.exports = { ClawMateConnector };
