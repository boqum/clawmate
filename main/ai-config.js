/**
 * AI Brain Configuration
 *
 * API key, budget, model selection management.
 * Uses safeStorage for API key encryption when available.
 */
const { safeStorage } = require('electron');
const Store = require('./store');

class AIConfig {
  constructor() {
    this.store = new Store('clawmate-ai-config', {
      apiKeyEncrypted: '',
      apiKeyPlain: '',
      model: 'auto',           // 'auto' | 'haiku' | 'sonnet'
      dailyBudget: 0.50,       // USD
      monthlyBudget: 5.00,
      language: 'auto',
      enabled: true,
      telegramAI: true,
      proactiveTelegram: false,
      todayCost: 0,
      todayDate: '',
      monthCost: 0,
      monthKey: '',
    });
  }

  // === API Key (encrypted if possible) ===

  getApiKey() {
    // Try decrypting first
    const encrypted = this.store.get('apiKeyEncrypted');
    if (encrypted) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        }
      } catch {}
    }
    // Fallback to plain text
    return this.store.get('apiKeyPlain') || '';
  }

  setApiKey(key) {
    if (!key) {
      this.store.set('apiKeyEncrypted', '');
      this.store.set('apiKeyPlain', '');
      return;
    }
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key);
        this.store.set('apiKeyEncrypted', encrypted.toString('base64'));
        this.store.set('apiKeyPlain', '');
        return;
      }
    } catch {}
    // Fallback: store plain
    this.store.set('apiKeyPlain', key);
    this.store.set('apiKeyEncrypted', '');
  }

  // === Status Checks ===

  isConfigured() {
    return !!this.getApiKey();
  }

  isActive() {
    return this.isConfigured() && this.store.get('enabled') && this.isWithinBudget();
  }

  // === Budget Management ===

  addCost(amount) {
    this._ensureDateKeys();
    const todayCost = (this.store.get('todayCost') || 0) + amount;
    const monthCost = (this.store.get('monthCost') || 0) + amount;
    this.store.set('todayCost', todayCost);
    this.store.set('monthCost', monthCost);
  }

  isWithinBudget() {
    this._ensureDateKeys();
    const todayCost = this.store.get('todayCost') || 0;
    const dailyBudget = this.store.get('dailyBudget') || 0.50;
    return todayCost < dailyBudget;
  }

  shouldUseHaikuOnly() {
    this._ensureDateKeys();
    const todayCost = this.store.get('todayCost') || 0;
    const dailyBudget = this.store.get('dailyBudget') || 0.50;
    return todayCost >= dailyBudget * 0.8;
  }

  getBudgetStatus() {
    this._ensureDateKeys();
    const todayCost = this.store.get('todayCost') || 0;
    const monthCost = this.store.get('monthCost') || 0;
    const dailyBudget = this.store.get('dailyBudget') || 0.50;
    const monthlyBudget = this.store.get('monthlyBudget') || 5.00;

    return {
      daily: {
        used: todayCost,
        limit: dailyBudget,
        percent: dailyBudget > 0 ? Math.round((todayCost / dailyBudget) * 100) : 0,
      },
      monthly: {
        used: monthCost,
        limit: monthlyBudget,
        percent: monthlyBudget > 0 ? Math.round((monthCost / monthlyBudget) * 100) : 0,
      },
    };
  }

  // === Getters/Setters ===

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    this.store.set(key, value);
  }

  getAll() {
    const data = this.store.getAll();
    // Hide API key from getAll
    delete data.apiKeyEncrypted;
    delete data.apiKeyPlain;
    data.hasApiKey = this.isConfigured();
    data.budget = this.getBudgetStatus();
    return data;
  }

  // === Internal ===

  _ensureDateKeys() {
    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);

    if (this.store.get('todayDate') !== today) {
      this.store.set('todayDate', today);
      this.store.set('todayCost', 0);
    }
    if (this.store.get('monthKey') !== monthKey) {
      this.store.set('monthKey', monthKey);
      this.store.set('monthCost', 0);
    }
  }
}

module.exports = { AIConfig };
