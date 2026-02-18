/**
 * AI Memory System
 *
 * Short-term (RAM) + Long-term (disk) memory for "surprising UX".
 * - Remembers user patterns and habits
 * - Detects "yesterday at this time..." similarities
 * - Prevents duplicate speech
 * - Tracks emotional baseline
 */
const Store = require('./store');

class AIMemory {
  constructor() {
    this.store = new Store('clawmate-ai-memory', {
      longTerm: {
        userPatterns: {},     // { triggerType: { count, lastSeen, hourCounts: {} } }
        preferences: {},      // reaction preferences
        highlights: [],       // memorable events (max 50)
        dailyLogs: {},        // { 'YYYY-MM-DD': { summary, triggers: {}, activeHours: [] } }
      },
      emotionalBaseline: { mood: 'neutral', momentum: 0.5 },
    });

    // Short-term memory (RAM only)
    this.shortTerm = [];        // recent AI interactions (max 20)
    this.recentSpeech = [];     // recent speech texts (max 10, dedup)
    this.todayTriggers = {};    // today's trigger counts
    this.sessionStart = Date.now();

    // Periodic save timer
    this._saveTimer = setInterval(() => this.savePeriodic(), 1800000); // 30min
  }

  // === Short-term Memory ===

  addInteraction(trigger, aiResponse) {
    this.shortTerm.push({
      trigger,
      response: aiResponse,
      timestamp: Date.now(),
    });
    if (this.shortTerm.length > 20) this.shortTerm.shift();

    // Track speech for dedup
    if (aiResponse?.speech) {
      this.recentSpeech.push(aiResponse.speech);
      if (this.recentSpeech.length > 10) this.recentSpeech.shift();
    }

    // Update trigger count
    this.todayTriggers[trigger] = (this.todayTriggers[trigger] || 0) + 1;

    // Update long-term patterns
    this.updateUserPatterns(trigger);
  }

  getRecentContext(count = 5) {
    return this.shortTerm.slice(-count).map(i => ({
      trigger: i.trigger,
      speech: i.response?.speech || null,
      time: new Date(i.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    }));
  }

  isDuplicate(speech) {
    if (!speech) return false;
    return this.recentSpeech.some(s =>
      s === speech || this._similarity(s, speech) > 0.8
    );
  }

  // === Long-term Memory ===

  updateUserPatterns(triggerType) {
    const lt = this.store.get('longTerm');
    if (!lt.userPatterns) lt.userPatterns = {};

    const hour = new Date().getHours();
    const pattern = lt.userPatterns[triggerType] || { count: 0, lastSeen: 0, hourCounts: {} };

    pattern.count++;
    pattern.lastSeen = Date.now();
    pattern.hourCounts[hour] = (pattern.hourCounts[hour] || 0) + 1;

    lt.userPatterns[triggerType] = pattern;
    this.store.set('longTerm', lt);
  }

  addHighlight(event, significance = 'normal') {
    const lt = this.store.get('longTerm');
    if (!lt.highlights) lt.highlights = [];

    lt.highlights.push({
      event,
      significance,
      timestamp: Date.now(),
      date: new Date().toISOString().slice(0, 10),
    });

    // Keep max 50
    if (lt.highlights.length > 50) {
      lt.highlights = lt.highlights.slice(-50);
    }

    this.store.set('longTerm', lt);
  }

  getPersonalityInsight() {
    const lt = this.store.get('longTerm');
    const patterns = lt.userPatterns || {};

    const insights = [];

    // Find top activities
    const sorted = Object.entries(patterns)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    if (sorted.length > 0) {
      const topActivities = sorted.map(([trigger, data]) => {
        const peakHour = this._getPeakHour(data.hourCounts);
        return `${trigger}(${data.count}회, 주로 ${peakHour}시)`;
      });
      insights.push(`주요 활동: ${topActivities.join(', ')}`);
    }

    // Recent highlights
    const recentHighlights = (lt.highlights || []).slice(-3);
    if (recentHighlights.length > 0) {
      insights.push(`최근 기억: ${recentHighlights.map(h => h.event).join(', ')}`);
    }

    return insights.join('\n') || '아직 사용자를 잘 모릅니다.';
  }

  getDailyLog(date) {
    const lt = this.store.get('longTerm');
    return (lt.dailyLogs || {})[date] || null;
  }

  getYesterdaySimilarity(currentTrigger) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const log = this.getDailyLog(yesterday);
    if (!log || !log.triggers) return null;

    const hour = new Date().getHours();
    const hourKey = `${hour}`;

    // Check if same trigger at same hour yesterday
    if (log.triggers[currentTrigger]?.hours?.includes(hourKey)) {
      return `어제 이 시간에도 ${this._triggerToKorean(currentTrigger)} 했었어.`;
    }
    return null;
  }

