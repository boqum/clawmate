/**
 * AI Brain Triggers
 *
 * ProactiveMonitor trigger → AI prompt → execute response.
 * Handles importance classification, batch buffering,
 * vision prompts, and pattern memory integration.
 */

// Trigger importance classification
const IMPORTANCE = {
  HIGH: new Set([
    'error_loop', 'checkout_detected', 'late_night', 'dawn_coding',
    'idle_return', 'procrastination',
  ]),
  MEDIUM: new Set([
    'shopping_detected', 'coding_detected', 'social_scrolling',
    'deep_focus', 'error_detected', 'wiki_rabbit_hole',
    'price_comparison', 'focus_break',
  ]),
  // Everything else is LOW
};

// Triggers that benefit from vision (screen capture)
const VISION_TRIGGERS = new Set([
  'shopping_detected', 'coding_detected', 'error_detected', 'error_loop',
  'checkout_detected', 'social_scrolling', 'video_watching',
  'news_reading', 'deep_focus', 'document_editing', 'terminal_active',
  'dev_web_detected', 'gaming_detected', 'learning_activity',
]);

class AIBrainTriggers {
  constructor(brain, memory, mainWindow) {
    this.brain = brain;
    this.memory = memory;
    this.mainWindow = mainWindow;

    // Batch buffer for LOW triggers
    this._batchBuffer = [];
    this._batchTimer = null;
    this._batchWindow = 10000; // 10s window
  }

  // === Active State ===

  isActive() {
    return this.brain.isActive;
  }

  // === Main Handler ===

  async handleTrigger(event) {
    if (!this.isActive()) return;

    const { trigger, context, timestamp } = event;
    const importance = this._getImportance(trigger);

    // Update memory mood
    this.memory.updateMood(trigger);

    // LOW triggers → batch buffer
    if (importance === 'low') {
      this._addToBatch(event);
      return;
    }

    // MEDIUM / HIGH → immediate processing
    await this._processTrigger(event, importance);
  }

  // === Batch Processing ===

