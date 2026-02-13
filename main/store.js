const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor(name, defaults = {}) {
    const userDataPath = app.getPath('userData');
    this.path = path.join(userDataPath, `${name}.json`);
    this.data = { ...defaults };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.path, 'utf-8');
      this.data = { ...this.data, ...JSON.parse(raw) };
    } catch {
      // 파일 없으면 기본값 사용
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('Store save error:', err);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  getAll() {
    return { ...this.data };
  }
}

module.exports = Store;