  // === Emotional State ===

  updateMood(trigger) {
    const baseline = this.store.get('emotionalBaseline');

    const moodEffects = {
      error_detected: { mood: 'worried', delta: -0.1 },
      error_loop: { mood: 'worried', delta: -0.2 },
      late_night: { mood: 'sleepy', delta: -0.05 },
      dawn_coding: { mood: 'sleepy', delta: -0.15 },
      deep_focus: { mood: 'focused', delta: 0.1 },
      coding_detected: { mood: 'curious', delta: 0.05 },
      shopping_detected: { mood: 'playful', delta: 0.05 },
      idle_return: { mood: 'happy', delta: 0.1 },
      social_scrolling: { mood: 'neutral', delta: 0 },
      procrastination: { mood: 'worried', delta: -0.05 },
    };

    const effect = moodEffects[trigger];
    if (effect) {
      baseline.mood = effect.mood;
      baseline.momentum = Math.max(0, Math.min(1, baseline.momentum + effect.delta));
    }

    this.store.set('emotionalBaseline', baseline);
  }

  getCurrentMood() {
    const baseline = this.store.get('emotionalBaseline');
    return {
      mood: baseline.mood || 'neutral',
      intensity: baseline.momentum || 0.5,
    };
  }

  // === Autonomous Thinking Context ===

  getObservationContext() {
    const mood = this.getCurrentMood();
    const recent = this.getRecentContext(3);
    const personality = this.getPersonalityInsight();

    const parts = [];
    parts.push(`현재 기분: ${mood.mood} (강도: ${Math.round(mood.intensity * 100)}%)`);

    if (recent.length > 0) {
      parts.push(`최근 대화:\n${recent.map(r => `  ${r.time} [${r.trigger}] → "${r.speech || '(조용히)'}"`).join('\n')}`);
    }

    if (personality !== '아직 사용자를 잘 모릅니다.') {
      parts.push(`사용자 성격:\n${personality}`);
    }

    return parts.join('\n\n');
  }

  // === Periodic Save ===

  savePeriodic() {
    const today = new Date().toISOString().slice(0, 10);
    const lt = this.store.get('longTerm');
    if (!lt.dailyLogs) lt.dailyLogs = {};

    const hour = new Date().getHours().toString();
    const log = lt.dailyLogs[today] || { triggers: {}, activeHours: [] };

    // Save today's triggers
    for (const [trigger, count] of Object.entries(this.todayTriggers)) {
      if (!log.triggers[trigger]) log.triggers[trigger] = { count: 0, hours: [] };
      log.triggers[trigger].count += count;
      if (!log.triggers[trigger].hours.includes(hour)) {
        log.triggers[trigger].hours.push(hour);
      }
    }

    // Track active hours
    if (!log.activeHours.includes(hour)) {
      log.activeHours.push(hour);
    }

    lt.dailyLogs[today] = log;

    // Keep only last 7 days
    const dates = Object.keys(lt.dailyLogs).sort();
    while (dates.length > 7) {
      delete lt.dailyLogs[dates.shift()];
    }

    this.store.set('longTerm', lt);

    // Reset today counters (they've been saved)
    this.todayTriggers = {};
  }

  destroy() {
    if (this._saveTimer) clearInterval(this._saveTimer);
    this.savePeriodic();
  }

  // === Internal Helpers ===

  _similarity(a, b) {
    if (a === b) return 1;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    const editDist = this._editDistance(longer, shorter);
    return (longer.length - editDist) / longer.length;
  }

  _editDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        matrix[i][j] = b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
    return matrix[b.length][a.length];
  }

  _getPeakHour(hourCounts) {
    if (!hourCounts || Object.keys(hourCounts).length === 0) return '?';
    return Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
  }

  _triggerToKorean(trigger) {
    const map = {
      shopping_detected: '쇼핑',
      coding_detected: '코딩',
      video_watching: '영상 시청',
      social_scrolling: 'SNS 스크롤',
      news_reading: '뉴스 읽기',
      gaming_detected: '게임',
      late_night: '밤늦게까지 깨어있기',
      deep_focus: '집중 작업',
      error_detected: '에러 마주치기',
      idle_return: '자리 비우기',
    };
    return map[trigger] || trigger;
  }
}

module.exports = { AIMemory };
