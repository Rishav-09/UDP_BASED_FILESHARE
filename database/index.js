const fs = require('fs');
const path = require('path');
const os = require('os');

class Database {
  constructor(filePath) {
    this.filePath = filePath || path.join(os.homedir(), '.swiftshare-db.json');
    this.data = {};
    this.init();
  }

  init() {
    try {
      const parentDir = path.dirname(this.filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(fileContent);
      } else {
        this.data = {
          settings: {
            username: os.userInfo().username || 'SwiftUser',
            deviceNickname: os.hostname() || 'SwiftDevice',
            theme: 'dark'
          },
          chats: {},     // peerId -> array of messages
          transfers: []  // array of file transfers
        };
        this.save();
      }
    } catch (error) {
      console.error('Failed to initialize database:', error);
      this.data = { settings: {}, chats: {}, transfers: [] };
    }
  }

  save() {
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error('Database write failed:', error);
    }
  }

  get(key, defaultValue) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  // Chats Operations
  getMessages(peerId) {
    if (!this.data.chats) this.data.chats = {};
    return this.data.chats[peerId] || [];
  }

  addMessage(peerId, message) {
    if (!this.data.chats) this.data.chats = {};
    if (!this.data.chats[peerId]) {
      this.data.chats[peerId] = [];
    }
    this.data.chats[peerId].push(message);
    this.save();
    return message;
  }

  clearChat(peerId) {
    if (this.data.chats && this.data.chats[peerId]) {
      this.data.chats[peerId] = [];
      this.save();
    }
  }

  // Transfers Operations
  getTransfers() {
    return this.data.transfers || [];
  }

  addTransfer(transfer) {
    if (!this.data.transfers) this.data.transfers = [];
    this.data.transfers.push(transfer);
    // Limit log size to 100 entries to prevent bloat
    if (this.data.transfers.length > 100) {
      this.data.transfers.shift();
    }
    this.save();
    return transfer;
  }

  updateTransfer(transferId, updates) {
    if (!this.data.transfers) this.data.transfers = [];
    const index = this.data.transfers.findIndex(t => t.id === transferId);
    if (index !== -1) {
      this.data.transfers[index] = { ...this.data.transfers[index], ...updates };
      this.save();
      return this.data.transfers[index];
    }
    return null;
  }

  // Settings
  getSettings() {
    return this.data.settings || {};
  }

  updateSettings(settings) {
    this.data.settings = { ...this.data.settings, ...settings };
    this.save();
  }
}

// Default export is a shared instance
const defaultDbPath = path.join(os.tmpdir(), 'swiftshare-db.json');
const dbInstance = new Database(defaultDbPath);

module.exports = dbInstance;
module.exports.Database = Database;
