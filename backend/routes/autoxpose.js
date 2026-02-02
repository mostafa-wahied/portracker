const express = require('express');
const { Logger } = require('../lib/logger');
const autoxposeClient = require('../lib/autoxpose-client');
const settingsManager = require('../lib/settings-manager');
const { isAuthEnabled } = require('../middleware/auth');

const router = express.Router();
const logger = new Logger('AutoxposeRoutes', { debug: process.env.DEBUG === 'true' });

router.get('/status', async (req, res) => {
  try {
    await autoxposeClient.initialize();
    
    const status = autoxposeClient.getStatus();
    const userId = isAuthEnabled() && req.session?.userId ? req.session.userId : null;
    const settings = settingsManager.getUserSettings(userId);
    
    res.json({
      ...status,
      displayMode: settings.autoxposeDisplayMode || 'url',
      urlStyle: settings.autoxposeUrlStyle || 'compact'
    });
  } catch (error) {
    logger.error('Error fetching autoxpose status:', error.message);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

router.post('/connect', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const cleanUrl = url.replace(/\/+$/, '');
    autoxposeClient.setBaseUrl(cleanUrl);
    
    const result = await autoxposeClient.testConnection();
    
    if (result.success) {
      const userId = isAuthEnabled() && req.session?.userId ? req.session.userId : null;
      settingsManager.updateUserSetting(userId, 'autoxposeUrl', cleanUrl);
      settingsManager.updateUserSetting(userId, 'autoxposeEnabled', true);
      settingsManager.updateUserSetting(null, 'autoxposeUrl', cleanUrl);
      settingsManager.updateUserSetting(null, 'autoxposeEnabled', true);
      
      logger.info(`Autoxpose connected: ${cleanUrl}`);
    }
    
    res.json(result);
  } catch (error) {
    logger.error('Error connecting to autoxpose:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/disconnect', (req, res) => {
  try {
    const userId = isAuthEnabled() && req.session?.userId ? req.session.userId : null;
    
    autoxposeClient.setBaseUrl(null);
    settingsManager.updateUserSetting(userId, 'autoxposeEnabled', false);
    settingsManager.deleteSetting(userId, 'autoxposeUrl');
    settingsManager.updateUserSetting(null, 'autoxposeEnabled', false);
    settingsManager.deleteSetting(null, 'autoxposeUrl');
    
    logger.info('Autoxpose disconnected');
    res.json({ success: true });
  } catch (error) {
    logger.error('Error disconnecting autoxpose:', error.message);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.put('/display-mode', (req, res) => {
  try {
    const { mode } = req.body;
    
    if (!mode || !['url', 'badge'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid display mode. Use "url" or "badge".' });
    }

    const userId = isAuthEnabled() && req.session?.userId ? req.session.userId : null;
    settingsManager.updateUserSetting(userId, 'autoxposeDisplayMode', mode);
    settingsManager.updateUserSetting(null, 'autoxposeDisplayMode', mode);
    
    res.json({ success: true, displayMode: mode });
  } catch (error) {
    logger.error('Error updating display mode:', error.message);
    res.status(500).json({ error: 'Failed to update display mode' });
  }
});

router.put('/url-style', (req, res) => {
  try {
    const { style } = req.body;
    
    if (!style || !['full', 'compact'].includes(style)) {
      return res.status(400).json({ error: 'Invalid URL style. Use "full" or "compact".' });
    }

    const userId = isAuthEnabled() && req.session?.userId ? req.session.userId : null;
    settingsManager.updateUserSetting(userId, 'autoxposeUrlStyle', style);
    settingsManager.updateUserSetting(null, 'autoxposeUrlStyle', style);
    
    res.json({ success: true, urlStyle: style });
  } catch (error) {
    logger.error('Error updating URL style:', error.message);
    res.status(500).json({ error: 'Failed to update URL style' });
  }
});

router.get('/services', async (req, res) => {
  try {
    const services = await autoxposeClient.getServices();
    res.json({ services });
  } catch (error) {
    logger.error('Error fetching autoxpose services:', error.message);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

router.get('/domain', async (req, res) => {
  try {
    const domain = await autoxposeClient.getDomain();
    res.json({ domain });
  } catch (error) {
    logger.error('Error fetching autoxpose domain:', error.message);
    res.status(500).json({ error: 'Failed to fetch domain' });
  }
});

module.exports = router;
