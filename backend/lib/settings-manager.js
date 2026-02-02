const db = require('../db');
const { Logger } = require('./logger');

const logger = new Logger('SettingsManager', { debug: process.env.DEBUG === 'true' });

const DEFAULT_SETTINGS = {
  theme: 'system',
  showServiceIcons: true,
  defaultView: 'service',
  defaultLayout: 'grid'
};

function ensureSettingsTable() {
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_settings'"
    ).get();

    if (!tableExists) {
      db.exec(`
        CREATE TABLE user_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          setting_key TEXT NOT NULL,
          setting_value TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, setting_key)
        );
      `);
      logger.info('Created user_settings table');
    }
    return true;
  } catch (error) {
    logger.error('Failed to ensure settings table:', error.message);
    return false;
  }
}

function getUserSettings(userId = null) {
  ensureSettingsTable();

  const rows = db.prepare(
    'SELECT setting_key, setting_value FROM user_settings WHERE user_id IS ?'
  ).all(userId);

  const settings = { ...DEFAULT_SETTINGS };

  for (const row of rows) {
    try {
      settings[row.setting_key] = JSON.parse(row.setting_value);
    } catch {
      settings[row.setting_key] = row.setting_value;
    }
  }

  return settings;
}

function updateUserSetting(userId = null, key, value) {
  if (!key || typeof key !== 'string') {
    logger.warn('Invalid setting key provided');
    return false;
  }

  ensureSettingsTable();

  const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
  const now = new Date().toISOString();

  const existing = db.prepare(
    'SELECT id FROM user_settings WHERE user_id IS ? AND setting_key = ?'
  ).get(userId, key);

  if (existing) {
    db.prepare(
      'UPDATE user_settings SET setting_value = ?, updated_at = ? WHERE user_id IS ? AND setting_key = ?'
    ).run(serializedValue, now, userId, key);
  } else {
    db.prepare(
      'INSERT INTO user_settings (user_id, setting_key, setting_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, key, serializedValue, now, now);
  }

  logger.debug(`Setting updated: ${key} for user: ${userId || 'anonymous'}`);
  return true;
}

function updateUserSettings(userId = null, settings) {
  if (!settings || typeof settings !== 'object') {
    logger.warn('Invalid settings object provided');
    return false;
  }

  for (const [key, value] of Object.entries(settings)) {
    updateUserSetting(userId, key, value);
  }

  return true;
}

function deleteSetting(userId = null, key) {
  if (!key) {
    return false;
  }

  ensureSettingsTable();

  const result = db.prepare(
    'DELETE FROM user_settings WHERE user_id IS ? AND setting_key = ?'
  ).run(userId, key);

  return result.changes > 0;
}

function getDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

module.exports = {
  getUserSettings,
  updateUserSetting,
  updateUserSettings,
  deleteSetting,
  getDefaultSettings,
  ensureSettingsTable
};