  _addToBatch(event) {
    this._batchBuffer.push(event);

    if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => {
        this._processBatch().catch(err => {
          console.error('[AI Triggers] Batch error:', err.message);
        });
      }, this._batchWindow);
    }
  }

  async _processBatch() {
    this._batchTimer = null;
    if (this._batchBuffer.length === 0) return;
    if (!this.isActive()) { this._batchBuffer = []; return; }

    // Pick most interesting trigger from batch
    const batch = [...this._batchBuffer];
    this._batchBuffer = [];

    // Prefer triggers with vision capability
    const visionTrigger = batch.find(e => VISION_TRIGGERS.has(e.trigger));
    const chosen = visionTrigger || batch[batch.length - 1];

    await this._processTrigger(chosen, 'low');
  }

  // === Process Single Trigger ===

  async _processTrigger(event, importance) {
    const { trigger, context } = event;

    // Check cache
    const cacheKey = `${trigger}:${context.activeApp || ''}`;
    const cached = this.brain.getCached(cacheKey);
    if (cached && importance === 'low') {
      this._executeResponse(cached);
      return;
    }

    // Check "yesterday similarity"
    const yesterday = this.memory.getYesterdaySimilarity(trigger);

    // Build prompt
    const hasScreen = !!context.screen;
    const prompt = this._buildTriggerPrompt(trigger, context, yesterday);

    try {
      const response = await this.brain.callAPI(
        [{ role: 'user', content: prompt }],
        {
          priority: importance,
          model: importance === 'high' ? 'sonnet' : 'haiku',
          vision: hasScreen,
          screenData: hasScreen ? context.screen : null,
          maxTokens: importance === 'high' ? 150 : 100,
        }
      );

      const parsed = this.brain._parseResponse(response);

      if (parsed) {
        // Cache (non-HIGH only)
        if (importance !== 'high') {
          this.brain.setCache(cacheKey, parsed);
        }

        // Record interaction
        this.memory.addInteraction(trigger, parsed);

        // Execute
        this._executeResponse(parsed);
      }
    } catch (err) {
      console.error(`[AI Triggers] ${trigger} error:`, err.message);
    }
  }

  // === Prompt Builder ===

  _buildTriggerPrompt(trigger, context, yesterday) {
    const base = this._getTriggerPromptTemplate(trigger, context);
    const parts = [base];

    if (yesterday) {
      parts.push(`\n참고 (기억): ${yesterday}`);
    }

    if (context.screen) {
      parts.push('\n[화면 이미지가 첨부됨 - 화면에 보이는 구체적 내용을 언급해]');
    }

    const recentContext = this.memory.getRecentContext(3);
    if (recentContext.length > 0) {
      parts.push(`\n최근 대화 맥락:\n${recentContext.map(r => `  ${r.time}: "${r.speech || '(조용)'}"`).join('\n')}`);
    }

    return parts.join('\n');
  }

  _getTriggerPromptTemplate(trigger, ctx) {
    const templates = {
      // === HIGH ===
      error_loop: () =>
        `사용자에게 에러가 연속 발생 중이다 (${ctx.count || '여러'}번). 타이틀: "${ctx.title || '?'}". 구체적으로 위로하고 격려해.`,

      checkout_detected: () =>
        `사용자가 결제 페이지에 있다. "${ctx.title || '?'}". 장난스럽게 반응해.`,

      late_night: () =>
        `새벽 ${ctx.hour || '?'}시다. 사용자가 아직 깨어있다. 진심으로 걱정하는 톤으로 잠을 권유해. 귀여운 잔소리 느낌.`,

      dawn_coding: () =>
        `새벽 ${ctx.hour || '?'}시에 코딩 중이다. 대단하면서도 걱정되는 반응.`,

      idle_return: () =>
        `사용자가 ${Math.floor((ctx.idleDuration || 0) / 60)}분간 자리를 비웠다가 돌아왔다. 반갑게 맞이해.`,

      procrastination: () =>
        `사용자가 작업↔오락을 ${ctx.switches || '여러'}번 왔다갔다 했다. 부드럽게 격려해. 비난은 안 돼.`,

      // === MEDIUM ===
      shopping_detected: () =>
        `사용자가 쇼핑 중이다 (${ctx.appName || ctx.title || '?'}). 화면에 보이는 상품이나 가격을 구체적으로 언급하며 장난스럽게 반응해.`,

      coding_detected: () =>
        `사용자가 코딩 중이다 (${ctx.appName || 'IDE'}). 화면에 보이는 코드나 파일명을 언급하며 코멘트해. 개발자 유머 OK.`,

      social_scrolling: () =>
        `사용자가 ${ctx.appName || 'SNS'}를 ${Math.floor((ctx.duration || 0) / 60)}분째 스크롤 중. 화면 내용을 참고해서 반응해.`,

      deep_focus: () =>
        `사용자가 ${Math.floor((ctx.duration || 0) / 60)}분째 집중 작업 중 (${ctx.category || '?'}). 격려하거나 가볍게 휴식 제안.`,

      error_detected: () =>
        `에러 창이 감지됐다: "${ctx.title || '?'}". 화면에 보이는 에러 메시지를 읽고 구체적으로 위로해.`,

      wiki_rabbit_hole: () =>
        `사용자가 위키 래빗홀에 빠졌다 (${ctx.count || '여러'}개 페이지). 장난스럽게 지적해.`,

      price_comparison: () =>
        `사용자가 여러 쇼핑 사이트를 비교 중이다. 가격비교 중인 걸 재밌게 언급해.`,

      focus_break: () =>
        `${Math.floor((ctx.focusDuration || 0) / 60)}분간 집중하다가 ${ctx.toCategory || '오락'}으로 빠졌다. 가볍게 반응.`,

      // === LOW (fallback) ===
      video_watching: () =>
        `사용자가 영상 시청 중 (${ctx.title || '?'}). 화면 내용 참고해서 가볍게 코멘트.`,

      news_reading: () =>
        `사용자가 뉴스를 읽고 있다 (${ctx.title || '?'}). 화면 내용 참고.`,

      app_switch: () =>
        `사용자가 "${ctx.from || '?'}"에서 "${ctx.to || '?'}"로 전환했다. 필요하면 가볍게 반응.`,

      search_detected: () =>
        `사용자가 무언가를 검색 중이다. 타이틀: "${ctx.title || '?'}".`,

      gaming_detected: () =>
        `사용자가 게임 중이다 (${ctx.title || '?'}). 장난스럽게 반응.`,

      learning_activity: () =>
        `사용자가 학습 중이다 (${ctx.title || '?'}). 격려해.`,

      music_playing: () =>
        `사용자가 음악을 듣고 있다. 가볍게 반응하거나 말하지 않아도 돼.`,
    };

    const template = templates[trigger];
    if (template) return template();

    // Generic fallback
    return `"${trigger}" 이벤트 발생. 상황: ${ctx.title || ctx.appName || '알 수 없음'}. 적절하게 반응하거나 조용히 있어.`;
  }

  // === Execute Response ===

  _executeResponse(parsed) {
    if (!parsed) return;

    if (parsed.speech) {
      this.emit('speak', parsed);
    }

    // Send to renderer via mainWindow
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (parsed.speech) {
        this.mainWindow.webContents.send('ai-command', {
          type: 'speak', payload: { text: parsed.speech },
        });
      }
      if (parsed.action) {
        this.mainWindow.webContents.send('ai-command', {
          type: 'action', payload: { state: parsed.action },
        });
      }
      if (parsed.emotion) {
        this.mainWindow.webContents.send('ai-command', {
          type: 'emote', payload: { emotion: parsed.emotion },
        });
      }
    }
  }

  // === Helpers ===

  _getImportance(trigger) {
    if (IMPORTANCE.HIGH.has(trigger)) return 'high';
    if (IMPORTANCE.MEDIUM.has(trigger)) return 'medium';
    return 'low';
  }

  destroy() {
    if (this._batchTimer) clearTimeout(this._batchTimer);
  }
}

module.exports = { AIBrainTriggers };
