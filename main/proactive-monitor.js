/**
 * Proactive Monitor - Watches user activity and triggers pet interventions
 *
 * Detects clipboard changes, active window switches, idle patterns,
 * and complex behavioral patterns to decide when the pet should react.
 *
 * Architecture:
 *   ClipboardWatcher (500ms)  --+
 *   ActiveWindowWatcher (5s)  --+--> ContextAnalyzer --> InterventionDecider (cooldown)
 *   IdleDetector (10s)  --------+           |
 *                               +-----------+-----------+
 *                               v                       v
 *                         AIBridge.send()         IPC 'proactive-event'
 *                         (when AI connected)           |
 *                                                       v
 *                                            Renderer ProactiveController
 */
const { clipboard, powerMonitor, desktopCapturer, screen } = require('electron');
const EventEmitter = require('events');

// =========================================================================
// Visual Triggers - 화면 캡처가 AI 판단에 도움이 되는 트리거들
// =========================================================================
const VISUAL_TRIGGERS = new Set([
  'error_detected', 'error_loop', 'checkout_detected', 'shopping_detected',
  'coding_detected', 'terminal_active', 'idle_return',
  'video_watching', 'news_reading', 'document_editing', 'learning_activity',
  'finance_activity', 'food_ordering', 'travel_planning', 'search_detected',
  'gaming_detected', 'meeting_detected', 'dev_web_detected', 'reading_pdf',
  'deep_focus', 'social_scrolling', 'wiki_rabbit_hole', 'price_comparison',
  'file_management', 'wiki_browsing', 'email_checking',
  'research_mode', 'procrastination', 'focus_break', 'repeated_search',
]);

