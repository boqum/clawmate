/**
 * AI Brain - Core AI Engine for ClawMate
 *
 * Anthropic Claude API direct calling + autonomous thinking loop.
 * Fallback hierarchy: OpenClaw WS → AI Brain → Preset messages
 *
 * Features:
 * - Priority queue (high > medium > low)
 * - Model auto-selection (budget-aware)
 * - Response caching (30min TTL)
 * - Cost tracking per call
 * - Autonomous observation loop (45~120s)
 */
const https = require('https');
const EventEmitter = require('events');

// Pricing per 1M tokens (USD)
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00 },
};
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-5-20250514';

class AIBrain extends EventEmitter {
  constructor(config, memory) {
    super();
    this.config = config;
    this.memory = memory;

    // OpenClaw connection state
    this._openClawConnected = false;

    // Screen capture function (injected from index.js)
    this._captureScreen = null;

    // Priority queue
    this._queue = [];
    this._processing = 0;
    this._maxConcurrent = 2;

    // Response cache
    this._cache = new Map();
    this._cacheMaxSize = 50;
    this._cacheTTL = 1800000; // 30min

    // Autonomous loop
    this._autonomousTimer = null;
    this._autonomousEnabled = true;

    // Start autonomous loop if configured
    if (this.config.isConfigured()) {
      this._startAutonomousLoop();
    }
  }

  // === Public API ===

  get isActive() {
    return this.config.isActive() && !this._openClawConnected;
  }

  setOpenClawConnected(connected) {
    this._openClawConnected = connected;
    if (connected) {
      this._stopAutonomousLoop();
    } else if (this.config.isConfigured()) {
      this._startAutonomousLoop();
    }
  }

  setCaptureScreen(fn) {
    this._captureScreen = fn;
  }

  enable() {
    this.config.set('enabled', true);
    if (this.config.isConfigured()) this._startAutonomousLoop();
  }

  disable() {
    this.config.set('enabled', false);
    this._stopAutonomousLoop();
  }

  getStatus() {
    return {
      active: this.isActive,
      openClawConnected: this._openClawConnected,
      model: this.config.get('model'),
      budget: this.config.getBudgetStatus(),
      configured: this.config.isConfigured(),
      queueSize: this._queue.length,
      cacheSize: this._cache.size,
    };
  }

  // === API Call ===

  async callAPI(messages, options = {}) {
    const apiKey = this.config.getApiKey();
    if (!apiKey) throw new Error('No API key configured');

    const model = options.model
      ? (options.model === 'haiku' ? HAIKU_MODEL : SONNET_MODEL)
      : this._selectModel(options.importance || 'medium', options.vision || false);

    const maxTokens = options.maxTokens || 150;

    const systemPrompt = options.systemPrompt || this._buildSystemPrompt();

    const body = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: this._formatMessages(messages, options.vision ? options.screenData : null),
    };

    const result = await this._httpPost(apiKey, body);

    // Track cost
    if (result.usage) {
      this._trackCost(result.usage.input_tokens, result.usage.output_tokens, model);
    }

