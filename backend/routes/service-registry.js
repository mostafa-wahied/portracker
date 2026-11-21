'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');

function createRegistryRouter(registry, {
  scanEnabled = false, httpStore = null, provenanceStore = null, dockerProvenanceStore = null,
} = {}) {
  const router = express.Router();

  router.get('/', requireAuth, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const result = registry.listServices({
        serverId: req.query.serverId,
        limit: req.query.limit,
        offset: req.query.offset,
        status: req.query.status,
        source: req.query.source,
        search: req.query.search,
        port: req.query.port,
        seenSince: req.query.seenSince,
      });
      if (httpStore) {
        result.items = result.items.map(item => ({
          ...item, ...httpStore.getMetadata(item.id),
        }));
      }
      res.json(result);
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

  router.get('/icons/:hash', requireAuth, (req, res) => {
    try {
      const icon = httpStore?.getIcon(req.params.hash);
      if (!icon) return res.status(404).json({ error: 'Cached icon not found' });
      res.set({
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'",
        'Content-Type': icon.mime,
      });
      return res.send(icon.bytes);
    } catch {
      return res.status(500).json({ error: 'Unable to load cached icon' });
    }
  });

  router.get('/:id', requireAuth, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const service = registry.getService(req.params.id);
      if (!service) return res.status(404).json({ error: 'Saved service not found' });
      const details = httpStore ? { ...service, ...httpStore.getMetadata(service.id) } : service;
      // The global auth-disabled mode must never expose private host paths.
      if (provenanceStore && process.env.ENABLE_AUTH === 'true') {
        details.linuxProvenance = provenanceStore.get(service.id);
      }
      if (dockerProvenanceStore && process.env.ENABLE_AUTH === 'true') {
        details.dockerProvenance = dockerProvenanceStore.get(service.id);
      }
      return res.json(details);
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