// =========================================================================
// Site/App Category Definitions (for window title matching)
// =========================================================================
const SITE_CATEGORIES = {
  shopping: {
    patterns: [
      'amazon', 'ebay', 'coupang', '\uCFE0\uD321', 'gmarket', 'g\uB9C8\uCF13', '11st', '11\uBC88\uAC00',
      'aliexpress', 'shopee', 'etsy', 'auction', '\uC625\uC158', 'tmon', '\uD2F0\uBAAC',
      'wemakeprice', '\uC704\uBA54\uD504', 'musinsa', '\uBB34\uC2E0\uC0AC', 'oliveyoung',
      '\uC62C\uB9AC\uBE0C\uC601', 'walmart', 'target.com', 'bestbuy', 'newegg',
      'rakuten', 'taobao', 'jd.com', 'lazada', 'zalando',
    ],
    trigger: 'shopping_detected',
    cooldown: 120000,
  },
  checkout: {
    patterns: [
      'cart', 'checkout', '\uC7A5\uBC14\uAD6C\uB2C8', '\uACB0\uC81C', 'payment',
      '\uC8FC\uBB38', 'order confirm', '\uC8FC\uBB38\uD655\uC778', 'place order',
      'buy now', '\uAD6C\uB9E4\uD558\uAE30', 'proceed to',
    ],
    trigger: 'checkout_detected',
    cooldown: 60000,
  },
  news: {
    patterns: [
      'cnn', 'bbc', 'nytimes', 'reuters', 'bloomberg',
      'naver.com/news', '\uB124\uC774\uBC84\uB274\uC2A4', 'daum.net/news', '\uB2E4\uC74C\uB274\uC2A4',
      'hacker news', 'techcrunch', 'the verge', 'ars technica',
      '\uC870\uC120\uC77C\uBCF4', '\uC911\uC559\uC77C\uBCF4', '\uB3D9\uC544\uC77C\uBCF4', '\uD55C\uACBD\uB808',
    ],
    trigger: 'news_reading',
    cooldown: 120000,
  },
  social: {
    patterns: [
      'instagram', 'twitter', 'x.com', 'facebook', 'threads',
      'tiktok', 'reddit', 'mastodon', 'bluesky', 'tumblr',
      'linkedin feed', 'pinterest',
    ],
    trigger: 'social_scrolling',
    cooldown: 120000,
  },
  video: {
    patterns: [
      'youtube', 'twitch', 'netflix', 'disney+', 'wavve', 'tving',
      'watcha', 'hulu', 'prime video', 'crunchyroll', 'vimeo',
      'dailymotion', 'bilibili', 'niconico',
    ],
    trigger: 'video_watching',
    cooldown: 120000,
  },
  coding: {
    patterns: [
      'visual studio code', 'vscode', 'intellij', 'pycharm', 'webstorm',
      'sublime text', 'atom', 'vim ', 'neovim', 'emacs', 'cursor',
      'zed', 'android studio', 'xcode', 'rider', 'goland',
    ],
    trigger: 'coding_detected',
    cooldown: 300000,
  },
  terminal: {
    patterns: [
      'powershell', 'cmd.exe', 'command prompt', 'windows terminal',
      'git bash', 'wsl', 'terminal', 'iterm', 'hyper', 'alacritty',
      'warp', 'kitty',
    ],
    trigger: 'terminal_active',
    cooldown: 300000,
  },
  music: {
    patterns: [
      'spotify', 'apple music', 'youtube music', 'soundcloud',
      'melon', 'genie', 'bugs', 'flo', 'vibe', 'tidal',
      'deezer', 'pandora', 'amazon music',
    ],
    trigger: 'music_playing',
    cooldown: 300000,
  },
  food: {
    patterns: [
      '\uBC30\uB2EC\uC758\uBBFC\uC871', 'baemin', '\uCFE0\uD321\uC774\uCE20', 'coupangeats',
      '\uC694\uAE30\uC694', 'yogiyo', 'ubereats', 'uber eats',
      'doordash', 'grubhub', 'deliveroo', 'just eat',
    ],
    trigger: 'food_ordering',
    cooldown: 120000,
  },
  travel: {
    patterns: [
      'booking.com', 'airbnb', 'hotels.com', 'expedia', 'agoda',
      '\uC57C\uB180\uC790', '\uC5EC\uAE30\uC5B4\uB54C', 'trip.com', 'skyscanner',
      'google flights', 'kayak', '\uD2B8\uB9AC\uD50C', 'tripadvisor',
      '\uC778\uD130\uD30C\uD06C', '\uB9C8\uC774\uB9AC\uC5BC\uD2B8\uB9BD',
    ],
    trigger: 'travel_planning',
    cooldown: 120000,
  },
  learning: {
    patterns: [
      'udemy', 'coursera', 'khan academy', '\uC778\uD504\uB7F0', 'inflearn',
      'nomadcoders', '\uB178\uB9C8\uB4DC\uCF54\uB354', 'edx', 'skillshare',
      'pluralsight', 'leetcode', 'hackerrank', 'codecademy',
      'duolingo', 'brilliant',
    ],
    trigger: 'learning_activity',
    cooldown: 300000,
  },
  email: {
    patterns: [
      'gmail', 'outlook', 'yahoo mail', 'naver mail', '\uB124\uC774\uBC84 \uBA54\uC77C',
      'protonmail', 'zoho mail', 'thunderbird', 'mail -',
    ],
    trigger: 'email_checking',
    cooldown: 120000,
  },
  gaming: {
    patterns: [
      'steam', 'epic games', 'league of legends', 'valorant',
      'overwatch', 'minecraft', 'roblox', 'genshin', 'fortnite',
      'apex legends', 'counter-strike', 'dota', 'diablo',
      'lost ark', '\uB85C\uC2A4\uD2B8\uC544\uD06C', 'maplestory', '\uBA54\uC774\uD50C\uC2A4\uD1A0\uB9AC',
    ],
    trigger: 'gaming_detected',
    cooldown: 300000,
  },
  login: {
    patterns: [
      'sign in', 'log in', '\uB85C\uADF8\uC778', 'login', 'sign up',
      '\uD68C\uC6D0\uAC00\uC785', 'create account', 'forgot password',
      '\uBE44\uBC00\uBC88\uD638 \uCC3E\uAE30', 'reset password',
    ],
    trigger: 'login_page',
    cooldown: 60000,
  },
  finance: {
    patterns: [
      '\uD1A0\uC2A4', 'toss', '\uCE74\uCE74\uC624\uBC45\uD06C', 'kakaobank',
      '\uD0A4\uC6C0\uC99D\uAD8C', '\uBBF8\uB798\uC5D0\uC14B', '\uC0BC\uC131\uC99D\uAD8C',
      '\uC2E0\uD55C\uD22C\uC790', 'robinhood', 'coinbase',
      'binance', 'upbit', '\uC5C5\uBE44\uD2B8', 'trading',
      '\uC8FC\uC2DD', 'stock', '\uC740\uD589', 'bank',
    ],
    trigger: 'finance_activity',
    cooldown: 120000,
  },
  document: {
    patterns: [
      'google docs', 'google sheets', 'google slides',
      'notion', 'microsoft word', 'microsoft excel', 'powerpoint',
      'confluence', 'obsidian', 'roam research', 'bear',
      'typora', 'mark text', '\uD55C\uAE00', 'hwp',
    ],
    trigger: 'document_editing',
    cooldown: 300000,
  },
  search: {
    patterns: [
      'google.com/search', 'google - ', 'bing.com/search',
      'naver.com/search', '\uB124\uC774\uBC84 \uAC80\uC0C9', 'duckduckgo',
      'search results', '\uAC80\uC0C9\uACB0\uACFC',
    ],
    trigger: 'search_detected',
    cooldown: 30000,
  },
  meeting: {
    patterns: [
      'zoom', 'teams', 'google meet', 'webex', 'slack huddle',
      'discord call', 'skype', '\uD654\uC0C1\uD68C\uC758',
    ],
    trigger: 'meeting_detected',
    cooldown: 300000,
  },
  wiki: {
    patterns: [
      'wikipedia', '\uC704\uD0A4\uD53C\uB514\uC544', '\uB098\uBB34\uC704\uD0A4', 'namu.wiki',
      'fandom.com', 'wikia',
    ],
    trigger: 'wiki_browsing',
    cooldown: 60000,
  },
  dev_web: {
    patterns: [
      'github', 'gitlab', 'bitbucket', 'stackoverflow', 'stack overflow',
      'npm', 'pypi', 'crates.io', 'developer', 'documentation', 'docs',
      'api reference', 'mdn web',
    ],
    trigger: 'dev_web_detected',
    cooldown: 120000,
  },
  download: {
    patterns: [
      'download', '\uB2E4\uC6B4\uB85C\uB4DC', 'thanks for downloading',
      'save as', '\uC800\uC7A5',
    ],
    trigger: 'download_detected',
    cooldown: 60000,
  },
  reading: {
    patterns: [
      '.pdf', 'adobe reader', 'preview', 'kindle',
      'e-book', 'ebook', 'epub',
    ],
    trigger: 'reading_pdf',
    cooldown: 300000,
  },
  file_manager: {
    patterns: [
      'file explorer', '\uD30C\uC77C \uD0D0\uC0C9\uAE30', 'finder', 'nautilus',
      'dolphin', 'thunar', 'files',
    ],
    trigger: 'file_management',
    cooldown: 120000,
  },
};