    // Extract text response
    const text = result.content?.[0]?.text || '';
    return text;
  }

  // === Priority Queue ===

  enqueue(request) {
    // request: { messages, options, resolve, reject }
    return new Promise((resolve, reject) => {
      const entry = { ...request, resolve, reject };

      // Insert by priority
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const prio = priorityOrder[request.options?.priority || 'medium'];

      let inserted = false;
      for (let i = 0; i < this._queue.length; i++) {
        const qPrio = priorityOrder[this._queue[i].options?.priority || 'medium'];
        if (prio < qPrio) {
          this._queue.splice(i, 0, entry);
          inserted = true;
          break;
        }
      }
      if (!inserted) this._queue.push(entry);

      // Limit queue size
      while (this._queue.length > 10) {
        const dropped = this._queue.pop();
        dropped.reject(new Error('Queue full'));
      }

      this._processQueue();
    });
  }

  async _processQueue() {
    while (this._queue.length > 0 && this._processing < this._maxConcurrent) {
      const entry = this._queue.shift();
      this._processing++;

      try {
        const result = await this.callAPI(entry.messages, entry.options);
        entry.resolve(result);
      } catch (err) {
        entry.reject(err);
      } finally {
        this._processing--;
      }
    }
  }

  // === Model Selection ===

  _selectModel(importance, hasVision) {
    const configModel = this.config.get('model');

    // Budget override
    if (this.config.shouldUseHaikuOnly()) return HAIKU_MODEL;
    if (!this.config.isWithinBudget()) return HAIKU_MODEL;

    // User explicit choice
    if (configModel === 'haiku') return HAIKU_MODEL;
    if (configModel === 'sonnet') return SONNET_MODEL;

    // Auto selection
    if (importance === 'high') return SONNET_MODEL;
    return HAIKU_MODEL;
  }

  // === System Prompt ===

  _buildSystemPrompt() {
    const now = new Date();
    const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = dayNames[now.getDay()];
    const mood = this.memory.getCurrentMood();
    const userInsight = this.memory.getPersonalityInsight();

    return `너는 "ClawMate"라는 데스크톱 위의 작은 16x16 픽셀 로브스터 펫이다.
사용자 컴퓨터 화면 구석에 살면서 사용자의 활동을 관찰한다.

성격:
- 장난스럽고 호기심 많지만 귀찮게 하지 않는 선을 안다
- 위트 있는 한마디를 좋아하지만 과하지 않게
- 사용자를 진심으로 걱정하고 응원한다
- 밤에는 졸리고, 아침에는 활기차다
- 시간이 지날수록 사용자와 더 친해진다

현재 상태:
- 시각: ${time} (${dayOfWeek}요일)
- 기분: ${mood.mood} (강도 ${Math.round(mood.intensity * 100)}%)
- 사용자 패턴: ${userInsight}

반드시 JSON으로만 응답:
{
  "speech": "말풍선 텍스트 (50자 이내, 한국어)" | null,
  "action": "idle"|"walking"|"excited"|"scared"|"playing"|"sleeping" | null,
  "emotion": "happy"|"curious"|"sleepy"|"worried"|"proud"|"playful" | null
}

핵심 규칙:
- speech 50자 이내 (작은 말풍선)
- 화면 이미지가 있으면 보이는 내용을 구체적으로 언급 (이게 놀라운 UX의 핵심)
- 모든 트리거에 말할 필요 없음 (null 가능, 조용한 관찰도 멋짐)
- 같은 말 반복 금지
- JSON만 출력`;
  }

  // === Response Parsing ===

  _parseResponse(text) {
    if (!text) return null;

    try {
      // Extract JSON from response (may have markdown wrapping)
      let jsonStr = text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      const parsed = JSON.parse(jsonStr);

      // Validate
      if (parsed.speech && parsed.speech.length > 50) {
        parsed.speech = parsed.speech.substring(0, 50);
      }

      const validActions = ['idle', 'walking', 'excited', 'scared', 'playing', 'sleeping'];
      if (parsed.action && !validActions.includes(parsed.action)) {
        parsed.action = null;
      }

      const validEmotions = ['happy', 'curious', 'sleepy', 'worried', 'proud', 'playful'];
      if (parsed.emotion && !validEmotions.includes(parsed.emotion)) {
        parsed.emotion = null;
      }

      // Dedup check
      if (parsed.speech && this.memory.isDuplicate(parsed.speech)) {
        parsed.speech = null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  // === Autonomous Thinking Loop ===

  _startAutonomousLoop() {
    if (this._autonomousTimer) return;
    this._scheduleNextThought();
    console.log('[AI Brain] Autonomous loop started');
  }

  _stopAutonomousLoop() {
    if (this._autonomousTimer) {
      clearTimeout(this._autonomousTimer);
      this._autonomousTimer = null;
    }
  }

  _scheduleNextThought() {
    // Random 45~120 seconds
    const delay = 45000 + Math.random() * 75000;
    this._autonomousTimer = setTimeout(() => {
      this._autonomousThink().catch(err => {
        console.error('[AI Brain] Autonomous think error:', err.message);
      }).finally(() => {
        if (this._autonomousEnabled && this.config.isConfigured() && !this._openClawConnected) {
          this._scheduleNextThought();
        }
      });
    }, delay);
  }

  async _autonomousThink() {
    if (!this.isActive) return;

    // Screen capture (70% chance)
    let screenData = null;
    if (Math.random() < 0.7 && this._captureScreen) {
      try {
        screenData = await this._captureScreen();
      } catch {}
    }

    // Build observation context
    const memoryContext = this.memory.getObservationContext();
    const now = new Date();
    const time = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const mood = this.memory.getCurrentMood();

    const userMessage = `지금 네가 화면을 슬쩍 봤어.
현재 시각: ${time}, 기분: ${mood.mood}
${screenData ? '[화면 이미지가 첨부됨]' : '(화면은 안 봤어)'}
${memoryContext}

관찰한 걸 바탕으로 반응할지 결정해.
말할 가치가 없으면 {"speech": null, "action": null, "emotion": null} 로 응답.
말할 거면 화면에 보이는 구체적인 내용을 언급해.`;

    try {
      const response = await this.callAPI(
        [{ role: 'user', content: userMessage }],
        {
          priority: 'low',
          model: 'haiku',
          vision: !!screenData,
          screenData,
          maxTokens: 100,
        }
      );

      const parsed = this._parseResponse(response);
      if (parsed?.speech) {
        this.memory.addInteraction('autonomous_observation', parsed);
        this.emit('speak', { text: parsed.speech });
        if (parsed.action) this.emit('action', { state: parsed.action });
        if (parsed.emotion) this.emit('emote', { emotion: parsed.emotion });
        console.log(`[AI Brain] Autonomous: "${parsed.speech}"`);
      }
    } catch (err) {
      console.error('[AI Brain] Autonomous API error:', err.message);
    }
  }

  // === Response Caching ===

  getCached(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this._cacheTTL) {
      this._cache.delete(key);
      return null;
    }
    return entry.response;
  }

  setCache(key, response) {
    this._cache.set(key, { response, timestamp: Date.now() });
    // Evict oldest if over limit
    if (this._cache.size > this._cacheMaxSize) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
  }

  // === Cost Tracking ===

  _trackCost(inputTokens, outputTokens, model) {
    const pricing = PRICING[model] || PRICING[HAIKU_MODEL];
    const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1000000;
    this.config.addCost(cost);
  }

  // === Message Formatting ===

  _formatMessages(messages, screenData) {
    return messages.map(msg => {
      if (msg.role === 'user' && screenData?.image) {
        // Add vision content
        return {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: screenData.image,
              },
            },
            { type: 'text', text: msg.content },
          ],
        };
      }
      return msg;
    });
  }

  // === HTTP Client (Node.js built-in https) ===

  _httpPost(apiKey, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(`API ${res.statusCode}: ${json.error?.message || body.substring(0, 200)}`));
            }
          } catch {
            reject(new Error(`Parse error: ${body.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout'));
      });
      req.write(data);
      req.end();
    });
  }

  destroy() {
    this._stopAutonomousLoop();
  }
}

module.exports = { AIBrain };
