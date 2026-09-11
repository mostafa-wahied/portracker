const db = require('../db');
const { Logger } = require('./logger');
const {
  DEFAULT_SETTINGS,
  isUserSettingKey,
  validateUserSettings,
} = require('./settings-schema');

const logger = new Logger('SettingsManager', { debug: process.env.DEBUG === 'true' });

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
    if (!isUserSettingKey(row.setting_key)) {
      continue;
    }
    try {
      settings[row.setting_key] = JSON.parse(row.setting_value);
    } catch {
      settings[row.setting_key] = row.setting_value;
    }
  }

  return settings;
}

function updateUserSetting(userId = null, key, value) {
  const validation = validateUserSettings({ [key]: value });
  if (!validation.valid) {
    logger.warn(validation.error);
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
  const validation = validateUserSettings(settings);
  if (!validation.valid) {
    logger.warn(validation.error);
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

function initializeSettingsStorage() {
  if (!ensureSettingsTable()) {
    return false;
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS autoxpose_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        url TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const migrationId = 'autoxpose-connection-trust-v1';
    const applyMigration = db.transaction(() => {
      const applied = db.prepare(
        'SELECT id FROM settings_migrations WHERE id = ?'
      ).get(migrationId);
      if (applied) return;
      db.prepare(
        "DELETE FROM user_settings WHERE setting_key IN ('autoxposeUrl', 'autoxposeEnabled')"
      ).run();
      db.prepare(
        'INSERT INTO settings_migrations (id, applied_at) VALUES (?, ?)'
      ).run(migrationId, new Date().toISOString());
    });
    applyMigration();
    return true;
  } catch (error) {
    logger.error('Failed to initialize settings storage:', error.message);
    return false;
  }
}

function getAutoxposeConnection() {
  const row = db.prepare(
    'SELECT url FROM autoxpose_connection WHERE id = 1'
  ).get();
  return row || null;
}

function setAutoxposeConnection(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return false;
  }

  db.prepare(`
    INSERT INTO autoxpose_connection (id, url, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      updated_at = excluded.updated_at
  `).run(url.trim(), new Date().toISOString());
  return true;
}

function clearAutoxposeConnection() {
  db.prepare('DELETE FROM autoxpose_connection WHERE id = 1').run();
  return true;
}

module.exports = {
  getUserSettings,
  updateUserSetting,
  updateUserSettings,
  deleteSetting,
  getDefaultSettings,
  ensureSettingsTable,
  initializeSettingsStorage,
  getAutoxposeConnection,
  setAutoxposeConnection,
  clearAutoxposeConnection,
};
