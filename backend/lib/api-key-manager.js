const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { Logger } = require('./logger');

const logger = new Logger('ApiKeyManager', { debug: process.env.DEBUG === 'true' });
const API_KEY_LENGTH = 32;
const BCRYPT_ROUNDS = 10;

async function generateApiKey(serverId) {
  if (!serverId) {
    logger.warn('generateApiKey called without serverId');
    return null;
  }

  const server = db.prepare('SELECT id FROM servers WHERE id = ?').get(serverId);
  if (!server) {
    logger.warn(`Server not found for API key generation: ${serverId}`);
    return null;
  }

  const apiKey = crypto.randomBytes(API_KEY_LENGTH).toString('hex');
  const createdAt = new Date().toISOString();
  const hashedKey = await bcrypt.hash(apiKey, BCRYPT_ROUNDS);

  db.prepare('UPDATE servers SET api_key = ?, api_key_created_at = ? WHERE id = ?')
    .run(hashedKey, createdAt, serverId);

  logger.info(`API key generated for server: ${serverId}`);
  return { apiKey, createdAt };
}

async function validateApiKey(serverId, providedKey) {
  if (!serverId || !providedKey) {
    return false;
  }

  const server = db.prepare('SELECT api_key FROM servers WHERE id = ?').get(serverId);
  if (!server || !server.api_key) {
    return false;
  }

  return bcrypt.compare(providedKey, server.api_key);
}

async function validateAnyApiKey(providedKey) {
  if (!providedKey) {
    return { valid: false, serverId: null };
  }

  const servers = db.prepare('SELECT id, api_key FROM servers WHERE api_key IS NOT NULL').all();

  for (const server of servers) {
    const isValid = await bcrypt.compare(providedKey, server.api_key);
    if (isValid) {
      return { valid: true, serverId: server.id };
    }
  }

  return { valid: false, serverId: null };
}

function getApiKeyInfo(serverId) {
  if (!serverId) {
    return null;
  }

  const server = db.prepare('SELECT api_key, api_key_created_at FROM servers WHERE id = ?').get(serverId);
  if (!server) {
    return null;
  }

  return {
    hasApiKey: !!server.api_key,
    createdAt: server.api_key_created_at || null
  };
}

function revokeApiKey(serverId) {
  if (!serverId) {
    logger.warn('revokeApiKey called without serverId');
    return false;
  }

  const result = db.prepare('UPDATE servers SET api_key = NULL, api_key_created_at = NULL WHERE id = ?')
    .run(serverId);

  if (result.changes > 0) {
    logger.info(`API key revoked for server: ${serverId}`);
    return true;
  }

  return false;
}

module.exports = {
  generateApiKey,
  validateApiKey,
  validateAnyApiKey,
  getApiKeyInfo,
  revokeApiKey
};
