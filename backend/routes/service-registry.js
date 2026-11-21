'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');

function createRegistryRouter(registry, { scanEnabled = false } = {}) {
  const router = express.Router();

  router.get('/', requireAuth, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(registry.listServices({
        serverId: req.query.serverId,
        limit: req.query.limit,
        offset: req.query.offset,
        status: req.query.status,
        source: req.query.source,
        search: req.query.search,
        port: req.query.port,
      }));
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to list saved services' });
    }
  });

  router.get('/scan-status', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: scanEnabled,
      sources: registry.getScanStatus('local'),
    });
  });

  router.get('/:id', requireAuth, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const service = registry.getService(req.params.id);
      if (!service) return res.status(404).json({ error: 'Saved service not found' });
      return res.json(service);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to load saved service' });
    }
  });

  router.delete('/:id', requireAuth, (req, res) => {
    try {
      if (!registry.forgetService(req.params.id)) {
        return res.status(404).json({ error: 'Saved service not found' });
      }
      return res.status(204).end();
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to forget saved service' });
    }
  });

  return router;
}

module.exports = { createRegistryRouter };
