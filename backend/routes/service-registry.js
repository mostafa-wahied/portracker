'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { buildRecoveryRecipes } = require('../lib/service-registry/recovery-recipes');

function createRegistryRouter(registry, {
  scanEnabled = false, scanner = null, httpStore = null, provenanceStore = null,
  dockerProvenanceStore = null, recoveryNotesStore = null,
  getCapabilities = null,
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
        portPrefix: req.query.portPrefix,
        pinnedOnly: req.query.pinnedOnly,
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

  // One bounded response for the Pinned Services view. Grouping never
  // changes ownership of pins, recovery notes, or source-specific history.
  router.get('/pinned-groups', requireAuth, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const result = registry.listPinnedGroups({
        serverId: req.query.serverId, limit: req.query.limit,
        offset: req.query.offset, status: req.query.status,
        source: req.query.source, search: req.query.search,
        portPrefix: req.query.portPrefix, seenSince: req.query.seenSince,
      });
      if (httpStore) {
        result.items = result.items.map(group => ({
          ...group, services: group.services.map(service =>
            ({ ...service, ...httpStore.getMetadata(service.id) })),
        }));
        result.items.forEach(group => {
          group.iconHash = group.services.find(service => service.iconHash)?.iconHash || null;
        });
      }
      res.json(result);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to list pinned service groups' });
    }
  });

  router.get('/scan-status', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const sources = registry.getScanStatus('local');
    res.json({
      enabled: scanEnabled,
      sources,
      ...(typeof getCapabilities === 'function'
        ? { capabilities: getCapabilities(sources) } : {}),
    });
  });

  // Manual collection is distinct from Refresh and from legacy live scans.
  // Origin middleware and requireAuth protect this POST; never accept targets.
  let currentManualScan = null;
  let lastManualStart = 0;
  const manualCooldownMs = 3000;
  router.post('/scan', requireAuth, async (_req, res) => {
    if (process.env.ENABLE_AUTH !== 'true') {
      return res.status(403).json({ error: 'Manual scanning requires authentication' });
    }
    if (!scanEnabled || typeof scanner?.scanOnce !== 'function') {
      return res.status(409).json({ error: 'Background discovery is disabled' });
    }

    const now = Date.now();
    if (!currentManualScan && now - lastManualStart < manualCooldownMs) {
      res.set('Retry-After', String(Math.ceil(
        (manualCooldownMs - (now - lastManualStart)) / 1000
      )));
      return res.status(429).json({ error: 'Scan just completed; please try again shortly' });
    }
    if (!currentManualScan) {
      lastManualStart = now;
      // Scanner has its own single-flight guard for concurrent scheduled jobs.
      try {
        currentManualScan = Promise.resolve(scanner.scanOnce({ manual: true }));
      } catch {
        return res.status(503).json({ error: 'Unable to run service discovery' });
      }
    }
    const scan = currentManualScan;
    try {
      const results = await scan;
      res.set('Cache-Control', 'no-store');
      return res.json({
        results: results.map(item => ({
          source: item.source, outcome: item.outcome,
          count: item.count, at: item.at,
        })),
        sources: registry.getScanStatus('local'),
      });
    } catch {
      return res.status(503).json({ error: 'Unable to run service discovery' });
    } finally {
      if (currentManualScan === scan) currentManualScan = null;
    }
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

  // Bookmark a durable logical service, never a network port or a process PID.
  router.put('/:id/pin', requireAuth, (req, res) => {
    try {
      if (!req.body || typeof req.body.pinned !== 'boolean') {
        throw new TypeError('Pinned must be a boolean');
      }
      const service = registry.setPinned(req.params.id, req.body.pinned);
      if (!service) return res.status(404).json({ error: 'Saved service not found' });
      res.set('Cache-Control', 'no-store');
      return res.json({ id: service.id, pinned: service.pinned, pinnedAt: service.pinnedAt });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to update service pin' });
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
      if (recoveryNotesStore && process.env.ENABLE_AUTH === 'true') {
        details.recovery = {
          notes: recoveryNotesStore.get(service.id),
          preferred: recoveryNotesStore.getStart(service.id),
          recipes: buildRecoveryRecipes({
            linuxProvenance: details.linuxProvenance,
            dockerProvenance: details.dockerProvenance,
          }),
        };
      }
      return res.json(details);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to load saved service' });
    }
  });

  router.put('/:id/recovery-start', requireAuth, (req, res) => {
    if (process.env.ENABLE_AUTH !== 'true' || !recoveryNotesStore) {
      return res.status(403).json({ error: 'Authenticated recovery instructions are disabled' });
    }
    try {
      const updated = recoveryNotesStore.saveStart(
        req.params.id, req.body?.command, req.body?.cwd, req.body?.version
      );
      if (!updated) return res.status(404).json({ error: 'Saved service not found' });
      res.set('Cache-Control', 'no-store');
      return res.json({ preferred: updated });
    } catch (error) {
      if (error.code === 'start_conflict') return res.status(409).json({ error: error.message });
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to save preferred startup command' });
    }
  });

  router.put('/:id/recovery-notes', requireAuth, (req, res) => {
    if (process.env.ENABLE_AUTH !== 'true' || !recoveryNotesStore) {
      return res.status(403).json({ error: 'Authenticated recovery notes are disabled' });
    }
    try {
      const updated = recoveryNotesStore.saveNotes(
        req.params.id, req.body?.notes, req.body?.version
      );
      if (!updated) return res.status(404).json({ error: 'Saved service not found' });
      res.set('Cache-Control', 'no-store');
      return res.json({ notes: updated });
    } catch (error) {
      if (error.code === 'notes_conflict') return res.status(409).json({ error: error.message });
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to save recovery notes' });
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