// Error patterns in window titles
const ERROR_PATTERNS = [
  'error', '404', '500', '503', 'not found', 'crashed',
  'fatal', 'exception', 'fail', 'FAILED', 'denied', 'refused',
  'timed out', 'timeout', '\uC624\uB958', '\uC5D0\uB7EC', '\uC2E4\uD328',
];

// Clipboard content patterns
const CLIPBOARD_PATTERNS = {
  url: /^https?:\/\//i,
  code: /(?:function\s|const\s|let\s|var\s|import\s|from\s|class\s|def\s|return\s|if\s*\(|for\s*\(|while\s*\(|\{[\s\S]*\}|;$|=>)/m,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^[\d\s\-+()]{7,20}$/,
  longText: null, // checked by length
};

// =========================================================================
// ProactiveMonitor Class
// =========================================================================
class ProactiveMonitor extends EventEmitter {
  constructor() {
    super();
    this.enabled = false;
    this.mainWindow = null;
    this.aiBridge = null;

    // Watcher intervals
    this._clipboardInterval = null;
    this._windowInterval = null;
    this._idleInterval = null;

    // Clipboard state
    this._lastClipText = '';
    this._lastClipHasImage = false;
    this._clipHistory = [];      // { text, timestamp }
    this._maxClipHistory = 20;

    // Window state
    this._lastTitle = '';
    this._lastAppName = '';
    this._lastCategory = null;
    this._titleHistory = [];     // { title, category, timestamp }
    this._maxTitleHistory = 50;
    this._sameTitleSince = 0;    // timestamp of when current title started
    this._sameAppSince = 0;      // timestamp of when current app started

    // Idle state
    this._wasIdle = false;
    this._idleStart = 0;

    // Cooldown tracking
    this._globalCooldown = 8000;
    this._lastEventTime = 0;
    this._triggerCooldowns = {};  // { triggerType: lastFireTime }

    // Pattern detection state
    this._appSwitchCount = 0;
    this._appSwitchWindow = [];  // timestamps of recent switches
    this._errorCount = 0;
    this._errorWindow = [];      // timestamps of recent errors
    this._categoryHistory = [];  // recent categories for procrastination detection
  }

  /**
   * Start monitoring
   * @param {BrowserWindow} mainWindow
   * @param {AIBridge} aiBridge
   * @param {AIBrainTriggers} [brainTriggers] - Optional AI Brain trigger handler
   */
  start(mainWindow, aiBridge, brainTriggers = null) {
    this.mainWindow = mainWindow;
    this.aiBridge = aiBridge;
    this.brainTriggers = brainTriggers;
    this.enabled = true;

    // Initialize clipboard state
    try {
      this._lastClipText = clipboard.readText() || '';
      this._lastClipHasImage = !clipboard.readImage().isEmpty();
    } catch {}

    this._lastTitle = '';
    this._sameTitleSince = Date.now();
    this._sameAppSince = Date.now();

    // Start watchers
    this._clipboardInterval = setInterval(() => this._checkClipboard(), 500);
    this._windowInterval = setInterval(() => this._checkActiveWindow(), 5000);
    this._idleInterval = setInterval(() => this._checkIdle(), 10000);

    // Check time-based triggers every 60s
    this._timeInterval = setInterval(() => this._checkTimeTriggers(), 60000);

    console.log('[ProactiveMonitor] Started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.enabled = false;
    if (this._clipboardInterval) clearInterval(this._clipboardInterval);
    if (this._windowInterval) clearInterval(this._windowInterval);
    if (this._idleInterval) clearInterval(this._idleInterval);
    if (this._timeInterval) clearInterval(this._timeInterval);
    this._clipboardInterval = null;
    this._windowInterval = null;
    this._idleInterval = null;
    this._timeInterval = null;
    console.log('[ProactiveMonitor] Stopped');
  }

  setEnabled(val) {
    this.enabled = val;
    if (!val) {
      this.stop();
    }
  }

  // =========================================================================
  // Clipboard Watcher (500ms)
  // =========================================================================
  _checkClipboard() {
    if (!this.enabled) return;
    const now = Date.now();

    try {
      // Check for screenshot (image in clipboard)
      const img = clipboard.readImage();
      const hasImage = !img.isEmpty();

      if (hasImage && !this._lastClipHasImage) {
        this._lastClipHasImage = true;
        this._fire('clipboard_screenshot', {
          hasImage: true,
          imageSize: img.getSize(),
        });
        return;
      }
      this._lastClipHasImage = hasImage;

      // Check for text changes
      const text = clipboard.readText() || '';
      if (text && text !== this._lastClipText) {
        const prevText = this._lastClipText;
        this._lastClipText = text;

        // Record history
        this._clipHistory.push({ text, timestamp: now });
        if (this._clipHistory.length > this._maxClipHistory) {
          this._clipHistory.shift();
        }

        // Determine clipboard content type
        const context = { text: text.substring(0, 200), length: text.length };

        // URL copied
        if (CLIPBOARD_PATTERNS.url.test(text.trim())) {
          this._fire('url_copied', { ...context, url: text.trim().substring(0, 500) });
        }
        // Code copied
        else if (CLIPBOARD_PATTERNS.code.test(text)) {
          this._fire('code_copied', context);
        }
        // Email copied
        else if (CLIPBOARD_PATTERNS.email.test(text.trim())) {
          this._fire('email_copied', { ...context, email: text.trim() });
        }
        // Phone copied
        else if (CLIPBOARD_PATTERNS.phone.test(text.trim())) {
          this._fire('phone_copied', context);
        }
        // Long text copied (500+ chars)
        else if (text.length >= 500) {
          this._fire('long_text_copied', context);
        }
        // General clipboard copy
        else {
          this._fire('clipboard_copy', context);
        }

        // Check repeated copy (3+ copies in 60s)
        const recentCopies = this._clipHistory.filter(
          (h) => now - h.timestamp < 60000
        );
        if (recentCopies.length >= 3) {
          this._fire('repeated_copy', {
            count: recentCopies.length,
            timespan: 60,
          });
        }

        // Check search pattern (copy then search engine within 30s)
        this._checkSearchPattern(text, now);
      }
    } catch {
      // Clipboard access can fail silently
    }
  }

  // =========================================================================
  // Active Window Watcher (5s)
  // =========================================================================
  async _checkActiveWindow() {
    if (!this.enabled) return;
    const now = Date.now();

    try {
      const { getActiveWindowTitle } = require('./platform');
      const title = await getActiveWindowTitle();
      if (!title) return;

      const titleLower = title.toLowerCase();
      const titleChanged = title !== this._lastTitle;

      if (titleChanged) {
        const prevTitle = this._lastTitle;
        const prevCategory = this._lastCategory;
        this._lastTitle = title;

        // Detect app name from title (part before " - " or " | ")
        const appName = this._extractAppName(title);
        const appChanged = appName !== this._lastAppName;

        if (appChanged) {
          const prevApp = this._lastAppName;
          this._lastAppName = appName;
          this._sameAppSince = now;

          // Fire app_switch
          this._fire('app_switch', {
            from: prevApp,
            to: appName,
            title,
          });

          // Track app switches for rapid_switching detection
          this._appSwitchWindow.push(now);
          this._appSwitchWindow = this._appSwitchWindow.filter(
            (t) => now - t < 60000
          );
          if (this._appSwitchWindow.length >= 5) {
            this._fire('rapid_switching', {
              count: this._appSwitchWindow.length,
              timespan: 60,
            });
          }
        }

        // Title changed but same app -> might be tab change
        this._sameTitleSince = now;

        // Record title history
        const category = this._categorizeTitle(titleLower);
        this._lastCategory = category;
        this._titleHistory.push({ title, category, timestamp: now });
        if (this._titleHistory.length > this._maxTitleHistory) {
          this._titleHistory.shift();
        }

        // Category history for pattern detection
        if (category) {
          this._categoryHistory.push({ category, timestamp: now });
          if (this._categoryHistory.length > 30) {
            this._categoryHistory.shift();
          }
        }

        // Fire category-specific triggers
        if (category) {
          const catDef = SITE_CATEGORIES[category];
          if (catDef) {
            this._fire(catDef.trigger, {
              title,
              category,
              appName,
            }, catDef.cooldown);
          }
        }

        // Error detection
        if (this._isErrorTitle(titleLower)) {
          this._errorWindow.push(now);
          this._errorWindow = this._errorWindow.filter(
            (t) => now - t < 300000
          );
          this._fire('error_detected', { title });

          // Error loop: 3+ errors in 5 minutes
          if (this._errorWindow.length >= 3) {
            this._fire('error_loop', {
              count: this._errorWindow.length,
              timespan: 300,
            });
          }
        }

        // Complex pattern detection
        this._checkWikiRabbitHole(titleLower, now);
        this._checkPriceComparison(now);
        this._checkResearchMode(now);
        this._checkProcrastination(now);
        this._checkRepeatedSearch(now);
      } else {
        // Same title - check for long focus
        const focusDuration = now - this._sameTitleSince;

        // long_focus: same app for 10+ minutes
        if (focusDuration >= 600000) {
          this._fire('long_focus', {
            title: this._lastTitle,
            duration: Math.floor(focusDuration / 1000),
            appName: this._lastAppName,
          });
        }

        // deep_focus: same app (IDE/document) for 20+ minutes
        const appDuration = now - this._sameAppSince;
        if (appDuration >= 1200000) {
          const cat = this._lastCategory;
          if (cat === 'coding' || cat === 'document' || cat === 'terminal') {
            this._fire('deep_focus', {
              title: this._lastTitle,
              duration: Math.floor(appDuration / 1000),
              category: cat,
            });
          }
        }

        // social_scrolling: same social media for 10+ minutes
        if (this._lastCategory === 'social' && focusDuration >= 600000) {
          this._fire('social_scrolling', {
            title: this._lastTitle,
            duration: Math.floor(focusDuration / 1000),
          });
        }
      }
    } catch (err) {
      // Window title fetch can fail
    }
  }

  // =========================================================================
  // Idle Detector (10s)
  // =========================================================================
  _checkIdle() {
    if (!this.enabled) return;

    try {
      const idleTime = powerMonitor.getSystemIdleTime(); // seconds

      if (idleTime > 60 && !this._wasIdle) {
        this._wasIdle = true;
        this._idleStart = Date.now();
      }

      if (this._wasIdle && idleTime < 5) {
        // User returned from idle
        const idleDuration = Math.floor((Date.now() - this._idleStart) / 1000);
        this._wasIdle = false;
        this._fire('idle_return', {
          idleDuration,
        });
      }
    } catch {}
  }

  // =========================================================================
  // Time-based Triggers (60s)
  // =========================================================================
  _checkTimeTriggers() {
    if (!this.enabled) return;
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0=Sun, 6=Sat

    // late_night: 23:00 ~ 05:00
    if (hour >= 23 || hour < 5) {
      this._fire('late_night', { hour }, 600000);

      // dawn_coding: 02:00 ~ 05:00 + IDE active
      if (hour >= 2 && hour < 5) {
        const cat = this._lastCategory;
        if (cat === 'coding' || cat === 'terminal') {
          this._fire('dawn_coding', { hour, category: cat }, 600000);
        }
      }
    }

    // pre_lunch: 11:30 ~ 12:00
    if (hour === 11 && now.getMinutes() >= 30) {
      this._fire('pre_lunch', { hour }, 1800000); // 30min cooldown
    }

    // end_of_work: 17:30 ~ 18:30
    if ((hour === 17 && now.getMinutes() >= 30) || (hour === 18 && now.getMinutes() <= 30)) {
      this._fire('end_of_work', { hour }, 1800000);
    }

    // weekend_work: Sat/Sun + work-related app
    if (day === 0 || day === 6) {
      const cat = this._lastCategory;
      if (cat === 'coding' || cat === 'document' || cat === 'terminal' || cat === 'email') {
        this._fire('weekend_work', { day, category: cat }, 3600000); // 1hr cooldown
      }
    }
  }

  // =========================================================================
  // Complex Pattern Detection
  // =========================================================================

  /**
   * Wiki rabbit hole: 3+ wiki page changes in 60s
   */
  _checkWikiRabbitHole(titleLower, now) {
    if (!titleLower.includes('wikipedia') && !titleLower.includes('namu.wiki') &&
        !titleLower.includes('\uB098\uBB34\uC704\uD0A4') && !titleLower.includes('fandom')) return;

    const recentWiki = this._titleHistory.filter(
      (h) => now - h.timestamp < 60000 && h.category === 'wiki'
    );
    if (recentWiki.length >= 3) {
      this._fire('wiki_rabbit_hole', {
        count: recentWiki.length,
        titles: recentWiki.map((h) => h.title).slice(-3),
      });
    }
  }

  /**
   * Price comparison: switching between shopping sites 3+ times in 60s
   */
  _checkPriceComparison(now) {
    const recentShopping = this._titleHistory.filter(
      (h) => now - h.timestamp < 60000 && h.category === 'shopping'
    );
    // Need 3+ distinct titles from shopping category
    const uniqueTitles = new Set(recentShopping.map((h) => h.title));
    if (uniqueTitles.size >= 3) {
      this._fire('price_comparison', {
        count: uniqueTitles.size,
        timespan: 60,
      });
    }
  }

  /**
   * Research mode: search engine + clipboard copies in 30s window
   */
  _checkResearchMode(now) {
    const recentSearch = this._titleHistory.filter(
      (h) => now - h.timestamp < 30000 && h.category === 'search'
    );
    const recentCopies = this._clipHistory.filter(
      (h) => now - h.timestamp < 30000
    );
    if (recentSearch.length >= 1 && recentCopies.length >= 2) {
      this._fire('research_mode', {
        searches: recentSearch.length,
        copies: recentCopies.length,
      });
    }
  }

  /**
   * Procrastination: rapid switching between work (coding/doc/terminal)
   * and entertainment (social/video/gaming) 3+ times in 60s
   */
  _checkProcrastination(now) {
    const recent = this._categoryHistory.filter(
      (h) => now - h.timestamp < 60000
    );
    if (recent.length < 4) return;

    const workCats = new Set(['coding', 'document', 'terminal', 'dev_web']);
    const funCats = new Set(['social', 'video', 'gaming', 'news']);

    let switches = 0;
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1].category;
      const curr = recent[i].category;
      if (
        (workCats.has(prev) && funCats.has(curr)) ||
        (funCats.has(prev) && workCats.has(curr))
      ) {
        switches++;
      }
    }

    if (switches >= 3) {
      this._fire('procrastination', {
        switches,
        timespan: 60,
      });
    }
  }

  /**
   * Repeated search: 3+ different search queries in 60s
   * (indicates user can't find what they need)
   */
  _checkRepeatedSearch(now) {
    const recentSearch = this._titleHistory.filter(
      (h) => now - h.timestamp < 60000 && h.category === 'search'
    );
    const uniqueSearches = new Set(recentSearch.map((h) => h.title));
    if (uniqueSearches.size >= 3) {
      this._fire('repeated_search', {
        count: uniqueSearches.size,
        timespan: 60,
      });
    }
  }

  /**
   * Search pattern: copy text then visit search engine within 30s
   */
  _checkSearchPattern(copiedText, now) {
    // Set a flag, check when next window title arrives
    this._pendingSearchCheck = { text: copiedText, timestamp: now };

    // Also check immediately with current title
    if (this._lastCategory === 'search') {
      this._fire('search_pattern', {
        copiedText: copiedText.substring(0, 100),
        searchTitle: this._lastTitle,
      });
    }
  }

  // =========================================================================
  // Focus break detection (called when app switches from deep focus)
  // =========================================================================
  _checkFocusBreak(fromCategory, toCategory) {
    const workCats = new Set(['coding', 'document', 'terminal', 'dev_web']);
    const funCats = new Set(['social', 'video', 'gaming']);

    if (workCats.has(fromCategory) && funCats.has(toCategory)) {
      const focusDuration = Date.now() - this._sameAppSince;
      if (focusDuration >= 1200000) { // was focused 20+ minutes
        this._fire('focus_break', {
          fromCategory,
          toCategory,
          focusDuration: Math.floor(focusDuration / 1000),
        });
      }
    }
  }

  // =========================================================================
  // Helper: Categorize title
  // =========================================================================
  _categorizeTitle(titleLower) {
    for (const [category, def] of Object.entries(SITE_CATEGORIES)) {
      for (const pattern of def.patterns) {
        if (titleLower.includes(pattern.toLowerCase())) {
          return category;
        }
      }
    }
    return null;
  }

  /**
   * Extract app name from window title
   * "Document.txt - Notepad" -> "Notepad"
   * "Google - Chrome" -> "Chrome"
   */
  _extractAppName(title) {
    // Common separators: " - ", " | ", " \u2014 "
    const separators = [' - ', ' | ', ' \u2014 ', ' \u2013 '];
    for (const sep of separators) {
      const idx = title.lastIndexOf(sep);
      if (idx > 0) {
        return title.substring(idx + sep.length).trim();
      }
    }
    return title.trim();
  }

  /**
   * Check if title contains error indicators
   */
  _isErrorTitle(titleLower) {
    return ERROR_PATTERNS.some((p) => titleLower.includes(p.toLowerCase()));
  }

  // =========================================================================
  // Screen Capture (for visual triggers)
  // =========================================================================

  /**
   * 현재 화면을 캡처하여 base64 JPEG로 반환
   * 실패 시 null (graceful degradation)
   */
  async _captureScreen() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 960, height: 540 },
      });
      if (sources.length === 0) return null;

      const thumbnail = sources[0].thumbnail;
      const jpegBuffer = thumbnail.toJPEG(40);
      return {
        image: jpegBuffer.toString('base64'),
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height,
      };
    } catch {
      return null;
    }
  }

  /**
   * 현재 커서 위치 반환
   */
  _getCursorPosition() {
    try {
      const point = screen.getCursorScreenPoint();
      return { x: point.x, y: point.y };
    } catch {
      return null;
    }
  }

  // =========================================================================
  // Intervention Decider (cooldown + fire)
  // =========================================================================
  async _fire(triggerType, context, customCooldown) {
    if (!this.enabled) return;

    const now = Date.now();

    // Global cooldown
    if (now - this._lastEventTime < this._globalCooldown) return;

    // Per-trigger cooldown
    const cooldown = customCooldown || this._getDefaultCooldown(triggerType);
    const lastFire = this._triggerCooldowns[triggerType] || 0;
    if (now - lastFire < cooldown) return;

    // Update cooldown tracking
    this._lastEventTime = now;
    this._triggerCooldowns[triggerType] = now;

    // Build event payload
    const event = {
      trigger: triggerType,
      context: context || {},
      timestamp: now,
      activeTitle: this._lastTitle,
      activeApp: this._lastAppName,
    };

    // Emit for internal listeners
    this.emit('trigger', event);

    // Send to renderer via IPC
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('proactive-event', event);
    }

    // Send to AI Bridge if connected (시각 트리거는 화면 캡처 포함)
    if (this.aiBridge && this.aiBridge.isConnected()) {
      const aiContext = {
        ...context,
        activeTitle: this._lastTitle,
        activeApp: this._lastAppName,
      };

      // 시각 트리거: 화면 캡처 + 커서 위치 번들링
      if (VISUAL_TRIGGERS.has(triggerType)) {
        const [screenData, cursor] = await Promise.all([
          this._captureScreen(),
          Promise.resolve(this._getCursorPosition()),
        ]);
        if (screenData) {
          aiContext.screen = screenData;
        }
        if (cursor) {
          aiContext.cursor = cursor;
        }
      }

      this.aiBridge.reportProactiveEvent(triggerType, aiContext);
    } else if (this.brainTriggers && this.brainTriggers.isActive()) {
      // Fallback: AI Brain handles trigger when OpenClaw is not connected
      const aiContext = {
        ...context,
        activeTitle: this._lastTitle,
        activeApp: this._lastAppName,
      };

      if (VISUAL_TRIGGERS.has(triggerType)) {
        const [screenData, cursor] = await Promise.all([
          this._captureScreen(),
          Promise.resolve(this._getCursorPosition()),
        ]);
        if (screenData) aiContext.screen = screenData;
        if (cursor) aiContext.cursor = cursor;
      }

      this.brainTriggers.handleTrigger({
        trigger: triggerType,
        context: aiContext,
        timestamp: Date.now(),
      });
    }

    console.log(`[ProactiveMonitor] Fired: ${triggerType}${VISUAL_TRIGGERS.has(triggerType) ? ' (with screen)' : ''}`);
  }

  /**
   * Default cooldowns per trigger type
   */
  _getDefaultCooldown(trigger) {
    const cooldowns = {
      // Clipboard triggers
      clipboard_copy: 10000,
      clipboard_screenshot: 30000,
      repeated_copy: 60000,
      url_copied: 15000,
      code_copied: 20000,
      long_text_copied: 30000,
      email_copied: 30000,
      phone_copied: 30000,

      // App/window triggers
      app_switch: 20000,
      error_detected: 30000,
      error_loop: 120000,
      meeting_detected: 300000,
      rapid_switching: 120000,

      // Behavior pattern triggers
      search_pattern: 30000,
      idle_return: 60000,
      long_focus: 300000,
      deep_focus: 600000,
      social_scrolling: 300000,
      wiki_rabbit_hole: 120000,
      price_comparison: 120000,
      research_mode: 60000,
      procrastination: 120000,
      focus_break: 120000,
      repeated_search: 60000,

      // Time triggers
      late_night: 600000,
      dawn_coding: 600000,
      pre_lunch: 1800000,
      end_of_work: 1800000,
      weekend_work: 3600000,

      // Category triggers (defaults, overridden by SITE_CATEGORIES)
      shopping_detected: 120000,
      checkout_detected: 60000,
      news_reading: 120000,
      video_watching: 120000,
      coding_detected: 300000,
      terminal_active: 300000,
      music_playing: 300000,
      food_ordering: 120000,
      travel_planning: 120000,
      learning_activity: 300000,
      email_checking: 120000,
      gaming_detected: 300000,
      login_page: 60000,
      finance_activity: 120000,
      document_editing: 300000,
      search_detected: 30000,
      wiki_browsing: 60000,
      dev_web_detected: 120000,
      download_detected: 60000,
      reading_pdf: 300000,
      file_management: 120000,
    };
    return cooldowns[trigger] || 30000;
  }
}

module.exports = { ProactiveMonitor };
