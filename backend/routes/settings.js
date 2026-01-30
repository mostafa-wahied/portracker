const express = require('express');
const db = require('../db');
const { Logger } = require('../lib/logger');
const { requireAuth, isAuthEnabled } = require('../middleware/auth');
const settingsManager = require('../lib/settings-manager');
const apiKeyManager = require('../lib/api-key-manager');

const router = express.Router();
const logger = new Logger('SettingsRoutes', { debug: process.env.DEBUG === 'true' });

router.get('/', (req, res) => {
  try {
    const userId = isAuthEnabled() && req.session?.userId ? req.session.userId : null;
    const settings = settingsManager.getUserSettings(userId);

    res.json(settings);
  } catch (error) {
    logger.error('Error fetching settings:', error.message);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/', (req, res) => {
  try {
    const userId = isAuthEnabled() && req.session?.userId ? req.session.userId : null;
    const settings = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings data' });
    }

    settingsManager.updateUserSettings(userId, settings);
    const updated = settingsManager.getUserSettings(userId);

    res.json(updated);
  } catch (error) {
    logger.error('Error updating settings:', error.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.get('/defaults', (req, res) => {
  const defaults = settingsManager.getDefaultSettings();
  res.json(defaults);
});

router.post('/servers/:serverId/api-key', requireAuth, (req, res) => {
  try {
    const { serverId } = req.params;

    if (!serverId) {
      return res.status(400).json({ error: 'Server ID is required' });
    }

    const server = db.prepare('SELECT id, label FROM servers WHERE id = ?').get(serverId);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    if (serverId !== 'local') {
      return res.status(400).json({ error: 'API keys can only be generated for the local server' });
    }

    const result = apiKeyManager.generateApiKey(serverId);
    if (!result) {
      return res.status(500).json({ error: 'Failed to generate API key' });
    }

    logger.info(`API key generated for server: ${serverId} (${server.label})`);

    res.json({
      success: true,
      apiKey: result.apiKey,
      createdAt: result.createdAt,
      message: 'API key generated successfully. This key will only be shown once.'
    });
  } catch (error) {
    logger.error('Error generating API key:', error.message);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

router.get('/servers/:serverId/api-key', requireAuth, (req, res) => {
  try {
    const { serverId } = req.params;

    if (!serverId) {
      return res.status(400).json({ error: 'Server ID is required' });
    }

    const info = apiKeyManager.getApiKeyInfo(serverId);
    if (!info) {
      return res.status(404).json({ error: 'Server not found' });
    }

    res.json(info);
  } catch (error) {
    logger.error('Error fetching API key info:', error.message);
    res.status(500).json({ error: 'Failed to fetch API key info' });
  }
});

router.delete('/servers/:serverId/api-key', requireAuth, (req, res) => {
  try {
    const { serverId } = req.params;

    if (!serverId) {
      return res.status(400).json({ error: 'Server ID is required' });
    }

    if (serverId !== 'local') {
      return res.status(400).json({ error: 'Can only revoke API key for the local server' });
    }

    const revoked = apiKeyManager.revokeApiKey(serverId);
    if (!revoked) {
      return res.status(404).json({ error: 'Server not found or no API key to revoke' });
    }

    logger.info(`API key revoked for server: ${serverId}`);

    res.json({
      success: true,
      message: 'API key revoked successfully'
    });
  } catch (error) {
    logger.error('Error revoking API key:', error.message);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

module.exports = router;
